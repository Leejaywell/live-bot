//! VolcEngine TTS WebSocket 双向客户端
//!
//! 通过 WebSocket 连接火山引擎双向 TTS 服务
//! （wss://openspeech.bytedance.com/api/v3/tts/bidirection），
//! 发送 JSON 合成请求并流式接收 base64 编码的 PCM 音频块。
//!
//! 协议流程：
//!   1. 建立 WebSocket 连接（Header 携带 X-Api-App-Id / X-Api-Access-Key / X-Api-Resource-Id）
//!   2. 发送合成请求 JSON（含 speaker / text / audio_params）
//!   3. 接收 code=0 的音频事件 → base64 解码
//!   4. 接收 code=20000000 → 合成完成

use std::pin::Pin;

use async_stream::try_stream;
use base64::Engine as _;
use futures_util::{SinkExt, Stream, StreamExt};
use serde_json::json;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, warn};
use uuid::Uuid;

use super::volc_engine::{VolcEngineConfig, VolcEngineRequest};
use crate::tts::minimax::AudioChunk;

/// VolcEngine WebSocket 双向 TTS 客户端
#[derive(Clone)]
pub struct VolcEngineWsTtsClient {
    config: VolcEngineConfig,
}

impl VolcEngineWsTtsClient {
    pub fn new(config: VolcEngineConfig) -> Self {
        Self { config }
    }

    /// 合成单句文本，返回 PCM 音频块流。
    pub fn synthesize(
        &self,
        request: VolcEngineRequest,
    ) -> Result<
        Pin<Box<dyn Stream<Item = Result<AudioChunk, anyhow::Error>> + Send + 'static>>,
        anyhow::Error,
    > {
        let speaker = request
            .speaker
            .clone()
            .or_else(|| self.config.default_speaker.clone())
            .ok_or_else(|| anyhow::anyhow!("未配置发音人：请在请求或 VOLC_SPEAKER 中提供"))?;

        let audio_format = request
            .audio_format
            .clone()
            .unwrap_or_else(|| self.config.default_audio_format.clone());

        let sample_rate = request
            .sample_rate
            .unwrap_or(self.config.default_sample_rate);

        let text = request
            .text
            .clone()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| anyhow::anyhow!("VolcEngine WS 请求需要 text 非空"))?;

        let user_uid = request
            .user_uid
            .clone()
            .unwrap_or_else(|| "streamix_user".to_string());

        let session_id = Uuid::new_v4().to_string();
        let app_id = self.config.app_id.clone();
        let access_key = self.config.access_key.clone();
        let resource_id = self.config.resource_id.clone();
        let namespace = request
            .namespace
            .clone()
            .or_else(|| self.config.default_namespace.clone());

        let endpoint = self
            .config
            .endpoint
            .replace("unidirectional", "bidirection")
            .replacen("https://", "wss://", 1);

        // 如果 endpoint 已经是 wss 则直接使用
        let endpoint = if endpoint.starts_with("wss://") {
            endpoint
        } else {
            format!("wss://openspeech.bytedance.com/api/v3/tts/bidirection")
        };

        let stream = try_stream! {
            // 1. 建立 WebSocket 连接（Header 认证）
            let request_builder = tokio_tungstenite::tungstenite::http::Request::builder()
                .uri(&endpoint)
                .header("X-Api-App-Id", &app_id)
                .header("X-Api-Access-Key", &access_key)
                .header("X-Api-Resource-Id", &resource_id)
                .header("X-Api-Request-Id", Uuid::new_v4().to_string())
                .header("Content-Type", "application/json");

            let req = request_builder
                .body(())
                .map_err(|e| anyhow::anyhow!("构建 VolcEngine WS 请求失败: {e}"))?;

            let (ws_stream, _) = tokio_tungstenite::connect_async(req)
                .await
                .map_err(|e| anyhow::anyhow!("VolcEngine WebSocket 连接失败: {e}"))?;

            let (mut write, mut read) = ws_stream.split();

            // 2. 构建并发送合成请求
            let mut req_body = json!({
                "user": { "uid": user_uid },
                "req_params": {
                    "speaker": speaker,
                    "text": text,
                    "audio_params": {
                        "format": audio_format,
                        "sample_rate": sample_rate,
                    },
                },
                "session_id": session_id,
            });

            if let Some(ref ns) = namespace {
                req_body["namespace"] = json!(ns);
            }
            if let Some(ref model) = request.model {
                req_body["req_params"]["model"] = json!(model);
            }
            if let Some(ref emotion) = request.emotion {
                req_body["req_params"]["audio_params"]["emotion"] = json!(emotion);
            }
            if let Some(speech_rate) = request.speech_rate {
                req_body["req_params"]["audio_params"]["speech_rate"] = json!(speech_rate);
            }
            if let Some(loudness_rate) = request.loudness_rate {
                req_body["req_params"]["audio_params"]["loudness_rate"] = json!(loudness_rate);
            }
            if let Some(ref lang) = request.language {
                req_body["req_params"]["audio_params"]["language"] = json!(lang);
            }

            let req_text = serde_json::to_string(&req_body)
                .map_err(|e| anyhow::anyhow!("序列化 VolcEngine WS 请求失败: {e}"))?;

            write
                .send(Message::Text(req_text.into()))
                .await
                .map_err(|e| anyhow::anyhow!("发送 VolcEngine WS 请求失败: {e}"))?;

            debug!("VolcEngine WS: 合成请求已发送, speaker={}", speaker);

            // 3. 读取响应
            let mut sequence_id: u64 = 0;
            let mut final_sent = false;

            while let Some(msg) = read.next().await {
                let msg = msg.map_err(|e| anyhow::anyhow!("读取 VolcEngine WS 消息失败: {e}"))?;

                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Binary(b) => {
                        debug!("VolcEngine WS: 收到二进制消息, 长度={}", b.len());
                        continue;
                    }
                    Message::Close(_) => {
                        debug!("VolcEngine WS: 连接关闭");
                        break;
                    }
                    Message::Ping(data) => {
                        let _ = write.send(Message::Pong(data)).await;
                        continue;
                    }
                    Message::Pong(_) => continue,
                    Message::Frame(_) => continue,
                };

                let payload: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("VolcEngine WS: 解析响应失败: {e}, raw={}", &text[..text.len().min(200)]);
                        continue;
                    }
                };

                let code = payload.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);

                match code {
                    0 => {
                        // 音频事件
                        if let Some(data_b64) = payload.get("data").and_then(|d| d.as_str()) {
                            let audio_bytes = base64::engine::general_purpose::STANDARD
                                .decode(data_b64.trim())
                                .map_err(|e| anyhow::anyhow!("解码 VolcEngine WS 音频 base64 失败: {e}"))?;

                            if !audio_bytes.is_empty() {
                                let chunk = AudioChunk::new_with_gain_and_sample_rate(
                                    audio_bytes,
                                    sequence_id,
                                    false,
                                    0.0,
                                    sample_rate,
                                );
                                sequence_id = sequence_id.saturating_add(1);
                                yield chunk;
                            }
                        } else if let Some(sentence) = payload.get("sentence").and_then(|s| s.get("text")).and_then(|t| t.as_str()) {
                            debug!("VolcEngine WS: 文本事件: sentence='{}'", sentence);
                        } else {
                            debug!("VolcEngine WS: code=0 非音频事件: {}", text);
                        }
                    }
                    20000000 => {
                        // 合成完成
                        debug!("VolcEngine WS: 合成完成");
                        final_sent = true;
                        break;
                    }
                    code => {
                        let message = payload
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("未知错误");
                        Err(anyhow::anyhow!(
                            "VolcEngine WS 错误: code={}, message={}",
                            code,
                            message
                        ))?;
                    }
                }
            }

            if !final_sent {
                warn!("VolcEngine WS: 流未收到完成事件，主动结束");
            }

            // 发送最终控制块
            let final_chunk = AudioChunk::new_with_gain_and_sample_rate(
                Vec::new(),
                u64::MAX,
                true,
                0.0,
                sample_rate,
            );
            yield final_chunk;

            let _ = write.close().await;
        };

        Ok(Box::pin(stream))
    }
}
