//! MiniMax TTS WebSocket 客户端
//!
//! 通过 WebSocket 连接 MiniMax TTS 服务（wss://api.minimaxi.com/ws/v1/t2a_v2），
//! 使用 task_start / task_continue / task_finish 协议进行流式语音合成。
//!
//! 协议流程：
//!   1. 建立 WebSocket 连接（Authorization: Bearer 头）
//!   2. 发送 task_start → 接收 connected_success / task_started
//!   3. 发送 task_continue(text) → 接收 task_continued（含 base64 音频）
//!   4. 发送 task_finish → 接收 task_finished

use std::pin::Pin;

use async_stream::try_stream;
use base64::Engine as _;
use futures_util::{SinkExt, Stream, StreamExt};
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, warn};

use super::config::MiniMaxConfig;
use super::types::{
    AudioSetting, MiniMaxError, TaskContinueRequest, TaskFinishRequest, TaskStartRequest,
    VoiceSetting, WebSocketResponse,
};
use super::voice_library::global_voice_library;
use super::AudioChunk;

/// MiniMax TTS WebSocket 客户端
#[derive(Clone)]
pub struct MiniMaxWsTtsClient {
    config: MiniMaxConfig,
}

impl MiniMaxWsTtsClient {
    pub fn new(config: MiniMaxConfig) -> Self {
        Self { config }
    }

    pub fn with_defaults() -> Self {
        Self::new(MiniMaxConfig::default())
    }

    /// 合成单句文本，返回 PCM 音频块流。
    ///
    /// `virtual_voice_id` 通过声音库映射到实际的 voice_id 和 API key。
    pub fn synthesize(
        &self,
        virtual_voice_id: &str,
        text: &str,
        voice_setting: Option<VoiceSetting>,
        audio_setting: Option<AudioSetting>,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<AudioChunk, MiniMaxError>> + Send + 'static>>, MiniMaxError>
    {
        if text.trim().is_empty() {
            return Err(MiniMaxError::Config("文本内容不能为空".to_string()));
        }

        let (api_key, actual_voice_id) = self
            .config
            .get_voice_from_library(virtual_voice_id)
            .ok_or_else(|| {
                MiniMaxError::Config(format!("声音库未找到虚拟 voice_id: {}", virtual_voice_id))
            })?;

        let mut voice_setting = voice_setting.unwrap_or_default();
        voice_setting.voice_id = Some(actual_voice_id.clone());

        // 从声音库读取自定义配置
        if let Some(speed) = global_voice_library().get_speed(virtual_voice_id) {
            voice_setting.speed = Some(speed);
        }
        if let Some(pitch) = global_voice_library().get_pitch(virtual_voice_id) {
            voice_setting.pitch = Some(pitch);
        }
        if let Some(emotion) = global_voice_library().get_emotion(virtual_voice_id) {
            voice_setting.emotion = Some(emotion);
        }
        if let Some(vol) = global_voice_library().get_vol(virtual_voice_id) {
            voice_setting.vol = Some(vol);
        }

        let model = global_voice_library()
            .get_model(virtual_voice_id)
            .unwrap_or_else(|| self.config.model.clone());

        let audio_setting = audio_setting.unwrap_or_default();
        let gain_db = global_voice_library().get_gain_db(virtual_voice_id);
        let ws_url = self.config.ws_url.clone();
        let text = text.to_string();

        let stream = try_stream! {
            // 1. 建立 WebSocket 连接
            let request = tokio_tungstenite::tungstenite::http::Request::builder()
                .uri(&ws_url)
                .header("Authorization", format!("Bearer {}", api_key))
                .body(())
                .map_err(|e| MiniMaxError::WebSocket(format!("构建请求失败: {e}")))?;

            let (ws_stream, _) = tokio_tungstenite::connect_async(request)
                .await
                .map_err(|e| MiniMaxError::WebSocket(format!("WebSocket 连接失败: {e}")))?;

            let (mut write, mut read) = ws_stream.split();

            // 2. 发送 task_start
            let task_start = serde_json::to_string(&TaskStartRequest {
                event: "task_start".to_string(),
                model: model.clone(),
                voice_setting: voice_setting.clone(),
                audio_setting: Some(audio_setting.clone()),
                pronunciation_dict: None,
                timbre_weights: None,
                language_boost: None,
                voice_modify: None,
            })
            .map_err(|e| MiniMaxError::Json(e))?;

            write
                .send(Message::Text(task_start.into()))
                .await
                .map_err(|e| MiniMaxError::WebSocket(format!("发送 task_start 失败: {e}")))?;

            debug!("MiniMax WS: task_start 已发送");

            // 3. 发送 task_continue
            let task_continue = serde_json::to_string(&TaskContinueRequest {
                event: "task_continue".to_string(),
                text: text.clone(),
            })
            .map_err(|e| MiniMaxError::Json(e))?;

            write
                .send(Message::Text(task_continue.into()))
                .await
                .map_err(|e| MiniMaxError::WebSocket(format!("发送 task_continue 失败: {e}")))?;

            debug!("MiniMax WS: task_continue 已发送");

            // 4. 发送 task_finish
            let task_finish = serde_json::to_string(&TaskFinishRequest {
                event: "task_finish".to_string(),
            })
            .map_err(|e| MiniMaxError::Json(e))?;

            write
                .send(Message::Text(task_finish.into()))
                .await
                .map_err(|e| MiniMaxError::WebSocket(format!("发送 task_finish 失败: {e}")))?;

            debug!("MiniMax WS: task_finish 已发送");

            // 5. 读取响应
            let mut sequence_id: u64 = 0;

            while let Some(msg) = read.next().await {
                let msg = msg.map_err(|e| MiniMaxError::WebSocket(format!("读取消息失败: {e}")))?;

                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Binary(b) => {
                        warn!("MiniMax WS: 收到意外二进制消息，长度={}", b.len());
                        continue;
                    }
                    Message::Close(_) => {
                        debug!("MiniMax WS: 连接关闭");
                        break;
                    }
                    Message::Ping(data) => {
                        let _ = write.send(Message::Pong(data)).await;
                        continue;
                    }
                    Message::Pong(_) => continue,
                    Message::Frame(_) => continue,
                };

                let response: WebSocketResponse = match serde_json::from_str(&text) {
                    Ok(r) => r,
                    Err(e) => {
                        warn!("MiniMax WS: 解析响应失败: {e}, raw={}", &text[..text.len().min(200)]);
                        continue;
                    }
                };

                match response {
                    WebSocketResponse::ConnectedSuccess { base_resp, session_id, .. } => {
                        if !base_resp.is_success() {
                            Err(MiniMaxError::Api(base_resp.error_message()))?;
                        }
                        debug!("MiniMax WS: 连接成功, session={}", session_id);
                    }
                    WebSocketResponse::TaskStarted { base_resp, .. } => {
                        if !base_resp.is_success() {
                            Err(MiniMaxError::Api(base_resp.error_message()))?;
                        }
                        debug!("MiniMax WS: 任务已启动");
                    }
                    WebSocketResponse::TaskContinued { data, base_resp, extra_info, .. } => {
                        if !base_resp.is_success() {
                            Err(MiniMaxError::Api(base_resp.error_message()))?;
                        }

                        if let Some(extra) = &extra_info {
                            debug!(
                                "MiniMax WS: extra_info duration={}ms, sample_rate={:?}, format={:?}",
                                extra.audio_length.unwrap_or_default(),
                                extra.audio_sample_rate,
                                extra.audio_format
                            );
                        }

                        if let Some(d) = data {
                            let audio_bytes = base64::engine::general_purpose::STANDARD
                                .decode(&d.audio)
                                .map_err(|e| MiniMaxError::Other(format!("base64 解码失败: {e}")))?;

                            if !audio_bytes.is_empty() {
                                let chunk = AudioChunk::new_with_gain_and_sample_rate(
                                    audio_bytes,
                                    sequence_id,
                                    false,
                                    gain_db,
                                    44100,
                                );
                                sequence_id = sequence_id.saturating_add(1);
                                yield chunk;
                            }
                        }
                    }
                    WebSocketResponse::TaskFinished { base_resp, .. } => {
                        if !base_resp.is_success() {
                            Err(MiniMaxError::Api(base_resp.error_message()))?;
                        }
                        debug!("MiniMax WS: 任务完成");
                        break;
                    }
                    WebSocketResponse::TaskFailed { base_resp, .. } => {
                        Err(MiniMaxError::Api(base_resp.error_message()))?;
                    }
                }
            }

            // 发送最终控制块
            let final_chunk = AudioChunk::new_with_gain_and_sample_rate(
                Vec::new(),
                u64::MAX,
                true,
                gain_db,
                44100,
            );
            yield final_chunk;

            let _ = write.close().await;
        };

        Ok(Box::pin(stream))
    }
}
