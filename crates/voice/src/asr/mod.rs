//! ASR 语音识别模块

pub mod backend;
pub mod punctuation;
pub mod stabilizer;
pub mod types;
pub mod whisperlive;

#[cfg(feature = "vad")]
pub mod sherpa;

pub use backend::AsrBackend;
pub use types::{VoiceText, voice_text_from_text};
pub use whisperlive::{BackendConfig, WhisperLiveAsrBackend};

#[cfg(feature = "vad")]
pub use sherpa::SherpaAsrBackend;
