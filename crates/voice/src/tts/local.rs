//! 本地 TTS 引擎：通过 sherpa-onnx OfflineTts 支持 Kokoro / MeloTTS / Piper

use std::path::Path;

use bytes::Bytes;

use crate::pipeline::frame::AudioFrame;

pub struct LocalTtsEngine {
    tts: sherpa_onnx::OfflineTts,
}

impl std::fmt::Debug for LocalTtsEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "LocalTtsEngine(sr={})", self.tts.sample_rate())
    }
}

impl LocalTtsEngine {
    /// Kokoro 多语言模型（含中文）
    ///
    /// 期望目录结构（解压 sherpa-onnx-kokoro-multi-lang-v1.1-ONNX.tar.bz2 得到）：
    /// ```
    /// <dir>/
    ///   model.onnx 或 model.int8.onnx
    ///   voices.bin
    ///   tokens.txt
    ///   espeak-ng-data/
    /// ```
    pub fn new_kokoro(dir: &Path) -> Result<Self, String> {
        let p = |name: &str| dir.join(name).to_string_lossy().to_string();
        let model = if dir.join("model.int8.onnx").exists() {
            p("model.int8.onnx")
        } else {
            p("model.onnx")
        };
        let config = sherpa_onnx::OfflineTtsConfig {
            model: sherpa_onnx::OfflineTtsModelConfig {
                kokoro: sherpa_onnx::OfflineTtsKokoroModelConfig {
                    model: Some(model),
                    voices: Some(p("voices.bin")),
                    tokens: Some(p("tokens.txt")),
                    data_dir: Some(p("espeak-ng-data")),
                    ..Default::default()
                },
                num_threads: 2,
                ..Default::default()
            },
            ..Default::default()
        };
        let tts = sherpa_onnx::OfflineTts::create(&config)
            .ok_or_else(|| format!("Kokoro TTS 初始化失败，请检查模型目录: {}", dir.display()))?;
        Ok(Self { tts })
    }

    /// MeloTTS 中文+英文模型（VITS）
    ///
    /// 期望目录结构（解压 sherpa-onnx-melo-tts-zh_en.tar.bz2 得到）：
    /// ```
    /// <dir>/
    ///   model.onnx
    ///   lexicon.txt
    ///   tokens.txt
    ///   dict/
    /// ```
    /// 说话人 ID：0=中文, 1=EN_Default, 2=EN_US, 3=EN_BR, 4=EN_IN, 5=EN_AU
    pub fn new_melo(dir: &Path) -> Result<Self, String> {
        let p = |name: &str| dir.join(name).to_string_lossy().to_string();
        let config = sherpa_onnx::OfflineTtsConfig {
            model: sherpa_onnx::OfflineTtsModelConfig {
                vits: sherpa_onnx::OfflineTtsVitsModelConfig {
                    model: Some(p("model.onnx")),
                    lexicon: Some(p("lexicon.txt")),
                    tokens: Some(p("tokens.txt")),
                    dict_dir: Some(p("dict")),
                    ..Default::default()
                },
                num_threads: 2,
                ..Default::default()
            },
            ..Default::default()
        };
        let tts = sherpa_onnx::OfflineTts::create(&config)
            .ok_or_else(|| format!("MeloTTS 初始化失败，请检查模型目录: {}", dir.display()))?;
        Ok(Self { tts })
    }

    /// Piper 中文模型（VITS）
    ///
    /// 期望目录结构（解压 vits-piper-zh_CN-huayan-medium.tar.bz2 得到）：
    /// ```
    /// <dir>/
    ///   model.onnx
    ///   tokens.txt
    ///   espeak-ng-data/
    /// ```
    pub fn new_piper(dir: &Path) -> Result<Self, String> {
        let p = |name: &str| dir.join(name).to_string_lossy().to_string();
        let config = sherpa_onnx::OfflineTtsConfig {
            model: sherpa_onnx::OfflineTtsModelConfig {
                vits: sherpa_onnx::OfflineTtsVitsModelConfig {
                    model: Some(p("model.onnx")),
                    tokens: Some(p("tokens.txt")),
                    data_dir: Some(p("espeak-ng-data")),
                    ..Default::default()
                },
                num_threads: 2,
                ..Default::default()
            },
            ..Default::default()
        };
        let tts = sherpa_onnx::OfflineTts::create(&config)
            .ok_or_else(|| format!("Piper TTS 初始化失败，请检查模型目录: {}", dir.display()))?;
        Ok(Self { tts })
    }

    /// 合成语音，返回 s16le PCM 的 AudioFrame。
    ///
    /// `sid`: 说话人 ID（Kokoro/MeloTTS 支持多说话人，Piper 通常为 0）
    /// `speed`: 语速倍率（1.0 = 正常）
    pub fn synthesize(&self, text: &str, sid: i32, speed: f32) -> Result<AudioFrame, String> {
        let gen_cfg = sherpa_onnx::GenerationConfig {
            sid,
            speed,
            ..Default::default()
        };
        let audio = self
            .tts
            .generate_with_config::<fn(&[f32], f32) -> bool>(text, &gen_cfg, None)
            .ok_or_else(|| "TTS 合成失败：文本为空或模型内部错误".to_string())?;

        let samples = audio.samples();
        let rate = audio.sample_rate() as u32;
        let mut pcm: Vec<u8> = Vec::with_capacity(samples.len() * 2);
        for &s in samples {
            let s16 = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
            pcm.extend_from_slice(&s16.to_le_bytes());
        }
        Ok(AudioFrame::new_pcm16(Bytes::from(pcm), rate))
    }
}
