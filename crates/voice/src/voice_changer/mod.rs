#[cfg(feature = "voice-changer")]
pub mod py_worker;
#[cfg(feature = "voice-changer")]
pub mod rvc;

#[cfg(feature = "voice-changer")]
use std::sync::{Arc, Mutex};

#[cfg(feature = "voice-changer")]
use bytes::Bytes;
#[cfg(feature = "voice-changer")]
use crossbeam_queue::SegQueue;
#[cfg(feature = "voice-changer")]
use tokio_util::sync::CancellationToken;
#[cfg(feature = "voice-changer")]
use tracing::{error, info, warn};

#[cfg(feature = "voice-changer")]
use crate::{AudioPlayer, pipeline::frame::AudioFrame};

#[cfg(feature = "voice-changer")]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VoiceChangerConfig {
    pub input_gain: f32,
    pub wet_mix: f32,
    pub frame_ms: u32,
}

#[cfg(feature = "voice-changer")]
impl Default for VoiceChangerConfig {
    fn default() -> Self {
        Self {
            input_gain: 1.0,
            wet_mix: 1.0,
            frame_ms: 40,
        }
    }
}

#[cfg(feature = "voice-changer")]
impl VoiceChangerConfig {
    pub fn sanitized(&self) -> Self {
        Self {
            input_gain: self.input_gain.clamp(0.0, 2.0),
            wet_mix: if self.wet_mix <= 0.0 {
                0.0
            } else {
                self.wet_mix.clamp(0.8, 1.0)
            },
            frame_ms: self.frame_ms.clamp(20, 80),
        }
    }

    fn frame_samples(&self) -> usize {
        ((self.frame_ms as usize * 16_000) / 1000).max(320)
    }
}

#[cfg(feature = "voice-changer")]
#[derive(Debug, Clone, serde::Serialize)]
pub struct VoiceChangerStatus {
    pub running: bool,
    pub model_id: String,
    pub input_gain: f32,
    pub wet_mix: f32,
    pub frame_ms: u32,
    pub processed_frames: u64,
    pub output_latency_ms: u32,
    pub last_error: Option<String>,
}

#[cfg(feature = "voice-changer")]
impl VoiceChangerStatus {
    fn new(model_id: String, config: VoiceChangerConfig) -> Self {
        Self {
            running: true,
            model_id,
            input_gain: config.input_gain,
            wet_mix: config.wet_mix,
            frame_ms: config.frame_ms,
            processed_frames: 0,
            output_latency_ms: 0,
            last_error: None,
        }
    }
}

#[cfg(feature = "voice-changer")]
pub struct VoiceChanger {
    status: Arc<Mutex<VoiceChangerStatus>>,
    cancel: CancellationToken,
    _thread: std::thread::JoinHandle<()>,
}

#[cfg(feature = "voice-changer")]
impl VoiceChanger {
    pub fn start(
        model_id: &str,
        model_path: &str,
        hubert_path: &str,
        config: VoiceChangerConfig,
    ) -> anyhow::Result<Self> {
        let config = config.sanitized();
        let engine = Arc::new(py_worker::PythonWorkerEngine::new(model_path, hubert_path)?);
        let status = Arc::new(Mutex::new(VoiceChangerStatus::new(
            model_id.to_string(),
            config.clone(),
        )));
        let cancel = CancellationToken::new();
        let cancel_thread = cancel.clone();
        let status_thread = Arc::clone(&status);

        let thread = std::thread::Builder::new()
            .name("voice-changer".to_string())
            .spawn(move || {
                if let Err(err) =
                    run_realtime_loop(engine, config, Arc::clone(&status_thread), cancel_thread)
                {
                    eprintln!("[VoiceChanger] realtime loop exited: {err}");
                    error!("变声器线程退出: {err}");
                    if let Ok(mut st) = status_thread.lock() {
                        st.running = false;
                        st.last_error = Some(err);
                    }
                }
            })?;

        Ok(Self {
            status,
            cancel,
            _thread: thread,
        })
    }

    pub fn stop(&self) {
        self.cancel.cancel();
        if let Ok(mut st) = self.status.lock() {
            st.running = false;
        }
    }

    pub fn status(&self) -> VoiceChangerStatus {
        self.status
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|_| VoiceChangerStatus {
                running: false,
                model_id: String::new(),
                input_gain: 1.0,
                wet_mix: 1.0,
                frame_ms: 80,
                processed_frames: 0,
                output_latency_ms: 0,
                last_error: Some("读取变声器状态失败".to_string()),
            })
    }
}

#[cfg(feature = "voice-changer")]
fn run_realtime_loop(
    engine: Arc<py_worker::PythonWorkerEngine>,
    config: VoiceChangerConfig,
    status: Arc<Mutex<VoiceChangerStatus>>,
    cancel: CancellationToken,
) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{BufferSize, SampleFormat, StreamConfig};

    let player = AudioPlayer::new_low_latency()?;
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "未找到默认麦克风输入设备".to_string())?;
    let supported = device.default_input_config().map_err(|e| e.to_string())?;
    let device_rate = supported.sample_rate().0;
    let device_channels = supported.channels() as usize;

    info!(
        device = device.name().unwrap_or_default(),
        sample_rate = device_rate,
        channels = device_channels,
        "变声器麦克风已就绪"
    );

    let queue: Arc<SegQueue<f32>> = Arc::new(SegQueue::new());
    let queue_cb = Arc::clone(&queue);
    let stream_config = StreamConfig {
        channels: supported.channels(),
        sample_rate: supported.sample_rate(),
        buffer_size: BufferSize::Default,
    };

    let stream = match supported.sample_format() {
        SampleFormat::F32 => device
            .build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    for &sample in data {
                        queue_cb.push(sample);
                    }
                },
                |e| warn!("变声器麦克风输入错误: {e}"),
                None,
            )
            .map_err(|e| e.to_string())?,
        SampleFormat::I16 => {
            let queue_i16 = Arc::clone(&queue);
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| {
                        for &sample in data {
                            queue_i16.push(sample as f32 / 32_767.0);
                        }
                    },
                    |e| warn!("变声器麦克风输入错误: {e}"),
                    None,
                )
                .map_err(|e| e.to_string())?
        }
        fmt => return Err(format!("不支持的变声器输入采样格式: {fmt:?}")),
    };

    stream.play().map_err(|e| e.to_string())?;
    eprintln!(
        "[VoiceChanger] mic stream started device={} rate={} channels={} format={:?}",
        device.name().unwrap_or_default(),
        device_rate,
        device_channels,
        supported.sample_format()
    );

    let window_samples = engine.recommended_chunk_samples();
    let hop_samples = (config.frame_samples().saturating_mul(5)).clamp(1_600, window_samples / 2);
    let mut interleaved_buf: Vec<f32> = Vec::with_capacity(4096);
    let mut mono_buf: Vec<f32> = Vec::with_capacity(window_samples * 2);
    let mut context_buf = vec![0.0f32; window_samples];
    let mut context_filled = 0usize;
    let mut diag_frames = 0u64;
    let mut diag_peak = 0.0f32;
    let mut last_output_sample = 0.0f32;

    while !cancel.is_cancelled() {
        let mut got = false;
        while let Some(sample) = queue.pop() {
            interleaved_buf.push(sample);
            got = true;
        }

        if !got {
            std::thread::sleep(std::time::Duration::from_millis(5));
            continue;
        }

        let complete = (interleaved_buf.len() / device_channels) * device_channels;
        let mono: Vec<f32> = interleaved_buf[..complete]
            .chunks_exact(device_channels)
            .map(|frame| frame.iter().sum::<f32>() / device_channels as f32)
            .collect();
        interleaved_buf.drain(..complete);

        if device_rate == 16_000 {
            mono_buf.extend_from_slice(&mono);
        } else {
            mono_buf.extend(resample_linear(&mono, device_rate, 16_000));
        }
        if mono_buf.len() > window_samples + hop_samples * 4 {
            let drop_n = mono_buf.len().saturating_sub(window_samples + hop_samples);
            mono_buf.drain(..drop_n);
            warn!("变声器输入积压，丢弃 {drop_n} 个旧样本以降低延迟");
        }

        while mono_buf.len() >= hop_samples {
            let mut dry_hop = mono_buf.drain(..hop_samples).collect::<Vec<_>>();
            for sample in &mut dry_hop {
                *sample = (*sample * config.input_gain).clamp(-1.0, 1.0);
                diag_peak = diag_peak.max(sample.abs());
            }
            shift_append(&mut context_buf, &dry_hop);
            context_filled = (context_filled + hop_samples).min(window_samples);

            if context_filled < window_samples {
                let mut warmed = dry_hop.clone();
                smooth_leading_edge(&mut warmed, last_output_sample, 128);
                last_output_sample = warmed.last().copied().unwrap_or(last_output_sample);
                let pcm = f32_to_pcm16_bytes(&warmed);
                player.push_frame(AudioFrame::new_pcm16(Bytes::from(pcm), 16_000));
                if let Ok(mut st) = status.lock() {
                    st.processed_frames = st.processed_frames.saturating_add(1);
                    st.output_latency_ms = player.latency.target_latency_ms();
                    st.last_error = None;
                }
                continue;
            }

            let infer_start = std::time::Instant::now();
            let wet_window = engine.process(&context_buf).map_err(|e| e.to_string())?;
            let infer_ms = infer_start.elapsed().as_millis();
            let wet_hop = tail_chunk(&wet_window, hop_samples);
            let dry_rms = rms(&dry_hop);
            let wet_rms = rms(&wet_hop);
            let dry_zcr = zero_crossing_rate(&dry_hop);
            let wet_zcr = zero_crossing_rate(&wet_hop);
            let suspicious_wet = wet_hop.is_empty()
                || wet_rms < dry_rms * 0.12
                || wet_zcr > 0.32 && dry_zcr < 0.18;
            let mut mixed = if suspicious_wet {
                dry_hop.clone()
            } else {
                mix_samples(&dry_hop, &wet_hop, config.wet_mix)
            };
            smooth_leading_edge(&mut mixed, last_output_sample, 128);
            last_output_sample = mixed.last().copied().unwrap_or(last_output_sample);
            let pcm = f32_to_pcm16_bytes(&mixed);
            player.push_frame(AudioFrame::new_pcm16(Bytes::from(pcm), 16_000));
            diag_frames = diag_frames.saturating_add(1);
            if diag_frames % 25 == 0 {
                eprintln!(
                    "[VoiceChanger] processed_frames={} input_peak={:.4} wet_window_samples={} hop_samples={} dry_rms={:.4} wet_rms={:.4} dry_zcr={:.3} wet_zcr={:.3} fallback={} output_latency_ms={}",
                    diag_frames,
                    diag_peak,
                    wet_window.len(),
                    hop_samples,
                    dry_rms,
                    wet_rms,
                    dry_zcr,
                    wet_zcr,
                    suspicious_wet,
                    player.latency.target_latency_ms()
                );
                diag_peak = 0.0;
            }
            if infer_ms > config.frame_ms as u128 {
                eprintln!(
                    "[VoiceChanger] realtime overrun infer_ms={} frame_ms={}",
                    infer_ms, config.frame_ms
                );
            }

            if let Ok(mut st) = status.lock() {
                st.processed_frames = st.processed_frames.saturating_add(1);
                st.output_latency_ms = player.latency.target_latency_ms();
                st.last_error = None;
            }
        }
    }

    if let Ok(mut st) = status.lock() {
        st.running = false;
    }
    Ok(())
}

#[cfg(feature = "voice-changer")]
fn shift_append(window: &mut [f32], append: &[f32]) {
    if append.is_empty() || window.is_empty() {
        return;
    }
    if append.len() >= window.len() {
        let start = append.len() - window.len();
        window.copy_from_slice(&append[start..]);
        return;
    }
    let hop = append.len();
    window.rotate_left(hop);
    let len = window.len();
    window[len - hop..].copy_from_slice(append);
}

#[cfg(feature = "voice-changer")]
fn tail_chunk(input: &[f32], len: usize) -> Vec<f32> {
    if input.len() <= len {
        return input.to_vec();
    }
    input[input.len() - len..].to_vec()
}

#[cfg(feature = "voice-changer")]
fn rms(input: &[f32]) -> f32 {
    if input.is_empty() {
        return 0.0;
    }
    let energy = input.iter().map(|sample| sample * sample).sum::<f32>() / input.len() as f32;
    energy.sqrt()
}

#[cfg(feature = "voice-changer")]
fn zero_crossing_rate(input: &[f32]) -> f32 {
    if input.len() < 2 {
        return 0.0;
    }
    let crossings = input
        .windows(2)
        .filter(|pair| pair[0].signum() != pair[1].signum())
        .count();
    crossings as f32 / (input.len() - 1) as f32
}

#[cfg(feature = "voice-changer")]
fn smooth_leading_edge(input: &mut [f32], prev_last: f32, fade_len: usize) {
    if input.is_empty() {
        return;
    }
    let len = fade_len.min(input.len());
    for (idx, sample) in input.iter_mut().take(len).enumerate() {
        let alpha = (idx + 1) as f32 / len as f32;
        *sample = prev_last * (1.0 - alpha) + *sample * alpha;
    }
}

#[cfg(feature = "voice-changer")]
fn mix_samples(dry: &[f32], wet: &[f32], wet_mix: f32) -> Vec<f32> {
    let mut out = Vec::with_capacity(dry.len());
    for idx in 0..dry.len() {
        let dry_sample = dry[idx];
        let wet_sample = wet.get(idx).copied().unwrap_or(dry_sample);
        out.push((dry_sample * (1.0 - wet_mix) + wet_sample * wet_mix).clamp(-1.0, 1.0));
    }
    out
}

#[cfg(feature = "voice-changer")]
fn f32_to_pcm16_bytes(input: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len() * 2);
    for &sample in input {
        let pcm = (sample * 32_767.0).clamp(-32_768.0, 32_767.0) as i16;
        out.extend_from_slice(&pcm.to_le_bytes());
    }
    out
}

#[cfg(feature = "voice-changer")]
fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = (input.len() as f64 / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 * ratio;
        let idx = src as usize;
        let frac = (src - idx as f64) as f32;
        let a = input.get(idx).copied().unwrap_or(0.0);
        let b = input.get(idx + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}
