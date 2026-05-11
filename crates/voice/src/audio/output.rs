//! 系统音频输出（含自适应延迟监控）
//!
//! AudioPlayer 将 TTS 合成的 PCM 帧送入 cpal 播放流。
//!
//! 设计：
//! - cpal Stream 完全封闭在专属 std::thread 中（避免 Send/Sync 问题）
//! - 外部通过 SyncSender<AudioFrame> 发帧，线程安全、Arc 可共享
//! - lock-free SegQueue 作为 cpal 回调与接收线程之间的 ring buffer
//! - LatencyMonitor 自适应调整缓冲上限，平衡延迟与流畅度

use std::sync::Arc;

use crossbeam_queue::SegQueue;
use tracing::{error, info, warn};

use super::latency::LatencyMonitor;
use super::mixer::i16_to_f32_bulk;
use crate::pipeline::frame::AudioFrame;

/// 线程安全的音频播放器（Send + Sync，含自适应延迟监控）
pub struct AudioPlayer {
    tx: std::sync::mpsc::SyncSender<AudioFrame>,
    _thread: std::thread::JoinHandle<()>,
    pub latency: Arc<LatencyMonitor>,
}

impl AudioPlayer {
    /// 打开默认输出设备，启动专属播放线程
    pub fn new() -> Result<Self, String> {
        let (tx, rx) = std::sync::mpsc::sync_channel::<AudioFrame>(64);
        let monitor = Arc::new(LatencyMonitor::default());
        let monitor_thread = Arc::clone(&monitor);

        let thread = std::thread::Builder::new()
            .name("audio-output".to_string())
            .spawn(move || {
                if let Err(e) = run_playback_thread(rx, monitor_thread) {
                    error!("音频播放线程退出: {e}");
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(Self { tx, _thread: thread, latency: monitor })
    }

    /// 将 AudioFrame 送入播放队列（非阻塞，队列满则丢弃）
    pub fn push_frame(&self, frame: AudioFrame) {
        if frame.data.is_empty() {
            return;
        }
        let _ = self.tx.try_send(frame);
    }
}

fn run_playback_thread(
    rx: std::sync::mpsc::Receiver<AudioFrame>,
    monitor: Arc<LatencyMonitor>,
) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{SampleFormat, StreamConfig};

    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "未找到音频输出设备".to_string())?;

    let supported = device.default_output_config().map_err(|e| e.to_string())?;

    let device_sample_rate = supported.sample_rate().0;
    let device_channels = supported.channels() as usize;

    info!(
        device = device.name().unwrap_or_default(),
        sample_rate = device_sample_rate,
        channels = device_channels,
        "音频输出已就绪"
    );

    let buffer: Arc<SegQueue<f32>> = Arc::new(SegQueue::new());
    let buf_cb = Arc::clone(&buffer);
    let mon_cb = Arc::clone(&monitor);

    let config = StreamConfig {
        channels: supported.channels(),
        sample_rate: supported.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };

    let stream = match supported.sample_format() {
        SampleFormat::F32 => device
            .build_output_stream(
                &config,
                move |data: &mut [f32], _| fill_f32(data, &buf_cb, device_channels, &mon_cb),
                |e| error!("音频输出错误: {e}"),
                None,
            )
            .map_err(|e| e.to_string())?,

        SampleFormat::I16 => {
            let buf_cb2 = Arc::clone(&buffer);
            let mon_cb2 = Arc::clone(&monitor);
            device
                .build_output_stream(
                    &config,
                    move |data: &mut [i16], _| fill_i16(data, &buf_cb2, device_channels, &mon_cb2),
                    |e| error!("音频输出错误: {e}"),
                    None,
                )
                .map_err(|e| e.to_string())?
        }

        fmt => return Err(format!("不支持的音频格式: {fmt:?}")),
    };

    stream.play().map_err(|e| e.to_string())?;

    // 接收帧并推入 ring buffer（含自适应延迟控制）
    while let Ok(frame) = rx.recv() {
        push_to_buffer(&frame, &buffer, device_sample_rate, &monitor);
    }

    Ok(())
}

fn push_to_buffer(
    frame: &AudioFrame,
    buffer: &SegQueue<f32>,
    device_rate: u32,
    monitor: &LatencyMonitor,
) {
    // 使用 SIMD 友好的批量 i16→f32 转换
    let samples = i16_to_f32_bulk(&frame.data);

    let resampled = if frame.sample_rate != device_rate {
        resample_linear(&samples, frame.sample_rate, device_rate)
    } else {
        samples
    };

    // 自适应缓冲上限（来自 LatencyMonitor）
    let max_buf = monitor.target_max.load(std::sync::atomic::Ordering::Relaxed);
    let current = buffer.len();
    if current + resampled.len() > max_buf {
        let drop_n = (current + resampled.len()).saturating_sub(max_buf);
        for _ in 0..drop_n {
            buffer.pop();
        }
        warn!("音频缓冲溢出，丢弃 {drop_n} 个样本 (target={}ms)", monitor.target_latency_ms());
    }

    for s in &resampled {
        buffer.push(*s);
    }
    monitor.on_push(resampled.len());
}

fn fill_f32(data: &mut [f32], buf: &SegQueue<f32>, channels: usize, monitor: &LatencyMonitor) {
    let mut drained = 0usize;
    for frame in data.chunks_mut(channels) {
        let s = buf.pop().unwrap_or(0.0);
        if s != 0.0 {
            drained += 1;
        }
        for ch in frame.iter_mut() {
            *ch = s;
        }
    }
    if drained > 0 {
        monitor.on_drain(drained);
    }
}

fn fill_i16(data: &mut [i16], buf: &SegQueue<f32>, channels: usize, monitor: &LatencyMonitor) {
    let mut drained = 0usize;
    for frame in data.chunks_mut(channels) {
        let s = buf.pop().unwrap_or(0.0);
        if s != 0.0 {
            drained += 1;
        }
        let s16 = (s * 32767.0).clamp(-32768.0, 32767.0) as i16;
        for ch in frame.iter_mut() {
            *ch = s16;
        }
    }
    if drained > 0 {
        monitor.on_drain(drained);
    }
}

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
