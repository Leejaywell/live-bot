use anyhow::Result;
use cron::Schedule;
use serde_json::json;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio::time::{Duration, sleep};
use tokio_util::sync::CancellationToken;

use crate::api::BiliApi;
use crate::bot;
use crate::bot::EventEmitter;
use crate::bot::engine::BotEngine;
use crate::config::AppConfig;
use crate::storage::Storage;
use crate::token;

// AsrBackend trait 用于 streaming_recognition 调用
#[cfg(feature = "vad")]
use streamix_voice::asr::AsrBackend;

pub async fn run_monitor_loop<E: EventEmitter>(
    app: E,
    http: BiliApi,
    room_id: i64,
    cancel: CancellationToken,
    current_session_id: Arc<Mutex<Option<String>>>,
    danmaku_buffer: Arc<Mutex<Vec<String>>>,
    model_dir: std::path::PathBuf,
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

    let (send_tx, send_rx) = mpsc::channel::<String>(1000);
    let (gift_tx, gift_rx) = mpsc::channel::<bilibili_live_protocol::LiveEvent>(1000);
    let send_cookie = token::read_session().ok().map(|s| s.cookie).filter(|c| !c.is_empty());

    // 读取机器人自身 UID，用于过滤弹幕回声（B站会将机器人发送的弹幕也推送回来）
    let self_uid: i64 = send_cookie.as_deref()
        .and_then(|c| extract_cookie_value(c, "DedeUserID"))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // Session 记忆：对话历史窗口 + 发言者档案
    use crate::bot::memory::SessionMemory;
    let session_memory = Arc::new(std::sync::Mutex::new(SessionMemory::new()));

    // Agent Runtime：注册内置工具（发送弹幕 + 查询统计）
    use crate::bot::agent::{AgentRuntime, GetSessionStatsTool, SendDanmuTool};
    let agent_runtime = Arc::new(
        AgentRuntime::new()
            .register(SendDanmuTool { tx: send_tx.clone() })
            .register(GetSessionStatsTool {
                storage: storage.clone(),
                session_id: current_session_id.clone(),
            }),
    );

    // TTS 语音播报：SpeakerRouter 按优先级路由（Bot=1, AI=5, System=10）
    use streamix_voice::{SessionConfig, SpeakerRouter};
    let tts_router: Option<SpeakerRouter> = if config.tts_enabled {
        let tts_engine = resolve_tts_engine(&config);
        let session_config = SessionConfig { tts_voice: config.tts_voice.clone(), ..SessionConfig::default() };
        Some(SpeakerRouter::spawn_with_audio_and_engine(session_config, tts_engine, cancel.clone()))
    } else {
        None
    };

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
        if let Some(ref router) = tts_router {
            let obs_router = router.clone();
            let obs_host = config.obs_host.clone();
            let obs_port = config.obs_port;
            let obs_password = config.obs_password.clone();
            let obs_cancel = cancel.clone();
            let obs_app = sender_app.clone();
            tokio::spawn(async move {
                if let Err(e) = crate::obs::run_obs_client(
                    &obs_host, obs_port, &obs_password, obs_router, obs_cancel,
                ).await {
                    let _ = obs_app.emit("monitor-log", serde_json::json!(format!("OBS 连接失败: {e}")));
                }
            });
        }
    }

    // VAD 麦克风捕获：检测主播语音段，触发 TTS 打断 + 话轮结束事件
    #[cfg(feature = "vad")]
    let _mic_capture: Option<streamix_voice::SherpaMicCapture> = if config.vad_enabled {
        let vad_model     = model_dir.join("silero_vad.onnx");
        let asr_url       = resolve_asr_url(&config);
        // 本地 ASR 只在没有外部 ASR URL 时启用
        let asr_model_dir = if asr_url.is_empty() {
            Some(model_dir.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"))
        } else {
            None
        };

        match streamix_voice::SherpaPipeline::spawn(vad_model, asr_model_dir, "auto", cancel.clone()) {
            Ok(pipeline) => {
                // 事件循环
                let events     = pipeline.subscribe();
                let vad_app    = sender_app.clone();
                let vad_cancel = cancel.clone();
                let vad_config = Arc::clone(&bot_config);
                let vad_memory = session_memory.clone();
                let vad_agent  = agent_runtime.clone();
                let vad_http   = http.clone();
                let vad_tx     = send_tx.clone();

                // WhisperLive：需要音频 tap；本地 sherpa ASR：事件里直接携带文本
                let audio_tap = if !asr_url.is_empty() {
                    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Vec<f32>>();
                    let events2      = pipeline.subscribe();
                    let asr_cancel   = cancel.clone();
                    let asr_app      = sender_app.clone();
                    let asr_config   = Arc::clone(&bot_config);
                    let asr_memory   = session_memory.clone();
                    let asr_agent    = agent_runtime.clone();
                    let asr_http     = http.clone();
                    let asr_tx       = send_tx.clone();
                    let asr_url_c    = asr_url.clone();
                    tokio::spawn(async move {
                        #[cfg(feature = "asr")]
                        run_asr_loop(
                            rx, events2, asr_url_c, asr_http, asr_config,
                            asr_memory, asr_agent, asr_tx, asr_app, asr_cancel,
                        ).await;
                    });
                    Some(tx)
                } else {
                    // 本地 sherpa ASR：SpeechEnd 事件里带文本，直接触发 AI
                    tokio::spawn(run_sherpa_asr_event_loop(
                        events, vad_http, vad_config, vad_memory, vad_agent, vad_tx, vad_app, vad_cancel,
                    ));
                    None
                };

                match streamix_voice::SherpaMicCapture::start(&pipeline, audio_tap) {
                    Ok(mic) => Some(mic),
                    Err(e) => {
                        let _ = sender_app.emit("monitor-log", serde_json::json!(format!("麦克风启动失败: {e}")));
                        None
                    }
                }
            }
            Err(e) => {
                let _ = sender_app.emit("monitor-log", serde_json::json!(format!("VAD 初始化失败: {e}")));
                None
            }
        }
    } else {
        None
    };

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
        loop {
            tokio::select! {
                _ = poll_cancel.cancelled() => return,
                _ = sleep(Duration::from_secs(10)) => {
                    match poll_http.room_info(room_id).await {
                        Ok(room) => {
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
                        Err(err) => { let _ = poll_app.emit("monitor-log", json!(format!("监听轮询失败: {err}"))); }
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
                    let session_id = stats_session.lock().unwrap().clone();
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
    let ws_task = tokio::spawn(async move {
        let original_cookie = token::read_session().ok().map(|s| s.cookie).unwrap_or_default();

        loop {
            let bot_config = bot_config.clone();
            let session_memory = session_memory.clone();
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
                    let _ = send_tx.send(bot_config.entry_msg.clone()).await;
                    let _ = ws_app.emit("monitor-log", json!(format!("已发送登场语: {}", bot_config.entry_msg)));
                }

                let event_app = ws_app.clone();
                let event_tx = send_tx.clone();
                let event_gift_tx = gift_tx.clone();
                let event_engine = engine.clone();
                let event_storage = storage.clone();
                let ai_http = ws_http.clone();
                let session_id_inner = session_id.clone();
                let event_tts_router = tts_router.clone();
                let event_agent = agent_runtime.clone();

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

                    // 过滤机器人自身发出的弹幕回声，避免计入弹幕统计
                    if self_uid != 0 {
                        if let bilibili_live_protocol::LiveEvent::Danmu { user_id, .. } = event {
                            if *user_id == self_uid {
                                return;
                            }
                        }
                    }

                    let line = event.to_string();

                    // Queue event for batched emission
                    let _ = batch_tx.send(serde_json::json!(parsed));

                    // Push formatted line to buffer for high-frequency polling

                    if let Ok(mut buf) = danmaku_buf_cb.lock() {
                        buf.push(line);
                        if buf.len() > 500 { buf.remove(0); }
                    }

                    if matches!(event, bilibili_live_protocol::LiveEvent::Gift { .. }) {
                        let _ = event_gift_tx.try_send(event.clone());
                    }
                    if let bilibili_live_protocol::LiveEvent::Popularity { value } = event {
                        let _ = event_app.emit("room-online", json!({ "count": value }));
                    }
                    let replies = match bot::record_and_handle_event(
                        &event_storage,
                        &session_id_inner,
                        room_id,
                        &parsed,
                        &event_engine,
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

                        if let Some(ref router) = event_tts_router {
                            let r = router.clone();
                            let m = message.clone();
                            tokio::spawn(async move { let _ = r.speak_bot(m).await; });
                        }
                        let _ = event_tx.try_send(message);
                    }
                    if let bilibili_live_protocol::LiveEvent::Danmu { text, user_id, user: danmu_uname, .. } = event {
                        let mut matched = false;
                        let danmu_uid = *user_id;
                        let danmu_uname = danmu_uname.clone();

                        // @昵称 触发（遍历 ai_bots，已启用的机器人）
                        for bot in &event_engine.config.ai_bots {
                            if !bot.enabled { continue; }
                            let trigger = format!("@{}", bot.nickname);
                            if text.starts_with(&trigger) {
                                matched = true;
                                let prompt = text[trigger.len()..].trim().to_string();
                                if !prompt.is_empty() {
                                    let ai_http = ai_http.clone();
                                    let ai_config = Arc::clone(&bot_config);
                                    let ai_tx = event_tx.clone();
                                    let ai_router = event_tts_router.clone();
                                    let bot_id = bot.id.clone();
                                    let nickname = bot.nickname.clone();
                                    let ai_memory = session_memory.clone();
                                    let ai_uname = danmu_uname.clone();
                                    let ai_agent = event_agent.clone();
                                    tokio::spawn(async move {
                                        let reply = call_ai(&ai_http, &ai_config, &bot_id, &prompt, danmu_uid, &ai_uname, &ai_memory, &ai_agent).await;
                                        if let Some(ref r) = ai_router {
                                            let _ = r.speak_ai(reply.clone()).await;
                                        }
                                        let _ = ai_tx.send(format!("[{}]{}", nickname, reply)).await;
                                    });
                                }
                                break;
                            }
                        }

                        // 昵称模糊匹配（消息中包含昵称；未启用则静默）
                        if !matched {
                            for bot in &event_engine.config.ai_bots {
                                if !bot.nickname.is_empty() && text.contains(bot.nickname.as_str()) {
                                    matched = true;
                                    if bot.enabled {
                                        let prompt = text.clone();
                                        let ai_http = ai_http.clone();
                                        let ai_config = Arc::clone(&bot_config);
                                        let ai_tx = event_tx.clone();
                                        let ai_router = event_tts_router.clone();
                                        let bot_id = bot.id.clone();
                                        let nickname = bot.nickname.clone();
                                        let ai_memory = session_memory.clone();
                                        let ai_uname = danmu_uname.clone();
                                        let ai_agent = event_agent.clone();
                                        tokio::spawn(async move {
                                            let reply = call_ai(&ai_http, &ai_config, &bot_id, &prompt, danmu_uid, &ai_uname, &ai_memory, &ai_agent).await;
                                            if let Some(ref r) = ai_router {
                                                let _ = r.speak_ai(reply.clone()).await;
                                            }
                                            let _ = ai_tx.send(format!("[{}]{}", nickname, reply)).await;
                                        });
                                    }
                                    break;
                                }
                            }
                        }

                        // 裸 @ 触发，使用第一个启用的机器人
                        if !matched && text.starts_with('@') {
                            let prompt = text[1..].trim().to_string();
                            if !prompt.is_empty() {
                                if let Some(bot) = event_engine.config.ai_bots.iter().find(|b| b.enabled) {
                                    let ai_http = ai_http.clone();
                                    let ai_config = Arc::clone(&bot_config);
                                    let ai_tx = event_tx.clone();
                                    let ai_router = event_tts_router.clone();
                                    let bot_id = bot.id.clone();
                                    let nickname = bot.nickname.clone();
                                    let ai_memory = session_memory.clone();
                                    let ai_uname = danmu_uname.clone();
                                    let ai_agent = event_agent.clone();
                                    tokio::spawn(async move {
                                        let reply = call_ai(&ai_http, &ai_config, &bot_id, &prompt, danmu_uid, &ai_uname, &ai_memory, &ai_agent).await;
                                        if let Some(ref r) = ai_router {
                                            let _ = r.speak_ai(reply.clone()).await;
                                        }
                                        let _ = ai_tx.send(format!("[{}]{}", nickname, reply)).await;
                                    });
                                }
                            }
                        }
                    }
                })
                .await
            }
            .await;
            if let Err(err) = result {
                let _ = ws_app.emit("monitor-log", json!(format!("弹幕流连接结束: {err}")));
            }

            tokio::select! {
                _ = ws_cancel.cancelled() => return,
                _ = sleep(Duration::from_secs(5)) => {}
            }
        }
    });
    cancel.cancelled().await;
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
    http: crate::api::BiliApi,
    config: Arc<crate::config::AppConfig>,
    memory: Arc<std::sync::Mutex<crate::bot::memory::SessionMemory>>,
    agent: Arc<crate::bot::agent::AgentRuntime>,
    danmu_tx: tokio::sync::mpsc::Sender<String>,
    app: Arc<E>,
    cancel: tokio_util::sync::CancellationToken,
) {
    use streamix_voice::asr::{WhisperLiveAsrBackend, BackendConfig};

    let backend_cfg = BackendConfig { url: asr_url, supports_hotwords: false };
    let mut asr = WhisperLiveAsrBackend::new_with_config(backend_cfg, "zh".to_string(), None, None);

    let mut speech_buf: Vec<f32> = Vec::new();
    let mut recording = false;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,

            ev = events.recv() => match ev {
                Ok(streamix_voice::TurnEvent::SpeechStart) => {
                    recording = true;
                    speech_buf.clear();
                    asr.reset_streaming();
                    let _ = app.emit("monitor-log", serde_json::json!("[VAD] 开始录音"));
                }
                Ok(streamix_voice::TurnEvent::TurnEnd) => {
                    recording = false;
                    if speech_buf.len() < 1600 {
                        // 少于 100ms 的片段，忽略
                        speech_buf.clear();
                        continue;
                    }
                    let audio = std::mem::take(&mut speech_buf);
                    let _ = app.emit("monitor-log", serde_json::json!(format!("[VAD] 话轮结束，送 ASR（{}ms）", audio.len() / 16)));

                    match asr.streaming_recognition(&audio, true, true).await {
                        Ok(Some(voice_text)) => {
                            let text = voice_text.content.trim().to_string();
                            if text.is_empty() { continue; }
                            let _ = app.emit("monitor-log", serde_json::json!(format!("[ASR] 识别结果: {}", text)));

                            // 语音识别结果 → 使用语音专属系统提示词（含性别）调用 AI
                            if let Some(bot) = config.ai_bots.iter().find(|b| b.enabled) {
                                let bot_id   = bot.id.clone();
                                let bot_nick = bot.nickname.clone();
                                let h = http.clone();
                                let c = Arc::clone(&config);
                                let m = memory.clone();
                                let ag = agent.clone();
                                let tx = danmu_tx.clone();
                                let ap = app.clone();
                                tokio::spawn(async move {
                                    let reply = call_ai_voice(&h, &c, &bot_id, &text, &m, &ag).await;
                                    let _ = ap.emit("monitor-log", serde_json::json!(format!("[ASR→AI] {}", reply)));
                                    let _ = tx.send(format!("[{}]{}", bot_nick, reply)).await;
                                });
                            }
                        }
                        Ok(None) => {}
                        Err(e) => {
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
                    } else {
                        break;
                    }
                }
            }
        }
    }
}

fn extract_cookie_value(cookie: &str, name: &str) -> Option<String> {
    cookie.split(';').find_map(|s| {
        let s = s.trim();
        let prefix = format!("{}=", name);
        s.starts_with(&prefix).then(|| s[prefix.len()..].to_string())
    })
}

/// AI 调用入口：通过 bot_id 隔离记忆，通过 bot.provider_id 找模型
///
/// 1. 从 ai_bots 找到 bot（昵称、人设、provider_id）
/// 2. 从 ai_providers 找到 provider（模型、API Key/URL）
/// 3. memory key = bot_id，确保不同机器人记忆互不干扰
async fn call_ai(
    http: &crate::api::BiliApi,
    config: &crate::config::AppConfig,
    bot_id: &str,
    prompt: &str,
    uid: i64,
    uname: &str,
    memory: &Arc<std::sync::Mutex<crate::bot::memory::SessionMemory>>,
    agent: &Arc<crate::bot::agent::AgentRuntime>,
) -> String {
    // 找 bot（人设信息）
    let Some(bot) = config.ai_bots.iter().find(|b| b.id == bot_id) else {
        eprintln!("[AI] bot {bot_id} not found");
        return String::new();
    };
    let Some(provider) = config.ai_providers.iter().find(|p| p.id == bot.provider_id) else {
        eprintln!("[AI] provider not found for bot {bot_id}");
        return String::new();
    };

    let (history, system_prompt, enriched_prompt) = {
        let mut mem = memory.lock().unwrap();
        let count = mem.note_speaker(uid, uname);
        let hint = if count > 1 {
            format!("（{}第{}次与你对话）", uname, count)
        } else {
            format!("（{}首次与你对话）", uname)
        };
        // system_prompt 从 bot 读，{{name}} 替换为机器人昵称
        let sys = bot.system_prompt.replace("{{name}}", &bot.nickname);
        // memory key = bot_id（与 provider_id 无关，确保多机器人隔离）
        let pairs = mem.history_pairs(bot_id);
        (pairs, sys, format!("{} {}", prompt, hint))
    };

    let reply = agent
        .run_with_provider(http, provider, &system_prompt, &history, &enriched_prompt)
        .await
        .unwrap_or_else(|e| { eprintln!("[AI] 调用失败: {e}"); String::new() });

    {
        let mut mem = memory.lock().unwrap();
        mem.push_turn(bot_id, prompt.to_string(), reply.clone());
    }

    reply
}

/// 语音模式 AI 调用：使用 voice_system_prompt 替换 {{gender}}，而非 bot 的人设提示词。
async fn call_ai_voice(
    http:   &crate::api::BiliApi,
    config: &crate::config::AppConfig,
    bot_id: &str,
    prompt: &str,
    memory: &Arc<std::sync::Mutex<crate::bot::memory::SessionMemory>>,
    agent:  &Arc<crate::bot::agent::AgentRuntime>,
) -> String {
    let Some(bot) = config.ai_bots.iter().find(|b| b.id == bot_id) else {
        eprintln!("[AI voice] bot {bot_id} not found");
        return String::new();
    };
    let Some(provider) = config.ai_providers.iter().find(|p| p.id == bot.provider_id) else {
        eprintln!("[AI voice] provider not found for bot {bot_id}");
        return String::new();
    };
    let sys = config.voice_system_prompt.replace("{{gender}}", &config.voice_gender);
    let (history, enriched_prompt) = {
        let mem = memory.lock().unwrap();
        (mem.history_pairs(bot_id), prompt.to_string())
    };
    let reply = agent
        .run_with_provider(http, provider, &sys, &history, &enriched_prompt)
        .await
        .unwrap_or_else(|e| { eprintln!("[AI] 调用失败: {e}"); String::new() });
    {
        let mut mem = memory.lock().unwrap();
        mem.push_turn(bot_id, prompt.to_string(), reply.clone());
    }
    reply
}

/// sherpa-onnx 本地 ASR 事件循环
///
/// SherpaPipeline 内部已完成 VAD + ASR；此函数只需监听 SpeechEnd 事件，
/// 取出 text 后调用 AI 回复。
#[cfg(feature = "vad")]
#[allow(clippy::too_many_arguments)]
async fn run_sherpa_asr_event_loop<E: crate::bot::EventEmitter + Send + Sync + 'static>(
    mut events: tokio::sync::broadcast::Receiver<streamix_voice::TurnEvent>,
    http:       crate::api::BiliApi,
    config:     Arc<crate::config::AppConfig>,
    memory:     Arc<std::sync::Mutex<crate::bot::memory::SessionMemory>>,
    agent:      Arc<crate::bot::agent::AgentRuntime>,
    danmu_tx:   tokio::sync::mpsc::Sender<String>,
    app:        Arc<E>,
    cancel:     tokio_util::sync::CancellationToken,
) {
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            ev = events.recv() => match ev {
                Ok(streamix_voice::TurnEvent::SpeechStart) => {
                    let _ = app.emit("monitor-log", serde_json::json!("[VAD] 检测到说话，开始录音"));
                }
                Ok(streamix_voice::TurnEvent::TurnEnd) => {
                    let _ = app.emit("monitor-log", serde_json::json!("[VAD] 话轮结束，等待 ASR 推理"));
                }
                Ok(streamix_voice::TurnEvent::SpeechEnd { text: Some(text), .. }) => {
                    let text = text.trim().to_string();
                    if text.is_empty() { continue; }
                    let _ = app.emit("monitor-log", serde_json::json!(format!("[ASR] {}", text)));
                    if let Some(bot) = config.ai_bots.iter().find(|b| b.enabled) {
                        let bot_id   = bot.id.clone();
                        let bot_nick = bot.nickname.clone();
                        let h = http.clone(); let c = Arc::clone(&config);
                        let m = memory.clone(); let ag = agent.clone();
                        let tx = danmu_tx.clone(); let ap = app.clone();
                        tokio::spawn(async move {
                            let reply = call_ai_voice(&h, &c, &bot_id, &text, &m, &ag).await;
                            let _ = ap.emit("monitor-log", serde_json::json!(format!("[ASR→AI] {}", reply)));
                            let _ = tx.send(format!("[{}]{}", bot_nick, reply)).await;
                        });
                    }
                }
                Ok(streamix_voice::TurnEvent::SpeechEnd { text: None, .. }) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    }
}

/// 根据 config 中 active_tts_provider_id 解析对应的 TTS 引擎配置。
/// 未找到或未配置时回退为 Edge TTS。
fn resolve_tts_engine(config: &AppConfig) -> streamix_voice::TtsEngine {
    let tts_provider = if config.active_tts_provider_id.is_empty() {
        None
    } else {
        config.ai_providers.iter().find(|p| p.provider_type == "tts" && p.id == config.active_tts_provider_id)
    };

    let Some(provider) = tts_provider else {
        return streamix_voice::TtsEngine::Edge;
    };

    let name_lower = provider.name.to_lowercase();

    if name_lower.contains("minimax") {
        streamix_voice::TtsEngine::MiniMax {
            api_key: provider.api_key.clone(),
            voice_id: if provider.model.is_empty() {
                "zh_female_wanwanxiaohe_moon_bigtts".to_string()
            } else {
                provider.model.clone()
            },
        }
    } else if name_lower.contains("火山") || name_lower.contains("volcengine") || name_lower.contains("volc") {
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
            std::env::var("VOLC_SPEAKER").unwrap_or_else(|_| "zh_female_shuangkuaisisi_moon_bigtts".to_string())
        } else {
            provider.api_url.clone()
        };
        streamix_voice::TtsEngine::VolcEngine { app_id, access_key, resource_id, speaker }
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
        streamix_voice::TtsEngine::Edge
    }
}

/// 根据 config 中 active_asr_provider_id 解析 ASR WebSocket URL。
/// 未配置时返回 config.asr_url（兼容旧字段）。
fn resolve_asr_url(config: &AppConfig) -> String {
    let asr_provider = if config.active_asr_provider_id.is_empty() {
        None
    } else {
        config.ai_providers.iter().find(|p| p.provider_type == "asr" && p.id == config.active_asr_provider_id)
    };

    if let Some(provider) = asr_provider {
        if !provider.api_url.is_empty() {
            return provider.api_url.clone();
        }
    }

    // 回退到旧版 asr_url 字段
    config.asr_url.clone()
}
