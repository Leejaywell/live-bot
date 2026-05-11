//! OBS WebSocket 5.x 场景感知客户端
//!
//! 连接 OBS Studio 的 WebSocket 服务（默认端口 4455），
//! 订阅场景切换和推流状态事件，通过 SpeakerRouter 播报系统提示。
//!
//! 连接流程：
//!   1. 连接 ws://host:port
//!   2. 接收 Hello（op=0）→ 提取认证信息（可选）
//!   3. 发送 Identify（op=1）→ 含认证 + 事件订阅掩码
//!   4. 接收 Identified（op=2）→ 准备就绪
//!   5. 接收 Event（op=5）→ 场景切换 / 推流开关

use anyhow::Result;
use base64::{Engine as _, engine::general_purpose};
use futures_util::SinkExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

use streamix_voice::SpeakerRouter;

/// OBS WebSocket 事件订阅掩码
/// Scenes (bit 2 = 4) | Outputs (bit 6 = 64)
const EVENT_SUBSCRIPTIONS: u32 = 4 | 64;

/// 场景事件：AI 可感知当前 OBS 场景
#[derive(Debug, Clone)]
pub enum ObsEvent {
    SceneChanged { scene_name: String },
    StreamStarted,
    StreamStopped,
}

/// 连接 OBS WebSocket 并持续监听事件，触发 TTS 播报
pub async fn run_obs_client(
    host: &str,
    port: u16,
    password: &str,
    tts_router: SpeakerRouter,
    cancel: CancellationToken,
) -> Result<()> {
    let url = format!("ws://{host}:{port}");

    let (ws_stream, _) = tokio_tungstenite::connect_async(&url).await?;
    let (mut writer, mut reader) = futures_util::StreamExt::split(ws_stream);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => return Ok(()),
            msg = futures_util::StreamExt::next(&mut reader) => {
                let msg: Message = match msg {
                    Some(Ok(m)) => m,
                    Some(Err(e)) => return Err(e.into()),
                    None => return Ok(()),
                };

                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Close(_) => return Ok(()),
                    _ => continue,
                };

                let packet: Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let op = packet["op"].as_u64().unwrap_or(99);
                match op {
                    // Hello → Identify
                    0 => {
                        let auth_str = if !password.is_empty() {
                            if let (Some(challenge), Some(salt)) = (
                                packet["d"]["authentication"]["challenge"].as_str(),
                                packet["d"]["authentication"]["salt"].as_str(),
                            ) {
                                Some(compute_auth(password, salt, challenge))
                            } else {
                                None
                            }
                        } else {
                            None
                        };

                        let identify = if let Some(auth) = auth_str {
                            json!({ "op": 1, "d": { "rpcVersion": 1, "authentication": auth, "eventSubscriptions": EVENT_SUBSCRIPTIONS } })
                        } else {
                            json!({ "op": 1, "d": { "rpcVersion": 1, "eventSubscriptions": EVENT_SUBSCRIPTIONS } })
                        };

                        writer
                            .send(Message::Text(identify.to_string().into()))
                            .await?;
                    }
                    // Identified → 连接就绪，播报提示
                    2 => {
                        let _ = tts_router.speak_system("OBS 场景感知已就绪").await;
                    }
                    // Event
                    5 => {
                        if let Some(event) = parse_obs_event(&packet) {
                            handle_obs_event(event, &tts_router).await;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

fn parse_obs_event(packet: &Value) -> Option<ObsEvent> {
    let event_type = packet["d"]["eventType"].as_str()?;
    match event_type {
        "CurrentProgramSceneChanged" => {
            let scene = packet["d"]["eventData"]["sceneName"].as_str()?.to_string();
            Some(ObsEvent::SceneChanged { scene_name: scene })
        }
        "StreamStateChanged" => {
            let active = packet["d"]["eventData"]["outputActive"].as_bool()?;
            if active {
                Some(ObsEvent::StreamStarted)
            } else {
                Some(ObsEvent::StreamStopped)
            }
        }
        _ => None,
    }
}

async fn handle_obs_event(event: ObsEvent, router: &SpeakerRouter) {
    let text = match event {
        ObsEvent::SceneChanged { scene_name } => format!("切换场景：{scene_name}"),
        ObsEvent::StreamStarted => "推流已开始".to_string(),
        ObsEvent::StreamStopped => "推流已停止".to_string(),
    };
    let _ = router.speak_system(text).await;
}

/// OBS WebSocket 5.x 认证：SHA256(base64(SHA256(password + salt)) + challenge)
fn compute_auth(password: &str, salt: &str, challenge: &str) -> String {
    let secret = Sha256::digest(format!("{password}{salt}").as_bytes());
    let secret_b64 = general_purpose::STANDARD.encode(secret);
    let auth = Sha256::digest(format!("{secret_b64}{challenge}").as_bytes());
    general_purpose::STANDARD.encode(auth)
}
