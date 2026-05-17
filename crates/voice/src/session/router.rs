//! Multi-speaker TTS 路由器
//!
//! 将三路 TTS 流（Bot 规则回复、AI 对话回复、系统提示）
//! 按优先级合并到单个 VoiceSession，并驱动 cpal 音频输出。
//!
//! 优先级定义：
//!   SYSTEM  = 10  — 开播/下播/场景切换提示
//!   AI      = 5   — AI 对话回复
//!   BOT     = 1   — 欢迎/感谢/规则自动回复
//!
//! Bot 回复队列上限 3 条，AI 回复队列上限 5 条，超出时丢弃最旧的。

use std::collections::VecDeque;
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::warn;

use super::{SessionConfig, SessionError, SessionEvent, SpeakRequest, TtsEngine, VoiceSession};
use crate::tts::emotion::detect_prosody;

pub const PRIORITY_SYSTEM: u8 = 10;
pub const PRIORITY_AI: u8 = 5;
pub const PRIORITY_BOT: u8 = 1;

const BOT_QUEUE_MAX: usize = 3;
const AI_QUEUE_MAX: usize = 5;

/// 路由请求类型
#[derive(Debug)]
pub enum RouteRequest {
    Bot(String),
    Ai(String),
    System(String),
}

/// 多路 TTS 路由器（Send + Sync，可 Arc 共享）
#[derive(Clone)]
pub struct SpeakerRouter {
    tx: mpsc::Sender<RouteRequest>,
    /// 共享 VoiceSession，供 VAD pipeline 推送控制帧（打断 TTS）
    session: VoiceSession,
}

impl SpeakerRouter {
    /// 启动路由器（含音频输出），使用指定的 TTS 引擎
    ///
    /// 内部创建 VoiceSession + AudioPlayer，订阅 AudioReady 并送入播放器。
    /// cancel 触发时自动关闭。
    #[cfg(feature = "playback")]
    pub fn spawn_with_audio_and_engine(
        session_config: SessionConfig,
        default_engine: TtsEngine,
        cancel: CancellationToken,
    ) -> Self {
        let (session, _handle) = VoiceSession::spawn(session_config);
        let (tx, rx) = mpsc::channel::<RouteRequest>(32);
        tokio::spawn(router_task_with_audio(
            rx,
            session.clone(),
            default_engine,
            cancel,
        ));
        Self { tx, session }
    }

    /// 启动路由器（含音频输出），默认使用 Edge TTS
    #[cfg(feature = "playback")]
    pub fn spawn_with_audio(session_config: SessionConfig, cancel: CancellationToken) -> Self {
        Self::spawn_with_audio_and_engine(session_config, TtsEngine::Edge, cancel)
    }

    /// 启动路由器（无音频输出，用于测试或无设备环境）
    pub fn spawn(session_config: SessionConfig) -> Self {
        Self::spawn_with_engine(session_config, TtsEngine::Edge)
    }

    /// 启动路由器（无音频输出），使用指定的 TTS 引擎
    pub fn spawn_with_engine(session_config: SessionConfig, default_engine: TtsEngine) -> Self {
        let (session, _handle) = VoiceSession::spawn(session_config);
        let (tx, rx) = mpsc::channel::<RouteRequest>(32);
        tokio::spawn(router_task_with_engine(rx, session.clone(), default_engine));
        Self { tx, session }
    }

    /// 返回底层 VoiceSession（供 VadPipeline 推送 SpeechStart / TurnEnd 控制帧）
    pub fn voice_session(&self) -> &VoiceSession {
        &self.session
    }

    pub async fn speak_bot(&self, text: impl Into<String>) -> Result<(), SessionError> {
        self.tx
            .send(RouteRequest::Bot(text.into()))
            .await
            .map_err(|_| SessionError::SessionClosed)
    }

    pub async fn speak_ai(&self, text: impl Into<String>) -> Result<(), SessionError> {
        self.tx
            .send(RouteRequest::Ai(text.into()))
            .await
            .map_err(|_| SessionError::SessionClosed)
    }

    pub async fn speak_system(&self, text: impl Into<String>) -> Result<(), SessionError> {
        self.tx
            .send(RouteRequest::System(text.into()))
            .await
            .map_err(|_| SessionError::SessionClosed)
    }
}

/// 含 AudioPlayer 的完整路由任务
#[cfg(feature = "playback")]
async fn router_task_with_audio(
    rx: mpsc::Receiver<RouteRequest>,
    session: VoiceSession,
    default_engine: TtsEngine,
    cancel: CancellationToken,
) {
    use crate::audio::output::AudioPlayer;

    // 启动音频播放器
    let player: Option<Arc<AudioPlayer>> = match AudioPlayer::new() {
        Ok(p) => Some(Arc::new(p)),
        Err(e) => {
            warn!("音频输出设备初始化失败，TTS 将静默运行: {e}");
            None
        }
    };

    // 订阅 AudioReady → 送入播放器
    if let Some(ref p) = player {
        let mut audio_rx = session.subscribe();
        let p_clone = Arc::clone(p);
        let cancel2 = cancel.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancel2.cancelled() => break,
                    ev = audio_rx.recv() => match ev {
                        Ok(SessionEvent::AudioReady(frame)) => p_clone.push_frame(frame),
                        Ok(SessionEvent::Closed) | Err(_) => break,
                        _ => {}
                    }
                }
            }
        });
    }

    run_router(rx, &session, default_engine, cancel).await;
    session.shutdown().await;
}

/// 不含 AudioPlayer 的路由任务（指定引擎）
async fn router_task_with_engine(
    rx: mpsc::Receiver<RouteRequest>,
    session: VoiceSession,
    default_engine: TtsEngine,
) {
    run_router(rx, &session, default_engine, CancellationToken::new()).await;
    session.shutdown().await;
}

/// 核心路由逻辑（优先级调度）
async fn run_router(
    mut rx: mpsc::Receiver<RouteRequest>,
    session: &VoiceSession,
    default_engine: TtsEngine,
    cancel: CancellationToken,
) {
    let mut bot_queue: VecDeque<String> = VecDeque::new();
    let mut ai_queue: VecDeque<String> = VecDeque::new();

    loop {
        let req = tokio::select! {
            _ = cancel.cancelled() => break,
            r = rx.recv() => match r {
                Some(r) => r,
                None => break,
            }
        };

        match req {
            RouteRequest::System(text) => {
                bot_queue.clear();
                ai_queue.clear();
                let r = SpeakRequest::new(text)
                    .with_engine(default_engine.clone())
                    .with_priority(PRIORITY_SYSTEM);
                let _ = session.speak(r).await;
            }
            RouteRequest::Ai(text) => {
                if ai_queue.len() >= AI_QUEUE_MAX {
                    ai_queue.pop_front();
                }
                ai_queue.push_back(text);
                flush_ai(session, &mut ai_queue, &default_engine).await;
            }
            RouteRequest::Bot(text) => {
                if bot_queue.len() >= BOT_QUEUE_MAX {
                    bot_queue.pop_front();
                }
                bot_queue.push_back(text);
                flush(session, &mut bot_queue, PRIORITY_BOT, &default_engine).await;
            }
        }
    }
}

async fn flush(
    session: &VoiceSession,
    queue: &mut VecDeque<String>,
    priority: u8,
    engine: &TtsEngine,
) {
    while let Some(text) = queue.pop_front() {
        let req = SpeakRequest::new(text)
            .with_engine(engine.clone())
            .with_priority(priority);
        if session.speak(req).await.is_err() {
            break;
        }
    }
}

/// AI 回复专用 flush：对每条文本检测情绪并附加 prosody 参数
async fn flush_ai(session: &VoiceSession, queue: &mut VecDeque<String>, engine: &TtsEngine) {
    while let Some(text) = queue.pop_front() {
        let prosody = detect_prosody(&text);
        let mut req = SpeakRequest::new(text)
            .with_engine(engine.clone())
            .with_priority(PRIORITY_AI);
        if let Some(rate) = prosody.rate {
            req = req.with_rate(rate);
        }
        if let Some(pitch) = prosody.pitch {
            req = req.with_pitch(pitch);
        }
        if let Some(volume) = prosody.volume {
            req = req.with_volume(volume);
        }
        if session.speak(req).await.is_err() {
            break;
        }
    }
}
