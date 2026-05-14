//! SenseVoice ASR backend via sherpa-onnx
//!
//! 模型文件（运行时加载，不嵌入二进制）：
//!   <model_dir>/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/
//!     model.int8.onnx, tokens.txt

use std::error::Error;
use std::path::PathBuf;

use async_trait::async_trait;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig};
use tracing::{debug, info};

use crate::asr::backend::AsrBackend;
use crate::asr::types::{VoiceText, voice_text_from_text};

pub struct SherpaAsrBackend {
    recognizer: OfflineRecognizer,
    pcm_buf:    Vec<f32>,
}

impl SherpaAsrBackend {
    /// `model_dir` 应包含 `model.int8.onnx` 和 `tokens.txt`。
    pub fn new(model_dir: &PathBuf, language: &str) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let model_path  = model_dir.join("model.int8.onnx");
        let tokens_path = model_dir.join("tokens.txt");

        if !model_path.exists() {
            return Err(format!(
                "SenseVoice 模型不存在: {}\n下载地址: https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models",
                model_path.display()
            ).into());
        }

        let mut config = OfflineRecognizerConfig::default();
        config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
            model:    Some(model_path.to_string_lossy().to_string()),
            language: Some(language.to_string()),
            use_itn:  true,
        };
        config.model_config.tokens      = Some(tokens_path.to_string_lossy().to_string());
        config.model_config.num_threads = 2;
        // feat_config defaults (sample_rate=16000, feature_dim=80) are already correct

        let recognizer = OfflineRecognizer::create(&config)
            .ok_or("sherpa-onnx OfflineRecognizer 初始化失败（请检查模型路径）")?;

        info!("✅ SenseVoice ASR (sherpa-onnx) 已就绪，语言: {}", language);
        Ok(Self { recognizer, pcm_buf: Vec::new() })
    }

    fn infer_buf(&mut self) -> Result<Option<String>, Box<dyn Error + Send + Sync>> {
        if self.pcm_buf.len() < 1600 {
            self.pcm_buf.clear();
            return Ok(None);
        }
        let pcm = std::mem::take(&mut self.pcm_buf);
        debug!("[SenseVoice] 推理 {}ms ({} 样本)", pcm.len() / 16, pcm.len());

        let stream = self.recognizer.create_stream();
        stream.accept_waveform(16000, &pcm);
        self.recognizer.decode(&stream);

        let text = stream
            .get_result()
            .map(|r| r.text.trim().to_string())
            .unwrap_or_default();

        if text.is_empty() {
            return Ok(None);
        }
        info!("[SenseVoice] 识别: {}", text);
        Ok(Some(text))
    }
}

#[async_trait]
impl AsrBackend for SherpaAsrBackend {
    async fn streaming_recognition(
        &mut self,
        audio:   &[f32],
        is_last: bool,
        _enable_final_inference: bool,
    ) -> Result<Option<VoiceText>, Box<dyn Error + Send + Sync>> {
        self.pcm_buf.extend_from_slice(audio);
        if !is_last { return Ok(None); }
        match self.infer_buf()? {
            Some(text) => Ok(Some(voice_text_from_text(text))),
            None       => Ok(None),
        }
    }

    fn reset_streaming(&mut self) {
        self.pcm_buf.clear();
    }
}
