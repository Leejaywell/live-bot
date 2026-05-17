use std::sync::Mutex;

use anyhow::{Result, bail};
use ort::{
    execution_providers::CPUExecutionProvider,
    session::{Session, builder::GraphOptimizationLevel},
    value::Tensor,
};
use tracing::info;

const RVC_HOP: usize = 160;
const SAMPLE_RATE: f32 = 16_000.0;
const F0_MIN_HZ: f32 = 50.0;
const F0_MAX_HZ: f32 = 1100.0;
const F0_BINS: i64 = 256;
const HUBERT_TARGET_FRAMES: usize = 50;
const RVC_TARGET_FRAMES: usize = HUBERT_TARGET_FRAMES * 2;
const RECOMMENDED_CHUNK_SAMPLES: usize = 16_080;

/// RVC (Retrieval-based Voice Conversion) ONNX inference engine.
///
/// Expected model files:
///
///   hubert_base.onnx — ContentVec/HuBERT encoder
///     input  "source"  [1, N]        f32  (16 kHz mono PCM)
///     output "embed"   [1, T, D]     f32  (D = 256 or 768, T = N / 320)
///
///   model.onnx — RVC v2 voice conversion model
///     inputs  "phone"          [1, T, D]     f32
///             "phone_lengths"  [1]           i64
///             "pitch"          [1, T]        i64  (0 = unvoiced, 1–255 log-scale bin)
///             "pitchf"         [1, T]        f32  (Hz, 0 = unvoiced)
///             "ds"             [1]           i64  (speaker id, usually 0)
///             "rnd"            [1, 192, T]   f32  (flow noise)
///     output  "audio"          [1, 1, S]     f32
pub struct RvcEngine {
    hubert: Mutex<Session>,
    model: Mutex<Session>,
    hubert_padding_mask: bool,
    hubert_output_name: String,
    model_padding_mask: bool,
    model_rnd: bool,
    model_sample_rate: usize,
}

impl std::fmt::Debug for RvcEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RvcEngine").finish_non_exhaustive()
    }
}

fn build_session(path: &str, threads: usize) -> Result<Session> {
    let mut b = Session::builder().map_err(|e| anyhow::anyhow!("{e}"))?;
    b = b
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    b = b
        .with_intra_threads(threads)
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    b = b
        .with_execution_providers([CPUExecutionProvider::default().build()])
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    b.commit_from_file(path)
        .map_err(|e| anyhow::anyhow!("加载模型 {path} 失败: {e}"))
}

impl RvcEngine {
    pub fn new(model_path: &str, hubert_path: &str) -> Result<Self> {
        let hubert =
            build_session(hubert_path, 1).map_err(|e| anyhow::anyhow!("加载 HuBERT 失败: {e}"))?;
        let model =
            build_session(model_path, 2).map_err(|e| anyhow::anyhow!("加载 RVC 失败: {e}"))?;

        let h_in: Vec<_> = hubert
            .inputs()
            .iter()
            .map(|i| i.name().to_string())
            .collect();
        let h_out: Vec<_> = hubert
            .outputs()
            .iter()
            .map(|o| o.name().to_string())
            .collect();
        let m_in: Vec<_> = model
            .inputs()
            .iter()
            .map(|i| i.name().to_string())
            .collect();
        let m_out: Vec<_> = model
            .outputs()
            .iter()
            .map(|o| o.name().to_string())
            .collect();
        info!(?h_in, ?h_out, ?m_in, ?m_out, "RVC 模型 I/O");
        println!("[RVC] HuBERT inputs={h_in:?} outputs={h_out:?}");
        println!("[RVC] Model inputs={m_in:?} outputs={m_out:?}");

        let mut engine = Self {
            hubert_padding_mask: h_in.iter().any(|name| name == "padding_mask"),
            hubert_output_name: if h_out.iter().any(|name| name == "embed") {
                "embed".to_string()
            } else {
                h_out
                    .first()
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("HuBERT 模型没有输出"))?
            },
            model_padding_mask: m_in.iter().any(|name| name == "padding_mask"),
            model_rnd: m_in.iter().any(|name| name == "rnd"),
            hubert: Mutex::new(hubert),
            model: Mutex::new(model),
            model_sample_rate: 48_000,
        };
        engine.model_sample_rate = engine.probe_model_sample_rate()?;

        Ok(engine)
    }

    pub fn process(&self, input: &[f32]) -> Result<Vec<f32>> {
        if input.is_empty() {
            return Ok(Vec::new());
        }
        let prepared_input;
        let model_input = if input.len() < RECOMMENDED_CHUNK_SAMPLES {
            prepared_input = pad_audio(input, RECOMMENDED_CHUNK_SAMPLES);
            prepared_input.as_slice()
        } else {
            input
        };
        let (feats, t, d) = self.extract_hubert(model_input)?;
        if t != HUBERT_TARGET_FRAMES {
            return Ok(input.to_vec());
        }
        let (phone, rvc_t) = upsample_phone_features(&feats, t, d);
        let (pitch_q, pitchf) = estimate_f0(model_input, rvc_t, RVC_HOP);
        let mut converted = self.run_rvc(phone, rvc_t, d, &pitch_q, &pitchf, 0)?;
        if converted.is_empty() {
            return Ok(input.to_vec());
        }
        if self.model_sample_rate != SAMPLE_RATE as usize {
            converted = resample_by_rate(&converted, self.model_sample_rate, SAMPLE_RATE as usize);
        }
        if converted.len() != input.len() {
            converted = resample_to_len(&converted, input.len());
        }
        Ok(converted)
    }

    pub fn recommended_chunk_samples(&self) -> usize {
        RECOMMENDED_CHUNK_SAMPLES
    }

    fn probe_model_sample_rate(&self) -> Result<usize> {
        let silent = vec![0.0f32; RECOMMENDED_CHUNK_SAMPLES];
        let (feats, t, d) = self.extract_hubert(&silent)?;
        if t != HUBERT_TARGET_FRAMES {
            bail!("HuBERT 探测帧数异常: {t}");
        }
        let (dummy_phone, _) = upsample_phone_features(&feats, t, d);
        let dummy_pitch = vec![0i64; RVC_TARGET_FRAMES];
        let dummy_pitchf = vec![0.0f32; RVC_TARGET_FRAMES];
        let audio = self.run_rvc(
            dummy_phone,
            RVC_TARGET_FRAMES,
            d,
            &dummy_pitch,
            &dummy_pitchf,
            0,
        )?;
        if audio.is_empty() {
            bail!("RVC 模型输出为空，无法推断输出采样率");
        }
        let sample_rate = ((audio.len() as f32 / RVC_TARGET_FRAMES as f32) * 100.0).round() as usize;
        if sample_rate == 0 {
            bail!("RVC 模型输出长度无效，无法推断输出采样率");
        }
        Ok(sample_rate)
    }

    fn extract_hubert(&self, audio: &[f32]) -> Result<(Vec<f32>, usize, usize)> {
        let source_tensor = Tensor::<f32>::from_array(([1usize, audio.len()], audio.to_vec()))?;

        let (t, d, feats) = {
            let mut session = self.hubert.lock().unwrap();
            let outputs = if self.hubert_padding_mask {
                let padding_mask =
                    Tensor::<bool>::from_array(([1usize, audio.len()], vec![false; audio.len()]))?;
                session.run(ort::inputs![
                    "source" => source_tensor,
                    "padding_mask" => padding_mask,
                ])?
            } else {
                session.run(ort::inputs!["source" => source_tensor])?
            };
            let embed = outputs
                .get(self.hubert_output_name.as_str())
                .ok_or_else(|| anyhow::anyhow!("HuBERT 缺少 '{}' 输出", self.hubert_output_name))?;
            let (shape, data) = embed.try_extract_tensor::<f32>()?;
            let (t, d) = match shape.as_ref() {
                [_, t, d] => (*t as usize, *d as usize),
                s => bail!("HuBERT embed 输出形状不支持: {:?}", s),
            };
            (t, d, data.to_vec())
        };

        Ok((feats, t, d))
    }

    fn run_rvc(
        &self,
        feats: Vec<f32>,
        t: usize,
        d: usize,
        pitch_q: &[i64],
        pitchf: &[f32],
        speaker_id: i64,
    ) -> Result<Vec<f32>> {
        let phone_tensor = Tensor::<f32>::from_array(([1usize, t, d], feats))?;
        let phone_lengths_tensor = Tensor::<i64>::from_array(([1usize], vec![t as i64]))?;
        let pitch_tensor = Tensor::<i64>::from_array(([1usize, t], pitch_q.to_vec()))?;
        let pitchf_tensor = Tensor::<f32>::from_array(([1usize, t], pitchf.to_vec()))?;
        let ds_tensor = Tensor::<i64>::from_array(([1usize], vec![speaker_id]))?;

        let audio_data = {
            let mut session = self.model.lock().unwrap();
            let outputs = if self.model_padding_mask && self.model_rnd {
                let rnd_tensor =
                    Tensor::<f32>::from_array(([1usize, 192usize, t], vec![0.0f32; 192 * t]))?;
                let padding_mask = Tensor::<bool>::from_array(([1usize, t], vec![false; t]))?;
                session.run(ort::inputs![
                    "phone"         => phone_tensor,
                    "phone_lengths" => phone_lengths_tensor,
                    "pitch"         => pitch_tensor,
                    "pitchf"        => pitchf_tensor,
                    "ds"            => ds_tensor,
                    "rnd"           => rnd_tensor,
                    "padding_mask"  => padding_mask,
                ])?
            } else if self.model_padding_mask {
                let padding_mask = Tensor::<bool>::from_array(([1usize, t], vec![false; t]))?;
                session.run(ort::inputs![
                    "phone"         => phone_tensor,
                    "phone_lengths" => phone_lengths_tensor,
                    "pitch"         => pitch_tensor,
                    "pitchf"        => pitchf_tensor,
                    "ds"            => ds_tensor,
                    "padding_mask"  => padding_mask,
                ])?
            } else if self.model_rnd {
                let rnd_tensor =
                    Tensor::<f32>::from_array(([1usize, 192usize, t], vec![0.0f32; 192 * t]))?;
                session.run(ort::inputs![
                    "phone"         => phone_tensor,
                    "phone_lengths" => phone_lengths_tensor,
                    "pitch"         => pitch_tensor,
                    "pitchf"        => pitchf_tensor,
                    "ds"            => ds_tensor,
                    "rnd"           => rnd_tensor,
                ])?
            } else {
                session.run(ort::inputs![
                    "phone"         => phone_tensor,
                    "phone_lengths" => phone_lengths_tensor,
                    "pitch"         => pitch_tensor,
                    "pitchf"        => pitchf_tensor,
                    "ds"            => ds_tensor,
                ])?
            };
            let audio = outputs
                .get("audio")
                .ok_or_else(|| anyhow::anyhow!("RVC 缺少 'audio' 输出"))?;
            let (_, data) = audio.try_extract_tensor::<f32>()?;
            data.to_vec()
        };

        Ok(audio_data)
    }
}

fn pad_audio(input: &[f32], len: usize) -> Vec<f32> {
    let mut audio = Vec::with_capacity(len);
    audio.extend_from_slice(input);
    audio.resize(len, 0.0);
    audio
}

fn upsample_phone_features(input: &[f32], t: usize, d: usize) -> (Vec<f32>, usize) {
    let mut out = Vec::with_capacity(t * 2 * d);
    for frame in 0..t {
        let start = frame * d;
        let end = start + d;
        let feat = &input[start..end];
        out.extend_from_slice(feat);
        out.extend_from_slice(feat);
    }
    (out, t * 2)
}

fn resample_to_len(input: &[f32], target_len: usize) -> Vec<f32> {
    if input.is_empty() || target_len == 0 {
        return Vec::new();
    }
    if input.len() == target_len {
        return input.to_vec();
    }

    let mut out = Vec::with_capacity(target_len);
    let ratio = (input.len().saturating_sub(1)) as f32 / (target_len.saturating_sub(1).max(1)) as f32;
    for i in 0..target_len {
        let pos = i as f32 * ratio;
        let lo = pos.floor() as usize;
        let hi = (lo + 1).min(input.len() - 1);
        let frac = pos - lo as f32;
        out.push(input[lo] + (input[hi] - input[lo]) * frac);
    }
    out
}

fn resample_by_rate(input: &[f32], from_rate: usize, to_rate: usize) -> Vec<f32> {
    if input.is_empty() || from_rate == 0 || to_rate == 0 || from_rate == to_rate {
        return input.to_vec();
    }
    let target_len = ((input.len() as f64 * to_rate as f64) / from_rate as f64).round() as usize;
    resample_to_len(input, target_len.max(1))
}

/// Normalized autocorrelation (NSDF) F0 estimator — one pitch value per HuBERT frame.
///
/// Returns (quantized pitch bins 0–255, raw Hz).  0 = unvoiced.
fn estimate_f0(audio: &[f32], num_frames: usize, hop: usize) -> (Vec<i64>, Vec<f32>) {
    let min_period = (SAMPLE_RATE / F0_MAX_HZ) as usize; // ~14 samples
    let max_period = (SAMPLE_RATE / F0_MIN_HZ) as usize; // ~320 samples
    let win = max_period * 2 + 64;
    let log_min = F0_MIN_HZ.ln();
    let log_range = F0_MAX_HZ.ln() - log_min;

    let mut pitchf = vec![0.0f32; num_frames];

    for frame in 0..num_frames {
        let center = frame * hop + hop / 2;
        let start = center.saturating_sub(win / 2);
        if start >= audio.len() {
            continue;
        }
        let end = (start + win).min(audio.len());
        let seg = &audio[start..end];
        if seg.len() < min_period * 2 {
            continue;
        }
        let energy: f32 = seg.iter().map(|&x| x * x).sum();
        if energy < 1e-6 {
            continue;
        }

        let max_lag = max_period.min(seg.len() / 2);
        let mut best_tau = 0usize;
        let mut best_nsdf = 0.0f32;

        for tau in min_period..=max_lag {
            let n = seg.len() - tau;
            let (mut acf, mut m0, mut mt) = (0.0f32, 0.0f32, 0.0f32);
            for i in 0..n {
                acf += seg[i] * seg[i + tau];
                m0 += seg[i] * seg[i];
                mt += seg[i + tau] * seg[i + tau];
            }
            let denom = ((m0 + mt) / 2.0).sqrt();
            let nsdf = if denom > 1e-8 {
                acf / (n as f32 * denom)
            } else {
                0.0
            };
            if nsdf > best_nsdf {
                best_nsdf = nsdf;
                best_tau = tau;
            }
        }

        if best_tau > 0 && best_nsdf > 0.45 {
            pitchf[frame] = SAMPLE_RATE / best_tau as f32;
        }
    }

    let pitch_q: Vec<i64> = pitchf
        .iter()
        .map(|&hz| {
            if hz < F0_MIN_HZ {
                0
            } else {
                let bin = ((hz.ln() - log_min) / log_range * (F0_BINS - 1) as f32).round() as i64;
                bin.clamp(1, F0_BINS - 1)
            }
        })
        .collect();

    (pitch_q, pitchf)
}

#[cfg(test)]
mod tests {
    use super::RvcEngine;

    #[test]
    fn new_fails_when_files_missing() {
        let err = RvcEngine::new("/nonexistent/model.onnx", "/nonexistent/hubert.onnx")
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("加载 HuBERT 失败") || err.contains("HuBERT"),
            "unexpected error: {err}"
        );
    }
}
