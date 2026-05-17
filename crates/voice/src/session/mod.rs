//! Voice Session Actor
//!
//! 1 会话 = 1 Actor，通过 tokio::mpsc 驱动，无共享状态。
//!
//! 外部通过 VoiceSession 发送命令，内部独立运行 TTS / ASR 任务。
//! 中断通过替换 GenerationHandle 实现（旧 handle drop = 旧任务 abort）。

pub mod interrupt;
pub mod router;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info};

use crate::pipeline::frame::{AudioFrame, ControlFrame, Frame};
use interrupt::{GenerationHandle, InterruptEngine};

/// 发给 Session Actor 的命令
#[derive(Debug)]
pub enum SessionCommand {
    /// TTS：将文本合成语音并播放
    Speak(SpeakRequest),
    /// 中断当前 TTS 输出
    Interrupt,
    /// 外部帧输入（来自麦克风/ASR）
    Frame(Frame),
    /// 关闭 session
    Shutdown,
    /// 内部：TTS 任务自然结束（用于重置 current_priority）
    SpeechFinished,
}

#[derive(Debug, Clone)]
pub struct SpeakRequest {
    /// 要朗读的文本
    pub text: String,
    /// TTS 引擎类型
    pub engine: TtsEngine,
    /// 优先级高的请求会自动中断低优先级的
    pub priority: u8,
    /// SSML prosody 语速（如 "+10%"），None 使用引擎默认值
    pub rate: Option<String>,
    /// SSML prosody 音高（如 "+5Hz"），None 使用引擎默认值
    pub pitch: Option<String>,
    /// SSML prosody 音量（如 "+10%"），None 使用引擎默认值
    pub volume: Option<String>,
}

impl SpeakRequest {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            engine: TtsEngine::Edge,
            priority: 0,
            rate: None,
            pitch: None,
            volume: None,
        }
    }
    pub fn with_engine(mut self, engine: TtsEngine) -> Self {
        self.engine = engine;
        self
    }
    pub fn with_priority(mut self, p: u8) -> Self {
        self.priority = p;
        self
    }
    pub fn with_rate(mut self, rate: impl Into<String>) -> Self {
        self.rate = Some(rate.into());
        self
    }
    pub fn with_pitch(mut self, pitch: impl Into<String>) -> Self {
        self.pitch = Some(pitch.into());
        self
    }
    pub fn with_volume(mut self, volume: impl Into<String>) -> Self {
        self.volume = Some(volume.into());
        self
    }
}

#[derive(Debug, Clone)]
pub enum TtsEngine {
    Edge,
    MiniMax {
        api_key: String,
        voice_id: String,
        model: String,
        ws_url: String,
    },
    Azure {
        subscription_key: String,
        region: String,
    },
    VolcEngine {
        app_id: String,
        access_key: String,
        resource_id: String,
        speaker: String,
    },
    /// 本地 sherpa-onnx 推理（Kokoro / MeloTTS / Piper）
    #[cfg(feature = "local-tts")]
    LocalTts {
        engine: std::sync::Arc<crate::tts::local::LocalTtsEngine>,
        speaker_id: i32,
        speed: f32,
    },
}

/// Session 产出的事件（可订阅）
#[derive(Debug, Clone)]
pub enum SessionEvent {
    /// TTS 音频帧（可直接播放）
    AudioReady(AudioFrame),
    /// TTS 开始
    SpeechStart { text: String },
    /// TTS 完成
    SpeechEnd,
    /// TTS 被中断
    SpeechInterrupted,
    /// TTS 合成失败
    SpeechError { message: String },
    /// ASR 转写结果
    Transcript { text: String, is_final: bool },
    /// Session 已关闭
    Closed,
}

/// Voice Session 的客户端句柄
///
/// Clone 后多处持有，共享同一个 actor。
#[derive(Clone)]
pub struct VoiceSession {
    cmd_tx: mpsc::Sender<SessionCommand>,
    event_tx: tokio::sync::broadcast::Sender<SessionEvent>,
}

impl VoiceSession {
    /// 创建新的 Session，返回句柄和后台 actor 的 JoinHandle
    pub fn spawn(config: SessionConfig) -> (Self, tokio::task::JoinHandle<()>) {
        let (cmd_tx, cmd_rx) = mpsc::channel(64);
        let (event_tx, _) = tokio::sync::broadcast::channel(128);
        let event_tx_clone = event_tx.clone();

        let session = Self { cmd_tx, event_tx };

        let cmd_tx_inner = session.cmd_tx.clone();
        let handle = tokio::spawn(async move {
            SessionActor::new(config, cmd_tx_inner, cmd_rx, event_tx_clone)
                .run()
                .await;
        });

        (session, handle)
    }

    /// 合成并播放文本
    pub async fn speak(&self, req: SpeakRequest) -> Result<(), SessionError> {
        self.cmd_tx
            .send(SessionCommand::Speak(req))
            .await
            .map_err(|_| SessionError::SessionClosed)
    }

    /// 中断当前 TTS
    pub async fn interrupt(&self) -> Result<(), SessionError> {
        self.cmd_tx
            .send(SessionCommand::Interrupt)
            .await
            .map_err(|_| SessionError::SessionClosed)
    }

    /// 推送外部帧（麦克风音频等）
    pub async fn push_frame(&self, frame: Frame) -> Result<(), SessionError> {
        self.cmd_tx
            .send(SessionCommand::Frame(frame))
            .await
            .map_err(|_| SessionError::SessionClosed)
    }

    /// 关闭 session
    pub async fn shutdown(&self) {
        let _ = self.cmd_tx.send(SessionCommand::Shutdown).await;
    }

    /// 订阅 session 事件
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<SessionEvent> {
        self.event_tx.subscribe()
    }
}

/// Session 配置
#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub session_id: String,
    /// TTS 输出 channel 缓冲大小
    pub audio_buffer: usize,
    /// Edge TTS 声音名称（如 "zh-CN-XiaoxiaoNeural"）
    pub tts_voice: String,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            session_id: uuid::Uuid::new_v4().to_string(),
            audio_buffer: 32,
            tts_voice: "zh-CN-XiaoxiaoNeural".to_string(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("session is closed")]
    SessionClosed,
    #[error("tts error: {0}")]
    Tts(String),
}

/// 内部 Actor：持有所有可变状态
struct SessionActor {
    config: SessionConfig,
    cmd_tx: mpsc::Sender<SessionCommand>,
    cmd_rx: mpsc::Receiver<SessionCommand>,
    event_tx: tokio::sync::broadcast::Sender<SessionEvent>,
    interrupt: InterruptEngine,
    /// 当前 TTS 任务的句柄（replace 即可中断旧任务）
    current_generation: Option<GenerationHandle>,
    /// 当前正在播放的 TTS 优先级（用于抢占判断）
    current_priority: u8,
    #[cfg(feature = "tts")]
    edge_client: crate::tts::EdgeTtsClient,
}

impl SessionActor {
    fn new(
        config: SessionConfig,
        cmd_tx: mpsc::Sender<SessionCommand>,
        cmd_rx: mpsc::Receiver<SessionCommand>,
        event_tx: tokio::sync::broadcast::Sender<SessionEvent>,
    ) -> Self {
        #[cfg(feature = "tts")]
        let edge_client = crate::tts::EdgeTtsClient::new(
            crate::tts::EdgeTtsConfig::default().with_voice(&config.tts_voice),
        );
        Self {
            config,
            cmd_tx,
            cmd_rx,
            event_tx,
            interrupt: InterruptEngine::new(),
            current_generation: None,
            current_priority: 0,
            #[cfg(feature = "tts")]
            edge_client,
        }
    }

    async fn run(mut self) {
        info!("session {} started", self.config.session_id);

        while let Some(cmd) = self.cmd_rx.recv().await {
            match cmd {
                SessionCommand::Speak(req) => self.handle_speak(req),
                SessionCommand::Interrupt => self.handle_interrupt(),
                SessionCommand::Frame(frame) => self.handle_frame(frame).await,
                SessionCommand::SpeechFinished => {
                    self.current_generation = None;
                    self.current_priority = 0;
                }
                SessionCommand::Shutdown => {
                    info!("session {} shutting down", self.config.session_id);
                    let _ = self.event_tx.send(SessionEvent::Closed);
                    break;
                }
            }
        }
    }

    fn handle_speak(&mut self, req: SpeakRequest) {
        // 优先级抢占：只有更高优先级才允许打断。
        // 同优先级重复请求丢弃，避免同一条弹幕从多个前端事件源重复进入时切断正文。
        if self.current_generation.is_some() && req.priority <= self.current_priority {
            debug!(
                "speak request priority {} <= current {}, discarded",
                req.priority, self.current_priority
            );
            return;
        }

        let priority = req.priority;
        let text = req.text.clone();
        let event_tx = self.event_tx.clone();
        let cmd_tx = self.cmd_tx.clone();
        #[cfg(feature = "tts")]
        let edge_client = {
            if req.rate.is_some() || req.pitch.is_some() || req.volume.is_some() {
                self.edge_client.with_prosody_override(
                    req.rate.clone(),
                    req.pitch.clone(),
                    req.volume.clone(),
                )
            } else {
                self.edge_client.clone()
            }
        };

        let _ = event_tx.send(SessionEvent::SpeechStart { text: text.clone() });

        let handle = self.interrupt.start(move |cancel_token| async move {
            #[cfg(feature = "tts")]
            Self::run_tts(
                text,
                req.engine,
                edge_client,
                req.rate,
                req.pitch,
                req.volume,
                cancel_token,
                event_tx,
            )
            .await;
            #[cfg(not(feature = "tts"))]
            {
                let _ = (text, req.engine, cancel_token);
                let _ = event_tx.send(SessionEvent::SpeechEnd);
            }
            // 通知 Actor 自然结束，重置 current_priority
            let _ = cmd_tx.try_send(SessionCommand::SpeechFinished);
        });

        self.current_generation = Some(handle);
        self.current_priority = priority;
    }

    fn handle_interrupt(&mut self) {
        if self.current_generation.is_some() {
            debug!("session interrupt: dropping generation handle");
            self.current_generation = None; // drop = abort
            self.current_priority = 0;
            let _ = self.event_tx.send(SessionEvent::SpeechInterrupted);
        }
    }

    async fn handle_frame(&mut self, frame: Frame) {
        // VAD 检测到语音开始 → 自动中断当前 TTS
        if let Frame::Control(ControlFrame::SpeechStart) = &frame {
            self.handle_interrupt();
        }
        // 其他帧交给 pipeline 处理（后续扩展）
    }

    /// TTS 任务的实际执行逻辑（仅在 tts feature 启用时编译）
    ///
    /// 按句子流式合成，每句合成完立即发送 AudioReady，
    /// 每次合成前检查 cancel_token 实现零延迟中断。
    #[cfg(feature = "tts")]
    async fn run_tts(
        text: String,
        engine: TtsEngine,
        edge_client: crate::tts::EdgeTtsClient,
        rate: Option<String>,
        pitch: Option<String>,
        volume: Option<String>,
        cancel_token: CancellationToken,
        event_tx: tokio::sync::broadcast::Sender<SessionEvent>,
    ) {
        let sentences = split_sentences(&text);

        for sentence in sentences {
            if cancel_token.is_cancelled() {
                debug!("tts cancelled before sentence: {}", sentence);
                return;
            }

            if matches!(engine, TtsEngine::Edge) {
                let result = tokio::select! {
                    _ = cancel_token.cancelled() => {
                        debug!("tts interrupted mid-sentence");
                        return;
                    }
                    result = synthesize_edge_sentence(&sentence, &edge_client, event_tx.clone()) => result,
                };
                if let Err(e) = result {
                    error!("tts error: {}", e);
                    let _ = event_tx.send(SessionEvent::SpeechError { message: e });
                    let _ = event_tx.send(SessionEvent::SpeechEnd);
                    return;
                }
                continue;
            }

            tokio::select! {
                _ = cancel_token.cancelled() => {
                    debug!("tts interrupted mid-sentence");
                    return;
                }
                result = synthesize_sentence(
                    &sentence,
                    &engine,
                    &edge_client,
                    rate.as_deref(),
                    pitch.as_deref(),
                    volume.as_deref(),
                ) => {
                    match result {
                        Ok(audio) => {
                            let _ = event_tx.send(SessionEvent::AudioReady(audio));
                        }
                        Err(e) => {
                            error!("tts error: {}", e);
                            let _ = event_tx.send(SessionEvent::SpeechError { message: e });
                            let _ = event_tx.send(SessionEvent::SpeechEnd);
                            return;
                        }
                    }
                }
            }
        }

        let _ = event_tx.send(SessionEvent::SpeechEnd);
    }
}

#[cfg(feature = "tts")]
async fn synthesize_edge_sentence(
    text: &str,
    edge_client: &crate::tts::EdgeTtsClient,
    event_tx: tokio::sync::broadcast::Sender<SessionEvent>,
) -> Result<(), String> {
    use futures_util::StreamExt as _;

    let mut stream = edge_client
        .synthesize(text, None)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(c) => {
                if c.is_final {
                    break;
                }
                if !c.data.is_empty() {
                    let _ = event_tx.send(SessionEvent::AudioReady(AudioFrame::new_pcm16(
                        bytes::Bytes::from(c.data),
                        c.sample_rate,
                    )));
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    Ok(())
}

/// 按标点分句（简化实现，后续可接 text_splitter 模块）
fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '。' | '！' | '？' | '…' | '.' | '!' | '?') {
            let s = current.trim().to_string();
            if !s.is_empty() {
                sentences.push(s);
            }
            current.clear();
        }
    }

    let remaining = current.trim().to_string();
    if !remaining.is_empty() {
        sentences.push(remaining);
    }

    if sentences.is_empty() && !text.is_empty() {
        sentences.push(text.to_string());
    }

    sentences
}

fn rate_to_minimax_speed(rate: &str) -> Option<f64> {
    let value = rate.trim().trim_end_matches('%').parse::<f64>().ok()?;
    Some((1.0 + value / 100.0).clamp(0.5, 2.0))
}

/// 单句 TTS 合成：收集流式 PCM 块后合并为一个 AudioFrame
#[cfg(feature = "tts")]
async fn synthesize_sentence(
    text: &str,
    engine: &TtsEngine,
    edge_client: &crate::tts::EdgeTtsClient,
    rate: Option<&str>,
    _pitch: Option<&str>,
    _volume: Option<&str>,
) -> Result<AudioFrame, String> {
    use futures_util::StreamExt as _;

    match engine {
        TtsEngine::Edge => {
            let mut stream = edge_client
                .synthesize(text, None)
                .await
                .map_err(|e| e.to_string())?;

            let mut pcm: Vec<u8> = Vec::new();
            let mut sample_rate = 16000u32;

            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(c) => {
                        if c.is_final {
                            break;
                        }
                        sample_rate = c.sample_rate;
                        pcm.extend_from_slice(&c.data);
                    }
                    Err(e) => return Err(e.to_string()),
                }
            }

            Ok(AudioFrame::new_pcm16(bytes::Bytes::from(pcm), sample_rate))
        }
        TtsEngine::MiniMax {
            api_key,
            voice_id,
            model,
            ws_url,
        } => {
            let config = crate::tts::MiniMaxConfig::new(
                Some(ws_url.clone()),
                None,
                Some(model.clone()),
                None,
            );
            let client = crate::tts::MiniMaxWsTtsClient::new(config);
            let mut voice_setting = crate::tts::VoiceSetting::default();
            if let Some(speed) = rate.and_then(rate_to_minimax_speed) {
                voice_setting.speed = Some(speed);
            }
            let audio_setting = crate::tts::AudioSetting {
                sample_rate: Some(32000),
                bitrate: Some(128000),
                format: Some("mp3".to_string()),
                channel: Some(1),
            };
            let mut stream = client
                .synthesize_direct(api_key, voice_id, text, Some(voice_setting), Some(audio_setting))
                .map_err(|e: crate::tts::MiniMaxError| e.to_string())?;

            let mut audio_bytes: Vec<u8> = Vec::new();
            let mut sample_rate = 44100u32;

            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(c) => {
                        if c.is_final {
                            break;
                        }
                        sample_rate = c.sample_rate;
                        audio_bytes.extend_from_slice(&c.data);
                    }
                    Err(e) => return Err(e.to_string()),
                }
            }

            let pcm = if looks_like_mp3(&audio_bytes) {
                let mut decoder = crate::tts::edge::mp3_decoder::Mp3Decoder::new();
                let mut pcm = decoder.decode(&audio_bytes).map_err(|e| e.to_string())?;
                pcm.extend_from_slice(&decoder.flush().map_err(|e| e.to_string())?);
                if let Some(decoded_rate) = decoder.sample_rate() {
                    sample_rate = decoded_rate as u32;
                }
                pcm
            } else {
                audio_bytes
            };

            Ok(AudioFrame::new_pcm16(bytes::Bytes::from(pcm), sample_rate))
        }
        TtsEngine::VolcEngine {
            app_id,
            access_key,
            resource_id,
            speaker,
        } => {
            use crate::tts::{VolcEngineConfig, VolcEngineRequest, VolcEngineWsTtsClient};

            let config = VolcEngineConfig {
                endpoint: "wss://openspeech.bytedance.com/api/v3/tts/bidirection".to_string(),
                app_id: app_id.clone(),
                access_key: access_key.clone(),
                resource_id: resource_id.clone(),
                default_speaker: Some(speaker.clone()),
                default_model: None,
                default_namespace: Some("BidirectionalTTS".to_string()),
                default_audio_format: "pcm".to_string(),
                default_sample_rate: 24000,
            };

            let client = VolcEngineWsTtsClient::new(config);
            let request = VolcEngineRequest::from_text(text);
            let mut stream = client
                .synthesize(request)
                .map_err(|e: anyhow::Error| e.to_string())?;

            let mut pcm: Vec<u8> = Vec::new();
            let mut sample_rate = 24000u32;

            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(c) => {
                        if c.is_final {
                            break;
                        }
                        sample_rate = c.sample_rate;
                        pcm.extend_from_slice(&c.data);
                    }
                    Err(e) => return Err(e.to_string()),
                }
            }

            Ok(AudioFrame::new_pcm16(bytes::Bytes::from(pcm), sample_rate))
        }
        TtsEngine::Azure { .. } => {
            // TODO: 接入 AzureTtsClient
            Ok(AudioFrame::new_pcm16(bytes::Bytes::new(), 16000))
        }
        #[cfg(feature = "local-tts")]
        TtsEngine::LocalTts {
            engine,
            speaker_id,
            speed,
        } => {
            let engine = engine.clone();
            let text = text.to_string();
            let sid = *speaker_id;
            let spd = *speed;
            tokio::task::spawn_blocking(move || engine.synthesize(&text, sid, spd))
                .await
                .map_err(|e| e.to_string())?
        }
    }
}

fn looks_like_mp3(data: &[u8]) -> bool {
    if data.len() < 2 {
        return false;
    }
    if data.starts_with(b"ID3") {
        return true;
    }
    data[0] == 0xFF && (data[1] & 0xE0) == 0xE0
}
