use anyhow::Result;
use cron::Schedule;
use serde_json::json;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::net::TcpStream;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};
use tokio::time::{Duration, sleep, timeout};
use tokio_util::sync::CancellationToken;

use crate::bot::EventEmitter;
use crate::bot::engine::BotEngine;
use crate::bot::{self, agent};
use crate::config::AppConfig;
use crate::live_platform::bilibili::api::BiliApi as LegacyBiliApi;
use crate::live_platform::{
    PlatformEventEnvelope, PlatformRegistry, PlatformRoomRef, PlatformSession,
};
use crate::music::providers::netease::NeteaseProvider;
use crate::music::service::MusicInteractionService;
use crate::plugin_settings::PluginSettings;
use crate::storage::Storage;

// AsrBackend trait 用于 streaming_recognition 调用
#[cfg(feature = "vad")]
use streamix_voice::asr::AsrBackend;

pub type SharedTtsRouter = Arc<Mutex<Option<streamix_voice::SpeakerRouter>>>;

pub enum MonitorCommand {
    ReloadTts,
    ReloadVoice,
    UpdateConfig(()),
}

const ROOM_STATUS_POLL_INTERVAL: Duration = Duration::from_secs(10);
const ROOM_STATUS_POLL_MAX_BACKOFF: Duration = Duration::from_secs(60);
const ROOM_STATUS_POLL_ERROR_LOG_INTERVAL: Duration = Duration::from_secs(60);

fn room_status_poll_backoff(failures: u32) -> Duration {
    match failures {
        0..=2 => ROOM_STATUS_POLL_INTERVAL,
        3..=5 => Duration::from_secs(20),
        6..=9 => Duration::from_secs(30),
        _ => ROOM_STATUS_POLL_MAX_BACKOFF,
    }
}

fn should_log_room_status_poll_error(failures: u32, last_log_at: Option<Instant>) -> bool {
    if failures == 1 || failures == 3 || failures == 6 {
        return true;
    }
    match last_log_at {
        Some(last) => last.elapsed() >= ROOM_STATUS_POLL_ERROR_LOG_INTERVAL,
        None => true,
    }
}

#[allow(dead_code)]
fn platform_event_display_line(event: &PlatformEventEnvelope) -> String {
    format!("[{}] {:?}", event.room.log_label(), event.event)
}

pub fn spawn_tts_router(
    config: &AppConfig,
    model_dir: &std::path::Path,
    cancel: CancellationToken,
) -> Option<streamix_voice::SpeakerRouter> {
    if !config.tts_enabled {
        return None;
    }

    let tts_engine = resolve_tts_engine(config, model_dir);
    let session_config = streamix_voice::SessionConfig {
        tts_voice: config.tts_voice.clone(),
        tts_rate: tts_rate_from_speed(config.tts_speed),
        tts_pitch: tts_pitch_from_slider(config.tts_pitch),
        ..streamix_voice::SessionConfig::default()
    };
    Some(streamix_voice::SpeakerRouter::spawn_with_audio_and_engine(
        session_config,
        tts_engine,
        cancel,
    ))
}

pub fn replace_tts_router(
    shared: &SharedTtsRouter,
    config: &AppConfig,
    model_dir: &std::path::Path,
    cancel: CancellationToken,
) -> Option<streamix_voice::SpeakerRouter> {
    // 1. 先取出并丢弃旧的（旧的 cancel 会由外部 ReloadTts 逻辑触发）
    if let Ok(mut guard) = shared.lock() {
        let _ = guard.take();
    }

    // 2. 创建新的
    let next = spawn_tts_router(config, model_dir, cancel);
    let current = next.clone();
    if let Ok(mut router) = shared.lock() {
        *router = next;
    }
    current
}

fn current_tts_router(shared: &SharedTtsRouter) -> Option<streamix_voice::SpeakerRouter> {
    shared.lock().ok().and_then(|router| router.clone())
}

fn tts_rate_from_speed(speed: f32) -> Option<String> {
    let clamped = speed.clamp(0.5, 2.0);
    if (clamped - 1.0).abs() < f32::EPSILON {
        return None;
    }
    let delta = ((clamped - 1.0) * 100.0).round() as i32;
    Some(format!("{delta:+}%"))
}

fn tts_pitch_from_slider(pitch: f32) -> Option<String> {
    let hz = (pitch.clamp(-1.0, 1.0) * 6.0).round() as i32;
    if hz == 0 {
        return None;
    }
    Some(format!("{hz:+}Hz"))
}

pub fn spawn_tts_mic_gate(
    router: streamix_voice::SpeakerRouter,
    capture_enabled: Arc<AtomicBool>,
    gate_generation: Arc<AtomicU64>,
    pipeline_audio_tx: Arc<Mutex<Option<tokio::sync::mpsc::UnboundedSender<Vec<f32>>>>>,
    cancel: CancellationToken,
) {
    let mut tts_events = router.voice_session().subscribe();
    let mut playback_until = Instant::now();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    // 路由器失效时，确保恢复麦克风
                    capture_enabled.store(true, Ordering::Relaxed);
                    break;
                }
                ev = tts_events.recv() => match ev {
                    Ok(streamix_voice::SessionEvent::SpeechStart { .. }) => {
                        let generation = gate_generation.fetch_add(1, Ordering::Relaxed) + 1;
                        playback_until = Instant::now();
                        capture_enabled.store(false, Ordering::Relaxed);
                        // 虽然 SpeechStart 时还没音频，但我们也开启一个安全解锁任务
                        schedule_tts_mic_unlock(
                            Arc::clone(&capture_enabled),
                            Arc::clone(&gate_generation),
                            generation,
                            playback_until,
                            pipeline_audio_tx.clone(),
                        );
                    }
                    Ok(streamix_voice::SessionEvent::AudioReady(frame)) => {
                        let generation = gate_generation.load(Ordering::Relaxed);
                        let now = Instant::now();
                        let base = if playback_until > now { playback_until } else { now };
                        let duration_ms = frame.duration_ms().ceil().max(1.0) as u64;
                        playback_until = base + Duration::from_millis(duration_ms);
                        capture_enabled.store(false, Ordering::Relaxed);

                        schedule_tts_mic_unlock(
                            Arc::clone(&capture_enabled),
                            Arc::clone(&gate_generation),
                            generation,
                            playback_until,
                            pipeline_audio_tx.clone(),
                        );
                    }
                    Ok(streamix_voice::SessionEvent::SpeechEnd)
                    | Ok(streamix_voice::SessionEvent::SpeechInterrupted)
                    | Ok(streamix_voice::SessionEvent::SpeechError { .. }) => {
                        let generation = gate_generation.load(Ordering::Relaxed);
                        schedule_tts_mic_unlock(
                            Arc::clone(&capture_enabled),
                            Arc::clone(&gate_generation),
                            generation,
                            playback_until,
                            pipeline_audio_tx.clone(),
                        );
                    }
                    _ => {}
                }
            }
        }
    });
}

fn schedule_tts_mic_unlock(
    capture_enabled: Arc<AtomicBool>,
    gate_generation: Arc<AtomicU64>,
    generation: u64,
    playback_until: Instant,
    pipeline_audio_tx: Arc<Mutex<Option<tokio::sync::mpsc::UnboundedSender<Vec<f32>>>>>,
) {
    tokio::spawn(async move {
        let now = Instant::now();
        // 1400ms post-playback grace period: covers room echo/reverb decay so the
        // mic doesn't pick up TTS output and send it back to ASR as user speech.
        let delay = playback_until
            .saturating_duration_since(now)
            .saturating_add(Duration::from_millis(1400));
        tokio::time::sleep(delay).await;
        if gate_generation.load(Ordering::Relaxed) == generation {
            capture_enabled.store(true, Ordering::Relaxed);
            // Flush the VAD history buffer so any echoed TTS audio that snuck
            // in just before the gate closed doesn't pollute the next utterance.
            if let Ok(guard) = pipeline_audio_tx.lock() {
                if let Some(ref tx) = *guard {
                    let _ = tx.send(Vec::new());
                }
            }
        }
    });
}

fn music_interaction_enabled() -> bool {
    PluginSettings::load_or_default()
        .map(|settings| settings.music_interaction.enabled)
        .unwrap_or(false)
}

fn bilibili_session_cookie(session: &PlatformSession) -> Option<String> {
    session
        .payload
        .get("cookie")
        .and_then(|value| value.as_str())
        .map(str::to_owned)
        .filter(|cookie| !cookie.is_empty())
}

fn spawn_music_event_handler<E: EventEmitter + Send + Sync + 'static>(
    music_service: Arc<MusicInteractionService>,
    event: bilibili_live_protocol::LiveEvent,
    tx: mpsc::Sender<String>,
    app: Arc<E>,
    cancel: CancellationToken,
    should_send_reply: bool,
    permit: OwnedSemaphorePermit,
) {
    tokio::spawn(async move {
        let _permit = permit;
        tokio::select! {
            _ = cancel.cancelled() => {}
            result = music_service.handle_live_event(&event) => {
                match result {
                    Ok(reply) => {
                        let text = reply.to_danmu_text();
                        if should_send_reply && !text.is_empty() {
                            let _ = tx.send(text).await;
                        }
                    }
                    Err(err) => {
                        let _ = app.emit(
                            "monitor-log",
                            json!(format!("点歌处理失败: {err}")),
                        );
                    }
                }
            }
        }
    });
}

#[allow(dead_code)]
pub async fn run_monitor_loop<E: EventEmitter + Send + Sync + 'static>(
    app: E,
    platforms: PlatformRegistry,
    room: PlatformRoomRef,
    session: PlatformSession,
    cancel: CancellationToken,
    tts_router: SharedTtsRouter,
    tts_cancel: Arc<Mutex<CancellationToken>>,
    command_rx: mpsc::UnboundedReceiver<MonitorCommand>,
    current_session_id: Arc<Mutex<Option<String>>>,
    danmaku_buffer: Arc<Mutex<Vec<String>>>,
    model_dir: std::path::PathBuf,
    session_memory: Arc<Mutex<crate::bot::memory::SessionMemory>>,
) -> Result<()> {
    if room.platform_id.as_str() == "bilibili" {
        let http = LegacyBiliApi::new()?;
        let room_id = room.platform_room_id.parse::<i64>()?;
        return run_bilibili_monitor_loop(
            app,
            http,
            room_id,
            session,
            cancel,
            tts_router,
            tts_cancel,
            command_rx,
            current_session_id,
            danmaku_buffer,
            model_dir,
            session_memory,
        )
        .await;
    }

    let platform = platforms
        .get(&room.platform_id)
        .ok_or_else(|| anyhow::anyhow!("平台未注册: {}", room.platform_id))?;
    let _ = platform;
    let _ = session;
    Err(anyhow::anyhow!("平台监听尚未接入: {}", room.platform_id))
}

pub async fn run_bilibili_monitor_loop<E: EventEmitter + Send + Sync + 'static>(
    app: E,
    http: LegacyBiliApi,
    room_id: i64,
    session: PlatformSession,
    cancel: CancellationToken,
    tts_router: SharedTtsRouter,
    tts_cancel: Arc<Mutex<CancellationToken>>,
    mut command_rx: mpsc::UnboundedReceiver<MonitorCommand>,
    current_session_id: Arc<Mutex<Option<String>>>,
    danmaku_buffer: Arc<Mutex<Vec<String>>>,
    model_dir: std::path::PathBuf,
    session_memory: Arc<Mutex<crate::bot::memory::SessionMemory>>,
) -> Result<()> {
    let _ = app.emit("monitor-status", json!("运行中"));
    let _ = app.emit("monitor-log", json!("直播间监听已启动"));

    let config = AppConfig::load_or_default()?;
    let storage_path = crate::config::db_path();
    let storage = Arc::new(Storage::open(&storage_path.to_string_lossy())?);

    let engine = Arc::new(BotEngine::new(config.clone()));
    let bot_config = Arc::new(config.clone());
    let sender_danmu_len = config.danmu_len;
    let cron_enabled = config.cron_danmu;
    let cron_entries = config.cron_danmu_list.clone();
    let my_room_ids = config.my_room_ids.clone();
    let record_enabled = config.record_enabled;

    let (send_tx, send_rx) = mpsc::channel::<String>(1000);
    let (gift_tx, gift_rx) = mpsc::channel::<bilibili_live_protocol::LiveEvent>(1000);
    let send_cookie = bilibili_session_cookie(&session);

    // 读取机器人自身 UID，用于过滤弹幕回声（B站会将机器人发送的弹幕也推送回来）
    let self_uid: i64 = send_cookie
        .as_deref()
        .and_then(|c| extract_cookie_value(c, "DedeUserID"))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // Agent Runtime：注册内置工具（发送弹幕 + 查询统计）
    use crate::bot::agent::{self, AgentRuntime, GetSessionStatsTool, SendDanmuTool};
    let agent_runtime = Arc::new(
        AgentRuntime::new()
            .register(SendDanmuTool {
                tx: send_tx.clone(),
            })
            .register(GetSessionStatsTool {
                storage: storage.clone(),
                session_id: current_session_id.clone(),
            }),
    );

    // TTS 语音播报：SpeakerRouter 按优先级路由（Bot=1, AI=5, System=10）
    let initial_tts_cancel = tts_cancel.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let mic_capture_enabled = Arc::new(AtomicBool::new(true));
    let tts_gate_generation = Arc::new(AtomicU64::new(0));
    // 共享的 VAD pipeline audio_tx，供 TTS gate 在解锁时发送 flush 哨兵清空历史缓冲区
    let shared_pipeline_audio_tx: Arc<Mutex<Option<tokio::sync::mpsc::UnboundedSender<Vec<f32>>>>> =
        Arc::new(Mutex::new(None));
    if let Some(router) = replace_tts_router(&tts_router, &config, &model_dir, initial_tts_cancel) {
        spawn_tts_mic_gate(
            router,
            Arc::clone(&mic_capture_enabled),
            Arc::clone(&tts_gate_generation),
            Arc::clone(&shared_pipeline_audio_tx),
            cancel.clone(),
        );
    }
    let recent_tts_text: Arc<Mutex<Vec<(Instant, String)>>> = Arc::new(Mutex::new(Vec::new()));

    // Sender Task
    let sender_http = http.clone();
    let sender_app = Arc::new(app);
    let sender_cancel = cancel.clone();
    let sender_app_c = sender_app.clone();
    let send_task = tokio::spawn(async move {
        let Some(cookie) = send_cookie else {
            let _ = sender_app_c.emit("monitor-log", json!("未找到 token，自动弹幕发送队列未启动"));
            return;
        };
        tokio::select! {
            _ = sender_cancel.cancelled() => {}
            _ = crate::bot::sender::run_send_queue(
                send_rx,
                sender_danmu_len,
                move |message| {
                    let http = sender_http.clone();
                    let cookie = cookie.clone();
                    async move { http.send_danmu(room_id, &message, &cookie).await }
                },
                move |line| {
                    let _ = sender_app_c.emit("monitor-log", json!(line));
                },
            ) => {}
        }
    });

    // OBS 场景感知：检测场景切换 / 推流状态，播报系统 TTS
    if config.obs_enabled {
        if let Some(obs_router) = current_tts_router(&tts_router) {
            let obs_host = config.obs_host.clone();
            let obs_port = config.obs_port;
            let obs_password = config.obs_password.clone();
            let obs_cancel = cancel.clone();
            let obs_app = sender_app.clone();
            tokio::spawn(async move {
                if let Err(e) = crate::obs::run_obs_client(
                    &obs_host,
                    obs_port,
                    &obs_password,
                    obs_router,
                    obs_cancel,
                )
                .await
                {
                    let _ = obs_app.emit(
                        "monitor-log",
                        serde_json::json!(format!("OBS 连接失败: {e}")),
                    );
                }
            });
        }
    }

    #[cfg(feature = "vad")]
    let mut voice_runtime = start_vad_runtime(
        sender_app.clone(),
        http.clone(),
        config.clone(),
        Arc::clone(&bot_config),
        session_memory.clone(),
        agent_runtime.clone(),
        send_tx.clone(),
        tts_router.clone(),
        Arc::clone(&recent_tts_text),
        Arc::clone(&mic_capture_enabled),
        Arc::clone(&shared_pipeline_audio_tx),
        &model_dir,
        cancel.clone(),
    )
    .await;

    // Gift Aggregator
    let gift_task = tokio::spawn(crate::bot::thanks::run_gift_aggregator(
        gift_rx,
        send_tx.clone(),
        cancel.clone(),
        config.clone(),
        storage.clone(),
    ));

    // Timed Danmu Task
    let timed_cancel = cancel.clone();
    let timed_app = sender_app.clone();
    let timed_tx = send_tx.clone();
    let timed_task = tokio::spawn(async move {
        if !cron_enabled {
            return;
        }
        for entry in cron_entries {
            let Some(expression) = crate::bot::timed::normalize_cron(&entry.cron) else {
                let _ = timed_app.emit(
                    "monitor-log",
                    json!(format!("定时弹幕表达式无效: {}", entry.cron)),
                );
                continue;
            };
            let Ok(schedule) = Schedule::from_str(&expression) else {
                let _ = timed_app.emit(
                    "monitor-log",
                    json!(format!("定时弹幕表达式解析失败: {expression}")),
                );
                continue;
            };
            let tx = timed_tx.clone();
            let app_inner = timed_app.clone();
            let cancel_inner = timed_cancel.clone();
            tokio::spawn(async move {
                let mut upcoming = schedule.upcoming(chrono::Local);
                let mut index = 0;
                loop {
                    let Some(next) = upcoming.next() else {
                        return;
                    };
                    let now = chrono::Local::now();
                    let delay = (next - now)
                        .to_std()
                        .unwrap_or_else(|_| Duration::from_secs(0));
                    tokio::select! {
                        _ = cancel_inner.cancelled() => return,
                        _ = sleep(delay) => {
                            if let Some(message) = crate::bot::timed::select_timed_message(&entry, &mut index) {
                                if tx.send(message).await.is_err() {
                                    let _ = app_inner.emit("monitor-log", json!("定时弹幕发送队列已关闭"));
                                    return;
                                }
                            }
                        }
                    }
                }
            });
        }
        timed_cancel.cancelled().await;
    });

    // Room Status Polling Task
    let poll_http = http.clone();
    let poll_app = sender_app.clone();
    let poll_cancel = cancel.clone();
    let poll_storage = storage.clone();
    let poll_session = current_session_id.clone();
    let poll_task = tokio::spawn(async move {
        // Run DB cleanup on startup
        let _ = poll_storage.cleanup_old_records(30);

        let mut last_status = -1;
        let mut poll_delay = ROOM_STATUS_POLL_INTERVAL;
        let mut consecutive_failures = 0_u32;
        let mut last_failure_log_at: Option<Instant> = None;
        loop {
            tokio::select! {
                _ = poll_cancel.cancelled() => return,
                _ = sleep(poll_delay) => {
                    match poll_http.room_info(room_id).await {
                        Ok(room) => {
                            if consecutive_failures > 0 {
                                let _ = poll_app.emit(
                                    "monitor-log",
                                    json!(format!("监听轮询已恢复（此前连续失败 {consecutive_failures} 次）")),
                                );
                            }
                            consecutive_failures = 0;
                            last_failure_log_at = None;
                            poll_delay = ROOM_STATUS_POLL_INTERVAL;

                            // Always emit current room status for real-time UI updates
                            let _ = poll_app.emit("room-status", json!({
                                "live_status": room.live_status,
                                "online": room.online,
                                "live_time": &room.live_time,
                            }));

                            if room.live_status != last_status {
                                last_status = room.live_status;
                                let status = if room.live_status == 1 { "直播中" } else { "未开播" };
                                let session_change = {
                                    let mut session = poll_session.lock().expect("session mutex poisoned");
                                    crate::bot::update_observed_session_for_room_status(
                                        &poll_storage,
                                        &mut session,
                                        room_id,
                                        room.live_status,
                                        chrono::Local::now(),
                                    )
                                };
                                let _ = poll_app.emit("monitor-log", json!(format!("直播状态变更: {status}")));
                                if let Ok(change) = session_change {
                                    match change {
                                        bot::SessionStatusChange::Started(id) => { let _ = poll_app.emit("monitor-log", json!(format!("直播场次已开始: {id}"))); }
                                        bot::SessionStatusChange::Ended(id) => { let _ = poll_app.emit("monitor-log", json!(format!("直播场次已结束: {id}"))); }
                                        bot::SessionStatusChange::Unchanged => {}
                                    }
                                }
                            }
                        }
                        Err(err) => {
                            consecutive_failures = consecutive_failures.saturating_add(1);
                            poll_delay = room_status_poll_backoff(consecutive_failures);
                            if should_log_room_status_poll_error(consecutive_failures, last_failure_log_at) {
                                last_failure_log_at = Some(Instant::now());
                                let _ = poll_app.emit(
                                    "monitor-log",
                                    json!(format!(
                                        "监听轮询失败（连续 {consecutive_failures} 次，{:.0}s 后重试）: {err}",
                                        poll_delay.as_secs_f32(),
                                    )),
                                );
                            }
                        }
                    }
                }
            }
        }
    });

    // Stats Update Task (Throttled)
    let stats_app = sender_app.clone();
    let stats_cancel = cancel.clone();
    let stats_storage = storage.clone();
    let stats_session = current_session_id.clone();
    let stats_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = stats_cancel.cancelled() => return,
                _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {
                    let session_id = stats_session.lock().unwrap_or_else(|e| e.into_inner()).clone();
                    if let Some(id) = session_id {
                        if let Ok(summary) = stats_storage.live_session_summary(&id) {
                            let _ = stats_app.emit("session-summary", serde_json::json!(summary));
                        }
                    }
                }
            }
        }
    });

    // WebSocket Client Task
    let ws_http = http.clone();
    let ws_app = sender_app.clone();
    let ws_cancel = cancel.clone();
    let ws_session = current_session_id.clone();
    let ws_danmaku = danmaku_buffer.clone();
    let ws_session_memory = session_memory.clone();
    let ws_agent_runtime = agent_runtime.clone();
    let ws_send_tx = send_tx.clone();
    let ws_tts_router = tts_router.clone();
    let ws_task = tokio::spawn(async move {
        let original_cookie = bilibili_session_cookie(&session).unwrap_or_default();
        let music_service = Arc::new(MusicInteractionService::new_with_storage(
            vec![Box::new(NeteaseProvider::new(reqwest::Client::new()))],
            storage.clone(),
            room_id,
            current_session_id.clone(),
        ));
        let music_task_limit = Arc::new(Semaphore::new(8));

        loop {
            let bot_config = bot_config.clone();
            let session_memory = ws_session_memory.clone();
            let my_room_ids = my_room_ids.clone();
            let music_service = music_service.clone();
            let music_task_limit = music_task_limit.clone();
            let music_cancel = ws_cancel.child_token();
            let result = async {
                let room = ws_http.room_init(room_id).await?;
                let session_id = {
                    let mut session = ws_session.lock().expect("session mutex poisoned");
                    if session.is_none() {
                        let id =
                            storage.start_observed_live_session(room_id, chrono::Local::now())?;
                        *session = Some(id);
                    }
                    session.clone().expect("session just initialized")
                };

                let mut current_cookie = original_cookie.clone();
                let uid = extract_cookie_value(&current_cookie, "DedeUserID")
                    .and_then(|v| v.parse::<i64>().ok())
                    .unwrap_or(0);

                let buvid = match extract_cookie_value(&current_cookie, "buvid3") {
                    Some(v) if !v.is_empty() => v,
                    _ => {
                        let _ = ws_app.emit("monitor-log", json!("正在获取 buvid..."));
                        let fetched = ws_http.fetch_buvid().await.unwrap_or_default();
                        if !fetched.is_empty() {
                            if current_cookie.is_empty() {
                                current_cookie = format!("buvid3={}", fetched);
                            } else {
                                current_cookie = format!("{}; buvid3={}", current_cookie, fetched);
                            }
                        }
                        fetched
                    }
                };

                let danmu = ws_http.danmu_info(room.room_id, &current_cookie).await?;

                let _ = ws_app.emit("monitor-log", json!(format!(
                    "WebSocket 认证: uid={uid}, buvid={}, token长度={}",
                    if buvid.is_empty() { "(空)" } else { &buvid[..buvid.len().min(8)] },
                    danmu.token.len()
                )));
                let connect_config = bilibili_live_protocol::ConnectConfig {
                    room_id: room.room_id,
                    uid,
                    buvid,
                    token: danmu.token,
                    hosts: danmu.hosts, // Vec<bilibili_live_protocol::DanmuHost>
                };
                let url = connect_config.first_ws_url();
                let _ = ws_app.emit("monitor-log", json!(format!("连接弹幕流: {url}")));

                // 发送进入房间提示语
                if !bot_config.entry_msg.is_empty() {
                    let _ = ws_send_tx.send(bot_config.entry_msg.clone()).await;
                    let _ = ws_app.emit("monitor-log", json!(format!("已发送登场语: {}", bot_config.entry_msg)));
                }

                let event_app = ws_app.clone();
                let event_tx = ws_send_tx.clone();
                let event_gift_tx = gift_tx.clone();
                let event_engine = engine.clone();
                let event_storage = storage.clone();
                let ai_http = ws_http.clone();
                let session_id_inner = session_id.clone();
                let event_tts_router = ws_tts_router.clone();
                let event_agent = ws_agent_runtime.clone();
                let event_music_service = music_service.clone();
                let event_music_task_limit = music_task_limit.clone();
                let event_music_cancel = music_cancel.clone();

                let danmaku_buf_cb = ws_danmaku.clone();

                // Batched Event Emitter
                let (batch_tx, mut batch_rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
                let batch_app = event_app.clone();
                let batch_cancel = ws_cancel.clone();
                tokio::spawn(async move {
                    let mut buffer = Vec::new();
                    let mut interval = tokio::time::interval(std::time::Duration::from_millis(200));
                    loop {
                        tokio::select! {
                            _ = batch_cancel.cancelled() => break,
                            msg = batch_rx.recv() => {
                                if let Some(v) = msg {
                                    buffer.push(v);
                                    if buffer.len() >= 50 {
                                        let _ = batch_app.emit("live-events", serde_json::json!(buffer));
                                        buffer.clear();
                                    }
                                } else { break; }
                            }
                            _ = interval.tick() => {
                                if !buffer.is_empty() {
                                    let _ = batch_app.emit("live-events", serde_json::json!(buffer));
                                    buffer.clear();
                                }
                            }
                        }
                    }
                });

                bilibili_live_protocol::run_parsed_client(connect_config, move |parsed| {
                    let event = &parsed.event;
                    let line = event.to_string();

                    let mut is_echo = false;
                    // 检测机器人自身发出的弹幕回声
                    if self_uid != 0 {
                        if let bilibili_live_protocol::LiveEvent::Danmu { user_id, .. } = event {
                            if *user_id == self_uid {
                                is_echo = true;
                            }
                        }
                    }

                    // 2. 无论是否是回声，都推送到前端显示（确保用户看到自己发的弹幕）
                    let _ = event_app.emit("live-event", json!(parsed));
                    let _ = batch_tx.send(json!(parsed));

                    // 3. 存入轮询缓冲区（兜底显示）
                    if let Ok(mut buf) = danmaku_buf_cb.lock() {
                        buf.push(line);
                        if buf.len() > 500 { buf.remove(0); }
                    }

                    // 4. 如果是回声，不进行后续处理（如 AI 回复或统计）
                    if is_echo {
                        return;
                    }

                    if matches!(event, bilibili_live_protocol::LiveEvent::Gift { .. }) {
                        let _ = event_gift_tx.try_send(event.clone());
                    }
                    if matches!(
                        event,
                        bilibili_live_protocol::LiveEvent::Danmu { .. }
                            | bilibili_live_protocol::LiveEvent::Gift { .. }
                            | bilibili_live_protocol::LiveEvent::SuperChat { .. }
                    ) && music_interaction_enabled()
                    {
                        let music_service = event_music_service.clone();
                        let tx = event_tx.clone();
                        let app = event_app.clone();
                        let event = event.clone();
                        let cancel = event_music_cancel.clone();

                        if matches!(event, bilibili_live_protocol::LiveEvent::Danmu { .. }) {
                            match event_music_task_limit.clone().try_acquire_owned() {
                                Ok(permit) => {
                                    spawn_music_event_handler(
                                        music_service,
                                        event,
                                        tx,
                                        app,
                                        cancel,
                                        true,
                                        permit,
                                    );
                                }
                                Err(_) => {
                                    let _ = event_app.emit(
                                        "monitor-log",
                                        json!("点歌处理繁忙，已跳过本次事件"),
                                    );
                                }
                            }
                        } else {
                            let task_limit = event_music_task_limit.clone();
                            tokio::spawn(async move {
                                tokio::select! {
                                    _ = cancel.cancelled() => {}
                                    permit = task_limit.acquire_owned() => {
                                        match permit {
                                            Ok(permit) => {
                                                spawn_music_event_handler(
                                                    music_service,
                                                    event,
                                                    tx,
                                                    app,
                                                    cancel,
                                                    false,
                                                    permit,
                                                );
                                            }
                                            Err(err) => {
                                                let _ = app.emit(
                                                    "monitor-log",
                                                    json!(format!("点歌处理并发限制器已关闭: {err}")),
                                                );
                                            }
                                        }
                                    }
                                }
                            });
                        }
                    }
                    if let bilibili_live_protocol::LiveEvent::Popularity { value } = event {
                        let _ = event_app.emit("room-online", json!({ "count": value }));
                    }
                    let should_record = record_enabled
                        && (my_room_ids.is_empty() || my_room_ids.contains(&room_id));
                    let replies = match bot::record_and_handle_event(
                        &event_storage,
                        &session_id_inner,
                        room_id,
                        &parsed,
                        &event_engine,
                        should_record,
                    ) {
                        Ok(replies) => replies,
                        Err(err) => {
                            let _ = event_app
                                .emit("monitor-log", json!(format!("事件记录失败: {err}")));
                            event_engine.handle_event(event, Some(&event_storage))
                        }
                    };

                    // Stats Update removed from here (moved to background task)

                    for message in replies {

                        if let Some(r) = current_tts_router(&event_tts_router) {
                            let m = message.clone();
                            tokio::spawn(async move { let _ = r.speak_bot(m).await; });
                        }
                        let _ = event_tx.try_send(message);
                    }
                    if let bilibili_live_protocol::LiveEvent::Danmu { text, user_id, user: danmu_uname, .. } = event {
                        let danmu_uid = *user_id;
                        let danmu_uname = danmu_uname.clone();

                        if bot_config.ai_reply_to_danmaku {
                            if let Some(res) = agent::resolve_bot_danmu(&bot_config, text) {
                                let ai_http = ai_http.clone();
                                let ai_config = Arc::clone(&bot_config);
                                let ai_tx = event_tx.clone();
                                let ai_router = event_tts_router.clone();
                                let bot_id = res.bot.id.clone();
                                let nickname = res.bot.nickname.clone();
                                let ai_memory = session_memory.clone();
                                let ai_uname = danmu_uname.clone();
                                let ai_agent = event_agent.clone();
                                let prompt = res.prompt;

                                tokio::spawn(async move {
                                    let reply = agent::call_ai(&ai_http, &ai_config, &bot_id, &prompt, danmu_uid, &ai_uname, &ai_memory, &ai_agent).await;
                                    if !reply.is_empty() {
                                        if let Some(r) = current_tts_router(&ai_router) {
                                            let _ = r.speak_ai(reply.clone()).await;
                                        }
                                        let _ = ai_tx.send(format!("[{}]{}", nickname, reply)).await;
                                    }
                                });
                            }
                        }
                    }
                })
                .await
            }
            .await;
            music_cancel.cancel();
            if let Err(err) = result {
                let _ = ws_app.emit("monitor-log", json!(format!("弹幕流连接结束: {err}")));
            }

            tokio::select! {
                _ = ws_cancel.cancelled() => return,
                _ = sleep(Duration::from_secs(5)) => {}
            }
        }
    });
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            command = command_rx.recv() => {
                match command {
                    Some(MonitorCommand::UpdateConfig(_)) => {
                        // Config is Arc<AppConfig> (immutable); TTS/voice reloads
                        // are handled by ReloadTts / ReloadVoice commands.
                    }
                    Some(MonitorCommand::ReloadTts) => {
                        match AppConfig::load_or_default() {
                            Ok(next_config) => {
                                if let Some(router) = current_tts_router(&tts_router) {
                                    let _ = router.voice_session().interrupt().await;
                                }
                                let next_cancel = cancel.child_token();
                                let old_cancel = {
                                    let mut guard =
                                        tts_cancel.lock().unwrap_or_else(|e| e.into_inner());
                                    let old = guard.clone();
                                    *guard = next_cancel.clone();
                                    old
                                };
                                old_cancel.cancel();
                                if let Some(router) = replace_tts_router(
                                    &tts_router,
                                    &next_config,
                                    &model_dir,
                                    next_cancel.clone(),
                                ) {
                                    spawn_tts_mic_gate(
                                        router,
                                        Arc::clone(&mic_capture_enabled),
                                        Arc::clone(&tts_gate_generation),
                                        Arc::clone(&shared_pipeline_audio_tx),
                                        next_cancel,
                                    );
                                } else {
                                    mic_capture_enabled.store(true, Ordering::Relaxed);
                                }
                                let _ = sender_app.emit(
                                    "monitor-log",
                                    json!(if next_config.tts_enabled {
                                        "语音播报已刷新，弹幕监听保持连接"
                                    } else {
                                        "语音播报已关闭，弹幕监听保持连接"
                                    }),
                                );
                            }
                            Err(err) => {
                                let _ = sender_app.emit("monitor-log", json!(format!("语音播报配置重载失败: {err}")));
                            }
                        }
                    }
                    Some(MonitorCommand::ReloadVoice) => {
                        #[cfg(feature = "vad")]
                        {
                            if let Some(runtime) = voice_runtime.take() {
                                runtime.cancel.cancel();
                            }
                            match AppConfig::load_or_default() {
                                Ok(next_config) => {
                                    voice_runtime = start_vad_runtime(
                                        sender_app.clone(),
                                        http.clone(),
                                        next_config.clone(),
                                        Arc::new(next_config),
                                        session_memory.clone(),
                                        agent_runtime.clone(),
                                        send_tx.clone(),
                                        tts_router.clone(),
                                        Arc::clone(&recent_tts_text),
                                        Arc::clone(&mic_capture_enabled),
                                        Arc::clone(&shared_pipeline_audio_tx),
                                        &model_dir,
                                        cancel.clone(),
                                    )
                                    .await;
                                }
                                Err(err) => {
                                    let _ = sender_app.emit("monitor-log", json!(format!("语音陪伴配置重载失败: {err}")));
                                }
                            }
                        }
                    }
                    None => break,
                }
            }
        }
    }
    #[cfg(feature = "vad")]
    if let Some(runtime) = voice_runtime.take() {
        runtime.cancel.cancel();
    }
    send_task.abort();
    gift_task.abort();
    timed_task.abort();
    poll_task.abort();
    stats_task.abort();
    ws_task.abort();

    let _ = sender_app.emit("monitor-status", json!("已停止"));
    let _ = sender_app.emit("monitor-log", json!("监听已停止"));
    Ok(())
}

#[cfg(feature = "vad")]
struct VoiceRuntime {
    cancel: CancellationToken,
    _mic_capture: Option<streamix_voice::SherpaMicCapture>,
    _pipeline_audio_tx: Option<tokio::sync::mpsc::UnboundedSender<Vec<f32>>>,
}

#[cfg(feature = "vad")]
#[allow(clippy::too_many_arguments)]
async fn start_vad_runtime<E: EventEmitter + Send + Sync + 'static>(
    app: Arc<E>,
    http: LegacyBiliApi,
    config: AppConfig,
    bot_config: Arc<AppConfig>,
    session_memory: Arc<Mutex<crate::bot::memory::SessionMemory>>,
    agent_runtime: Arc<agent::AgentRuntime>,
    send_tx: mpsc::Sender<String>,
    tts_router: SharedTtsRouter,
    recent_tts_text: Arc<Mutex<Vec<(Instant, String)>>>,
    mic_capture_enabled: Arc<AtomicBool>,
    shared_pipeline_audio_tx: Arc<Mutex<Option<tokio::sync::mpsc::UnboundedSender<Vec<f32>>>>>,
    model_dir: &std::path::Path,
    monitor_cancel: CancellationToken,
) -> Option<VoiceRuntime> {
    if !config.vad_enabled {
        let _ = app.emit("monitor-log", serde_json::json!("语音陪伴麦克风已关闭"));
        return None;
    }

    let cancel = monitor_cancel.child_token();
    let vad_model = model_dir.join("silero_vad.onnx");
    let vad_exists = vad_model.exists();
    let vad_size = std::fs::metadata(&vad_model).map(|m| m.len()).unwrap_or(0);
    let _ = app.emit(
        "monitor-log",
        serde_json::json!(format!(
            "[诊断] VAD 启动检查 | 路径: {} | 存在: {} | 大小: {} bytes",
            vad_model.display(),
            vad_exists,
            vad_size
        )),
    );

    let (asr_url, asr_model_dir, asr_startup_notice) =
        resolve_vad_asr_source(&config, model_dir).await;
    let pipeline = match streamix_voice::SherpaPipeline::spawn(
        vad_model,
        asr_model_dir,
        &config.asr_language,
        config.vad_threshold,
        config.vad_min_speech_duration.clamp(0.04, 0.5),
        config.vad_min_silence_duration.clamp(0.2, 1.5),
        cancel.clone(),
    ) {
        Ok(pipeline) => pipeline,
        Err(e) => {
            let _ = app.emit(
                "monitor-log",
                serde_json::json!(format!("VAD 初始化失败: {e}")),
            );
            return Some(VoiceRuntime {
                cancel,
                _mic_capture: None,
                _pipeline_audio_tx: None,
            });
        }
    };

    let has_asr = pipeline.has_asr;
    let _ = app.emit(
        "monitor-log",
        serde_json::json!(if has_asr {
            "语音检测（VAD）已就绪，SenseVoice ASR 已加载，正在启动麦克风..."
        } else {
            "语音检测（VAD）已就绪，正在启动麦克风..."
        }),
    );
    if let Some(warn) = &pipeline.asr_warning {
        let _ = app.emit("monitor-log", serde_json::json!(warn));
    }
    if let Some(notice) = asr_startup_notice {
        let _ = app.emit("monitor-log", serde_json::json!(notice));
    }

    let events = pipeline.subscribe();
    let audio_tap = if !asr_url.is_empty() {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Vec<f32>>();
        let events2 = pipeline.subscribe();
        let asr_cancel = cancel.clone();
        let asr_app = app.clone();
        let asr_config = Arc::clone(&bot_config);
        let asr_memory = session_memory.clone();
        let asr_agent = agent_runtime.clone();
        let asr_http = http.clone();
        let asr_tx = send_tx.clone();
        let asr_url_c = asr_url.clone();
        let asr_recent_tts = Arc::clone(&recent_tts_text);
        let asr_tts_router = tts_router.clone();
        tokio::spawn(async move {
            #[cfg(feature = "asr")]
            run_asr_loop(
                rx,
                events2,
                asr_url_c,
                asr_tts_router,
                asr_http,
                asr_config,
                asr_memory,
                asr_agent,
                asr_tx,
                asr_app,
                asr_cancel,
                asr_recent_tts,
            )
            .await;
        });
        Some(tx)
    } else {
        let ev = events;
        let ap = app.clone();
        let c = cancel.clone();
        let bc = Arc::clone(&bot_config);
        let sm = session_memory.clone();
        let ar = agent_runtime.clone();
        let st = send_tx.clone();
        let tr = tts_router.clone();
        let rtts = Arc::clone(&recent_tts_text);
        tokio::spawn(async move {
            run_sherpa_asr_event_loop(
                ev,
                has_asr,
                tr,
                http,
                bc,
                sm,
                ar,
                st,
                ap,
                c,
                rtts,
            )
            .await;
        });
        None
    };

    let (mic_status_tx, mic_status_rx) = std::sync::mpsc::channel::<String>();
    let mic_status_app = app.clone();
    let mic_status_cancel = cancel.clone();
    std::thread::Builder::new()
        .name("sherpa-mic-status".into())
        .spawn(move || {
            while !mic_status_cancel.is_cancelled() {
                match mic_status_rx.recv_timeout(std::time::Duration::from_millis(200)) {
                    Ok(line) => {
                        let _ = mic_status_app.emit("monitor-log", serde_json::json!(line));
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        })
        .ok();

    // 向共享状态注册 pipeline audio_tx，将指针传递给 TTS gate 的解锁任务
    if let Ok(mut guard) = shared_pipeline_audio_tx.lock() {
        *guard = Some(pipeline.audio_tx.clone());
    }

    let mic_capture = match streamix_voice::SherpaMicCapture::start(
        &pipeline,
        audio_tap,
        Some(mic_status_tx),
        config.voice_mic_gain,
        Some(Arc::clone(&mic_capture_enabled)),
    ) {
        Ok(mic) => {
            let _ = app.emit(
                "monitor-log",
                serde_json::json!("麦克风已就绪，语音陪伴开始监听"),
            );
            let _ = app.emit(
                "monitor-log",
                serde_json::json!(
                    "若3秒内未见「检测到你正在说话」，请检查：系统设置 > 隐私与安全 > 麦克风"
                ),
            );
            Some(mic)
        }
        Err(e) => {
            let _ = app.emit(
                "monitor-log",
                serde_json::json!(format!("麦克风启动失败: {e}")),
            );
            None
        }
    };

    Some(VoiceRuntime {
        cancel,
        _mic_capture: mic_capture,
        _pipeline_audio_tx: Some(pipeline.audio_tx),
    })
}

/// 监听 VadPipeline 话轮事件，记录日志（无 ASR 时使用）
/// VAD + ASR 完整循环：
///   SpeechStart → 开始积累 PCM
///   TurnEnd → 发送积累音频到 WhisperLive → 识别结果注入 AI
#[cfg(all(feature = "playback", feature = "vad", feature = "asr"))]
#[allow(clippy::too_many_arguments)]
async fn run_asr_loop<E: crate::bot::EventEmitter + Send + Sync + 'static>(
    mut audio_rx: tokio::sync::mpsc::UnboundedReceiver<Vec<f32>>,
    mut events: tokio::sync::broadcast::Receiver<streamix_voice::TurnEvent>,
    asr_url: String,
    tts_router: SharedTtsRouter,
    http: LegacyBiliApi,
    config: Arc<crate::config::AppConfig>,
    memory: Arc<std::sync::Mutex<crate::bot::memory::SessionMemory>>,
    _agent: Arc<crate::bot::agent::AgentRuntime>,
    danmu_tx: tokio::sync::mpsc::Sender<String>,
    app: Arc<E>,
    cancel: tokio_util::sync::CancellationToken,
    recent_tts_text: Arc<Mutex<Vec<(Instant, String)>>>,
) {
    use streamix_voice::asr::{BackendConfig, WhisperLiveAsrBackend};

    let backend_cfg = BackendConfig {
        url: asr_url,
        supports_hotwords: false,
    };
    let mut asr = WhisperLiveAsrBackend::new_with_config(backend_cfg, "zh".to_string(), None, None);

    let mut speech_buf: Vec<f32> = Vec::new();
    let mut recording = false;
    let mut turn_started_at: Option<Instant> = None;
    let mut speculative_ai: Option<SpeculativeVoiceAi> = None;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,

            ev = events.recv() => match ev {
                Ok(streamix_voice::TurnEvent::SpeechStart) => {
                    recording = true;
                    speech_buf.clear();
                    abort_speculative_voice_ai(speculative_ai.take());
                    asr.reset_streaming();
                    turn_started_at = Some(Instant::now());
                    let _ = app.emit("monitor-log", serde_json::json!("[VAD] 开始录音"));
                }
                Ok(streamix_voice::TurnEvent::TurnEnd { samples }) => {
                    recording = false;
                    let audio = if !samples.is_empty() { samples } else { std::mem::take(&mut speech_buf) };
                    if audio.len() < 1600 {
                        abort_speculative_voice_ai(speculative_ai.take());
                        speech_buf.clear();
                        continue;
                    }
                    let _ = app.emit("monitor-log", serde_json::json!(format!("[VAD] 话轮结束，送 ASR（{}ms）", audio.len() / 16)));

                    // Sherpa VAD emits TurnEnd with the complete utterance. Treat that as
                    // the source of truth; relying on SpeechStart-time recording loses the
                    // leading audio because SpeechStart is emitted when the segment is ready.
                    match asr.streaming_recognition(&audio, true, true).await {
                        Ok(Some(voice_text)) => {
                            let asr_done_at = Instant::now();
                            let turn_started = turn_started_at.take().unwrap_or(asr_done_at);
                            let asr_ms = asr_done_at.duration_since(turn_started).as_millis() as u64;
                            let text = voice_text.content.trim().to_string();
                            if text.is_empty() {
                                abort_speculative_voice_ai(speculative_ai.take());
                                continue;
                            }
                            if !is_meaningful_voice_text(&text) {
                                abort_speculative_voice_ai(speculative_ai.take());
                                continue;
                            }
                            if is_recent_tts_echo(&text, &recent_tts_text) {
                                abort_speculative_voice_ai(speculative_ai.take());
                                let _ = app.emit("monitor-log", serde_json::json!(format!("[ASR] 忽略电脑回声: {}", text)));
                                continue;
                            }
                            let _ = app.emit("monitor-log", serde_json::json!(format!("[ASR] 识别结果: {}", text)));

                            if let Some(bot) = config.ai_bots.iter().find(|b| b.enabled) {
                                let bot_id   = bot.id.clone();
                                let bot_nick = bot.nickname.clone();
                                let h = http.clone();
                                let c = Arc::clone(&config);
                                let m = memory.clone();
                                let tx = danmu_tx.clone();
                                let ap = app.clone();
                                let maybe_router = current_tts_router(&tts_router);
                                let recent_tts = Arc::clone(&recent_tts_text);
                                let first_chunk_ms = Arc::new(AtomicU64::new(0));
                                let first_chunk_ms_for_tts = Arc::clone(&first_chunk_ms);
                                let draft = speculative_ai.take();
                                let cancel_for_ai = cancel.clone();
                                let cancel_for_tts = cancel.clone();
                                tokio::spawn(async move {
                                    let ai_started_at = Instant::now();
                                    let (tts_tx, mut tts_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
                                    if let Some(router) = maybe_router {
                                        let recent = Arc::clone(&recent_tts);
                                        let cancel_for_tts = cancel_for_tts.clone();
                                        tokio::spawn(async move {
                                            speak_ai_chunks(
                                                router,
                                                &mut tts_rx,
                                                recent,
                                                Some(turn_started),
                                                Some(first_chunk_ms_for_tts),
                                                cancel_for_tts,
                                            )
                                            .await;
                                        });
                                    } else {
                                        drop(tts_rx);
                                    }
                                    let reply = tokio::select! {
                                        _ = cancel_for_ai.cancelled() => return,
                                        reply = async {
                                            if let Some(reply) =
                                                resolve_speculative_voice_reply(draft, &text, &ap).await
                                            {
                                                agent::remember_ai_voice_reply(&bot_id, &text, &reply, &m);
                                                let _ = tts_tx.send(reply.clone());
                                                reply
                                            } else {
                                                agent::call_ai_voice_streaming(&h, &c, &bot_id, &text, &m, tts_tx).await
                                            }
                                        } => reply,
                                    };
                                    if cancel_for_ai.is_cancelled() {
                                        return;
                                    }
                                    let ai_total_ms = ai_started_at.elapsed().as_millis() as u64;
                                    let total_ms = turn_started.elapsed().as_millis() as u64;
                                    emit_voice_latency(
                                        &ap,
                                        asr_ms,
                                        first_chunk_ms.load(Ordering::Relaxed),
                                        ai_total_ms,
                                        total_ms,
                                    );
                                    if reply.trim().is_empty() {
                                        let _ = ap.emit("monitor-log", serde_json::json!("[ASR→AI] LLM 未返回内容"));
                                    } else {
                                        let _ = ap.emit("monitor-log", serde_json::json!(format!("[ASR→AI] {}", reply)));
                                        // 同时发弹幕
                                        let _ = tx.send(format!("[{}]{}", bot_nick, reply)).await;
                                    }
                                });
                            } else {
                                abort_speculative_voice_ai(speculative_ai.take());
                                let _ = app.emit("monitor-log", serde_json::json!("[ASR→AI] 未配置启用的 AI 机器人"));
                            }
                        }
                        Ok(None) => {
                            abort_speculative_voice_ai(speculative_ai.take());
                        }
                        Err(e) => {
                            abort_speculative_voice_ai(speculative_ai.take());
                            let _ = app.emit("monitor-log", serde_json::json!(format!("[ASR] 识别失败: {e}")));
                        }
                    }
                }
                Ok(streamix_voice::TurnEvent::SpeechEnd { .. }) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            },

            chunk = audio_rx.recv() => {
                if recording {
                    if let Some(c) = chunk {
                        speech_buf.extend_from_slice(&c);
                        match asr.streaming_recognition(&c, false, false).await {
                            Ok(Some(partial)) => {
                                let partial_text = partial.content.trim();
                                if is_meaningful_voice_text(partial_text) {
                                    let _ = app.emit("monitor-log", serde_json::json!(format!("[ASR] 实时识别: {}", partial_text)));
                                    if should_start_speculative_voice_ai(partial_text)
                                        && !is_recent_tts_echo(partial_text, &recent_tts_text)
                                        && should_replace_speculative_voice_ai(
                                            speculative_ai.as_ref(),
                                            partial_text,
                                        )
                                    {
                                        abort_speculative_voice_ai(speculative_ai.take());
                                        if let Some(bot) = config.ai_bots.iter().find(|b| b.enabled) {
                                            speculative_ai = Some(spawn_speculative_voice_ai(
                                                http.clone(),
                                                Arc::clone(&config),
                                                memory.clone(),
                                                bot.id.clone(),
                                                partial_text.to_string(),
                                            ));
                                            let _ = app.emit(
                                                "monitor-log",
                                                serde_json::json!(format!("[ASR] partial 已预启动 LLM: {}", partial_text)),
                                            );
                                        }
                                    }
                                }
                            }
                            Ok(None) => {}
                            Err(e) => {
                                let _ = app.emit("monitor-log", serde_json::json!(format!("[ASR] 实时识别失败: {e}")));
                            }
                        }
                    } else {
                        break;
                    }
                }
            }
        }
    }
}

struct SpeculativeVoiceAi {
    prompt: String,
    result_rx: tokio::sync::oneshot::Receiver<String>,
    handle: tokio::task::JoinHandle<()>,
}

fn spawn_speculative_voice_ai(
    http: LegacyBiliApi,
    config: Arc<crate::config::AppConfig>,
    memory: Arc<std::sync::Mutex<crate::bot::memory::SessionMemory>>,
    bot_id: String,
    prompt: String,
) -> SpeculativeVoiceAi {
    let (result_tx, result_rx) = tokio::sync::oneshot::channel();
    let prompt_for_task = prompt.clone();
    let handle = tokio::spawn(async move {
        let reply =
            agent::call_ai_voice_draft(&http, &config, &bot_id, &prompt_for_task, &memory).await;
        let _ = result_tx.send(reply);
    });
    SpeculativeVoiceAi {
        prompt,
        result_rx,
        handle,
    }
}

fn abort_speculative_voice_ai(draft: Option<SpeculativeVoiceAi>) {
    if let Some(draft) = draft {
        draft.handle.abort();
    }
}

async fn resolve_speculative_voice_reply<E: crate::bot::EventEmitter + Send + Sync + 'static>(
    draft: Option<SpeculativeVoiceAi>,
    final_text: &str,
    app: &Arc<E>,
) -> Option<String> {
    let Some(mut draft) = draft else {
        return None;
    };
    if !is_speculative_voice_prompt_compatible(&draft.prompt, final_text) {
        draft.handle.abort();
        let _ = app.emit(
            "monitor-log",
            serde_json::json!(format!(
                "[ASR] partial 与最终文本不一致，已取消预启动 LLM: {} -> {}",
                draft.prompt, final_text
            )),
        );
        return None;
    }

    match timeout(Duration::from_millis(180), &mut draft.result_rx).await {
        Ok(Ok(reply)) if !reply.trim().is_empty() => {
            let _ = app.emit(
                "monitor-log",
                serde_json::json!("[ASR] 命中 partial 预启动 LLM 结果"),
            );
            Some(reply)
        }
        Ok(_) => None,
        Err(_) => {
            draft.handle.abort();
            None
        }
    }
}

fn should_start_speculative_voice_ai(partial: &str) -> bool {
    let normalized_len = normalize_echo_text(partial).chars().count();
    if normalized_len < 8 {
        return false;
    }
    normalized_len >= 12 || partial.chars().last().is_some_and(is_voice_boundary)
}

fn should_replace_speculative_voice_ai(
    current: Option<&SpeculativeVoiceAi>,
    partial: &str,
) -> bool {
    let Some(current) = current else {
        return true;
    };
    if !is_speculative_voice_prompt_compatible(&current.prompt, partial) {
        return true;
    }
    let current_len = normalize_echo_text(&current.prompt).chars().count();
    let partial_len = normalize_echo_text(partial).chars().count();
    partial_len >= current_len + 12 && !current.prompt.chars().last().is_some_and(is_voice_boundary)
}

fn is_speculative_voice_prompt_compatible(partial: &str, final_text: &str) -> bool {
    let partial = normalize_echo_text(partial);
    let final_text = normalize_echo_text(final_text);
    if partial.chars().count() < 8 || final_text.chars().count() < 8 {
        return false;
    }
    final_text.starts_with(&partial)
        || partial.starts_with(&final_text)
        || echo_text_similarity(&partial, &final_text) >= 0.88
}

fn is_voice_boundary(ch: char) -> bool {
    matches!(
        ch,
        '。' | '！'
            | '？'
            | '…'
            | '.'
            | '!'
            | '?'
            | '\n'
            | '，'
            | '、'
            | '；'
            | ';'
            | ','
            | ':'
            | '：'
    )
}

fn extract_cookie_value(cookie: &str, name: &str) -> Option<String> {
    cookie.split(';').find_map(|s| {
        let s = s.trim();
        let prefix = format!("{}=", name);
        s.starts_with(&prefix)
            .then(|| s[prefix.len()..].to_string())
    })
}

/// AI 调用入口：通过 bot_id 隔离记忆，通过 bot.provider_id 找模型
///
/// sherpa-onnx 本地 ASR 事件循环
///
/// SherpaPipeline 内部已完成 VAD + ASR；此函数只需监听 SpeechEnd 事件，
/// 取出 text 后调用 AI 回复。
#[cfg(feature = "vad")]
#[allow(clippy::too_many_arguments)]
async fn run_sherpa_asr_event_loop<E: crate::bot::EventEmitter + Send + Sync + 'static>(
    mut events: tokio::sync::broadcast::Receiver<streamix_voice::TurnEvent>,
    has_asr: bool,
    tts_router: SharedTtsRouter,
    http: LegacyBiliApi,
    config: Arc<crate::config::AppConfig>,
    memory: Arc<std::sync::Mutex<crate::bot::memory::SessionMemory>>,
    _agent: Arc<crate::bot::agent::AgentRuntime>,
    danmu_tx: tokio::sync::mpsc::Sender<String>,
    app: Arc<E>,
    cancel: tokio_util::sync::CancellationToken,
    recent_tts_text: Arc<Mutex<Vec<(Instant, String)>>>,
) {
    let mut turn_started_at: Option<Instant> = None;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            ev = events.recv() => match ev {
                Ok(streamix_voice::TurnEvent::SpeechStart) => {
                    turn_started_at = Some(Instant::now());
                    let msg = if has_asr {
                        "[VAD] 检测到语音段，正在识别..."
                    } else {
                        "[VAD] 检测到语音段（ASR 模型未就绪，无法识别）"
                    };
                    let _ = app.emit("monitor-log", serde_json::json!(msg));
                }
                Ok(streamix_voice::TurnEvent::TurnEnd { .. }) => {}
                Ok(streamix_voice::TurnEvent::SpeechEnd { text: Some(text), .. }) => {
                    let asr_done_at = Instant::now();
                    let turn_started = turn_started_at.take().unwrap_or(asr_done_at);
                    let asr_ms = asr_done_at.duration_since(turn_started).as_millis() as u64;
                    let text = text.trim().to_string();
                    if text.is_empty() { continue; }
                    if !is_meaningful_voice_text(&text) { continue; }
                    if is_recent_tts_echo(&text, &recent_tts_text) {
                        let _ = app.emit("monitor-log", serde_json::json!(format!("[ASR] 忽略电脑回声: {}", text)));
                        continue;
                    }
                    let _ = app.emit("monitor-log", serde_json::json!(format!("[ASR] 识别结果: {}", text)));
                    if let Some(bot) = config.ai_bots.iter().find(|b| b.enabled) {
                        let bot_id = bot.id.clone();
                        let bot_nick = bot.nickname.clone();
                        let h = http.clone();
                        let c = Arc::clone(&config);
                        let m = memory.clone();
                        let tx = danmu_tx.clone();
                        let ap = app.clone();
                        let recent_tts = Arc::clone(&recent_tts_text);
                        let first_chunk_ms = Arc::new(AtomicU64::new(0));
                        let first_chunk_ms_for_tts = Arc::clone(&first_chunk_ms);
                        let cancel_for_ai = cancel.clone();
                        let cancel_for_tts = cancel.clone();
                        // Snapshot the router now; it may be None if TTS is disabled.
                        // LLM is called unconditionally; TTS playback only happens when router exists.
                        let maybe_router = current_tts_router(&tts_router);
                        tokio::spawn(async move {
                            let ai_started_at = Instant::now();
                            let (tts_tx, mut tts_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
                            if let Some(router) = maybe_router {
                                let recent = Arc::clone(&recent_tts);
                                let cancel_for_tts = cancel_for_tts.clone();
                                tokio::spawn(async move {
                                    speak_ai_chunks(
                                        router,
                                        &mut tts_rx,
                                        recent,
                                        Some(turn_started),
                                        Some(first_chunk_ms_for_tts),
                                        cancel_for_tts,
                                    )
                                    .await;
                                });
                            } else {
                                drop(tts_rx);
                            }
                            let reply = tokio::select! {
                                _ = cancel_for_ai.cancelled() => return,
                                reply = agent::call_ai_voice_streaming(&h, &c, &bot_id, &text, &m, tts_tx) => reply,
                            };
                            if cancel_for_ai.is_cancelled() {
                                return;
                            }
                            let ai_total_ms = ai_started_at.elapsed().as_millis() as u64;
                            let total_ms = turn_started.elapsed().as_millis() as u64;
                            emit_voice_latency(
                                &ap,
                                asr_ms,
                                first_chunk_ms.load(Ordering::Relaxed),
                                ai_total_ms,
                                total_ms,
                            );
                            if reply.trim().is_empty() {
                                let _ = ap.emit("monitor-log", serde_json::json!("[ASR→AI] LLM 未返回内容"));
                            } else {
                                let _ = ap.emit("monitor-log", serde_json::json!(format!("[ASR→AI] {}", reply)));
                                // 同时发弹幕（供直播间观众看到）
                                let _ = tx.send(format!("[{}]{}", bot_nick, reply)).await;
                            }
                        });
                    }
                }
                Ok(streamix_voice::TurnEvent::SpeechEnd { text: None, .. }) => {
                    if has_asr {
                        let _ = app.emit("monitor-log", serde_json::json!("[ASR] 识别结果为空（语音过短或音量过低）"));
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    }
}

async fn speak_ai_chunks(
    router: streamix_voice::SpeakerRouter,
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<String>,
    recent_tts_text: Arc<Mutex<Vec<(Instant, String)>>>,
    turn_started_at: Option<Instant>,
    first_chunk_ms: Option<Arc<AtomicU64>>,
    cancel: CancellationToken,
) {
    let mut is_first_utterance = true;
    loop {
        let chunk = tokio::select! {
            _ = cancel.cancelled() => {
                let _ = router.voice_session().interrupt().await;
                break;
            }
            chunk = rx.recv() => match chunk {
                Some(chunk) => chunk,
                None => break,
            },
        };
        if chunk.trim().is_empty() {
            continue;
        }
        let mut utterance = chunk;
        let target_chars = if is_first_utterance { 0 } else { 48 };
        while target_chars > 0 && utterance.chars().count() < target_chars {
            match rx.try_recv() {
                Ok(next) if !next.trim().is_empty() => utterance.push_str(&next),
                Ok(_) => continue,
                Err(tokio::sync::mpsc::error::TryRecvError::Empty) => break,
                Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => break,
            }
        }
        if let (Some(started_at), Some(first_chunk_ms)) = (turn_started_at, first_chunk_ms.as_ref())
        {
            let elapsed = started_at.elapsed().as_millis() as u64;
            let _ =
                first_chunk_ms.compare_exchange(0, elapsed, Ordering::Relaxed, Ordering::Relaxed);
        }
        remember_tts_text(&recent_tts_text, &utterance);
        let utterances = split_voice_tts_utterance(&utterance);
        is_first_utterance = false;

        for utterance in utterances {
            let mut events = router.voice_session().subscribe();
            if router.speak_ai(utterance).await.is_err() {
                return;
            }
            let _ = tokio::time::timeout(Duration::from_secs(20), async {
                loop {
                    tokio::select! {
                        _ = cancel.cancelled() => {
                            let _ = router.voice_session().interrupt().await;
                            break;
                        }
                        event = events.recv() => match event {
                            Ok(streamix_voice::SessionEvent::SpeechEnd)
                            | Ok(streamix_voice::SessionEvent::SpeechInterrupted)
                            | Ok(streamix_voice::SessionEvent::Closed)
                            | Err(_) => break,
                            _ => {}
                        }
                    }
                }
            })
            .await;
            if cancel.is_cancelled() {
                break;
            }
        }
    }
}

fn split_voice_tts_utterance(text: &str) -> Vec<String> {
    const MAX_CHARS: usize = 28;
    let mut chunks = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        current.push(ch);
        let len = current.chars().count();
        if is_voice_tts_sentence_boundary(ch) || (len >= 12 && is_voice_tts_soft_break(ch)) {
            let chunk = current.trim();
            if !chunk.is_empty() {
                chunks.push(chunk.to_string());
            }
            current.clear();
        } else if len >= MAX_CHARS + 8 {
            let chunk = current.trim();
            if !chunk.is_empty() {
                chunks.push(chunk.to_string());
            }
            current.clear();
        }
    }

    let remaining = current.trim();
    if !remaining.is_empty() {
        chunks.push(remaining.to_string());
    }
    if chunks.is_empty() && !text.trim().is_empty() {
        chunks.push(text.trim().to_string());
    }
    chunks
}

fn is_voice_tts_sentence_boundary(ch: char) -> bool {
    matches!(ch, '。' | '！' | '？' | '…' | '.' | '!' | '?' | '\n')
}

fn is_voice_tts_soft_break(ch: char) -> bool {
    matches!(ch, '，' | '、' | '；' | ';' | ',' | ':' | '：')
}

fn emit_voice_latency<E: crate::bot::EventEmitter + Send + Sync + 'static>(
    app: &Arc<E>,
    asr_ms: u64,
    first_chunk_ms: u64,
    ai_total_ms: u64,
    total_ms: u64,
) {
    let _ = app.emit(
        "voice-latency",
        serde_json::json!({
            "asr_ms": asr_ms,
            "ai_first_chunk_ms": if first_chunk_ms == 0 { serde_json::Value::Null } else { serde_json::json!(first_chunk_ms) },
            "ai_total_ms": ai_total_ms,
            "total_ms": total_ms,
        }),
    );
}

fn remember_tts_text(recent: &Arc<Mutex<Vec<(Instant, String)>>>, text: &str) {
    let normalized = normalize_echo_text(text);
    if normalized.is_empty() {
        return;
    }
    if let Ok(mut items) = recent.lock() {
        let now = Instant::now();
        items.retain(|(at, _)| now.duration_since(*at) < Duration::from_secs(20));
        items.push((now, normalized));
        if items.len() > 24 {
            let overflow = items.len() - 24;
            items.drain(..overflow);
        }
    }
}

fn is_recent_tts_echo(text: &str, recent: &Arc<Mutex<Vec<(Instant, String)>>>) -> bool {
    let heard = normalize_echo_text(text);
    // Short utterances (< 6 chars) can't be reliably matched — don't suppress them
    if heard.chars().count() < 6 {
        return false;
    }
    let Ok(items) = recent.lock() else {
        return false;
    };
    let now = Instant::now();
    items.iter().any(|(at, spoken)| {
        // 20s window: TTS echo won't linger longer than this in a typical room
        now.duration_since(*at) < Duration::from_secs(20)
            // 0.75 threshold: conservative enough that genuine speech isn't suppressed
            && echo_text_similarity(&heard, spoken) >= 0.75
    })
}

fn normalize_echo_text(text: &str) -> String {
    text.chars()
        .filter(|ch| ch.is_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(ch))
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_meaningful_voice_text(text: &str) -> bool {
    !normalize_echo_text(text).is_empty()
}

fn echo_text_similarity(a: &str, b: &str) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a.contains(b) || b.contains(a) {
        return 1.0;
    }
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let common = a_chars.iter().filter(|ch| b_chars.contains(ch)).count();
    common as f32 / a_chars.len().min(b_chars.len()) as f32
}

/// 根据 config 中 active_tts_provider_id 解析对应的 TTS 引擎配置。
/// 未找到或未配置时回退为 Edge TTS。
fn resolve_tts_engine(
    config: &AppConfig,
    model_dir: &std::path::Path,
) -> streamix_voice::TtsEngine {
    let tts_provider = if config.active_tts_provider_id.is_empty() {
        None
    } else {
        config
            .ai_providers
            .iter()
            .find(|p| p.provider_type == "tts" && p.id == config.active_tts_provider_id)
    };

    let Some(provider) = tts_provider else {
        return streamix_voice::TtsEngine::Edge;
    };

    let name_lower = provider.name.to_lowercase();

    if name_lower.contains("minimax") {
        let voice_id = if !config.tts_voice.is_empty() {
            config.tts_voice.clone()
        } else {
            "zh_female_wanwanxiaohe_moon_bigtts".to_string()
        };
        let model = if provider.model.is_empty() {
            "speech-2.8-turbo".to_string()
        } else {
            provider.model.clone()
        };
        let http_url = normalize_minimax_http_url(&provider.api_url);
        let speed = config.tts_speed.clamp(0.5, 2.0) as f64;
        spawn_minimax_prewarm(http_url.clone(), provider.api_key.clone());
        streamix_voice::TtsEngine::MiniMaxHttp {
            api_key: provider.api_key.clone(),
            voice_id,
            model,
            http_url,
            speed: Some(speed),
            vol: Some(1.0),
            pitch: Some(0),
        }
    } else if name_lower.contains("火山")
        || name_lower.contains("volcengine")
        || name_lower.contains("volc")
    {
        let app_id = if provider.api_key.is_empty() {
            std::env::var("VOLC_APP_ID").unwrap_or_default()
        } else {
            provider.api_key.clone()
        };
        let access_key = std::env::var("VOLC_ACCESS_TOKEN").unwrap_or_default();
        let resource_id = if provider.model.is_empty() {
            std::env::var("VOLC_RESOURCE_ID").unwrap_or_else(|_| "seed-tts-2.0".to_string())
        } else {
            provider.model.clone()
        };
        let speaker = if provider.api_url.is_empty() {
            std::env::var("VOLC_SPEAKER")
                .unwrap_or_else(|_| "zh_female_shuangkuaisisi_moon_bigtts".to_string())
        } else {
            provider.api_url.clone()
        };
        streamix_voice::TtsEngine::VolcEngine {
            app_id,
            access_key,
            resource_id,
            speaker,
        }
    } else if name_lower.contains("azure") {
        streamix_voice::TtsEngine::Azure {
            subscription_key: provider.api_key.clone(),
            region: if provider.model.is_empty() {
                "eastasia".to_string()
            } else {
                provider.model.clone()
            },
        }
    } else {
        #[cfg(feature = "local-tts")]
        {
            if let Some(engine) = try_resolve_local_tts(&name_lower, model_dir, config.tts_speed) {
                return engine;
            }
        }
        streamix_voice::TtsEngine::Edge
    }
}

fn normalize_minimax_http_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return "https://api.minimaxi.com/v1/t2a_v2".to_string();
    }
    let mut out = trimmed
        .replace("wss://", "https://")
        .replace("ws://", "http://");
    if out.contains("/ws/v1/t2a_v2") {
        out = out.replace("/ws/v1/t2a_v2", "/v1/t2a_v2");
    }
    if !out.starts_with("http://") && !out.starts_with("https://") {
        out = format!("https://{out}");
    }
    out
}

/// 启动时并发预热 HTTP/2 连接，避免首条 TTS 付 TLS 握手代价。
fn spawn_minimax_prewarm(http_url: String, _api_key: String) {
    let prewarm_n = std::env::var("MINIMAX_PREWARM_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(4);
    if prewarm_n == 0 {
        return;
    }
    tokio::spawn(async move {
        let config = streamix_voice::tts::MiniMaxConfig::new(None, Some(http_url), None, None);
        let client = streamix_voice::tts::MiniMaxHttpTtsClient::new(config);
        if let Err(err) = client.prewarm_connections(prewarm_n).await {
            eprintln!("[TTS] MiniMax HTTP 连接预热失败: {err}");
        }
    });
}

/// 尝试将 provider 名称映射到本地 TTS 引擎。失败时返回 None（调用方回退到 Edge）。
#[cfg(feature = "local-tts")]
fn try_resolve_local_tts(
    name_lower: &str,
    model_dir: &std::path::Path,
    speed: f32,
) -> Option<streamix_voice::TtsEngine> {
    use std::sync::Arc;
    use streamix_voice::tts::local::LocalTtsEngine;

    if name_lower.contains("kokoro") {
        let dir = model_dir.join("sherpa-onnx-kokoro-multi-lang-v1.1-ONNX");
        match LocalTtsEngine::new_kokoro(&dir) {
            Ok(e) => {
                return Some(streamix_voice::TtsEngine::LocalTts {
                    engine: Arc::new(e),
                    speaker_id: 0,
                    speed,
                });
            }
            Err(err) => eprintln!("[TTS] Kokoro 加载失败，回退至 Edge: {err}"),
        }
    } else if name_lower.contains("melo") {
        let dir = model_dir.join("sherpa-onnx-melo-tts-zh_en");
        match LocalTtsEngine::new_melo(&dir) {
            Ok(e) => {
                return Some(streamix_voice::TtsEngine::LocalTts {
                    engine: Arc::new(e),
                    speaker_id: 0,
                    speed,
                });
            }
            Err(err) => eprintln!("[TTS] MeloTTS 加载失败，回退至 Edge: {err}"),
        }
    } else if name_lower.contains("piper") {
        let dir = model_dir.join("vits-piper-zh_CN-huayan-medium");
        match LocalTtsEngine::new_piper(&dir) {
            Ok(e) => {
                return Some(streamix_voice::TtsEngine::LocalTts {
                    engine: Arc::new(e),
                    speaker_id: 0,
                    speed,
                });
            }
            Err(err) => eprintln!("[TTS] Piper 加载失败，回退至 Edge: {err}"),
        }
    }
    None
}

/// 根据 config 中 active_asr_provider_id 解析 ASR WebSocket URL。
/// 未配置时返回 config.asr_url（兼容旧字段）。
pub(crate) fn resolve_asr_url(config: &AppConfig) -> String {
    let asr_provider = if config.active_asr_provider_id.is_empty() {
        None
    } else {
        config
            .ai_providers
            .iter()
            .find(|p| p.provider_type == "asr" && p.id == config.active_asr_provider_id)
    };

    if let Some(provider) = asr_provider {
        if !provider.api_url.is_empty() {
            return provider.api_url.clone();
        }
    }

    // 回退到旧版 asr_url 字段
    config.asr_url.clone()
}

fn sensevoice_model_dir(model_dir: &std::path::Path) -> std::path::PathBuf {
    model_dir.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17")
}

fn sensevoice_model_ready(model_dir: &std::path::Path) -> bool {
    let dir = sensevoice_model_dir(model_dir);
    dir.join("model.int8.onnx").exists() && dir.join("tokens.txt").exists()
}

fn is_loopback_ws_url(raw: &str) -> bool {
    reqwest::Url::parse(raw)
        .ok()
        .and_then(|url| {
            url.host_str()
                .map(|host| matches!(host, "localhost" | "127.0.0.1" | "::1"))
        })
        .unwrap_or(false)
}

async fn ws_endpoint_reachable(raw: &str) -> bool {
    let Some((host, port)) = reqwest::Url::parse(raw).ok().and_then(|url| {
        url.host_str()
            .map(|host| (host.to_string(), url.port_or_known_default().unwrap_or(80)))
    }) else {
        return false;
    };

    matches!(
        timeout(
            Duration::from_millis(800),
            TcpStream::connect((host.as_str(), port))
        )
        .await,
        Ok(Ok(_))
    )
}

async fn resolve_vad_asr_source(
    config: &AppConfig,
    model_dir: &std::path::Path,
) -> (String, Option<std::path::PathBuf>, Option<String>) {
    let asr_provider = if config.active_asr_provider_id.is_empty() {
        None
    } else {
        config
            .ai_providers
            .iter()
            .find(|p| p.provider_type == "asr" && p.id == config.active_asr_provider_id)
    };

    let asr_url = resolve_asr_url(config);
    let use_builtin_sensevoice = asr_provider
        .map(|p| p.model == "sensevoice")
        .unwrap_or(asr_url.is_empty());
    if use_builtin_sensevoice || asr_url.is_empty() {
        return ("".to_string(), Some(sensevoice_model_dir(model_dir)), None);
    }

    if is_loopback_ws_url(&asr_url) && !ws_endpoint_reachable(&asr_url).await {
        if sensevoice_model_ready(model_dir) {
            return (
                "".to_string(),
                Some(sensevoice_model_dir(model_dir)),
                Some(format!(
                    "ASR 服务不可达: {asr_url}，已自动回退到内置 SenseVoice 本地识别"
                )),
            );
        }

        return (
            asr_url.clone(),
            None,
            Some(format!(
                "ASR 服务不可达: {asr_url}。当前配置依赖外部 WebSocket 服务，语音将无法正常转文字"
            )),
        );
    }

    (asr_url, None, None)
}

#[cfg(test)]
mod tests {
    use super::split_voice_tts_utterance;

    #[test]
    fn split_voice_tts_utterance_prefers_sentence_boundaries() {
        let chunks = split_voice_tts_utterance("第一句很短。第二句也很短。");

        assert_eq!(chunks, vec!["第一句很短。", "第二句也很短。"]);
    }

    #[test]
    fn split_voice_tts_utterance_splits_long_text_for_faster_first_audio() {
        let chunks = split_voice_tts_utterance(
            "这是一段比较长的语音回复，会先切出前半段，再继续播放后面的内容。",
        );

        assert!(chunks.len() > 1);
        assert!(chunks[0].chars().count() <= 29);
    }
}
