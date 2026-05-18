//! sherpa-onnx VAD + SenseVoice ASR pipeline
//!
//! 架构：
//!   麦克风 PCM (cpal) → sherpa VoiceActivityDetector → 语音段 → SherpaAsrBackend（可选）
//!
//! 模型文件（运行时加载，路径由调用方传入）：
//!   <model_dir>/silero_vad.onnx  — VAD
//!   <model_dir>/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/
//!     model.int8.onnx, tokens.txt  — ASR（可选）

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

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
    SpeechEnd {
        vetoed: bool,
        text: Option<String>,
    },
    /// 话轮音频已就绪；samples 为 16kHz 单声道 f32，供外部 ASR 使用
    TurnEnd {
        samples: Vec<f32>,
    },
}

/// VAD + 可选 ASR pipeline 句柄
pub struct SherpaPipeline {
    /// 向 pipeline 推送 PCM 块（16kHz 单声道 f32，每块 512 样本）
    pub audio_tx: mpsc::UnboundedSender<Vec<f32>>,
    pub events_tx: broadcast::Sender<TurnEvent>,
    cancel: CancellationToken,
    /// ASR 是否成功加载（false = 仅 VAD，无识别文本）
    pub has_asr: bool,
    /// ASR 加载失败时的错误描述，供调用方展示给用户
    pub asr_warning: Option<String>,
}

impl SherpaPipeline {
    /// 启动 pipeline。
    ///
    /// - `vad_model`: silero_vad.onnx 路径
    /// - `asr_model_dir`: SenseVoice 模型目录（`None` 则跳过 ASR）
    /// - `language`: "zh" / "yue" / "en" / "ja" / "ko" / "auto"
    /// - `vad_threshold`: 0.1（最灵敏）~ 0.9（最保守），默认 0.3
    /// - `vad_min_speech`: 最短语音段秒数，默认 0.08
    /// - `vad_min_silence`: 话轮结束静音秒数，默认 0.4
    pub fn spawn(
        vad_model: PathBuf,
        asr_model_dir: Option<PathBuf>,
        language: &str,
        vad_threshold: f32,
        vad_min_speech: f32,
        vad_min_silence: f32,
        cancel: CancellationToken,
    ) -> Result<Self, String> {
        // Guard: validate file exists and is plausibly intact before calling C++.
        // A missing OR corrupt ONNX file causes Ort::Session::Session to throw a C++
        // exception that escapes the FFI boundary → demangling_terminate_handler → abort().
        // catch_unwind cannot intercept C++ exceptions, so we must gate here.
        if !vad_model.exists() {
            return Err(format!(
                "VAD 模型文件不存在: {} — 请先下载 silero_vad.onnx",
                vad_model.display()
            ));
        }
        {
            let meta = std::fs::metadata(&vad_model)
                .map_err(|e| format!("无法读取 VAD 模型文件元数据: {e}"))?;
            // silero_vad.onnx is ~1.7 MB; anything under 64 KB is certainly truncated.
            if meta.len() < 65_536 {
                return Err(format!(
                    "VAD 模型文件过小 ({} bytes)，可能下载不完整，请重新下载 silero_vad.onnx",
                    meta.len()
                ));
            }
            // ONNX/protobuf files have no fixed magic, but field-1 (ir_version, varint)
            // always makes the first byte 0x08.  Reject anything that doesn't start with it.
            let mut f = std::fs::File::open(&vad_model)
                .map_err(|e| format!("无法打开 VAD 模型文件: {e}"))?;
            let mut hdr = [0u8; 1];
            use std::io::Read;
            f.read_exact(&mut hdr)
                .map_err(|e| format!("无法读取 VAD 模型文件头: {e}"))?;
            if hdr[0] != 0x08 {
                return Err(format!(
                    "VAD 模型文件格式不正确（首字节 0x{:02x} ≠ 0x08），请重新下载 silero_vad.onnx",
                    hdr[0]
                ));
            }
        }

        // 可选 ASR 初始化（软失败：模型缺失时只运行 VAD，不中止整个 pipeline）
        let mut asr_warning: Option<String> = None;
        let asr: Option<SherpaAsrBackend> = match asr_model_dir {
            Some(dir) => {
                let lang = language.to_string();
                match SherpaAsrBackend::new(&dir, &lang) {
                    Ok(b) => Some(b),
                    Err(e) => {
                        let msg = format!("本地 ASR 模型加载失败，将仅运行 VAD（无识别文本）: {e}");
                        warn!("{msg}");
                        asr_warning = Some(msg);
                        None
                    }
                }
            }
            None => None,
        };
        let has_asr = asr.is_some();

        // VAD 初始化（sherpa-onnx 1.13+: VoiceActivityDetector::create 代替 new）
        let vad_config = VadModelConfig {
            silero_vad: sherpa_onnx::SileroVadModelConfig {
                model: Some(vad_model.to_string_lossy().to_string()),
                min_silence_duration: vad_min_silence,
                min_speech_duration: vad_min_speech,
                threshold: vad_threshold,
                window_size: 512,
                max_speech_duration: 20.0,
            },
            ten_vad: Default::default(),
            sample_rate: 16000,
            num_threads: 1,
            provider: Some("cpu".to_string()),
            debug: false,
        };
        let vad = VoiceActivityDetector::create(&vad_config, 30.0)
            .ok_or("VAD 初始化失败（请检查 silero_vad.onnx 路径）")?;

        let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<f32>>();
        let (events_tx, _) = broadcast::channel::<TurnEvent>(64);
        let ev_tx = events_tx.clone();

        let cancel_bg = cancel.clone();
        tokio::task::spawn_blocking(move || {
            run_loop(audio_rx, vad, asr, ev_tx, cancel_bg);
        });

        info!("✅ SherpaPipeline 已启动 (has_asr={})", has_asr);
        Ok(Self {
            audio_tx,
            events_tx,
            cancel,
            has_asr,
            asr_warning,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<TurnEvent> {
        self.events_tx.subscribe()
    }
}

/// VAD + 可选 ASR 主循环（在 spawn_blocking 线程里运行）
///
/// sherpa-onnx VAD 内部已完成端点检测（end-pointing），`front()` 返回的是完整语音段，
/// 不是逐帧增量数据。`front()` 在 `is_empty()` 为 true 时返回 None，因此
/// `while !vad.is_empty()` 循环内 `front()` 始终返回 Some——需直接处理每个完整段落。
fn run_loop(
    mut audio_rx: mpsc::UnboundedReceiver<Vec<f32>>,
    vad: VoiceActivityDetector,
    mut asr: Option<SherpaAsrBackend>,
    events: broadcast::Sender<TurnEvent>,
    cancel: CancellationToken,
) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("sherpa loop runtime");

    rt.block_on(async move {
        let mut chunk_count: u64 = 0;
        // Log at 3s, 10s, then every 30s (at 16kHz / 512 samples per chunk ≈ 31 chunks/s)
        let checkpoints: &[u64] = &[93, 310, 930, 1860, 2790];
        let mut next_checkpoint_idx = 0;

        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                chunk = audio_rx.recv() => {
                    let Some(samples) = chunk else { break };

                    chunk_count += 1;
                    if next_checkpoint_idx < checkpoints.len() && chunk_count == checkpoints[next_checkpoint_idx] {
                        info!("[VAD] 已接收 {} 块音频（约 {}s），VAD 运行正常", chunk_count, chunk_count / 31);
                        next_checkpoint_idx += 1;
                    }

                    vad.accept_waveform(&samples);

                    // 每次 accept_waveform 后轮询所有就绪的完整语音段
                    while let Some(seg) = vad.front() {
                        let seg_samples = seg.samples().to_vec();
                        vad.pop();

                        if seg_samples.is_empty() {
                            continue;
                        }

                        info!("[VAD] 语音段就绪 ({}ms)", seg_samples.len() / 16);
                        let _ = events.send(TurnEvent::SpeechStart);

                        let asr_text = if let Some(ref mut asr) = asr {
                            match asr.streaming_recognition(&seg_samples, true, true).await {
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

                        let _ = events.send(TurnEvent::TurnEnd { samples: seg_samples });
                        let _ = events.send(TurnEvent::SpeechEnd { vetoed: false, text: asr_text });
                    }
                }
            }
        }
    });
}

/// 麦克风捕获 → SherpaPipeline
pub struct SherpaMicCapture {
    cancel: CancellationToken,
    _thread: std::thread::JoinHandle<()>,
}

impl SherpaMicCapture {
    /// 启动麦克风捕获。
    ///
    /// `audio_tap`：若提供，每块 512 样本也会同步发到该发送端（供 WhisperLive 等外部 ASR 使用）。
    pub fn start(
        pipeline: &SherpaPipeline,
        audio_tap: Option<mpsc::UnboundedSender<Vec<f32>>>,
        status_tx: Option<std::sync::mpsc::Sender<String>>,
        mic_gain: f32,
        capture_enabled: Option<Arc<AtomicBool>>,
    ) -> Result<Self, String> {
        let tx = pipeline.audio_tx.clone();
        let cancel = pipeline.cancel.clone();
        let cancel_t = cancel.clone();
        let (startup_tx, startup_rx) = std::sync::mpsc::channel::<Result<(), String>>();

        let thread = std::thread::Builder::new()
            .name("sherpa-mic".into())
            .spawn(move || {
                if let Err(e) = run_mic(
                    tx,
                    audio_tap,
                    cancel_t,
                    status_tx.clone(),
                    startup_tx,
                    mic_gain,
                    capture_enabled,
                ) {
                    if let Some(ref status) = status_tx {
                        let _ = status.send(format!("麦克风捕获失败: {e}"));
                    }
                    eprintln!("[Mic] capture failed: {e}");
                    error!("麦克风捕获失败: {e}");
                }
            })
            .map_err(|e| e.to_string())?;

        match startup_rx.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                cancel.cancel();
                return Err(e);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                cancel.cancel();
                return Err("麦克风启动超时：3秒内未收到输入流就绪信号".to_string());
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                cancel.cancel();
                return Err("麦克风启动线程异常退出".to_string());
            }
        }

        Ok(Self {
            cancel,
            _thread: thread,
        })
    }

    pub fn stop(&self) {
        self.cancel.cancel();
    }
}

fn run_mic(
    tx: mpsc::UnboundedSender<Vec<f32>>,
    audio_tap: Option<mpsc::UnboundedSender<Vec<f32>>>,
    cancel: CancellationToken,
    status_tx: Option<std::sync::mpsc::Sender<String>>,
    startup_tx: std::sync::mpsc::Sender<Result<(), String>>,
    mic_gain: f32,
    capture_enabled: Option<Arc<AtomicBool>>,
) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{BufferSize, SampleFormat, StreamConfig};

    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(device) => device,
        None => {
            let msg = "未找到麦克风".to_string();
            let _ = startup_tx.send(Err(msg.clone()));
            return Err(msg);
        }
    };
    let sup = match device.default_input_config() {
        Ok(sup) => sup,
        Err(e) => {
            let msg = format!("读取默认麦克风配置失败: {e}");
            let _ = startup_tx.send(Err(msg.clone()));
            return Err(msg);
        }
    };
    let rate = sup.sample_rate().0;
    let ch = sup.channels() as usize;
    let fmt = sup.sample_format();

    info!(
        "麦克风: {} {}Hz {}ch {:?}",
        device.name().unwrap_or_default(),
        rate,
        ch,
        fmt,
    );
    if let Some(ref status) = status_tx {
        let _ = status.send(format!(
            "麦克风设备: {} {}Hz {}ch {:?}",
            device.name().unwrap_or_default(),
            rate,
            ch,
            fmt,
        ));
    }

    let queue: Arc<SegQueue<f32>> = Arc::new(SegQueue::new());
    let q_cb = queue.clone();

    let config = StreamConfig {
        channels: sup.channels(),
        sample_rate: sup.sample_rate(),
        buffer_size: BufferSize::Default,
    };

    let stream = match fmt {
        SampleFormat::F32 => device
            .build_input_stream(
                &config,
                move |data: &[f32], _| {
                    for &s in data {
                        q_cb.push((s * mic_gain).clamp(-1.0, 1.0));
                    }
                },
                |e| warn!("麦克风错误: {e}"),
                None,
            )
            .map_err(|e| {
                let msg = format!("创建 F32 麦克风输入流失败: {e}");
                let _ = startup_tx.send(Err(msg.clone()));
                msg
            })?,
        SampleFormat::I16 => {
            let q = queue.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        for &s in data {
                            q.push((s as f32 / 32768.0 * mic_gain).clamp(-1.0, 1.0));
                        }
                    },
                    |e| warn!("麦克风错误: {e}"),
                    None,
                )
                .map_err(|e| {
                    let msg = format!("创建 I16 麦克风输入流失败: {e}");
                    let _ = startup_tx.send(Err(msg.clone()));
                    msg
                })?
        }
        SampleFormat::I32 => {
            let q = queue.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[i32], _| {
                        for &s in data {
                            q.push((s as f32 / i32::MAX as f32 * mic_gain).clamp(-1.0, 1.0));
                        }
                    },
                    |e| warn!("麦克风错误: {e}"),
                    None,
                )
                .map_err(|e| {
                    let msg = format!("创建 I32 麦克风输入流失败: {e}");
                    let _ = startup_tx.send(Err(msg.clone()));
                    msg
                })?
        }
        fmt => {
            let msg = format!("不支持的采样格式 {fmt:?}");
            let _ = startup_tx.send(Err(msg.clone()));
            return Err(msg);
        }
    };

    if let Err(e) = stream.play() {
        let msg = format!("启动麦克风输入流失败: {e}");
        let _ = startup_tx.send(Err(msg.clone()));
        return Err(msg);
    }
    let _ = startup_tx.send(Ok(()));
    if let Some(ref status) = status_tx {
        let _ = status.send("麦克风输入流已开始采集".to_string());
    }

    const VAD_CHUNK: usize = 512;
    const VAD_RATE: u32 = 16_000;

    let mut interleaved_buf: Vec<f32> = Vec::new();
    let mut vad_buf: Vec<f32> = Vec::new();

    // 首次 1 秒打印音量（快速诊断），此后每 5 秒一次
    let mut diag_samples: u64 = 0;
    let mut diag_peak: f32 = 0.0;
    let mut diag_report_count: u32 = 0;
    let diag_interval_first = VAD_RATE as u64; // 1 秒
    let diag_interval_normal = VAD_RATE as u64 * 5; // 5 秒

    while !cancel.is_cancelled() {
        while let Some(s) = queue.pop() {
            interleaved_buf.push(s);
        }

        // 只处理完整声道帧，保留余量供下次迭代
        let n_complete = (interleaved_buf.len() / ch) * ch;
        if n_complete == 0 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            continue;
        }

        // 多声道 → 单声道均值
        let mono: Vec<f32> = interleaved_buf[..n_complete]
            .chunks_exact(ch)
            .map(|frame| frame.iter().sum::<f32>() / ch as f32)
            .collect();
        interleaved_buf.drain(..n_complete);

        // 重采样到 16kHz
        if rate == VAD_RATE {
            vad_buf.extend_from_slice(&mono);
        } else {
            let ratio = VAD_RATE as f64 / rate as f64;
            let new_len = (mono.len() as f64 * ratio) as usize;
            for i in 0..new_len {
                let src = i as f64 / ratio;
                let lo = src.floor() as usize;
                let hi = (lo + 1).min(mono.len() - 1);
                let t = (src - lo as f64) as f32;
                vad_buf.push(mono[lo] * (1.0 - t) + mono[hi] * t);
            }
        }

        // 音量诊断统计
        for &s in &vad_buf {
            diag_peak = diag_peak.max(s.abs());
        }
        diag_samples += vad_buf.len() as u64;
        let threshold = if diag_report_count == 0 {
            diag_interval_first
        } else {
            diag_interval_normal
        };
        if diag_samples >= threshold {
            diag_report_count += 1;
            if diag_peak < 1e-6 {
                warn!(
                    "[麦克风] 音量全静音（peak≈0），请检查：① 系统隐私 > 麦克风权限 ② 系统输入音量是否为0"
                );
                if let Some(ref status) = status_tx {
                    let _ = status.send(
                        "[麦克风] 音量全静音（peak≈0），请检查系统麦克风权限和输入音量".to_string(),
                    );
                }
            } else {
                info!("[麦克风] 音量 peak={:.4}（正常范围 0.01-1.0）", diag_peak);
                if let Some(ref status) = status_tx {
                    let _ = status.send(format!("[麦克风] 音量 peak={:.4}", diag_peak));
                }
            }
            diag_samples = 0;
            diag_peak = 0.0;
        }

        // 按 512 样本分块推入 VAD pipeline
        while vad_buf.len() >= VAD_CHUNK {
            let chunk: Vec<f32> = vad_buf.drain(..VAD_CHUNK).collect();
            if capture_enabled
                .as_ref()
                .is_some_and(|enabled| !enabled.load(Ordering::Relaxed))
            {
                continue;
            }
            if let Some(ref tap) = audio_tap {
                let _ = tap.send(chunk.clone());
            }
            if tx.send(chunk).is_err() {
                return Ok(());
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    Ok(())
}
