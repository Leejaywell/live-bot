mod api;
mod bot;
mod config;
mod obs;
mod storage;
mod token;

use anyhow::Result;
use config::AppConfig;
use std::sync::{Arc, Mutex};
use tokio::runtime::Runtime;
use tokio_util::sync::CancellationToken;

#[cfg(feature = "tauri")]
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone)]
struct SharedState {
    #[allow(dead_code)]
    runtime: Arc<Runtime>,
    http: api::BiliApi,
    monitor: Arc<Mutex<Option<MonitorHandle>>>,
    storage: Arc<storage::Storage>,
    connected_room: Arc<Mutex<Option<i64>>>,
    monitor_log_buffer: Arc<Mutex<Vec<String>>>,
    /// 预览 TTS（AI页播放按钮）：(router, 当前声音, cancel)
    #[cfg(feature = "tauri")]
    preview_tts: Arc<Mutex<Option<(streamix_voice::SpeakerRouter, String, CancellationToken)>>>,
    #[cfg(feature = "tauri")]
    model_dl_cancels: Arc<Mutex<std::collections::HashMap<String, CancellationToken>>>,
    /// 全局 AI 会话记忆（机器人 ID 隔离）
    session_memory: Arc<Mutex<bot::memory::SessionMemory>>,
    /// 基础 AI Agent 运行时
    agent_runtime: Arc<bot::agent::AgentRuntime>,
    /// 实时变声器状态
    #[cfg(feature = "tauri")]
    voice_changer: Arc<Mutex<Option<streamix_voice::voice_changer::VoiceChanger>>>,
}

struct MonitorHandle {
    cancel: CancellationToken,
    session_id: Arc<Mutex<Option<String>>>,
    danmaku_buffer: Arc<Mutex<Vec<String>>>,
}

#[cfg(feature = "tauri")]
struct BufferedEmitter {
    handle: AppHandle,
    log_buffer: Arc<Mutex<Vec<String>>>,
    batch_tx: tokio::sync::mpsc::UnboundedSender<String>,
}

#[cfg(feature = "tauri")]
impl bot::EventEmitter for BufferedEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) -> anyhow::Result<()> {
        if event == "monitor-log" {
            if let Some(text) = payload.as_str() {
                // Update internal buffer for polling
                if let Ok(mut buf) = self.log_buffer.lock() {
                    buf.push(text.to_string());
                    if buf.len() > 200 { buf.remove(0); }
                }
                // Queue for batched IPC emission
                let _ = self.batch_tx.send(text.to_string());
                // Fallthrough to emit singular event (needed for notifications in App.tsx)
            }
        }
 else if event == "live-event" {
            // singular events are allowed for immediate updates
        }
        
        tauri::Emitter::emit(&self.handle, event, payload)
            .map_err(|e| anyhow::anyhow!(e.to_string()))
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn load_config() -> Result<AppConfig, String> {
    AppConfig::load_or_default().map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn save_config(config: AppConfig) -> Result<(), String> {
    config.save().map_err(|e| e.to_string())
}

fn user_info_json(info: &api::UserInfo, saved_at: i64) -> serde_json::Value {
    serde_json::json!({
        "uid":               info.uid,
        "uname":             info.uname,
        "face":              info.face,
        "level":             info.level,
        "vip_status":        info.vip_status,
        "vip_type":          info.vip_type,
        "coins":             info.coins,
        "vip_nickname_color": info.vip_nickname_color,
        "is_login":          true,
        "saved_at":          saved_at,
    })
}

fn not_logged_in_json(saved_at: i64) -> serde_json::Value {
    serde_json::json!({
        "uid": 0, "uname": "", "face": "", "level": 0,
        "vip_status": 0, "vip_type": 0, "coins": 0.0, "vip_nickname_color": "",
        "is_login": false, "saved_at": saved_at,
    })
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_user_info(state: tauri::State<'_, SharedState>) -> Result<serde_json::Value, String> {
    let saved_at = token::session_saved_at().unwrap_or(0);
    let session = match token::read_session() {
        Ok(s) if !s.cookie.is_empty() => s,
        _ => return Ok(not_logged_in_json(saved_at)),
    };
    match state.http.user_info(&session.cookie).await {
        Ok(info) => Ok(user_info_json(&info, saved_at)),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("登录状态无效") {
                Ok(not_logged_in_json(saved_at))
            } else {
                // Network / HTTP error — return Err so the frontend can ignore gracefully
                Err(format!("network_error: {msg}"))
            }
        }
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn start_login(state: tauri::State<'_, SharedState>) -> Result<api::LoginUrl, String> {
    state.http.login_url().await.map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn poll_login(
    state: tauri::State<'_, SharedState>,
    key: String,
) -> Result<serde_json::Value, String> {
    match state.http.poll_login(&key).await {
        Ok(api::LoginPoll::Success(cookie, refresh_token)) => {
            let session = token::Session { cookie, refresh_token };
            token::write_session(&session).map_err(|e| e.to_string())?;
            let saved_at = token::session_saved_at().unwrap_or(0);
            match state.http.user_info(&session.cookie).await {
                Ok(info) => {
                    let mut v = user_info_json(&info, saved_at);
                    v["status"] = serde_json::json!("Success");
                    Ok(v)
                }
                Err(_) => Ok(serde_json::json!({ "status": "Success" })),
            }
        }
        Ok(api::LoginPoll::Expired(msg)) => Ok(serde_json::json!({ "status": "Expired",   "message": msg })),
        Ok(api::LoginPoll::Pending(msg)) => Ok(serde_json::json!({ "status": "Scanning",  "message": msg })),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn check_room(
    state: tauri::State<'_, SharedState>,
    room_id: i64,
) -> Result<api::RoomInfo, String> {
    state
        .http
        .room_info(room_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_room_by_uid(
    state: tauri::State<'_, SharedState>,
    uid: i64,
) -> Result<api::RoomInfo, String> {
    state
        .http
        .room_id_by_uid(uid)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn logout() -> Result<(), String> {
    token::delete_session().map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_system_info() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "config_path": crate::config::config_path().to_string_lossy(),
        "db_path": crate::config::db_path().to_string_lossy()
    }))
}

/// 在 monitor 启动前自动补全缺失的本地模型文件。
/// 通过 ModelHub 下载单文件（VAD），对需要解压的模型复用现有 dl_* 函数。
#[cfg(all(feature = "tauri", feature = "model-hub"))]
async fn auto_download_models(
    app: &AppHandle,
    model_dir: &std::path::Path,
    config: &AppConfig,
    cancel: CancellationToken,
) {
    use streamix_voice::{ModelHub, ModelSource, DownloadStage};

    let hub = ModelHub::new(model_dir);

    // ── VAD (silero_vad.onnx, ~1.8 MB) ───────────────────────────────────────
    let vad_path = model_dir.join("silero_vad.onnx");
    if !vad_path.exists() && !cancel.is_cancelled() {
        let _ = app.emit("monitor-log", serde_json::json!("正在自动下载 VAD 模型…"));
        let use_mirror = detect_china_ip().await;
        let url = if use_mirror {
            "https://mirror.ghproxy.com/https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
        } else {
            "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
        };

        let (tx, mut rx) = tokio::sync::mpsc::channel::<streamix_voice::DownloadProgress>(64);
        let app_c = app.clone();
        tokio::spawn(async move {
            while let Some(p) = rx.recv().await {
                if p.stage == DownloadStage::Done { break; }
                let pct = p.total.map(|t| (p.downloaded as f64 / t as f64 * 99.0) as u32).unwrap_or(0);
                let mut payload = serde_json::json!({
                    "model_id": "silero-vad", "stage": "downloading", "pct": pct,
                    "downloaded_mb": format!("{:.1}", p.downloaded as f64 / 1_048_576.0),
                });
                if let Some(t) = p.total {
                    payload["total_mb"] = format!("{:.1}", t as f64 / 1_048_576.0).into();
                }
                let _ = app_c.emit("model-dl-progress", payload);
            }
        });

        let result = tokio::select! {
            _ = cancel.cancelled() => return,
            r = hub.ensure(ModelSource::url(url, "silero_vad.onnx"), Some(tx)) => r,
        };
        match result {
            Ok(_) => {
                let _ = app.emit("model-dl-progress",
                    serde_json::json!({"model_id": "silero-vad", "stage": "done", "pct": 100u32}));
                let _ = app.emit("monitor-log", serde_json::json!("VAD 模型就绪"));
            }
            Err(e) => {
                let _ = app.emit("monitor-log", serde_json::json!(format!("VAD 模型下载失败: {e}")));
            }
        }
    }

    // ── SenseVoice ASR（仅当无外部 ASR URL 时使用本地模型）───────────────────
    #[cfg(feature = "vad")]
    {
        let asr_url = crate::bot::monitor::resolve_asr_url(config);
        let sv_dir = model_dir.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");
        if asr_url.is_empty() && !sv_dir.join("model.int8.onnx").exists() && !cancel.is_cancelled() {
            let _ = app.emit("monitor-log", serde_json::json!("正在自动下载 SenseVoice 模型（约 300 MB）…"));
            match dl_sensevoice(app.clone(), cancel.clone()).await {
                Ok(_)  => { let _ = app.emit("monitor-log", serde_json::json!("SenseVoice 模型就绪")); }
                Err(e) => { let _ = app.emit("monitor-log", serde_json::json!(format!("SenseVoice 下载失败: {e}"))); }
            }
        }
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn start_monitor(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    room_id: Option<i64>,
) -> Result<(), String> {
    // Stop any existing monitor before starting a new one
    {
        let mut monitor = state.monitor.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = monitor.take() {
            handle.cancel.cancel();
        }
    }

    let danmaku_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let cancel = CancellationToken::new();
    let session_id = Arc::new(Mutex::new(None));
    let handle = MonitorHandle {
        cancel: cancel.clone(),
        session_id: session_id.clone(),
        danmaku_buffer: danmaku_buf.clone(),
    };

    let room_id = room_id
        .or_else(|| state.connected_room.lock().ok().and_then(|r| *r))
        .unwrap_or_else(|| {
            AppConfig::load_or_default().ok().map(|c| c.room_id).unwrap_or(0)
        });
    let http = state.http.clone();

    // Clear log buffer for new session
    if let Ok(mut buf) = state.monitor_log_buffer.lock() {
        buf.clear();
    }

    // Batch Emitter Task for monitor-log
    let (batch_tx, mut batch_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let batch_app = app.clone();
    let batch_cancel = cancel.clone();
    tokio::spawn(async move {
        let mut buffer = Vec::new();
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(200));
        loop {
            tokio::select! {
                _ = batch_cancel.cancelled() => break,
                msg = batch_rx.recv() => {
                    if let Some(s) = msg {
                        buffer.push(s);
                        if buffer.len() >= 20 {
                            let _ = batch_app.emit("monitor-logs", serde_json::json!(buffer));
                            buffer.clear();
                        }
                    } else { break; }
                }
                _ = interval.tick() => {
                    if !buffer.is_empty() {
                        let _ = batch_app.emit("monitor-logs", serde_json::json!(buffer));
                        buffer.clear();
                    }
                }
            }
        }
    });

    let emitter = BufferedEmitter {
        handle: app.clone(),
        log_buffer: state.monitor_log_buffer.clone(),
        batch_tx,
    };

    let models = model_dir(&app);
    #[cfg(feature = "model-hub")]
    let auto_dl_app = app.clone();
    #[cfg(feature = "model-hub")]
    let auto_dl_cancel = cancel.clone();

    let session_memory = state.session_memory.clone();

    tokio::spawn(async move {
        // 自动补全缺失模型后再启动引擎
        #[cfg(feature = "model-hub")]
        if let Ok(cfg) = AppConfig::load_or_default() {
            auto_download_models(&auto_dl_app, &models, &cfg, auto_dl_cancel).await;
        }

        if let Err(e) =
            crate::bot::monitor::run_monitor_loop(emitter, http, room_id, cancel, session_id, danmaku_buf, models, session_memory)
                .await
        {
            eprintln!("Monitor error: {}", e);
        }
    });

    let mut monitor = state.monitor.lock().map_err(|e| e.to_string())?;
    *monitor = Some(handle);
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn stop_monitor(state: tauri::State<'_, SharedState>) -> Result<(), String> {
    let mut monitor = state.monitor.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = monitor.take() {
        handle.cancel.cancel();
        Ok(())
    } else {
        Err("Monitor is not running".to_string())
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_monitor_status(state: tauri::State<'_, SharedState>) -> Result<bool, String> {
    let monitor = state.monitor.lock().map_err(|e| e.to_string())?;
    Ok(monitor.is_some())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_stats(
    state: tauri::State<'_, SharedState>,
    days: i64,
) -> Result<storage::LiveSessionSummary, String> {
    state
        .storage
        .periodic_summary(days)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_gift_stats(
    state: tauri::State<'_, SharedState>,
    days: i64,
    n: i32,
) -> Result<Vec<storage::GiftStat>, String> {
    state.storage.gift_top_n(days, n).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_user_gift_stats(
    state: tauri::State<'_, SharedState>,
    days: i64,
    n: i32,
) -> Result<Vec<storage::UserGiftStat>, String> {
    state.storage.user_gift_top_n(days, n).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_blind_box_stats(
    state: tauri::State<'_, SharedState>,
    days: i64,
) -> Result<Vec<(String, i64)>, String> {
    state.storage.get_blind_box_stats(days).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_daily_stats(
    state: tauri::State<'_, SharedState>,
    days: i64,
) -> Result<Vec<storage::DailyStats>, String> {
    state.storage.daily_interaction_counts(days).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_tracked_users(
    state: tauri::State<'_, SharedState>,
    limit: i64,
) -> Result<Vec<storage::KnownUser>, String> {
    state.storage.get_tracked_users(limit).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn check_tracked_user(
    state: tauri::State<'_, SharedState>,
    uid: i64,
) -> Result<Option<storage::CheckUserResult>, String> {
    state.storage.check_tracked_user(uid).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn add_tracked_user(
    state: tauri::State<'_, SharedState>,
    uid: i64,
    nickname: String,
    alias: String,
    notes: String,
) -> Result<(), String> {
    state.storage.add_tracked_user(uid, &nickname, &alias, &notes).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn restore_tracked_user(
    state: tauri::State<'_, SharedState>,
    uid: i64,
    alias: String,
    notes: String,
) -> Result<(), String> {
    state.storage.restore_tracked_user(uid, &alias, &notes).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn update_tracked_user(
    state: tauri::State<'_, SharedState>,
    uid: i64,
    alias: String,
    notes: String,
) -> Result<(), String> {
    state.storage.update_tracked_user(uid, &alias, &notes).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn soft_delete_tracked_user(
    state: tauri::State<'_, SharedState>,
    uid: i64,
) -> Result<(), String> {
    state.storage.soft_delete_tracked_user(uid).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_pk_summary(
    state: tauri::State<'_, SharedState>,
) -> Result<Option<storage::PkSessionSummary>, String> {
    let monitor = state.monitor.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = monitor.as_ref() {
        let session_id = handle.session_id.lock().map_err(|e| e.to_string())?;
        if let Some(id) = session_id.as_ref() {
            let config = AppConfig::load_or_default().map_err(|e| e.to_string())?;
            return Ok(Some(
                state
                    .storage
                    .session_pk_summary(id, config.room_id)
                    .map_err(|e| e.to_string())?,
            ));
        }
    }
    Ok(None)
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_pk_history(
    state: tauri::State<'_, SharedState>,
) -> Result<Vec<storage::PkHistoryRecord>, String> {
    let monitor = state.monitor.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = monitor.as_ref() {
        let session_id = handle.session_id.lock().map_err(|e| e.to_string())?;
        if let Some(id) = session_id.as_ref() {
            return Ok(state
                .storage
                .session_pk_history(id)
                .map_err(|e| e.to_string())?);
        }
    }
    Ok(Vec::new())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn send_danmu(state: tauri::State<'_, SharedState>, message: String) -> Result<(), String> {
    let room_id = {
        let room = state.connected_room.lock().map_err(|e| e.to_string())?;
        match *room {
            Some(id) => id,
            None => AppConfig::load_or_default().map_err(|e| e.to_string())?.room_id,
        }
    };
    if room_id == 0 {
        return Err("未连接直播间".to_string());
    }
    let session = token::read_session().map_err(|e| e.to_string())?;
    state
        .http
        .send_danmu(room_id, &message, &session.cookie)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn query_user_detail(
    state: tauri::State<'_, SharedState>,
    uid: String,
) -> Result<storage::UserDetail, String> {
    let uid_i64 = uid.parse::<i64>().map_err(|e| e.to_string())?;
    state
        .storage
        .user_detail(uid_i64)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_voice_changer_status(state: tauri::State<'_, SharedState>) -> Result<bool, String> {
    let vc = state.voice_changer.lock().unwrap();
    Ok(vc.is_some())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn start_voice_changer(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    model_id: String,
) -> Result<(), String> {
    let mut vc_lock = state.voice_changer.lock().unwrap();
    if vc_lock.is_some() {
        return Err("变声器已在运行".to_string());
    }

    // 1. 获取模型路径
    let base = model_dir(&app).join("rvc");
    let model_path = base.join(&model_id).join("model.onnx");
    let hubert_path = base.join("hubert_base.onnx");

    if !model_path.exists() || !hubert_path.exists() {
        return Err("模型文件不存在，请先下载".to_string());
    }

    // 2. 初始化引擎
    let mut vc = streamix_voice::voice_changer::VoiceChanger::new();
    vc.load_model(
        &model_path.to_string_lossy(),
        &hubert_path.to_string_lossy(),
    ).map_err(|e| format!("加载模型失败: {e}"))?;

    // 3. 启动实时音频循环（此处为简化逻辑，实际需要 cpal 异步流）
    // 在真实实现中，我们会启动一个后台线程处理音频 I/O
    *vc_lock = Some(vc);
    
    let _ = app.emit("monitor-log", serde_json::json!(format!("AI 变声器已启动: {}", model_id)));
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn stop_voice_changer(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut vc = state.voice_changer.lock().unwrap();
    *vc = None;
    let _ = app.emit("monitor-log", serde_json::json!("AI 变声器已关闭"));
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn search_rvc_models(query: String) -> Result<serde_json::Value, String> {
    // 模拟从远程仓库搜索
    let all_models = vec![
        serde_json::json!({
            "id": "sweet-girl",
            "name": "甜美少女",
            "author": "Streamix-AI",
            "description": "自然清甜的少女音，适合日常互动和唱歌。",
            "tags": ["推荐", "少女", "清纯"],
            "installed": false,
            "size": "32MB"
        }),
        serde_json::json!({
            "id": "cool-man",
            "name": "磁性大叔",
            "author": "VoiceLab",
            "description": "浑厚有磁性的熟男音色，极具安全感。",
            "tags": ["大叔", "磁性", "电台"],
            "installed": false,
            "size": "45MB"
        }),
        serde_json::json!({
            "id": "anime-maid",
            "name": "二次元女仆",
            "author": "Moegirl",
            "description": "经典的动漫女仆风格，高频活泼。",
            "tags": ["动漫", "萝莉", "元气"],
            "installed": false,
            "size": "28MB"
        }),
    ];

    let filtered: Vec<_> = all_models
        .into_iter()
        .filter(|m| {
            if query.is_empty() { return true; }
            m["name"].as_str().unwrap().contains(&query) || 
            m["tags"].as_array().unwrap().iter().any(|t| t.as_str().unwrap().contains(&query))
        })
        .collect();

    Ok(serde_json::json!(filtered))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn send_ai_message(
    state: tauri::State<'_, SharedState>,
    prompt: String,
) -> Result<String, String> {
    let config = AppConfig::load_or_default().map_err(|e| e.to_string())?;

    // 使用统一的机器人解析逻辑
    let (bot_id, final_prompt, nickname) =
        if let Some(res) = bot::agent::resolve_bot_danmu(&config, &prompt) {
            (res.bot.id.clone(), res.prompt, res.bot.nickname.clone())
        } else {
            return Err("未识别到目标机器人，请使用 @机器人昵称 或指令触发".to_string());
        };

    let reply = bot::agent::call_ai(
        &state.http,
        &config,
        &bot_id,
        &final_prompt,
        0, // UID 0 for local user
        "User",
        &state.session_memory,
        &state.agent_runtime,
    )
    .await;

    if reply.is_empty() {
        return Err("AI 响应为空".to_string());
    }

    Ok(format!("[{}]{}", nickname, reply))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_anchor_info(
    state: tauri::State<'_, SharedState>,
    uid: i64,
) -> Result<api::AnchorInfo, String> {
    state.http.anchor_info(uid).await.map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn proxy_image(state: tauri::State<'_, SharedState>, url: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = state.http.fetch_image(&url).await.map_err(|e| e.to_string())?;
    let mime = if bytes.starts_with(b"\xff\xd8") {
        "image/jpeg"
    } else if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.starts_with(b"RIFF") {
        "image/webp"
    } else {
        "image/jpeg"
    };
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(&bytes)))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn set_connected_room(
    state: tauri::State<'_, SharedState>,
    room_id: Option<i64>,
) -> Result<(), String> {
    let mut room = state.connected_room.lock().map_err(|e| e.to_string())?;
    *room = room_id;
    match room_id {
        Some(id) => token::write_connected_room(id).map_err(|e| e.to_string())?,
        None => token::delete_connected_room(),
    }
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_connected_room(
    state: tauri::State<'_, SharedState>,
) -> Result<Option<i64>, String> {
    let room = state.connected_room.lock().map_err(|e| e.to_string())?;
    Ok(*room)
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_monitor_logs(state: tauri::State<'_, SharedState>) -> Result<Vec<String>, String> {
    let buf = state.monitor_log_buffer.lock().map_err(|e| e.to_string())?;
    Ok(buf.clone())
}

/// 预览 TTS：在 AI 机器人页面播放回复文本。
/// 按声音懒惰初始化 SpeakerRouter，声音改变时自动重建。
#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_recent_danmaku(
    state: tauri::State<'_, SharedState>,
) -> Result<Vec<String>, String> {
    let monitor = state.monitor.lock().map_err(|e| e.to_string())?;
    let items = if let Some(handle) = monitor.as_ref() {
        let mut buf = handle.danmaku_buffer.lock().map_err(|e| e.to_string())?;
        if buf.is_empty() {
            Vec::new()
        } else {
            let drained: Vec<String> = buf.drain(..).collect();
            println!("[Monitor] Polled: Drained {} lines", drained.len());
            drained
        }
    } else {
        Vec::new()
    };
    Ok(items)
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn speak_text_cmd(
    state: tauri::State<'_, SharedState>,
    text: String,
    voice: String,
) -> Result<(), String> {
    use streamix_voice::{SessionConfig, SpeakerRouter};

    // 从 config 解析当前 TTS 引擎
    let cfg = AppConfig::load_or_default().map_err(|e| e.to_string())?;
    let engine = resolve_tts_engine_for_preview(&cfg);

    let router = {
        let mut guard = state.preview_tts.lock().map_err(|e| e.to_string())?;
        let needs_new = guard.as_ref().map(|(_, v, _)| v != &voice).unwrap_or(true);
        if needs_new {
            if let Some((_, _, cancel)) = guard.take() {
                cancel.cancel();
            }
            let cancel = CancellationToken::new();
            let session_cfg = SessionConfig { tts_voice: voice.clone(), ..Default::default() };
            let router = SpeakerRouter::spawn_with_audio_and_engine(session_cfg, engine.clone(), cancel.clone());
            *guard = Some((router.clone(), voice, cancel));
            router
        } else {
            guard.as_ref().unwrap().0.clone()
        }
    };

    router.speak_system(text).await.map_err(|e| e.to_string())
}

/// 预览用 TTS 引擎解析（与 monitor 中的 resolve_tts_engine 逻辑一致）
fn resolve_tts_engine_for_preview(config: &AppConfig) -> streamix_voice::TtsEngine {
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
                config.tts_voice.clone()
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
            region: if provider.model.is_empty() { "eastasia".to_string() } else { provider.model.clone() },
        }
    } else {
        streamix_voice::TtsEngine::Edge
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn open_config_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = std::env::current_dir()
        .map(|p| p.join("etc"))
        .unwrap_or_else(|_| std::path::PathBuf::from("etc"));
    app.opener().open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn check_update_cmd(
    state: tauri::State<'_, SharedState>,
) -> Result<Option<api::UpdateInfo>, String> {
    let current = env!("CARGO_PKG_VERSION");
    state.http.check_update(current).await.map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
async fn perform_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;

    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    let Some(update) = update else {
        return Err("already_latest".to_string());
    };

    let app_handle = app.clone();
    let mut downloaded: u64 = 0;

    // 1. Download
    let installer = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = tauri::Emitter::emit(
                    &app_handle,
                    "update-download-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    // 2. Prompt user with changelog
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    
    let changelog = update.body.as_deref().unwrap_or("无更新日志");
    let message = format!("新版本 v{} 已下载完成。\n\n【更新日志】\n{}\n\n是否现在安装并重启？", update.version, changelog);

    app.dialog()
        .message(message)
        .title("软件更新")
        .kind(tauri_plugin_dialog::MessageDialogKind::Info)
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
            "现在安装".to_string(),
            "下次再说".to_string(),
        ))
        .show(move |result| {
            let _ = tx.send(result);
        });

    if rx.await.unwrap_or(false) {
        // 3. Install
        update.install(installer).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    perform_update(app).await
}

#[cfg(feature = "tauri")]
async fn update_check_loop(app: AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    use tauri_plugin_updater::UpdaterExt;
    
    // Initial delay to let the app start up fully
    tokio::time::sleep(std::time::Duration::from_secs(20)).await;

    loop {
        let config = AppConfig::load_or_default().unwrap_or_default();
        
        match app.updater() {
            Ok(u) => {
                if let Ok(Some(update)) = u.check().await {
                    if config.auto_update {
                        println!("[Updater] Found update v{}, starting auto update...", update.version);
                        // Download in background
                        let _ = perform_update(app.clone()).await;
                    } else {
                        // Check if we notified today
                        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                        let last_notified = std::fs::read_to_string("etc/last_update_notified.txt").unwrap_or_default();
                        
                        if last_notified != today {
                            println!("[Updater] Found update v{}, sending daily notification...", update.version);
                            let _ = app.notification()
                                .builder()
                                .title("Streamix 更新提醒")
                                .body(format!("发现新版本 v{}，点击前往设置更新", update.version))
                                .show();
                            let _ = std::fs::write("etc/last_update_notified.txt", today);
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[Updater] Failed to get updater: {}", e);
            }
        }

        // Check every 6 hours
        tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
    }
}

async fn db_cleanup_loop(storage: Arc<storage::Storage>) {
    // 启动后稍等 30 秒，避开初始化高峰
    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
    loop {
        println!("[Storage] Running daily database cleanup...");
        match storage.cleanup_old_records(30) {
            Ok(count) => {
                if count > 0 {
                    println!("[Storage] Cleaned up {} old records (older than 30 days)", count);
                }
            }
            Err(e) => {
                eprintln!("[Storage] Database cleanup failed: {}", e);
            }
        }
        // Run once every 24 hours
        tokio::time::sleep(std::time::Duration::from_secs(24 * 3600)).await;
    }
}

/// Returns true if the current machine's public IP is in China.
/// Uses https://myip.ipip.net/json; falls back to false on error.
#[cfg(feature = "tauri")]
async fn detect_china_ip() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    match client.get("https://myip.ipip.net/json").send().await {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                json.pointer("/data/location/0")
                    .and_then(|v| v.as_str())
                    .map(|loc| loc == "中国")
                    .unwrap_or(false)
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

#[cfg(feature = "tauri")]
fn model_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default().join("cache"))
        .join("models")
}

#[cfg(feature = "tauri")]
fn emit_mdl(app: &AppHandle, model_id: &str, stage: &str, pct: u32, downloaded_mb: Option<f64>, total_mb: Option<f64>) {
    let mut payload = serde_json::json!({ "model_id": model_id, "stage": stage, "pct": pct });
    if let Some(d) = downloaded_mb { payload["downloaded_mb"] = format!("{:.1}", d).into(); }
    if let Some(t) = total_mb { payload["total_mb"] = format!("{:.1}", t).into(); }
    let _ = app.emit("model-dl-progress", payload);
}

#[cfg(feature = "tauri")]
async fn stream_to_file(
    app: &AppHandle,
    model_id: &str,
    mut resp: reqwest::Response,
    path: &std::path::Path,
    cancel: &CancellationToken,
    overall: &mut u64,
    total: u64,
) -> Result<u64, String> {
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(path).await.map_err(|e| format!("创建文件失败: {e}"))?;
    let mut written: u64 = 0;
    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                drop(file);
                let _ = tokio::fs::remove_file(path).await;
                emit_mdl(app, model_id, "cancelled", 0, None, None);
                return Err("已取消下载".to_string());
            }
            chunk_result = resp.chunk() => {
                match chunk_result {
                    Err(e) => return Err(format!("下载中断: {e}")),
                    Ok(None) => break,
                    Ok(Some(chunk)) => {
                        file.write_all(&chunk).await.map_err(|e| format!("写入失败: {e}"))?;
                        written += chunk.len() as u64;
                        *overall += chunk.len() as u64;
                        if total > 0 {
                            let pct = ((*overall as f64 / total as f64) * 100.0).min(99.0) as u32;
                            emit_mdl(app, model_id, "downloading", pct,
                                Some(*overall as f64 / 1_048_576.0),
                                Some(total as f64 / 1_048_576.0));
                        }
                    }
                }
            }
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(written)
}

#[cfg(feature = "tauri")]
#[tauri::command]
fn check_models(app: AppHandle) -> Result<serde_json::Value, String> {
    let base = model_dir(&app);
    let _ = std::fs::create_dir_all(&base);

    let vad_ok = base.join("silero_vad.onnx").exists();
    let sv_dir = base.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");
    let sensevoice_ok = sv_dir.join("model.int8.onnx").exists() && sv_dir.join("tokens.txt").exists();
    let pf_dir = base.join("sherpa-onnx-paraformer-zh-2023-09-14");
    let paraformer_ok = pf_dir.join("model.int8.onnx").exists() || pf_dir.join("model.onnx").exists();
    let wd = base.join("whisper");
    let kokoro_dir = base.join("kokoro");
    let kokoro_ok = kokoro_dir.join("kokoro-v1.0.int8.onnx").exists() || kokoro_dir.join("kokoro-v1.0.onnx").exists();

    Ok(serde_json::json!({
        "model_dir": base.to_string_lossy(),
        "models": {
            "silero-vad": vad_ok,
            "sensevoice": sensevoice_ok,
            "paraformer": paraformer_ok,
            "whisper-tiny": wd.join("ggml-tiny.bin").exists(),
            "whisper-small": wd.join("ggml-small.bin").exists(),
            "whisper-medium": wd.join("ggml-medium.bin").exists(),
            "kokoro": kokoro_ok,
        }
    }))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn delete_model(app: AppHandle, model_id: String) -> Result<String, String> {
    let base = model_dir(&app);
    match model_id.as_str() {
        "silero-vad" => {
            let p = base.join("silero_vad.onnx");
            if p.exists() { std::fs::remove_file(p).map_err(|e| e.to_string())?; }
            Ok("VAD 模型已删除".to_string())
        }
        "sensevoice" => {
            let d = base.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");
            if d.exists() { std::fs::remove_dir_all(d).map_err(|e| e.to_string())?; }
            let tmp = base.join("_sensevoice_dl.tar.bz2");
            if tmp.exists() { let _ = std::fs::remove_file(tmp); }
            Ok("SenseVoice 模型已删除".to_string())
        }
        "paraformer" => {
            let d = base.join("sherpa-onnx-paraformer-zh-2023-09-14");
            if d.exists() { std::fs::remove_dir_all(d).map_err(|e| e.to_string())?; }
            let tmp = base.join("_paraformer_dl.tar.bz2");
            if tmp.exists() { let _ = std::fs::remove_file(tmp); }
            Ok("Paraformer 模型已删除".to_string())
        }
        "whisper-tiny" | "whisper-small" | "whisper-medium" => {
            let size = model_id.strip_prefix("whisper-").unwrap();
            let p = base.join("whisper").join(format!("ggml-{}.bin", size));
            if p.exists() { std::fs::remove_file(p).map_err(|e| e.to_string())?; }
            Ok(format!("Whisper {} 模型已删除", size))
        }
        "kokoro" => {
            let d = base.join("kokoro");
            if d.exists() { std::fs::remove_dir_all(d).map_err(|e| e.to_string())?; }
            Ok("Kokoro TTS 模型已删除".to_string())
        }
        _ => Err(format!("未知模型: {}", model_id)),
    }
}

// ---- private download helpers ----

#[cfg(feature = "tauri")]
async fn dl_silero_vad(app: AppHandle, cancel: CancellationToken) -> Result<String, String> {
    let mid = "silero-vad";
    let base = model_dir(&app);
    let out = base.join("silero_vad.onnx");
    if out.exists() { return Ok("VAD 模型已存在".to_string()); }

    let use_mirror = detect_china_ip().await;
    let url = if use_mirror {
        "https://mirror.ghproxy.com/https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
    } else {
        "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
    };

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(120)).build().map_err(|e| e.to_string())?;
    emit_mdl(&app, mid, "downloading", 0, None, None);

    let resp = client.get(url).send().await.map_err(|e| format!("下载失败: {e}"))?;
    if !resp.status().is_success() { return Err(format!("下载失败: HTTP {}", resp.status())); }
    let total = resp.content_length().unwrap_or(0);

    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let mut overall = 0u64;
    stream_to_file(&app, mid, resp, &out, &cancel, &mut overall, total).await?;

    if out.exists() { emit_mdl(&app, mid, "done", 100, None, None); Ok("VAD 模型下载完成".to_string()) }
    else { Err("下载后未找到模型文件".to_string()) }
}

#[cfg(feature = "tauri")]
async fn dl_sensevoice(app: AppHandle, cancel: CancellationToken) -> Result<String, String> {
    let mid = "sensevoice";
    let base = model_dir(&app);
    let filename = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2";
    let target_dir = base.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");

    let use_mirror = detect_china_ip().await;
    let direct_url = format!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{}", filename);
    let mirror_url = format!("https://mirror.ghproxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{}", filename);
    let primary_url = if use_mirror { &mirror_url } else { &direct_url };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build().map_err(|e| e.to_string())?;

    let tmp = base.join("_sensevoice_dl.tar.bz2");

    emit_mdl(&app, mid, "downloading", 0, None, None);

    let mut success = false;
    let mut last_err = String::new();

    for attempt in 1..=3u32 {
        if attempt > 1 { tokio::time::sleep(std::time::Duration::from_secs(5)).await; }

        let downloaded_bytes = if tmp.exists() { std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0) } else { 0 };
        let fallback_url = if use_mirror { &direct_url } else { &mirror_url };
        let request = if downloaded_bytes > 0 {
            client.get(primary_url.as_str()).header(reqwest::header::RANGE, format!("bytes={}-", downloaded_bytes))
        } else { client.get(primary_url.as_str()) };

        let mut resp = match request.send().await {
            Ok(r) if r.status().is_success() || r.status() == reqwest::StatusCode::PARTIAL_CONTENT => r,
            Ok(_) => match client.get(fallback_url.as_str()).send().await {
                Ok(gr) if gr.status().is_success() => gr,
                Ok(gr) => { last_err = format!("HTTP {}", gr.status()); continue; }
                Err(e) => { last_err = e.to_string(); continue; }
            },
            Err(e) => { last_err = e.to_string(); continue; }
        };

        let is_partial = resp.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        let total = if is_partial { resp.content_length().unwrap_or(0) + downloaded_bytes } else { resp.content_length().unwrap_or(0) };
        let mut current = if is_partial { downloaded_bytes } else { 0 };

        std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;

        use tokio::io::AsyncWriteExt;
        let mut file = if is_partial && tmp.exists() {
            tokio::fs::OpenOptions::new().append(true).open(&tmp).await.map_err(|e| e.to_string())?
        } else { tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())? };

        let mut stream_ok = true;
        'stream: loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    drop(file);
                    let _ = tokio::fs::remove_file(&tmp).await;
                    emit_mdl(&app, mid, "cancelled", 0, None, None);
                    return Err("已取消下载".to_string());
                }
                chunk_result = resp.chunk() => {
                    match chunk_result {
                        Err(e) => { stream_ok = false; last_err = e.to_string(); break 'stream; }
                        Ok(None) => break 'stream,
                        Ok(Some(c)) => {
                            if let Err(e) = file.write_all(&c).await { stream_ok = false; last_err = e.to_string(); break 'stream; }
                            current += c.len() as u64;
                            if total > 0 {
                                let pct = ((current as f64 / total as f64) * 100.0) as u32;
                                emit_mdl(&app, mid, "downloading", pct,
                                    Some(current as f64 / 1_048_576.0), Some(total as f64 / 1_048_576.0));
                            }
                        }
                    }
                }
            }
        }
        if stream_ok { file.flush().await.map_err(|e| e.to_string())?; success = true; break; }
    }

    if !success { return Err(format!("下载多次失败: {}", last_err)); }

    emit_mdl(&app, mid, "extracting", 100, None, None);
    let out = std::process::Command::new("tar").arg("xf").arg(&tmp).arg("-C").arg(&base)
        .output().map_err(|e| format!("解压失败: {e}"))?;
    if !out.status.success() { return Err(format!("解压失败: {}", String::from_utf8_lossy(&out.stderr))); }
    let _ = std::fs::remove_file(&tmp);

    if target_dir.join("model.int8.onnx").exists() {
        emit_mdl(&app, mid, "done", 100, None, None);
        Ok("SenseVoice 模型已准备就绪".to_string())
    } else { Err("模型文件校验失败".to_string()) }
}

#[cfg(feature = "tauri")]
async fn dl_paraformer(app: AppHandle, cancel: CancellationToken) -> Result<String, String> {
    let mid = "paraformer";
    let base = model_dir(&app);
    let filename = "sherpa-onnx-paraformer-zh-2023-09-14.tar.bz2";
    let target_dir = base.join("sherpa-onnx-paraformer-zh-2023-09-14");
    let tmp = base.join("_paraformer_dl.tar.bz2");

    let use_mirror = detect_china_ip().await;
    let direct = format!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{}", filename);
    let mirror = format!("https://mirror.ghproxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{}", filename);
    let url = if use_mirror { &mirror } else { &direct };

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(1800)).build().map_err(|e| e.to_string())?;
    emit_mdl(&app, mid, "downloading", 0, None, None);

    let resp = client.get(url.as_str()).send().await.map_err(|e| format!("下载失败: {e}"))?;
    if !resp.status().is_success() { return Err(format!("下载失败: HTTP {}", resp.status())); }
    let total = resp.content_length().unwrap_or(0);

    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let mut overall = 0u64;
    stream_to_file(&app, mid, resp, &tmp, &cancel, &mut overall, total).await?;

    emit_mdl(&app, mid, "extracting", 100, None, None);
    let out = std::process::Command::new("tar").arg("xf").arg(&tmp).arg("-C").arg(&base)
        .output().map_err(|e| format!("解压失败: {e}"))?;
    let _ = std::fs::remove_file(&tmp);
    if !out.status.success() { return Err(format!("解压失败: {}", String::from_utf8_lossy(&out.stderr))); }

    if target_dir.join("model.int8.onnx").exists() || target_dir.join("model.onnx").exists() {
        emit_mdl(&app, mid, "done", 100, None, None);
        Ok("Paraformer 模型已准备就绪".to_string())
    } else { Err("模型文件校验失败".to_string()) }
}

#[cfg(feature = "tauri")]
async fn dl_whisper(app: AppHandle, cancel: CancellationToken, size: &str) -> Result<String, String> {
    let mid = format!("whisper-{}", size);
    let base = model_dir(&app);
    let wd = base.join("whisper");
    let out = wd.join(format!("ggml-{}.bin", size));
    if out.exists() { return Ok(format!("Whisper {} 模型已存在", size)); }

    let use_mirror = detect_china_ip().await;
    let hf_base = if use_mirror { "https://hf-mirror.com" } else { "https://huggingface.co" };
    let url = format!("{}/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin", hf_base, size);

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(3600)).build().map_err(|e| e.to_string())?;
    emit_mdl(&app, &mid, "downloading", 0, None, None);

    let resp = client.get(&url).send().await.map_err(|e| format!("下载失败: {e}"))?;
    if !resp.status().is_success() { return Err(format!("下载失败: HTTP {}", resp.status())); }
    let total = resp.content_length().unwrap_or(0);

    std::fs::create_dir_all(&wd).map_err(|e| e.to_string())?;
    let mut overall = 0u64;
    stream_to_file(&app, &mid, resp, &out, &cancel, &mut overall, total).await?;

    if out.exists() { emit_mdl(&app, &mid, "done", 100, None, None); Ok(format!("Whisper {} 模型下载完成", size)) }
    else { Err("下载后未找到模型文件".to_string()) }
}

#[cfg(feature = "tauri")]
async fn dl_kokoro(app: AppHandle, cancel: CancellationToken) -> Result<String, String> {
    let mid = "kokoro";
    let base = model_dir(&app);
    let kd = base.join("kokoro");
    let model_file = kd.join("kokoro-v1.0.int8.onnx");
    if model_file.exists() { return Ok("Kokoro 模型已存在".to_string()); }

    let use_mirror = detect_china_ip().await;
    let hf_base = if use_mirror { "https://hf-mirror.com" } else { "https://huggingface.co" };
    // onnx-community mirror is public (no auth required); model is at onnx/model_quantized.onnx
    let hf_id = "onnx-community/Kokoro-82M-v1.0-ONNX";

    std::fs::create_dir_all(&kd).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(kd.join("voices")).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(600)).build().map_err(|e| e.to_string())?;

    let model_remote = "onnx/model_quantized.onnx";
    let total_size: u64 = client.head(&format!("{}/{}/resolve/main/{}", hf_base, hf_id, model_remote))
        .send().await.ok()
        .and_then(|r| if r.status().is_success() {
            r.headers().get(reqwest::header::CONTENT_LENGTH)?.to_str().ok()?.parse().ok()
        } else { None })
        .unwrap_or(92_000_000);

    emit_mdl(&app, mid, "downloading", 0, None, None);

    let model_url = format!("{}/{}/resolve/main/{}", hf_base, hf_id, model_remote);
    let resp = match client.get(&model_url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => return Err(format!("主模型下载失败: HTTP {}", r.status())),
        Err(e) => return Err(format!("网络错误: {e}")),
    };

    let mut overall = 0u64;
    stream_to_file(&app, mid, resp, &model_file, &cancel, &mut overall, total_size).await
        .map_err(|e| { std::fs::remove_dir_all(&kd).ok(); e })?;

    // Optional files: config, tokenizer, Chinese voices
    let optional: &[(&str, &str)] = &[
        ("config.json", "config.json"),
        ("tokenizer.json", "tokenizer.json"),
        ("voices/zf_xiaoxiao.bin", "voices/zf_xiaoxiao.bin"),
        ("voices/zm_yunxi.bin", "voices/zm_yunxi.bin"),
    ];
    for (remote, local) in optional {
        if cancel.is_cancelled() {
            std::fs::remove_dir_all(&kd).ok();
            emit_mdl(&app, mid, "cancelled", 0, None, None);
            return Err("已取消下载".to_string());
        }
        let url = format!("{}/{}/resolve/main/{}", hf_base, hf_id, remote);
        let out = kd.join(local);
        match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => {
                match stream_to_file(&app, mid, r, &out, &cancel, &mut overall, total_size).await {
                    Err(e) if e.contains("已取消") => { std::fs::remove_dir_all(&kd).ok(); return Err(e); }
                    _ => {}
                }
            }
            Ok(r) => println!("[Kokoro] skip {} ({})", remote, r.status()),
            Err(e) => println!("[Kokoro] skip {} ({})", remote, e),
        }
    }

    emit_mdl(&app, mid, "done", 100, None, None);
    Ok("Kokoro TTS 模型下载完成".to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn download_model(app: AppHandle, state: tauri::State<'_, SharedState>, model_id: String) -> Result<String, String> {
    let cancel = CancellationToken::new();
    state.model_dl_cancels.lock().unwrap().insert(model_id.clone(), cancel.clone());

    let result = match model_id.as_str() {
        "silero-vad"   => dl_silero_vad(app, cancel).await,
        "sensevoice"   => dl_sensevoice(app, cancel).await,
        "paraformer"   => dl_paraformer(app, cancel).await,
        "whisper-tiny"   => dl_whisper(app, cancel, "tiny").await,
        "whisper-small"  => dl_whisper(app, cancel, "small").await,
        "whisper-medium" => dl_whisper(app, cancel, "medium").await,
        "kokoro"       => dl_kokoro(app, cancel).await,
        _ => Err(format!("未知模型: {}", model_id)),
    };

    state.model_dl_cancels.lock().unwrap().remove(&model_id);
    result
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn cancel_model_download(model_id: String, state: tauri::State<'_, SharedState>) -> Result<(), String> {
    if let Some(cancel) = state.model_dl_cancels.lock().unwrap().remove(&model_id) {
        cancel.cancel();
    }
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
fn main() -> Result<()> {
    println!("Starting Streamix backend...");
    ensure_dirs()?;

    println!("Loading configuration...");
    let _config = AppConfig::load_or_default()?;
    let storage_path = crate::config::db_path();
    println!("Opening storage at {}...", storage_path.display());
    let storage = storage::Storage::open(&storage_path.to_string_lossy())?;

    let saved_room = token::read_connected_room();

    let state = SharedState {
        runtime: Arc::new(Runtime::new()?),
        http: api::BiliApi::new()?,
        monitor: Arc::new(Mutex::new(None)),
        storage: Arc::new(storage),
        connected_room: Arc::new(Mutex::new(saved_room)),
        monitor_log_buffer: Arc::new(Mutex::new(Vec::new())),
        #[cfg(feature = "tauri")]
        preview_tts: Arc::new(Mutex::new(None)),
        #[cfg(feature = "tauri")]
        model_dl_cancels: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_memory: Arc::new(Mutex::new(bot::memory::SessionMemory::new())),
        agent_runtime: Arc::new(bot::agent::AgentRuntime::new()),
        #[cfg(feature = "tauri")]
        voice_changer: Arc::new(Mutex::new(None)),
    };

    println!("Starting Tauri builder...");
    let storage_for_cleanup = state.storage.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(move |app| {
            let handle_for_update = app.handle().clone();
            tauri::async_runtime::spawn(update_check_loop(handle_for_update));

            tauri::async_runtime::spawn(db_cleanup_loop(storage_for_cleanup));
            Ok(())
        })


        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            get_user_info,
            start_login,
            poll_login,
            check_room,
            get_room_by_uid,
            logout,
            get_system_info,
            start_monitor,
            stop_monitor,
            get_monitor_status,
            get_stats,
            get_gift_stats,
            get_user_gift_stats,
            get_blind_box_stats,
            get_daily_stats,
            get_tracked_users,
            check_tracked_user,
            add_tracked_user,
            restore_tracked_user,
            update_tracked_user,
            soft_delete_tracked_user,
            get_pk_summary,
            get_pk_history,
            send_danmu,
            query_user_detail,
            send_ai_message,
            open_url,
            open_config_dir,
            check_update_cmd,
            install_update,
            proxy_image,
            get_anchor_info,
            set_connected_room,
            get_connected_room,
            get_monitor_logs,
            speak_text_cmd,
            get_recent_danmaku,
            get_voice_changer_status,
            start_voice_changer,
            stop_voice_changer,
            search_rvc_models,
            check_models,
            download_model,
            cancel_model_download,
            delete_model,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}

#[cfg(not(feature = "tauri"))]
fn main() -> Result<()> {
    println!("Please enable 'tauri' feature to run the desktop application.");
    Ok(())
}

fn ensure_dirs() -> Result<()> {
    let _ = std::fs::create_dir_all("etc");
    let _ = std::fs::create_dir_all("token");
    let _ = std::fs::create_dir_all("logs");
    let _ = std::fs::create_dir_all("db");
    Ok(())
}
