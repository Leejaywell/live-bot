//! 麦克风实时捕获 → VadPipeline
//!
//! MicCapture 打开默认输入设备，在专属线程内完成：
//!   设备采样率 → 单声道混音 → 线性重采样 → 16kHz → 512 样本块 → VadPipeline::push_audio
//!
//! cpal 回调把原始 f32 样本推入 lock-free SegQueue，处理线程异步消费，
//! 保证回调延迟稳定（不在 RT 线程做重采样）。

use std::sync::Arc;

use crossbeam_queue::SegQueue;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use crate::vad::pipeline::VadPipeline;

const VAD_CHUNK: usize = 512;
const VAD_RATE: u32 = 16_000;

/// 麦克风实时捕获句柄
pub struct MicCapture {
    cancel: CancellationToken,
    _thread: std::thread::JoinHandle<()>,
}

impl MicCapture {
    /// 打开默认输入设备，将 16kHz 单声道 PCM 块推入 `pipeline`。
    ///
    /// `audio_tx`：若提供，每个 512 样本块也会同步投递到该发送端（用于 ASR 积累）。
    pub fn start(
        pipeline: VadPipeline,
        audio_tx: Option<tokio::sync::mpsc::UnboundedSender<Vec<f32>>>,
    ) -> Result<Self, String> {
        let cancel = CancellationToken::new();
        let cancel_thread = cancel.clone();

        let thread = std::thread::Builder::new()
            .name("mic-capture".into())
            .spawn(move || {
                if let Err(e) = run_mic_thread(pipeline, audio_tx, cancel_thread) {
                    error!("麦克风捕获线程退出: {e}");
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(Self { cancel, _thread: thread })
    }

    /// 停止麦克风捕获（cancel token 触发后处理线程自行退出）
    pub fn stop(&self) {
        self.cancel.cancel();
    }
}

fn run_mic_thread(
    pipeline: VadPipeline,
    audio_tx: Option<tokio::sync::mpsc::UnboundedSender<Vec<f32>>>,
    cancel: CancellationToken,
) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{BufferSize, SampleFormat, StreamConfig};

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "未找到默认麦克风输入设备".to_string())?;

    let supported = device.default_input_config().map_err(|e| e.to_string())?;
    let device_rate = supported.sample_rate().0;
    let device_ch = supported.channels() as usize;

    info!(
        device = device.name().unwrap_or_default(),
        sample_rate = device_rate,
        channels = device_ch,
        "麦克风已就绪"
    );

    // cpal 回调 → 处理线程的 RT-safe 队列（存储交错 f32 样本）
    let queue: Arc<SegQueue<f32>> = Arc::new(SegQueue::new());
    let queue_cb = Arc::clone(&queue);

    let config = StreamConfig {
        channels: supported.channels(),
        sample_rate: supported.sample_rate(),
        buffer_size: BufferSize::Default,
    };

    let stream = match supported.sample_format() {
        SampleFormat::F32 => device
            .build_input_stream(
                &config,
                move |data: &[f32], _| {
                    for &s in data {
                        queue_cb.push(s);
                    }
                },
                |e| warn!("麦克风输入错误: {e}"),
                None,
            )
            .map_err(|e| e.to_string())?,

        SampleFormat::I16 => {
            let q = Arc::clone(&queue);
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        for &s in data {
                            q.push(s as f32 / 32_767.0);
                        }
                    },
                    |e| warn!("麦克风输入错误: {e}"),
                    None,
                )
                .map_err(|e| e.to_string())?
        }

        fmt => return Err(format!("不支持的采样格式: {fmt:?}")),
    };

    stream.play().map_err(|e| e.to_string())?;

    // interleaved_buf: 设备原始采样率 + 多声道交错
    // vad_buf:         16kHz 单声道，待分块送 VAD
    let mut interleaved_buf: Vec<f32> = Vec::with_capacity(4096);
    let mut vad_buf: Vec<f32> = Vec::with_capacity(1024);

    while !cancel.is_cancelled() {
        // 从 RT 队列排干
        let mut got = false;
        while let Some(s) = queue.pop() {
            interleaved_buf.push(s);
            got = true;
        }

        if !got {
            std::thread::sleep(std::time::Duration::from_millis(5));
            continue;
        }

        // 只处理完整采样帧（通常 cpal 已保证对齐，但做防御性截断）
        let n_complete = (interleaved_buf.len() / device_ch) * device_ch;

        // 多声道 → 单声道均值混音
        let mono: Vec<f32> = interleaved_buf[..n_complete]
            .chunks_exact(device_ch)
            .map(|ch| ch.iter().sum::<f32>() / device_ch as f32)
            .collect();
        interleaved_buf.drain(..n_complete);

        // 重采样到 16kHz（线性插值）
        if device_rate != VAD_RATE {
            vad_buf.extend(resample_linear(&mono, device_rate, VAD_RATE));
        } else {
            vad_buf.extend_from_slice(&mono);
        }

        // 按 512 样本分块推入 VadPipeline（及可选的 ASR 通道）
        while vad_buf.len() >= VAD_CHUNK {
            let chunk: Vec<f32> = vad_buf.drain(..VAD_CHUNK).collect();
            if let Some(ref tx) = audio_tx {
                let _ = tx.send(chunk.clone());
            }
            pipeline.push_audio(chunk);
        }
    }

    info!("麦克风捕获已停止");
    Ok(())
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
