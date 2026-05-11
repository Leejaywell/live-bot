//! streamix-voice — TTS / ASR / VAD pipeline
//!
//! Features:
//!   `tts`      — Edge / MiniMax / Azure / Baidu / VolcEngine TTS（默认启用）
//!   `asr`      — WhisperLive 流式 ASR 客户端（默认启用）
//!   `vad`      — sherpa-onnx SenseVoice VAD + ASR（本地 ONNX，可选）
//!   `denoiser` — GTCRN 频域降噪（需要 ort + ndarray，可选）

pub mod audio;
pub mod pipeline;
pub mod session;
pub mod text_splitter;

#[cfg(feature = "tts")]
pub mod tts;

#[cfg(feature = "asr")]
pub mod asr;

#[cfg(feature = "vad")]
pub mod sherpa_vad;

// 顶层重导出，方便调用方
pub use pipeline::{Frame, FrameProcessor, ProcessorChain};
pub use session::{SessionCommand, SessionConfig, SessionEvent, VoiceSession, SpeakRequest, TtsEngine};
pub use session::router::{SpeakerRouter, PRIORITY_AI, PRIORITY_BOT, PRIORITY_SYSTEM};

#[cfg(feature = "playback")]
pub use audio::output::AudioPlayer;

#[cfg(feature = "vad")]
pub use sherpa_vad::{TurnEvent, SherpaPipeline, SherpaMicCapture};
