//! sherpa-onnx VAD + SenseVoice ASR pipeline
//!
//! 架构：
//!   麦克风 PCM (cpal) → sherpa VoiceActivityDetector → 语音段 → SherpaAsrBackend（可选）
//!
//! 模型文件（运行时加载）：
//!   assets/models/silero_vad.onnx  — VAD
//!   assets/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/
//!     model.int8.onnx, tokens.txt  — ASR（可选）

use std::path::PathBuf;
use std::sync::Arc;

use crossbeam_queue::SegQueue;
use sherpa_onnx::{VadModelConfig, VoiceActivityDetector};
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use crate::asr::backend::AsrBackend;
use crate::asr::sherpa::SherpaAsrBackend;

/// 对外广播的话轮事件
#[derive(Debug, Clone)]
pub enum TurnEvent {
    SpeechStart,
    /// 话轮结束，附带本地 ASR 识别文本（无 ASR 或识别为空时为 None）
    SpeechEnd { vetoed: bool, text: Option<String> },
    TurnEnd,
}

/// VAD + 可选 ASR pipeline 句柄
pub struct SherpaPipeline {
    /// 向 pipeline 推送 PCM 块（16kHz 单声道 f32，每块 512 样本）
    pub audio_tx:  mpsc::UnboundedSender<Vec<f32>>,
    pub events_tx: broadcast::Sender<TurnEvent>,
    cancel:        CancellationToken,
}

impl SherpaPipeline {
    /// 启动 pipeline。
    ///
    /// - `vad_model`: silero_vad.onnx 路径
    /// - `asr_model_dir`: SenseVoice 模型目录（`None` 则跳过 ASR）
    /// - `language`: "zh" / "en" / "auto"
    pub fn spawn(
        vad_model:     PathBuf,
        asr_model_dir: Option<PathBuf>,
        language:      &str,
        cancel:        CancellationToken,
    ) -> Result<Self, String> {
        // 可选 ASR 初始化
        let asr: Option<SherpaAsrBackend> = match asr_model_dir {
            Some(dir) => {
                let lang = language.to_string();
                Some(SherpaAsrBackend::new(&dir, &lang).map_err(|e| e.to_string())?)
            }
            None => None,
        };

        // VAD 初始化（sherpa-onnx 1.13+: VoiceActivityDetector::create 代替 new）
        let vad_config = VadModelConfig {
            silero_vad: sherpa_onnx::SileroVadModelConfig {
                model:                Some(vad_model.to_string_lossy().to_string()),
                min_silence_duration: 0.5,
                min_speech_duration:  0.1,
                threshold:            0.5,
                window_size:          512,
                max_speech_duration:  20.0,
            },
            ten_vad:     Default::default(),
            sample_rate: 16000,
            num_threads: 1,
            provider:    Some("cpu".to_string()),
            debug:       false,
        };
        let vad = VoiceActivityDetector::create(&vad_config, 30.0)
            .ok_or("VAD 初始化失败（请检查 silero_vad.onnx 路径）")?;

        let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<f32>>();
        let (events_tx, _)       = broadcast::channel::<TurnEvent>(64);
        let ev_tx = events_tx.clone();

        let cancel_bg = cancel.clone();
        tokio::task::spawn_blocking(move || {
            run_loop(audio_rx, vad, asr, ev_tx, cancel_bg);
        });

        info!("✅ SherpaPipeline 已启动");
        Ok(Self { audio_tx, events_tx, cancel })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<TurnEvent> {
        self.events_tx.subscribe()
    }
}

/// VAD + 可选 ASR 主循环（在 spawn_blocking 线程里运行）
fn run_loop(
    mut audio_rx: mpsc::UnboundedReceiver<Vec<f32>>,
    mut vad:      VoiceActivityDetector,
    mut asr:      Option<SherpaAsrBackend>,
    events:       broadcast::Sender<TurnEvent>,
    cancel:       CancellationToken,
) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("sherpa loop runtime");

    rt.block_on(async move {
        let mut speech_buf: Vec<f32> = Vec::new();
        let mut in_speech = false;

        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                chunk = audio_rx.recv() => {
                    let Some(samples) = chunk else { break };

                    vad.accept_waveform(&samples);

                    while !vad.is_empty() {
                        if let Some(seg) = vad.front() {
                            let seg_samples = seg.samples().to_vec();
                            vad.pop();

                            if !seg_samples.is_empty() {
                                if !in_speech {
                                    in_speech = true;
                                    speech_buf.clear();
                                    let _ = events.send(TurnEvent::SpeechStart);
                                    info!("[VAD] 语音开始");
                                }
                                speech_buf.extend_from_slice(&seg_samples);
                            }
                        } else {
                            // 空 segment = 静音段结束
                            if in_speech && !speech_buf.is_empty() {
                                in_speech = false;
                                let _ = events.send(TurnEvent::TurnEnd);
                                info!("[VAD] 话轮结束 ({}ms)", speech_buf.len() / 16);

                                let asr_text = if let Some(ref mut asr) = asr {
                                    match asr.streaming_recognition(&speech_buf, true, true).await {
                                        Ok(Some(vt)) => {
                                            info!("[ASR] {}", vt.content);
                                            Some(vt.content)
                                        }
                                        Ok(None) => None,
                                        Err(e) => { warn!("[ASR] 推理失败: {e}"); None }
                                    }
                                } else {
                                    None
                                };

                                let _ = events.send(TurnEvent::SpeechEnd { vetoed: false, text: asr_text });
                                speech_buf.clear();
                            }
                            break;
                        }
                    }
                }
            }
        }
    });
}

/// 麦克风捕获 → SherpaPipeline
pub struct SherpaMicCapture {
    cancel:  CancellationToken,
    _thread: std::thread::JoinHandle<()>,
}

impl SherpaMicCapture {
    /// 启动麦克风捕获。
    ///
    /// `audio_tap`：若提供，每块 512 样本也会同步发到该发送端（供 WhisperLive 等外部 ASR 使用）。
    pub fn start(
        pipeline:  &SherpaPipeline,
        audio_tap: Option<mpsc::UnboundedSender<Vec<f32>>>,
    ) -> Result<Self, String> {
        let tx       = pipeline.audio_tx.clone();
        let cancel   = pipeline.cancel.clone();
        let cancel_t = cancel.clone();

        let thread = std::thread::Builder::new()
            .name("sherpa-mic".into())
            .spawn(move || {
                if let Err(e) = run_mic(tx, audio_tap, cancel_t) {
                    error!("麦克风捕获失败: {e}");
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(Self { cancel, _thread: thread })
    }

    pub fn stop(&self) { self.cancel.cancel(); }
}

fn run_mic(
    tx:        mpsc::UnboundedSender<Vec<f32>>,
    audio_tap: Option<mpsc::UnboundedSender<Vec<f32>>>,
    cancel:    CancellationToken,
) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{BufferSize, SampleFormat, StreamConfig};

    let host   = cpal::default_host();
    let device = host.default_input_device().ok_or("未找到麦克风")?;
    let sup    = device.default_input_config().map_err(|e| e.to_string())?;
    let rate   = sup.sample_rate().0;
    let ch     = sup.channels() as usize;

    info!("麦克风: {} {}Hz {}ch", device.name().unwrap_or_default(), rate, ch);

    let queue: Arc<SegQueue<f32>> = Arc::new(SegQueue::new());
    let q_cb  = queue.clone();

    let config = StreamConfig {
        channels:    sup.channels(),
        sample_rate: sup.sample_rate(),
        buffer_size: BufferSize::Default,
    };

    let stream = match sup.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _| { for &s in data { q_cb.push(s); } },
            |e| warn!("麦克风错误: {e}"), None,
        ).map_err(|e| e.to_string())?,
        SampleFormat::I16 => {
            let q = queue.clone();
            device.build_input_stream(
                &config,
                move |data: &[i16], _| { for &s in data { q.push(s as f32 / 32767.0); } },
                |e| warn!("麦克风错误: {e}"), None,
            ).map_err(|e| e.to_string())?
        }
        fmt => return Err(format!("不支持的采样格式 {fmt:?}")),
    };

    stream.play().map_err(|e| e.to_string())?;

    const VAD_CHUNK: usize = 512;
    const VAD_RATE:  u32   = 16_000;

    let mut stereo_buf: Vec<f32> = Vec::new();
    let mut vad_buf:    Vec<f32> = Vec::new();

    while !cancel.is_cancelled() {
        while let Some(s) = queue.pop() {
            stereo_buf.push(s);
        }

        let mono: Vec<f32> = stereo_buf.chunks_exact(ch)
            .map(|c| c.iter().sum::<f32>() / ch as f32)
            .collect();
        stereo_buf.clear();

        if rate == VAD_RATE {
            vad_buf.extend_from_slice(&mono);
        } else {
            let ratio = VAD_RATE as f64 / rate as f64;
            let new_len = (mono.len() as f64 * ratio) as usize;
            for i in 0..new_len {
                let src = i as f64 / ratio;
                let lo  = src.floor() as usize;
                let hi  = (lo + 1).min(mono.len() - 1);
                let t   = src - lo as f64;
                vad_buf.push(mono[lo] * (1.0 - t as f32) + mono[hi] * t as f32);
            }
        }

        while vad_buf.len() >= VAD_CHUNK {
            let chunk: Vec<f32> = vad_buf.drain(..VAD_CHUNK).collect();
            if let Some(ref tap) = audio_tap {
                let _ = tap.send(chunk.clone());
            }
            if tx.send(chunk).is_err() { return Ok(()); }
        }

        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Ok(())
}
