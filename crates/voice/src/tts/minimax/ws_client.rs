//! MiniMax TTS WebSocket 客户端
//!
//! 通过 WebSocket 连接 MiniMax TTS 服务（wss://api.minimaxi.com/ws/v1/t2a_v2），
//! 使用 task_start / task_continue / task_finish 协议进行流式语音合成。
//!
//! 协议流程：
//!   1. 建立 WebSocket 连接（Authorization: Bearer 头）
//!   2. 发送 task_start → 接收 connected_success / task_started
//!   3. 发送 task_continue(text) → 接收 task_continued（含 hex 音频）
//!   4. 发送 task_finish → 接收 task_finished

use std::pin::Pin;

use async_stream::try_stream;
use futures_util::{SinkExt, Stream, StreamExt};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};
use tracing::{debug, warn};

use super::AudioChunk;
use super::config::MiniMaxConfig;
use super::types::{
    AudioSetting, MiniMaxError, TaskContinueRequest, TaskFinishRequest, TaskStartRequest,
    VoiceSetting, WebSocketResponse,
};
use super::voice_library::global_voice_library;

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
    ) -> Result<
        Pin<Box<dyn Stream<Item = Result<AudioChunk, MiniMaxError>> + Send + 'static>>,
        MiniMaxError,
    > {
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
            let mut request = ws_url
                .as_str()
                .into_client_request()
                .map_err(|e| MiniMaxError::WebSocket(format!("构建请求失败: {e}")))?;
            request.headers_mut().insert(
                "Authorization",
                format!("Bearer {}", api_key)
                    .parse()
                    .map_err(|e| MiniMaxError::Auth(format!("Authorization header 无效: {e}")))?,
            );

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

            // 文档要求：收到 task_started 后才能发送 task_continue / task_finish。
            loop {
                let msg = read.next().await.ok_or_else(|| {
                    MiniMaxError::WebSocket("等待 task_started 时连接已关闭".to_string())
                })?;
                let msg = msg.map_err(|e| MiniMaxError::WebSocket(format!("读取消息失败: {e}")))?;
                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Ping(data) => {
                        let _ = write.send(Message::Pong(data)).await;
                        continue;
                    }
                    Message::Close(_) => {
                        Err(MiniMaxError::WebSocket("等待 task_started 时连接关闭".to_string()))?
                    }
                    _ => continue,
                };
                let response: WebSocketResponse = serde_json::from_str(&text)
                    .map_err(|e| MiniMaxError::Other(format!("解析握手响应失败: {e}")))?;
                match response {
                    WebSocketResponse::ConnectedSuccess { base_resp, .. } => {
                        if !base_resp.is_success() {
                            Err(MiniMaxError::Api(base_resp.error_message()))?;
                        }
                    }
                    WebSocketResponse::TaskStarted { base_resp, .. } => {
                        if !base_resp.is_success() {
                            Err(MiniMaxError::Api(base_resp.error_message()))?;
                        }
                        debug!("MiniMax WS: 任务已启动");
                        break;
                    }
                    WebSocketResponse::TaskFailed { base_resp, .. } => {
                        Err(MiniMaxError::Api(base_resp.error_message()))?;
                    }
                    _ => {}
                }
            }

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
                            let audio_bytes = hex::decode(&d.audio)
                                .map_err(|e| MiniMaxError::Other(format!("音频数据hex解码失败: {e}")))?;

                            if !audio_bytes.is_empty() {
                                let sample_rate = extra_info
                                    .as_ref()
                                    .and_then(|extra| extra.audio_sample_rate)
                                    .unwrap_or(44100);
                                let chunk = AudioChunk::new_with_gain_and_sample_rate(
                                    audio_bytes,
                                    sequence_id,
                                    false,
                                    gain_db,
                                    sample_rate,
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

    /// 直接使用调用方提供的 API Key 与 voice_id 进行合成。
    pub fn synthesize_direct(
        &self,
        api_key: &str,
        voice_id: &str,
        text: &str,
        voice_setting: Option<VoiceSetting>,
        audio_setting: Option<AudioSetting>,
    ) -> Result<
        Pin<Box<dyn Stream<Item = Result<AudioChunk, MiniMaxError>> + Send + 'static>>,
        MiniMaxError,
    > {
        if text.trim().is_empty() {
            return Err(MiniMaxError::Config("文本内容不能为空".to_string()));
        }
        if api_key.trim().is_empty() {
            return Err(MiniMaxError::Config("MiniMax API Key 不能为空".to_string()));
        }
        if voice_id.trim().is_empty() {
            return Err(MiniMaxError::Config(
                "MiniMax voice_id 不能为空".to_string(),
            ));
        }

        let mut voice_setting = voice_setting.unwrap_or_default();
        voice_setting.voice_id = Some(voice_id.to_string());

        let audio_setting = audio_setting.unwrap_or_default();
        let model = self.config.model.clone();
        let ws_url = self.config.ws_url.clone();
        let text = text.to_string();
        let api_key = api_key.to_string();

        let stream = try_stream! {
            let mut request = ws_url
                .as_str()
                .into_client_request()
                .map_err(|e| MiniMaxError::WebSocket(format!("构建请求失败: {e}")))?;
            request.headers_mut().insert(
                "Authorization",
                format!("Bearer {}", api_key)
                    .parse()
                    .map_err(|e| MiniMaxError::Auth(format!("Authorization header 无效: {e}")))?,
            );

            let (ws_stream, _) = tokio_tungstenite::connect_async(request)
                .await
                .map_err(|e| MiniMaxError::WebSocket(format!("WebSocket 连接失败: {e}")))?;

            let (mut write, mut read) = ws_stream.split();

            let task_start = serde_json::to_string(&TaskStartRequest {
                event: "task_start".to_string(),
                model,
                voice_setting,
                audio_setting: Some(audio_setting),
                pronunciation_dict: None,
                timbre_weights: None,
                language_boost: Some("Chinese".to_string()),
                voice_modify: None,
            })
            .map_err(MiniMaxError::Json)?;

            write
                .send(Message::Text(task_start.into()))
                .await
                .map_err(|e| MiniMaxError::WebSocket(format!("发送 task_start 失败: {e}")))?;

            debug!("MiniMax WS(direct): task_start 已发送");

            // 文档要求：收到 task_started 后才能发送 task_continue / task_finish。
            loop {
                let msg = read.next().await.ok_or_else(|| MiniMaxError::WebSocket("等待 task_started 时连接已关闭".to_string()))?;
                let msg = msg.map_err(|e| MiniMaxError::WebSocket(format!("读取消息失败: {e}")))?;
                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Ping(data) => {
                        let _ = write.send(Message::Pong(data)).await;
                        continue;
                    }
                    Message::Close(_) => Err(MiniMaxError::WebSocket("等待 task_started 时连接关闭".to_string()))?,
                    _ => continue,
                };
                let response: WebSocketResponse = serde_json::from_str(&text)
                    .map_err(|e| MiniMaxError::Other(format!("解析握手响应失败: {e}")))?;
                match response {
                    WebSocketResponse::ConnectedSuccess { base_resp, .. } => {
                        if !base_resp.is_success() {
                            Err(MiniMaxError::Api(base_resp.error_message()))?;
                        }
                    }
                    WebSocketResponse::TaskStarted { base_resp, .. } => {
                        if !base_resp.is_success() {
                            Err(MiniMaxError::Api(base_resp.error_message()))?;
                        }
                        break;
                    }
                    WebSocketResponse::TaskFailed { base_resp, .. } => {
                        Err(MiniMaxError::Api(base_resp.error_message()))?;
                    }
                    _ => {}
                }
            }

            let task_continue = serde_json::to_string(&TaskContinueRequest {
                event: "task_continue".to_string(),
                text,
            })
            .map_err(MiniMaxError::Json)?;

            write
                .send(Message::Text(task_continue.into()))
                .await
                .map_err(|e| MiniMaxError::WebSocket(format!("发送 task_continue 失败: {e}")))?;

            let task_finish = serde_json::to_string(&TaskFinishRequest {
                event: "task_finish".to_string(),
            })
            .map_err(MiniMaxError::Json)?;

            write
                .send(Message::Text(task_finish.into()))
                .await
                .map_err(|e| MiniMaxError::WebSocket(format!("发送 task_finish 失败: {e}")))?;

            let mut sequence_id: u64 = 0;
            while let Some(msg) = read.next().await {
                let msg = msg.map_err(|e| MiniMaxError::WebSocket(format!("读取消息失败: {e}")))?;
                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Binary(b) => {
                        warn!("MiniMax WS(direct): 收到意外二进制消息，长度={}", b.len());
                        continue;
                    }
                    Message::Close(_) => break,
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
                        warn!("MiniMax WS(direct): 解析响应失败: {e}, raw={}", &text[..text.len().min(200)]);
                        continue;
                    }
                };

                match response {
                    WebSocketResponse::TaskContinued { data, base_resp, extra_info, .. } => {
                        if !base_resp.is_success() {
                            Err(MiniMaxError::Api(base_resp.error_message()))?;
                        }

                        let sample_rate = extra_info
                            .as_ref()
                            .and_then(|extra| extra.audio_sample_rate)
                            .unwrap_or(44100);

                        if let Some(d) = data {
                            let audio_bytes = hex::decode(&d.audio)
                                .map_err(|e| MiniMaxError::Other(format!("音频数据hex解码失败: {e}")))?;

                            if !audio_bytes.is_empty() {
                                yield AudioChunk::new_with_gain_and_sample_rate(
                                    audio_bytes,
                                    sequence_id,
                                    false,
                                    0.0,
                                    sample_rate,
                                );
                                sequence_id = sequence_id.saturating_add(1);
                            }
                        }
                    }
                    WebSocketResponse::TaskFinished { base_resp, .. } => {
                        if !base_resp.is_success() {
                            Err(MiniMaxError::Api(base_resp.error_message()))?;
                        }
                        break;
                    }
                    WebSocketResponse::TaskFailed { base_resp, .. } => {
                        Err(MiniMaxError::Api(base_resp.error_message()))?;
                    }
                    WebSocketResponse::ConnectedSuccess { .. } | WebSocketResponse::TaskStarted { .. } => {}
                }
            }

            yield AudioChunk::new_with_gain_and_sample_rate(Vec::new(), u64::MAX, true, 0.0, 44100);
            let _ = write.close().await;
        };

        Ok(Box::pin(stream))
    }
}
