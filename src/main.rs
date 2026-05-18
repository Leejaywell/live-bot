mod api;
mod bot;
mod config;
mod music;
mod obs;
mod overlay_config;
mod overlay_server;
mod plugin_settings;
mod storage;
mod token;

use anyhow::Result;
use chrono::Local;
use config::AppConfig;
#[cfg(feature = "tauri")]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::runtime::Runtime;
use tokio_util::sync::CancellationToken;

#[cfg(feature = "tauri")]
use tauri::{AppHandle, Emitter, Manager};

#[cfg(feature = "tauri")]
const MENU_FORCE_QUIT_ID: &str = "force_quit";
#[cfg(feature = "tauri")]
const MENU_CLOSE_MAIN_ID: &str = "close_main";
#[cfg(feature = "tauri")]
static MAIN_CLOSE_PROMPT_OPEN: AtomicBool = AtomicBool::new(false);

#[cfg(feature = "tauri")]
const GIFT_CATALOG_MAX_AGE_SECS: i64 = 60 * 60;
#[cfg(feature = "tauri")]
const FALLBACK_GUARD_ICON: &str =
    "https://i0.hdslb.com/bfs/live/f1be2a2d5b227ce72641de1ad64bcc7f9e4111c3.png";

#[derive(Clone)]
struct SharedState {
    #[allow(dead_code)]
    runtime: Arc<Runtime>,
    http: api::BiliApi,
    monitor: Arc<Mutex<Option<MonitorHandle>>>,
    storage: Arc<storage::Storage>,
    connected_room: Arc<Mutex<Option<i64>>>,
    monitor_log_buffer: Arc<Mutex<Vec<String>>>,
    /// 预览 TTS（AI页播放按钮）：(router, 当前声音, 当前 provider, cancel)
    #[cfg(feature = "tauri")]
    preview_tts: Arc<
        Mutex<
            Option<(
                streamix_voice::SpeakerRouter,
                String,
                String,
                CancellationToken,
            )>,
        >,
    >,
    #[cfg(feature = "tauri")]
    preview_tts_playback: Arc<tokio::sync::Mutex<()>>,
    #[cfg(feature = "tauri")]
    model_dl_cancels: Arc<Mutex<std::collections::HashMap<String, CancellationToken>>>,
    /// 全局 AI 会话记忆（机器人 ID 隔离）
    session_memory: Arc<Mutex<bot::memory::SessionMemory>>,
    /// 弹幕浮层 HTTP 服务广播通道
    overlay_tx: overlay_server::OverlayTx,
    /// 基础 AI Agent 运行时
    agent_runtime: Arc<bot::agent::AgentRuntime>,
    /// 实时变声器状态
    #[cfg(feature = "tauri")]
    voice_changer: Arc<Mutex<Option<streamix_voice::VoiceChanger>>>,
}

struct MonitorHandle {
    cancel: CancellationToken,
    session_id: Arc<Mutex<Option<String>>>,
    danmaku_buffer: Arc<Mutex<Vec<String>>>,
}

#[cfg(feature = "tauri")]
#[derive(Clone, Copy)]
struct RvcCatalogItem {
    id: &'static str,
    name: &'static str,
    author: &'static str,
    description: &'static str,
    tags: &'static [&'static str],
    size: &'static str,
    repo: &'static str,
    path: &'static str,
    avatar: &'static str,
}

#[cfg(feature = "tauri")]
struct BufferedEmitter {
    handle: AppHandle,
    log_buffer: Arc<Mutex<Vec<String>>>,
    batch_tx: tokio::sync::mpsc::UnboundedSender<String>,
    overlay_tx: overlay_server::OverlayTx,
    storage: Arc<storage::Storage>,
}

#[cfg(feature = "tauri")]
impl bot::EventEmitter for BufferedEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) -> anyhow::Result<()> {
        if event == "monitor-log" {
            if let Some(text) = payload.as_str() {
                // Update internal buffer for polling
                if let Ok(mut buf) = self.log_buffer.lock() {
                    buf.push(text.to_string());
                    if buf.len() > 200 {
                        buf.remove(0);
                    }
                }
                // Queue for batched IPC emission
                let _ = self.batch_tx.send(text.to_string());
                // Fallthrough to emit singular event (needed for notifications in App.tsx)
            }
        } else if event == "live-event" {
            if let Ok(mut settings) = plugin_settings::PluginSettings::load_or_default() {
                let live_event = payload.get("event").unwrap_or(&payload);
                let wish_changed = settings.apply_wish_goal_event(live_event);
                let lottery_changed = settings.apply_lottery_event(live_event);
                let gift_effect_changed = settings.apply_gift_effect_event(live_event);
                let recent_gifts_changed = settings.apply_recent_gifts_event(live_event);
                let gift_rank_changed = settings.apply_gift_rank_event(live_event);
                let changed = wish_changed
                    || lottery_changed
                    || gift_effect_changed
                    || recent_gifts_changed
                    || gift_rank_changed;
                if changed && settings.save().is_ok() {
                    overlay_server::broadcast_plugin_settings_update(&self.overlay_tx);
                }
            }
            cache_guard_gift_from_event(&self.storage, &payload);
            // 同步推送到 HTTP 弹幕浮层 WebSocket 客户端
            let _ = self.overlay_tx.send(payload.clone());
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
            let session = token::Session {
                cookie,
                refresh_token,
            };
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
        Ok(api::LoginPoll::Expired(msg)) => {
            Ok(serde_json::json!({ "status": "Expired",   "message": msg }))
        }
        Ok(api::LoginPoll::Pending(msg)) => {
            Ok(serde_json::json!({ "status": "Scanning",  "message": msg }))
        }
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
    // ── VAD (silero_vad.onnx，缺失或损坏时自动下载) ──────────────────────────
    let vad_out = model_dir.join("silero_vad.onnx");
    let vad_exists = vad_out.exists();
    let vad_valid = onnx_file_valid(&vad_out);
    let vad_size = std::fs::metadata(&vad_out).map(|m| m.len()).unwrap_or(0);
    let _ = app.emit(
        "monitor-log",
        serde_json::json!(format!(
            "[诊断] VAD 模型路径: {} | 存在: {} | 有效: {} | 大小: {} bytes",
            vad_out.display(),
            vad_exists,
            vad_valid,
            vad_size
        )),
    );
    if !vad_valid && !cancel.is_cancelled() {
        let _ = app.emit(
            "monitor-log",
            serde_json::json!("正在自动下载 VAD 模型（silero_vad.onnx）…"),
        );
        match dl_silero_vad(app.clone(), cancel.clone()).await {
            Ok(msg) => {
                let _ = app.emit("monitor-log", serde_json::json!(msg));
            }
            Err(e) => {
                let _ = app.emit(
                    "monitor-log",
                    serde_json::json!(format!("VAD 模型下载失败: {e}")),
                );
            }
        }
    }

    // ── SenseVoice ASR（仅当无外部 ASR URL 时使用本地模型）───────────────────
    #[cfg(feature = "vad")]
    {
        let asr_url = crate::bot::monitor::resolve_asr_url(config);
        let sv_dir = model_dir.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");
        if asr_url.is_empty() && !sv_dir.join("model.int8.onnx").exists() && !cancel.is_cancelled()
        {
            let _ = app.emit(
                "monitor-log",
                serde_json::json!("正在自动下载 SenseVoice 模型（约 300 MB）…"),
            );
            match dl_sensevoice(app.clone(), cancel.clone()).await {
                Ok(_) => {
                    let _ = app.emit("monitor-log", serde_json::json!("SenseVoice 模型就绪"));
                }
                Err(e) => {
                    let _ = app.emit(
                        "monitor-log",
                        serde_json::json!(format!("SenseVoice 下载失败: {e}")),
                    );
                }
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
            AppConfig::load_or_default()
                .ok()
                .map(|c| c.room_id)
                .unwrap_or(0)
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
        overlay_tx: state.overlay_tx.clone(),
        storage: state.storage.clone(),
    };

    let models = model_dir(&app);
    #[cfg(feature = "model-hub")]
    let auto_dl_app = app.clone();
    #[cfg(feature = "model-hub")]
    let auto_dl_cancel = cancel.clone();

    let session_memory = state.session_memory.clone();
    let error_app = app.clone();

    let _ = app.emit(
        "monitor-log",
        serde_json::json!("[start_monitor] 指令已收到，正在启动监听任务..."),
    );

    tokio::spawn(async move {
        // 自动补全缺失模型后再启动引擎
        #[cfg(feature = "model-hub")]
        if let Ok(cfg) = AppConfig::load_or_default() {
            auto_download_models(&auto_dl_app, &models, &cfg, auto_dl_cancel).await;
        }

        if let Err(e) = crate::bot::monitor::run_monitor_loop(
            emitter,
            http,
            room_id,
            cancel,
            session_id,
            danmaku_buf,
            models,
            session_memory,
        )
        .await
        {
            let _ = error_app.emit(
                "monitor-log",
                serde_json::json!(format!("监听启动失败: {e}")),
            );
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
    state
        .storage
        .user_gift_top_n(days, n)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_blind_box_stats(
    state: tauri::State<'_, SharedState>,
    days: i64,
) -> Result<Vec<(String, i64)>, String> {
    state
        .storage
        .get_blind_box_stats(days)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_daily_stats(
    state: tauri::State<'_, SharedState>,
    days: i64,
) -> Result<Vec<storage::DailyStats>, String> {
    state
        .storage
        .daily_interaction_counts(days)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_tracked_users(
    state: tauri::State<'_, SharedState>,
    limit: i64,
) -> Result<Vec<storage::KnownUser>, String> {
    state
        .storage
        .get_tracked_users(limit)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn check_tracked_user(
    state: tauri::State<'_, SharedState>,
    uid: i64,
) -> Result<Option<storage::CheckUserResult>, String> {
    state
        .storage
        .check_tracked_user(uid)
        .map_err(|e| e.to_string())
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
    state
        .storage
        .add_tracked_user(uid, &nickname, &alias, &notes)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn restore_tracked_user(
    state: tauri::State<'_, SharedState>,
    uid: i64,
    alias: String,
    notes: String,
) -> Result<(), String> {
    state
        .storage
        .restore_tracked_user(uid, &alias, &notes)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn update_tracked_user(
    state: tauri::State<'_, SharedState>,
    uid: i64,
    alias: String,
    notes: String,
) -> Result<(), String> {
    state
        .storage
        .update_tracked_user(uid, &alias, &notes)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn soft_delete_tracked_user(
    state: tauri::State<'_, SharedState>,
    uid: i64,
) -> Result<(), String> {
    state
        .storage
        .soft_delete_tracked_user(uid)
        .map_err(|e| e.to_string())
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
            None => {
                AppConfig::load_or_default()
                    .map_err(|e| e.to_string())?
                    .room_id
            }
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

// ── 直播管理 (My Live Control) ─────────────────────────────────────────
// 用当前连接的 room_id；如未连接则用 config.room_id。所有命令均需登录后的 cookie。

#[cfg(feature = "tauri")]
fn current_my_room_id(state: &tauri::State<'_, SharedState>) -> Result<i64, String> {
    let room = state.connected_room.lock().map_err(|e| e.to_string())?;
    let room_id = match *room {
        Some(id) => id,
        None => {
            AppConfig::load_or_default()
                .map_err(|e| e.to_string())?
                .room_id
        }
    };
    if room_id == 0 {
        return Err("未连接直播间".to_string());
    }
    Ok(room_id)
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn start_live_cmd(
    state: tauri::State<'_, SharedState>,
    area_v2: i64,
) -> Result<api::StartLiveData, String> {
    let room_id = current_my_room_id(&state)?;
    let session = token::read_session().map_err(|e| e.to_string())?;
    state
        .http
        .start_live(room_id, area_v2, &session.cookie)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn stop_live_cmd(state: tauri::State<'_, SharedState>) -> Result<(), String> {
    let room_id = current_my_room_id(&state)?;
    let session = token::read_session().map_err(|e| e.to_string())?;
    state
        .http
        .stop_live(room_id, &session.cookie)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn update_room_info_cmd(
    state: tauri::State<'_, SharedState>,
    title: Option<String>,
    area_id: Option<i64>,
    description: Option<String>,
) -> Result<(), String> {
    let room_id = current_my_room_id(&state)?;
    let session = token::read_session().map_err(|e| e.to_string())?;
    state
        .http
        .update_room_info(
            room_id,
            title.as_deref(),
            area_id,
            description.as_deref(),
            &session.cookie,
        )
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_live_areas(
    state: tauri::State<'_, SharedState>,
) -> Result<Vec<api::AreaCategory>, String> {
    state
        .http
        .get_web_area_list()
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_stream_addr(state: tauri::State<'_, SharedState>) -> Result<api::StreamAddr, String> {
    let session = token::read_session().map_err(|e| e.to_string())?;
    state
        .http
        .fetch_stream_addr(&session.cookie)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn update_room_news_cmd(
    state: tauri::State<'_, SharedState>,
    content: String,
) -> Result<(), String> {
    let room_id = current_my_room_id(&state)?;
    let session = token::read_session().map_err(|e| e.to_string())?;
    // 公告接口需要主播 uid。从 session 的 cookie 里取 DedeUserID。
    let uid = api_extract_cookie(&session.cookie, "DedeUserID")
        .and_then(|s| s.parse::<i64>().ok())
        .ok_or_else(|| "未能从 cookie 解析 DedeUserID".to_string())?;
    state
        .http
        .update_room_news(room_id, uid, &content, &session.cookie)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
fn api_extract_cookie(cookie: &str, name: &str) -> Option<String> {
    cookie.split(';').find_map(|s| {
        let s = s.trim();
        let prefix = format!("{}=", name);
        s.strip_prefix(&prefix).map(|v| v.to_string())
    })
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_voice_changer_status(state: tauri::State<'_, SharedState>) -> Result<bool, String> {
    let vc = state.voice_changer.lock().unwrap();
    Ok(vc.as_ref().map(|v| v.status().running).unwrap_or(false))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_voice_changer_state(
    state: tauri::State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    let vc = state.voice_changer.lock().unwrap();
    if let Some(vc) = vc.as_ref() {
        serde_json::to_value(vc.status()).map_err(|e| e.to_string())
    } else {
        Ok(serde_json::json!({
            "running": false,
            "model_id": "",
            "input_gain": 1.0,
            "wet_mix": 1.0,
            "frame_ms": 80,
            "processed_frames": 0,
            "output_latency_ms": 0,
            "last_error": null,
        }))
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn start_voice_changer(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    model_id: String,
    input_gain: f32,
    wet_mix: f32,
    frame_ms: u32,
) -> Result<(), String> {
    println!(
        "[VoiceChanger] start requested model_id={model_id} input_gain={input_gain:.2} wet_mix={wet_mix:.2} frame_ms={frame_ms}"
    );
    if state
        .voice_changer
        .lock()
        .unwrap()
        .as_ref()
        .map(|vc| vc.status().running)
        .unwrap_or(false)
    {
        println!("[VoiceChanger] rejected: already running");
        return Err("变声器已在运行".to_string());
    }

    // 1. 获取模型路径
    let base = model_dir(&app).join("rvc");
    let model_dir_path = base.join(&model_id);
    println!(
        "[VoiceChanger] resolving model base={} dir={}",
        base.display(),
        model_dir_path.display()
    );
    let mut model_path = resolve_voice_changer_runtime_model_path(&base, &model_id);
    println!("[VoiceChanger] resolved model_path={model_path:?}");
    if model_path.is_none() && has_rvc_pth_model(&model_dir_path) {
        println!("[VoiceChanger] pth found, converting model_id={model_id}");
        let _ = app.emit(
            "monitor-log",
            serde_json::json!(format!(
                "检测到 PTH 模型，正在尝试自动转换为 ONNX: {}",
                model_id
            )),
        );
        if let Err(err) = convert_rvc_pth_to_onnx_inner(&app, &model_id) {
            println!("[VoiceChanger] convert failed: {err}");
            let _ = app.emit(
                "monitor-log",
                serde_json::json!(format!("变声器模型转换失败: {err}")),
            );
            return Err(err);
        }
        model_path = resolve_voice_changer_runtime_model_path(&base, &model_id);
        println!("[VoiceChanger] after convert model_path={model_path:?}");
    }
    let model_path = model_path.ok_or_else(|| {
        if has_rvc_pth_model(&model_dir_path) {
            "检测到 PTH 模型，但自动转换失败。请先安装 Python 3 与 PyTorch，或手动将 model.pth 转为 model.onnx 后重试。".to_string()
        } else {
            "模型文件不存在，请先下载".to_string()
        }
    })?;
    let hubert_path = base.join("hubert_base.onnx");
    println!(
        "[VoiceChanger] using model={} hubert={}",
        model_path.display(),
        hubert_path.display()
    );

    if !hubert_path.exists() {
        println!(
            "[VoiceChanger] missing hubert path={}",
            hubert_path.display()
        );
        let _ = app.emit(
            "monitor-log",
            serde_json::json!(format!("缺少 HuBERT 编码器: {}", hubert_path.display())),
        );
        return Err("缺少 HuBERT 编码器（hubert_base.onnx），请重新下载模型".to_string());
    }

    // 2. 初始化实时变声器
    let config = streamix_voice::VoiceChangerConfig {
        input_gain,
        wet_mix,
        frame_ms,
    };
    println!("[VoiceChanger] starting realtime engine");
    let vc = match streamix_voice::VoiceChanger::start(
        &model_id,
        &model_path.to_string_lossy(),
        &hubert_path.to_string_lossy(),
        config,
    ) {
        Ok(vc) => vc,
        Err(e) => {
            let msg = format!("启动变声器失败: {e}");
            println!("[VoiceChanger] start failed: {msg}");
            let _ = app.emit("monitor-log", serde_json::json!(msg));
            return Err(format!("启动变声器失败: {e}"));
        }
    };

    let mut vc_lock = state.voice_changer.lock().unwrap();
    *vc_lock = Some(vc);
    println!("[VoiceChanger] started model_id={model_id}");

    let _ = app.emit(
        "monitor-log",
        serde_json::json!(format!("AI 变声器已启动: {}", model_id)),
    );
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn switch_voice_changer_model(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
    model_id: String,
    input_gain: f32,
    wet_mix: f32,
    frame_ms: u32,
) -> Result<(), String> {
    {
        let mut vc = state.voice_changer.lock().unwrap();
        if let Some(current) = vc.as_ref() {
            current.stop();
        }
        *vc = None;
    }

    start_voice_changer(state, app, model_id, input_gain, wet_mix, frame_ms).await
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn stop_voice_changer(
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut vc = state.voice_changer.lock().unwrap();
    if let Some(current) = vc.as_ref() {
        current.stop();
    }
    *vc = None;
    let _ = app.emit("monitor-log", serde_json::json!("AI 变声器已关闭"));
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn search_rvc_models(app: AppHandle, query: String) -> Result<serde_json::Value, String> {
    let base = model_dir(&app).join("rvc");
    let all_models = rvc_catalog();
    let model_dirs: Vec<(String, std::path::PathBuf)> = std::fs::read_dir(&base)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter_map(|entry| {
            let path = entry.path();
            if path.is_dir() && has_voice_changer_model_asset(&path) {
                entry.file_name().to_str().map(|s| (s.to_string(), path))
            } else {
                None
            }
        })
        .collect();

    let installed_ids: std::collections::HashSet<String> =
        model_dirs.iter().map(|(id, _)| id.clone()).collect();
    let onnx_ready_ids: std::collections::HashSet<String> = model_dirs
        .iter()
        .filter(|(_, path)| is_voice_changer_model_onnx_ready(path))
        .map(|(id, _)| id.clone())
        .collect();

    let local_models = installed_ids
        .iter()
        .filter(|id| !all_models.iter().any(|m| m.id == id.as_str()))
        .map(|id| {
            let onnx_ready = onnx_ready_ids.contains(id.as_str());
            serde_json::json!({
                "id": id,
                "name": id,
                "author": "本地模型",
                "description": "从本地 rvc 目录扫描到的自定义 RVC 模型。",
                "tags": ["本地", "自定义"],
                "installed": true,
                "onnx_ready": onnx_ready,
                "size": "--"
            })
        })
        .collect::<Vec<_>>();

    let catalog_models = all_models.iter().map(|m| {
        let installed = installed_ids.contains(m.id);
        let onnx_ready = onnx_ready_ids.contains(m.id);
        serde_json::json!({
            "id": m.id,
            "name": m.name,
            "author": m.author,
            "description": m.description,
            "tags": m.tags,
            "installed": installed,
            "onnx_ready": onnx_ready,
            "size": m.size,
            "avatar": m.avatar,
        })
    });

    let filtered: Vec<_> = catalog_models
        .chain(local_models.into_iter())
        .filter(|m| {
            if query.is_empty() {
                return true;
            }
            let q = query.to_lowercase();
            m["name"]
                .as_str()
                .unwrap_or_default()
                .to_lowercase()
                .contains(&q)
                || m["author"]
                    .as_str()
                    .unwrap_or_default()
                    .to_lowercase()
                    .contains(&q)
                || m["tags"]
                    .as_array()
                    .map(|tags| {
                        tags.iter()
                            .any(|t| t.as_str().unwrap_or_default().to_lowercase().contains(&q))
                    })
                    .unwrap_or(false)
        })
        .collect();

    Ok(serde_json::json!(filtered))
}

#[cfg(feature = "tauri")]
fn rvc_catalog() -> &'static [RvcCatalogItem] {
    &[
        // ── 原神·少女 ─────────────────────────────────────────────
        RvcCatalogItem {
            id: "rvc-hutao",
            name: "胡桃",
            author: "ArkanDash/rvc-genshin-impact",
            description: "往生堂堂主，鬼马精灵，活泼中透着一丝阴气，辨识度极高。",
            tags: &["热门", "原神", "女声", "活泼"],
            size: "56MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/hu-tao%20200%20epochs%2048k%20v2.zip",
            avatar: "🌸",
        },
        RvcCatalogItem {
            id: "rvc-ganyu",
            name: "甘雨",
            author: "ArkanDash/rvc-genshin-impact",
            description: "璃月港外务书记官，半人半仙，嗓音温柔细腻如清泉。",
            tags: &["热门", "原神", "女声", "温柔"],
            size: "54MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/ganyu%20200%20epochs%2048k%20v2.zip",
            avatar: "🦌",
        },
        RvcCatalogItem {
            id: "rvc-raiden",
            name: "雷电将军",
            author: "ArkanDash/rvc-genshin-impact",
            description: "稻妻之神，威严低沉，带有不容置疑的霸气。",
            tags: &["热门", "原神", "女声", "御姐"],
            size: "59MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/raiden-jp%20104%20epochs%2048k%20v2.zip",
            avatar: "⚡",
        },
        RvcCatalogItem {
            id: "rvc-keqing",
            name: "刻晴",
            author: "ArkanDash/rvc-genshin-impact",
            description: "璃月七星·天权星，干练清脆，雷厉风行中透着一丝傲娇。",
            tags: &["热门", "原神", "女声", "干练"],
            size: "52MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/keqing%20200%20epochs%2048k%20v2.zip",
            avatar: "🌙",
        },
        RvcCatalogItem {
            id: "rvc-klee",
            name: "可莉",
            author: "ArkanDash/rvc-genshin-impact",
            description: "蒙德城最危险的骑士团成员，稚嫩萌系高音，天真无邪。",
            tags: &["热门", "原神", "女声", "萝莉"],
            size: "48MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/klee%20200%20epochs%2048k%20v2.zip",
            avatar: "💥",
        },
        RvcCatalogItem {
            id: "rvc-ayaka",
            name: "神里绫华",
            author: "ArkanDash/rvc-genshin-impact",
            description: "社奉行神里家长女，端庄优雅的大家闺秀，清冷如霜。",
            tags: &["热门", "原神", "女声", "清冷"],
            size: "55MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/ayaka%20200%20epochs%2048k%20v2.zip",
            avatar: "❄️",
        },
        RvcCatalogItem {
            id: "rvc-yoimiya",
            name: "宵宫",
            author: "ArkanDash/rvc-genshin-impact",
            description: "焰硝传奇的烟花师，声音如夏夜烟火一样明亮热烈。",
            tags: &["热门", "原神", "女声", "元气"],
            size: "51MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/yoimiya%20200%20epochs%2048k%20v2.zip",
            avatar: "🎆",
        },
        RvcCatalogItem {
            id: "rvc-yaemiko",
            name: "八重神子",
            author: "ArkanDash/rvc-genshin-impact",
            description: "九尾狐巫女，妖媚慵懒，带有戏弄人的媚意，极具魅力。",
            tags: &["热门", "原神", "女声", "御姐"],
            size: "57MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/yae-miko%20200%20epochs%2048k%20v2.zip",
            avatar: "🦊",
        },
        RvcCatalogItem {
            id: "rvc-shenhe",
            name: "申鹤",
            author: "ArkanDash/rvc-genshin-impact",
            description: "形神隔绝之人，清冷仙气，语调轻飘若云端。",
            tags: &["热门", "原神", "女声", "仙气"],
            size: "53MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/shenhe%20200%20epochs%2048k%20v2.zip",
            avatar: "🧊",
        },
        RvcCatalogItem {
            id: "rvc-beidou",
            name: "北斗",
            author: "ArkanDash/rvc-genshin-impact",
            description: "掌柜的统帅，豪迈爽朗大姐姐，中气十足。",
            tags: &["热门", "原神", "女声", "豪迈"],
            size: "50MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/beidou%20200%20epochs%2048k%20v2.zip",
            avatar: "⚓",
        },
        RvcCatalogItem {
            id: "rvc-yelan",
            name: "夜兰",
            author: "ArkanDash/rvc-genshin-impact",
            description: "神秘情报商人，低调通透，带有一丝玩味的俏皮感。",
            tags: &["热门", "原神", "女声", "神秘"],
            size: "54MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/yelan%20200%20epochs%2048k%20v2.zip",
            avatar: "🏹",
        },
        RvcCatalogItem {
            id: "rvc-furina",
            name: "芙宁娜",
            author: "ArkanDash/rvc-genshin-impact",
            description: "水神审判官，戏剧天后，嗓音富有表演张力，跌宕起伏。",
            tags: &["热门", "原神", "女声", "戏剧"],
            size: "58MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/furina%20200%20epochs%2048k%20v2.zip",
            avatar: "🎭",
        },
        RvcCatalogItem {
            id: "rvc-nahida",
            name: "纳西妲",
            author: "ArkanDash/rvc-genshin-impact",
            description: "草神，智慧之神，童声纯真聪慧，轻快活泼充满好奇。",
            tags: &["热门", "原神", "女声", "萝莉"],
            size: "49MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/nahida%20200%20epochs%2048k%20v2.zip",
            avatar: "🌿",
        },
        RvcCatalogItem {
            id: "rvc-yanfei",
            name: "烟绯",
            author: "ArkanDash/rvc-genshin-impact",
            description: "璃月律法专家，干脆利落，说话节奏感强，适合播报向。",
            tags: &["热门", "原神", "女声", "干练"],
            size: "50MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/yanfei%20200%20epochs%2048k%20v2.zip",
            avatar: "⚖️",
        },
        RvcCatalogItem {
            id: "rvc-xiangling",
            name: "香菱",
            author: "ArkanDash/rvc-genshin-impact",
            description: "万民堂大厨，热情活跃，声音充满烟火气，亲切自然。",
            tags: &["热门", "原神", "女声", "活泼"],
            size: "48MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/xiangling%20200%20epochs%2048k%20v2.zip",
            avatar: "🌶️",
        },
        RvcCatalogItem {
            id: "rvc-nilou",
            name: "妮露",
            author: "ArkanDash/rvc-genshin-impact",
            description: "须弥舞者，嗓音柔美律动，带有异域风情，适合舞台感内容。",
            tags: &["热门", "原神", "女声", "温柔"],
            size: "52MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/nilou%20200%20epochs%2048k%20v2.zip",
            avatar: "💃",
        },
        RvcCatalogItem {
            id: "rvc-fischl",
            name: "菲谢尔",
            author: "ArkanDash/rvc-genshin-impact",
            description: "侦探少女，中二病满满，语调夸张有趣，极具娱乐感。",
            tags: &["热门", "原神", "女声", "中二"],
            size: "49MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/fischl%20200%20epochs%2048k%20v2.zip",
            avatar: "🌑",
        },
        RvcCatalogItem {
            id: "rvc-ningguang",
            name: "凝光",
            author: "ArkanDash/rvc-genshin-impact",
            description: "玉衡星，璃月商界女王，高贵端庄，霸气中带有从容。",
            tags: &["热门", "原神", "女声", "御姐"],
            size: "53MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/ningguang%20200%20epochs%2048k%20v2.zip",
            avatar: "💎",
        },
        RvcCatalogItem {
            id: "rvc-eula",
            name: "优菈",
            author: "ArkanDash/rvc-genshin-impact",
            description: "骑士团长，劳伦斯后裔，冷峻傲慢语气，爆发时极具感染力。",
            tags: &["热门", "原神", "女声", "冷感"],
            size: "54MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/eula%20200%20epochs%2048k%20v2.zip",
            avatar: "🗡️",
        },
        RvcCatalogItem {
            id: "rvc-collei",
            name: "柯莱",
            author: "ArkanDash/rvc-genshin-impact",
            description: "森林游侠，青涩少女，声音清新可爱略带紧张感。",
            tags: &["热门", "原神", "女声", "萝莉"],
            size: "47MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/collei%20200%20epochs%2048k%20v2.zip",
            avatar: "🍃",
        },
        // ── 原神·男声 ─────────────────────────────────────────────
        RvcCatalogItem {
            id: "rvc-zhongli",
            name: "钟离",
            author: "ArkanDash/rvc-genshin-impact",
            description: "岩神化身，博识丰厚，低沉浑厚，沉稳如山，男声天花板。",
            tags: &["热门", "原神", "男声", "低沉"],
            size: "61MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/zhongli%20200%20epochs%2048k%20v2.zip",
            avatar: "🗿",
        },
        RvcCatalogItem {
            id: "rvc-xiao",
            name: "魈",
            author: "ArkanDash/rvc-genshin-impact",
            description: "夜叉护法，冷峻孤傲，少年感中带着沧桑，颇具悲剧美感。",
            tags: &["热门", "原神", "男声", "冷感"],
            size: "55MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/xiao%20200%20epochs%2048k%20v2.zip",
            avatar: "🎭",
        },
        RvcCatalogItem {
            id: "rvc-venti",
            name: "温迪",
            author: "ArkanDash/rvc-genshin-impact",
            description: "风神化身的吟游诗人，嗓音轻盈悦耳，适合说唱和读诗。",
            tags: &["热门", "原神", "男声", "少年"],
            size: "52MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/venti%20200%20epochs%2048k%20v2.zip",
            avatar: "🎵",
        },
        RvcCatalogItem {
            id: "rvc-kazuha",
            name: "枫原万叶",
            author: "ArkanDash/rvc-genshin-impact",
            description: "漂泊武士，声音带有诗意飘逸感，柔中有刚，温润如玉。",
            tags: &["热门", "原神", "男声", "少年"],
            size: "53MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/kazuha%20200%20epochs%2048k%20v2.zip",
            avatar: "🍁",
        },
        RvcCatalogItem {
            id: "rvc-wanderer",
            name: "流浪者",
            author: "ArkanDash/rvc-genshin-impact",
            description: "傲娇魁儡，高冷外表下暗藏情绪，语调跌宕，最适合直播互怼。",
            tags: &["热门", "原神", "男声", "傲娇"],
            size: "56MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/wanderer%20200%20epochs%2048k%20v2.zip",
            avatar: "🌪️",
        },
        RvcCatalogItem {
            id: "rvc-xingqiu",
            name: "行秋",
            author: "ArkanDash/rvc-genshin-impact",
            description: "归终书斋少东家，文雅少年，声音清朗略带书卷气。",
            tags: &["热门", "原神", "男声", "少年"],
            size: "49MB",
            repo: "ArkanDash/rvc-genshin-impact",
            path: "prezipped/v2/xingqiu%20200%20epochs%2048k%20v2.zip",
            avatar: "📖",
        },
        // ── 崩坏：星穹铁道 ────────────────────────────────────────
        RvcCatalogItem {
            id: "rvc-fuxuan",
            name: "符玄",
            author: "SaylorTwift07/Hoyo-RVC-Models",
            description: "仙舟·罗浮占算主，神秘高冷，嗓音带有来自古老秘术的威严感。",
            tags: &["热门", "星穹铁道", "女声", "御姐"],
            size: "58MB",
            repo: "SaylorTwift07/Hoyo-RVC-Models",
            path: "Star%20Rail/Fu%20Xuan/fu_xuan_200_epochs.zip",
            avatar: "🔮",
        },
        RvcCatalogItem {
            id: "rvc-yanqing",
            name: "彦卿",
            author: "SaylorTwift07/Hoyo-RVC-Models",
            description: "仙舟·罗浮剑圣，少年侠士，声音清亮坚定，少年英气十足。",
            tags: &["热门", "星穹铁道", "男声", "少年"],
            size: "50MB",
            repo: "SaylorTwift07/Hoyo-RVC-Models",
            path: "Star%20Rail/Yanqing/yanqing_200_epochs.zip",
            avatar: "⚔️",
        },
        RvcCatalogItem {
            id: "rvc-bailu",
            name: "白露",
            author: "SaylorTwift07/Hoyo-RVC-Models",
            description: "仙舟·罗浮药王，神仙姐姐，温和治愈，娇俏中带着稳重。",
            tags: &["热门", "星穹铁道", "女声", "温柔"],
            size: "54MB",
            repo: "SaylorTwift07/Hoyo-RVC-Models",
            path: "Star%20Rail/Bailu/bailu_200_epochs.zip",
            avatar: "💊",
        },
        RvcCatalogItem {
            id: "rvc-silverwolf",
            name: "银狼",
            author: "SaylorTwift07/Hoyo-RVC-Models",
            description: "虚无派黑客少女，慵懒不羁，带有属于二次元老宅女的独特气质。",
            tags: &["热门", "星穹铁道", "女声", "少女"],
            size: "52MB",
            repo: "SaylorTwift07/Hoyo-RVC-Models",
            path: "Star%20Rail/Silver%20Wolf/silver_wolf_200_epochs.zip",
            avatar: "🐺",
        },
        RvcCatalogItem {
            id: "rvc-jingyuan",
            name: "景元",
            author: "SaylorTwift07/Hoyo-RVC-Models",
            description: "仙舟·罗浮云骑军将军，温文儒雅，低沉磁性，含笑带刀。",
            tags: &["热门", "星穹铁道", "男声", "低沉"],
            size: "61MB",
            repo: "SaylorTwift07/Hoyo-RVC-Models",
            path: "Star%20Rail/Jing%20Yuan/jing_yuan_200_epochs.zip",
            avatar: "☁️",
        },
        RvcCatalogItem {
            id: "rvc-blade",
            name: "刃",
            author: "SaylorTwift07/Hoyo-RVC-Models",
            description: "星核猎手，低沉危险，沙哑男声带有末世感，极具压迫力。",
            tags: &["热门", "星穹铁道", "男声", "低沉"],
            size: "57MB",
            repo: "SaylorTwift07/Hoyo-RVC-Models",
            path: "Star%20Rail/Blade/blade_200_epochs.zip",
            avatar: "🖤",
        },
        RvcCatalogItem {
            id: "rvc-seele",
            name: "希儿",
            author: "SaylorTwift07/Hoyo-RVC-Models",
            description: "彭格列第六天国守护者，灵动少女感，切换交战状态时声线突变。",
            tags: &["热门", "星穹铁道", "女声", "少女"],
            size: "53MB",
            repo: "SaylorTwift07/Hoyo-RVC-Models",
            path: "Star%20Rail/Seele/seele_200_epochs.zip",
            avatar: "🦋",
        },
        RvcCatalogItem {
            id: "rvc-firefly",
            name: "流萤",
            author: "SaylorTwift07/Hoyo-RVC-Models",
            description: "星际迷途的萤火虫，少女热血，嗓音温暖中带有坚毅。",
            tags: &["热门", "星穹铁道", "女声", "少女"],
            size: "55MB",
            repo: "SaylorTwift07/Hoyo-RVC-Models",
            path: "Star%20Rail/Firefly/firefly_200_epochs.zip",
            avatar: "✨",
        },
        RvcCatalogItem {
            id: "rvc-blackswan",
            name: "黑天鹅",
            author: "SaylorTwift07/Hoyo-RVC-Models",
            description: "虚无派记忆侦探，妖艳撩拨，声线低而慵懒，带有危险魅惑。",
            tags: &["热门", "星穹铁道", "女声", "御姐"],
            size: "56MB",
            repo: "SaylorTwift07/Hoyo-RVC-Models",
            path: "Star%20Rail/Black%20Swan/black_swan_200_epochs.zip",
            avatar: "🖤",
        },
        RvcCatalogItem {
            id: "rvc-march7th",
            name: "三月七",
            author: "SaylorTwift07/Hoyo-RVC-Models",
            description: "开拓者的快乐伙伴，活泼开朗，声音明亮甜美，是永远的元气担当。",
            tags: &["热门", "星穹铁道", "女声", "活泼"],
            size: "51MB",
            repo: "SaylorTwift07/Hoyo-RVC-Models",
            path: "Star%20Rail/March%207th/march7th_200_epochs.zip",
            avatar: "📷",
        },
        RvcCatalogItem {
            id: "rvc-danheng",
            name: "丹恒",
            author: "SaylorTwift07/Hoyo-RVC-Models",
            description: "星穹列车乘客，寡言正直，声音沉稳有力，少言而有分量。",
            tags: &["热门", "星穹铁道", "男声", "少年"],
            size: "52MB",
            repo: "SaylorTwift07/Hoyo-RVC-Models",
            path: "Star%20Rail/Dan%20Heng/dan_heng_200_epochs.zip",
            avatar: "🐉",
        },
        // ── 国风虚拟歌手 ───────────────────────────────────────────
        RvcCatalogItem {
            id: "rvc-luotianyi",
            name: "洛天依",
            author: "RVC-Boss/Chinese-Vocaloid-RVC",
            description: "中国最受欢迎的虚拟歌手，声音清脆干净，适合各类演唱和播报。",
            tags: &["热门", "虚拟歌手", "女声", "清纯"],
            size: "62MB",
            repo: "RVC-Boss/Chinese-Vocaloid-RVC",
            path: "Luo%20Tianyi/luotianyi_400_epochs_48k_v2.zip",
            avatar: "🎤",
        },
        RvcCatalogItem {
            id: "rvc-yanhe",
            name: "言和",
            author: "RVC-Boss/Chinese-Vocaloid-RVC",
            description: "中国男声虚拟歌手，声音清朗阳光，适合年轻男主播使用。",
            tags: &["热门", "虚拟歌手", "男声", "少年"],
            size: "58MB",
            repo: "RVC-Boss/Chinese-Vocaloid-RVC",
            path: "Yanhe/yanhe_400_epochs_48k_v2.zip",
            avatar: "🎸",
        },
        RvcCatalogItem {
            id: "rvc-yuzhiyuan",
            name: "乐正绫",
            author: "RVC-Boss/Chinese-Vocaloid-RVC",
            description: "四川虚拟歌手，声音甜美活泼略带国风气质，深受国内用户喜爱。",
            tags: &["热门", "虚拟歌手", "女声", "甜美"],
            size: "59MB",
            repo: "RVC-Boss/Chinese-Vocaloid-RVC",
            path: "Yuezheng%20Ling/yuezhengLing_400_epochs_48k_v2.zip",
            avatar: "🌈",
        },
        RvcCatalogItem {
            id: "rvc-miku-zh",
            name: "初音未来·中文版",
            author: "RVC-Boss/Miku-Chinese-RVC",
            description: "世界最知名虚拟歌手的中文训练版本，保留标志性音色，适配中文语境。",
            tags: &["热门", "虚拟歌手", "女声", "萝莉"],
            size: "65MB",
            repo: "RVC-Boss/Miku-Chinese-RVC",
            path: "Miku-Chinese/miku_zh_500_epochs_48k_v2.zip",
            avatar: "🎵",
        },
        RvcCatalogItem {
            id: "rvc-moqingxian",
            name: "墨清弦",
            author: "RVC-Boss/Chinese-Vocaloid-RVC",
            description: "古风男声虚拟歌手，嗓音文雅低沉，适合汉服直播或国风内容创作。",
            tags: &["热门", "虚拟歌手", "男声", "低沉"],
            size: "57MB",
            repo: "RVC-Boss/Chinese-Vocaloid-RVC",
            path: "Mo%20Qingxian/moqingxian_400_epochs_48k_v2.zip",
            avatar: "🎻",
        },
        // ── 崩坏3角色 ────────────────────────────────────────────
        RvcCatalogItem {
            id: "rvc-bronya",
            name: "布洛妮娅",
            author: "ArkanDash/rvc-honkai-impact",
            description: "崩坏3圣痕战场指挥官，冷静理性，机甲感强，声线干净精准。",
            tags: &["热门", "崩坏3", "女声", "冷感"],
            size: "55MB",
            repo: "ArkanDash/rvc-honkai-impact",
            path: "prezipped/v2/bronya%20200%20epochs%2048k%20v2.zip",
            avatar: "🤖",
        },
        RvcCatalogItem {
            id: "rvc-kiana",
            name: "琪亚娜",
            author: "ArkanDash/rvc-honkai-impact",
            description: "律者·终焉，活泼中带末日气息，多种情绪切换自然，高人气主角。",
            tags: &["热门", "崩坏3", "女声", "活泼"],
            size: "53MB",
            repo: "ArkanDash/rvc-honkai-impact",
            path: "prezipped/v2/kiana%20200%20epochs%2048k%20v2.zip",
            avatar: "🌸",
        },
        RvcCatalogItem {
            id: "rvc-mei",
            name: "雷电芽衣",
            author: "ArkanDash/rvc-honkai-impact",
            description: "鬼人幻魔·雷电芽衣，威严中带柔情，大剑挥出时的力量感十足。",
            tags: &["热门", "崩坏3", "女声", "御姐"],
            size: "56MB",
            repo: "ArkanDash/rvc-honkai-impact",
            path: "prezipped/v2/mei%20200%20epochs%2048k%20v2.zip",
            avatar: "⚡",
        },
        // ── 国产游戏/动漫角色 ──────────────────────────────────────
        RvcCatalogItem {
            id: "rvc-tangsan",
            name: "唐三·斗罗大陆",
            author: "ACG-RVC/Donghua-Models",
            description: "斗罗大陆主角，声线稳重有力，适合热血励志类内容直播。",
            tags: &["国漫", "动漫", "男声", "热血"],
            size: "54MB",
            repo: "ACG-RVC/Donghua-Models",
            path: "Douluo/Tang%20San/tangsan_200_epochs_48k_v2.zip",
            avatar: "🔱",
        },
        RvcCatalogItem {
            id: "rvc-wuqing",
            name: "武庚·夜华",
            author: "ACG-RVC/Donghua-Models",
            description: "武庚纪男主，低沉有力，适合国漫热血剧情解说向内容。",
            tags: &["国漫", "动漫", "男声", "低沉"],
            size: "52MB",
            repo: "ACG-RVC/Donghua-Models",
            path: "Wugeng/wu_geng_200_epochs_48k_v2.zip",
            avatar: "🌑",
        },
        RvcCatalogItem {
            id: "rvc-meidb",
            name: "斗破·美杜莎",
            author: "ACG-RVC/Donghua-Models",
            description: "斗破苍穹蛇族女王，低沉妩媚，御姐气场全开，魅惑无极限。",
            tags: &["国漫", "动漫", "女声", "御姐"],
            size: "55MB",
            repo: "ACG-RVC/Donghua-Models",
            path: "Doupocangqiong/Medusa/medusa_200_epochs_48k_v2.zip",
            avatar: "🐍",
        },
        RvcCatalogItem {
            id: "rvc-xiaozhan",
            name: "A·哥哥系男声",
            author: "ACG-RVC/Streamer-RVC",
            description: "参考国内顶流声线训练的成熟磁性男声，适合品味生活类直播。",
            tags: &["热门", "男声", "磁性", "主播风"],
            size: "67MB",
            repo: "ACG-RVC/Streamer-RVC",
            path: "Male-Mature/mature_male_400_epochs_48k_v2.zip",
            avatar: "🎙️",
        },
        RvcCatalogItem {
            id: "rvc-loli-cn",
            name: "国风萝莉音",
            author: "ACG-RVC/Streamer-RVC",
            description: "可爱甜萝莉音色，用于动漫配音或互动性较强的直播场景。",
            tags: &["热门", "女声", "萝莉", "甜美"],
            size: "48MB",
            repo: "ACG-RVC/Streamer-RVC",
            path: "Loli/cute_loli_400_epochs_48k_v2.zip",
            avatar: "🎀",
        },
        RvcCatalogItem {
            id: "rvc-dajie-cn",
            name: "大叔·解说音",
            author: "ACG-RVC/Streamer-RVC",
            description: "成熟沧桑大叔嗓音，浑厚有力，专为游戏解说和电竞直播场景打造。",
            tags: &["热门", "男声", "大叔", "解说"],
            size: "63MB",
            repo: "ACG-RVC/Streamer-RVC",
            path: "Uncle/uncle_commentary_400_epochs_48k_v2.zip",
            avatar: "🎮",
        },
        RvcCatalogItem {
            id: "rvc-shota-cn",
            name: "正太·少年音",
            author: "ACG-RVC/Streamer-RVC",
            description: "清亮阳光少年音，元气满满，适合游戏实况、二次元互动。",
            tags: &["热门", "男声", "少年", "元气"],
            size: "50MB",
            repo: "ACG-RVC/Streamer-RVC",
            path: "Shota/shota_cute_400_epochs_48k_v2.zip",
            avatar: "⭐",
        },
    ]
}

#[cfg(feature = "tauri")]
fn rvc_catalog_item(id: &str) -> Option<&'static RvcCatalogItem> {
    rvc_catalog().iter().find(|item| item.id == id)
}

#[cfg(feature = "tauri")]
fn has_voice_changer_model_asset(dir: &std::path::Path) -> bool {
    if dir.join("model.onnx").exists()
        || dir.join("model.pth").exists()
        || dir.join("model.zip").exists()
    {
        return true;
    }
    std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .any(|entry| {
            entry
                .path()
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| matches!(ext, "onnx" | "pth" | "zip"))
                .unwrap_or(false)
        })
}

#[cfg(feature = "tauri")]
fn is_voice_changer_model_onnx_ready(dir: &std::path::Path) -> bool {
    if dir.join("model.onnx").exists() {
        return true;
    }
    std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .any(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("onnx"))
}

#[cfg(feature = "tauri")]
fn resolve_voice_changer_model_path(
    base: &std::path::Path,
    model_id: &str,
) -> Option<std::path::PathBuf> {
    let dir = base.join(model_id);
    let onnx = dir.join("model.onnx");
    if onnx.exists() {
        return Some(onnx);
    }
    // Fall back: any .onnx file in the directory.
    std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().and_then(|x| x.to_str()) == Some("onnx"))
}

#[cfg(feature = "tauri")]
fn resolve_voice_changer_runtime_model_path(
    base: &std::path::Path,
    model_id: &str,
) -> Option<std::path::PathBuf> {
    resolve_voice_changer_pth_model_path(base, model_id)
        .or_else(|| resolve_voice_changer_model_path(base, model_id))
}

#[cfg(feature = "tauri")]
fn resolve_voice_changer_pth_model_path(
    base: &std::path::Path,
    model_id: &str,
) -> Option<std::path::PathBuf> {
    let dir = base.join(model_id);
    let pth = dir.join("model.pth");
    if pth.exists() {
        return Some(pth);
    }
    std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().and_then(|x| x.to_str()) == Some("pth"))
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
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let bytes = state
        .http
        .fetch_image(&url)
        .await
        .map_err(|e| e.to_string())?;
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
async fn get_connected_room(state: tauri::State<'_, SharedState>) -> Result<Option<i64>, String> {
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
async fn get_recent_danmaku(state: tauri::State<'_, SharedState>) -> Result<Vec<String>, String> {
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
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    text: String,
    voice: String,
    provider_id: Option<String>,
    speed: Option<f32>,
) -> Result<(), String> {
    use streamix_voice::{PRIORITY_SYSTEM, SessionConfig, SpeakRequest, SpeakerRouter};

    // 从 config 解析当前 TTS 引擎
    let cfg = AppConfig::load_or_default().map_err(|e| e.to_string())?;
    let engine =
        resolve_tts_engine_for_preview(&cfg, &model_dir(&app), provider_id.as_deref(), &voice);
    let engine_name = match &engine {
        streamix_voice::TtsEngine::Edge => "edge",
        streamix_voice::TtsEngine::MiniMax { .. } => "minimax",
        streamix_voice::TtsEngine::Azure { .. } => "azure",
        streamix_voice::TtsEngine::VolcEngine { .. } => "volcengine",
        #[cfg(feature = "local-tts")]
        streamix_voice::TtsEngine::LocalTts { .. } => "local",
    };
    let engine_detail = match &engine {
        streamix_voice::TtsEngine::MiniMax {
            voice_id,
            model,
            ws_url,
            ..
        } => format!(" model={model} ws_url={ws_url} voice_id={voice_id}"),
        _ => String::new(),
    };
    let _ = app.emit(
        "monitor-log",
        serde_json::json!(format!(
            "[TTS诊断] engine={engine_name} provider={} voice={}{} text_len={} text={}",
            provider_id.as_deref().unwrap_or(""),
            voice,
            engine_detail,
            text.chars().count(),
            text
        )),
    );

    let router = {
        let mut guard = state.preview_tts.lock().map_err(|e| e.to_string())?;
        let provider_key = provider_id.clone().unwrap_or_default();
        let needs_new = guard
            .as_ref()
            .map(|(_, v, p, _)| v != &voice || p != &provider_key)
            .unwrap_or(true);
        if needs_new {
            if let Some((_, _, _, cancel)) = guard.take() {
                cancel.cancel();
            }
            let cancel = CancellationToken::new();
            let session_cfg = SessionConfig {
                tts_voice: voice.clone(),
                ..Default::default()
            };
            let router = SpeakerRouter::spawn_with_audio_and_engine(
                session_cfg,
                engine.clone(),
                cancel.clone(),
            );
            *guard = Some((router.clone(), voice, provider_key, cancel));
            router
        } else {
            guard.as_ref().unwrap().0.clone()
        }
    };

    let mut req = SpeakRequest::new(text)
        .with_engine(engine.clone())
        .with_priority(PRIORITY_SYSTEM);
    if let Some(speed) = speed {
        let clamped = speed.clamp(0.5, 2.0);
        let delta = ((clamped - 1.0) * 100.0).round() as i32;
        req = req.with_rate(format!("{delta:+}%"));
    }

    let _playback_guard = state.preview_tts_playback.lock().await;
    let mut audio_events = router.voice_session().subscribe();

    router.voice_session().speak(req).await.map_err(|e| {
        let msg = e.to_string();
        let _ = app.emit(
            "monitor-log",
            serde_json::json!(format!("[TTS错误] engine={engine_name} {msg}")),
        );
        msg
    })?;

    let wait_secs = match engine {
        streamix_voice::TtsEngine::MiniMax { .. } => 15,
        _ => 6,
    };
    let wait_result = tokio::time::timeout(std::time::Duration::from_secs(wait_secs), async {
        loop {
            match audio_events.recv().await {
                Ok(streamix_voice::SessionEvent::SpeechError { message }) => {
                    let _ = app.emit(
                        "monitor-log",
                        serde_json::json!(format!("[TTS错误] engine={engine_name} {message}")),
                    );
                    break;
                }
                Ok(streamix_voice::SessionEvent::SpeechEnd)
                | Ok(streamix_voice::SessionEvent::SpeechInterrupted)
                | Ok(streamix_voice::SessionEvent::Closed)
                | Err(_) => break,
                _ => {}
            }
        }
    })
    .await;
    if wait_result.is_err() {
        let _ = app.emit(
            "monitor-log",
            serde_json::json!(format!("[TTS错误] engine={engine_name} 播放等待超时")),
        );
    }

    Ok(())
}

/// 预览用 TTS 引擎解析（与 monitor 中的 resolve_tts_engine 逻辑一致）
fn resolve_tts_engine_for_preview(
    config: &AppConfig,
    model_dir: &std::path::Path,
    provider_id: Option<&str>,
    selected_voice: &str,
) -> streamix_voice::TtsEngine {
    let tts_provider = provider_id
        .filter(|id| !id.is_empty())
        .and_then(|id| {
            config
                .ai_providers
                .iter()
                .find(|p| p.provider_type == "tts" && p.id == id)
        })
        .or_else(|| {
            if config.active_tts_provider_id.is_empty() {
                None
            } else {
                config
                    .ai_providers
                    .iter()
                    .find(|p| p.provider_type == "tts" && p.id == config.active_tts_provider_id)
            }
        });

    let Some(provider) = tts_provider else {
        return streamix_voice::TtsEngine::Edge;
    };

    let name_lower = provider.name.to_lowercase();

    if name_lower.contains("minimax") {
        streamix_voice::TtsEngine::MiniMax {
            api_key: provider.api_key.clone(),
            voice_id: if !selected_voice.is_empty() {
                selected_voice.to_string()
            } else if !config.tts_voice.is_empty() {
                config.tts_voice.clone()
            } else {
                "zh_female_wanwanxiaohe_moon_bigtts".to_string()
            },
            model: if provider.model.is_empty() {
                "speech-2.8-turbo".to_string()
            } else {
                provider.model.clone()
            },
            ws_url: normalize_minimax_ws_url(&provider.api_url),
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
        if let Some(engine) = try_resolve_local_tts(&name_lower, model_dir, config.tts_speed) {
            return engine;
        }
        streamix_voice::TtsEngine::Edge
    }
}

fn normalize_minimax_ws_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return "wss://api.minimaxi.com/ws/v1/t2a_v2".to_string();
    }
    let mut out = trimmed
        .replace("https://", "wss://")
        .replace("http://", "ws://");
    if !out.contains("/ws/v1/t2a_v2") && out.ends_with("/v1/t2a_v2") {
        out = out.replace("/v1/t2a_v2", "/ws/v1/t2a_v2");
    }
    out
}

/// 将本地 TTS provider 名称映射到 LocalTts 引擎；失败时返回 None。
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

#[cfg(feature = "tauri")]
#[tauri::command]
async fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn open_config_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = std::env::current_dir()
        .map(|p| p.join("etc"))
        .unwrap_or_else(|_| std::path::PathBuf::from("etc"));
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn force_quit(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn check_update_cmd(
    state: tauri::State<'_, SharedState>,
) -> Result<Option<api::UpdateInfo>, String> {
    let current = env!("CARGO_PKG_VERSION");
    state
        .http
        .check_update(current)
        .await
        .map_err(|e| e.to_string())
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
    let message = format!(
        "新版本 v{} 已下载完成。\n\n【更新日志】\n{}\n\n是否现在安装并重启？",
        update.version, changelog
    );

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
                        println!(
                            "[Updater] Found update v{}, starting auto update...",
                            update.version
                        );
                        // Download in background
                        let _ = perform_update(app.clone()).await;
                    } else {
                        // Check if we notified today
                        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                        let last_notified = std::fs::read_to_string("etc/last_update_notified.txt")
                            .unwrap_or_default();

                        if last_notified != today {
                            println!(
                                "[Updater] Found update v{}, sending daily notification...",
                                update.version
                            );
                            let _ = app
                                .notification()
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
                    println!(
                        "[Storage] Cleaned up {} old records (older than 30 days)",
                        count
                    );
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
fn emit_mdl(
    app: &AppHandle,
    model_id: &str,
    stage: &str,
    pct: u32,
    downloaded_mb: Option<f64>,
    total_mb: Option<f64>,
) {
    let mut payload = serde_json::json!({ "model_id": model_id, "stage": stage, "pct": pct });
    if let Some(d) = downloaded_mb {
        payload["downloaded_mb"] = format!("{:.1}", d).into();
    }
    if let Some(t) = total_mb {
        payload["total_mb"] = format!("{:.1}", t).into();
    }
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
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| format!("创建文件失败: {e}"))?;
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
                        let prev = *overall;
                        written += chunk.len() as u64;
                        *overall += chunk.len() as u64;
                        if total > 0 {
                            let pct = ((*overall as f64 / total as f64) * 100.0).min(99.0) as u32;
                            emit_mdl(app, model_id, "downloading", pct,
                                Some(*overall as f64 / 1_048_576.0),
                                Some(total as f64 / 1_048_576.0));
                        } else if prev / (512 * 1024) != *overall / (512 * 1024) {
                            // No content-length — pulse every 512 KB so the UI shows activity
                            emit_mdl(app, model_id, "downloading", 0,
                                Some(*overall as f64 / 1_048_576.0), None);
                        }
                    }
                }
            }
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(written)
}

/// ONNX/protobuf files always start with 0x08 (ir_version field tag).
/// A file that starts with anything else was not downloaded correctly.
fn onnx_file_valid(path: &std::path::Path) -> bool {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let Ok(meta) = f.metadata() else { return false };
    if meta.len() < 65_536 {
        return false;
    }
    let mut hdr = [0u8; 1];
    f.read_exact(&mut hdr).is_ok() && hdr[0] == 0x08
}

#[cfg(feature = "tauri")]
#[tauri::command]
fn check_models(app: AppHandle) -> Result<serde_json::Value, String> {
    let base = model_dir(&app);
    let vad_ok = onnx_file_valid(&base.join("silero_vad.onnx"));
    let sv_dir = base.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");
    let sensevoice_ok =
        sv_dir.join("model.int8.onnx").exists() && sv_dir.join("tokens.txt").exists();
    let pf_dir = base.join("sherpa-onnx-paraformer-zh-2023-09-14");
    let paraformer_ok =
        pf_dir.join("model.int8.onnx").exists() || pf_dir.join("model.onnx").exists();
    let wd = base.join("whisper");
    let kokoro_dir = base.join("kokoro");
    let kokoro_ok = kokoro_dir.join("kokoro-v1.0.int8.onnx").exists()
        || kokoro_dir.join("kokoro-v1.0.onnx").exists();
    let ks_dir = base.join("sherpa-onnx-kokoro-multi-lang-v1.1-ONNX");
    let kokoro_sherpa_ok =
        ks_dir.join("model.onnx").exists() || ks_dir.join("model.int8.onnx").exists();
    let melo_dir = base.join("sherpa-onnx-melo-tts-zh_en");
    let melo_ok = melo_dir.join("model.onnx").exists();
    let piper_dir = base.join("vits-piper-zh_CN-huayan-medium");
    let piper_ok = piper_dir.join("model.onnx").exists();

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
            "kokoro-sherpa": kokoro_sherpa_ok,
            "melo-tts": melo_ok,
            "piper-zh": piper_ok,
        }
    }))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn delete_model(app: AppHandle, model_id: String) -> Result<String, String> {
    let base = model_dir(&app);
    if let Some(item) = rvc_catalog_item(&model_id) {
        let dir = base.join("rvc").join(item.id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        return Ok(format!("{} 已删除", item.name));
    }
    match model_id.as_str() {
        "silero-vad" => {
            let p = base.join("silero_vad.onnx");
            if p.exists() {
                std::fs::remove_file(p).map_err(|e| e.to_string())?;
            }
            Ok("VAD 模型已删除".to_string())
        }
        "sensevoice" => {
            let d = base.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");
            if d.exists() {
                std::fs::remove_dir_all(d).map_err(|e| e.to_string())?;
            }
            let tmp = base.join("_sensevoice_dl.tar.bz2");
            if tmp.exists() {
                let _ = std::fs::remove_file(tmp);
            }
            Ok("SenseVoice 模型已删除".to_string())
        }
        "paraformer" => {
            let d = base.join("sherpa-onnx-paraformer-zh-2023-09-14");
            if d.exists() {
                std::fs::remove_dir_all(d).map_err(|e| e.to_string())?;
            }
            let tmp = base.join("_paraformer_dl.tar.bz2");
            if tmp.exists() {
                let _ = std::fs::remove_file(tmp);
            }
            Ok("Paraformer 模型已删除".to_string())
        }
        "whisper-tiny" | "whisper-small" | "whisper-medium" => {
            let size = model_id.strip_prefix("whisper-").unwrap();
            let p = base.join("whisper").join(format!("ggml-{}.bin", size));
            if p.exists() {
                std::fs::remove_file(p).map_err(|e| e.to_string())?;
            }
            Ok(format!("Whisper {} 模型已删除", size))
        }
        "kokoro" => {
            let d = base.join("kokoro");
            if d.exists() {
                std::fs::remove_dir_all(d).map_err(|e| e.to_string())?;
            }
            Ok("Kokoro TTS 模型已删除".to_string())
        }
        _ => Err(format!("未知模型: {}", model_id)),
    }
}

// ---- private download helpers ----

/// After tar extraction, if the model files landed flat in `base` instead of the expected
/// `target` subdirectory (some HF tarballs omit the directory prefix), move them in.
fn fix_flat_extract(base: &std::path::Path, target: &std::path::Path, check: &str, names: &[&str]) {
    if target.join(check).exists() || !base.join(check).exists() {
        return;
    }
    let _ = std::fs::create_dir_all(target);
    for &name in names {
        let src = base.join(name);
        if src.exists() {
            let _ = std::fs::rename(&src, target.join(name));
        }
    }
}

#[cfg(feature = "tauri")]
async fn ensure_rvc_hubert(app: &AppHandle, cancel: &CancellationToken) -> Result<(), String> {
    let base = model_dir(app).join("rvc");
    let hubert_path = base.join("hubert_base.onnx");
    if hubert_path.exists() {
        return Ok(());
    }

    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let is_china = detect_china_ip().await;
    let hf = if is_china {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    let url = format!("{hf}/MidFord327/Hubert-Base-ONNX/resolve/main/hubert_base.onnx");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载 hubert_base.onnx 失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "下载 hubert_base.onnx 失败: HTTP {}",
            resp.status()
        ));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut overall = 0u64;
    stream_to_file(
        app,
        "rvc-hubert",
        resp,
        &hubert_path,
        cancel,
        &mut overall,
        total,
    )
    .await?;
    Ok(())
}

#[cfg(feature = "tauri")]
async fn dl_rvc_model(
    app: AppHandle,
    cancel: CancellationToken,
    item: &'static RvcCatalogItem,
) -> Result<String, String> {
    let base = model_dir(&app).join("rvc");
    let target_dir = base.join(item.id);
    std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    ensure_rvc_hubert(&app, &cancel).await?;

    let file_name = item.path.rsplit('/').next().unwrap_or("model.bin");
    let is_china = detect_china_ip().await;
    let hf = if is_china {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    let url = format!("{hf}/{}/resolve/main/{}", item.repo, item.path);

    let model_target = if file_name.ends_with(".onnx") {
        target_dir.join("model.onnx")
    } else if file_name.ends_with(".pth") {
        target_dir.join("model.pth")
    } else if file_name.ends_with(".zip") {
        target_dir.join("model.zip")
    } else {
        target_dir.join(file_name)
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut overall = 0u64;
    stream_to_file(
        &app,
        item.id,
        resp,
        &model_target,
        &cancel,
        &mut overall,
        total,
    )
    .await?;

    // If the downloaded file is a zip, extract it in-place then remove the archive.
    if model_target.extension().and_then(|e| e.to_str()) == Some("zip") {
        emit_mdl(&app, item.id, "extracting", 100, None, None);
        extract_zip_model(&model_target, &target_dir).map_err(|e| format!("解压模型失败: {e}"))?;
        let _ = std::fs::remove_file(&model_target);
    }

    if cancel.is_cancelled() {
        emit_mdl(&app, item.id, "cancelled", 0, None, None);
        return Err("下载已取消".to_string());
    }

    if !is_voice_changer_model_onnx_ready(&target_dir) && has_rvc_pth_model(&target_dir) {
        emit_mdl(&app, item.id, "converting", 0, None, None);
        convert_rvc_pth_to_onnx_inner(&app, item.id)
            .map_err(|e| format!("下载完成，但自动转换 ONNX 失败: {e}"))?;
    }

    if !is_voice_changer_model_onnx_ready(&target_dir) {
        return Err("下载完成，但模型不是 ONNX 格式，且未找到可转换的 PTH 文件".to_string());
    }

    emit_mdl(&app, item.id, "done", 100, None, None);
    Ok(format!("{} 下载完成", item.name))
}

#[cfg(feature = "tauri")]
fn extract_zip_model(zip_path: &std::path::Path, dest_dir: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let raw_name = entry.name().to_string();
        // Strip any leading directory components — place all files flat in dest_dir.
        let file_name = std::path::Path::new(&raw_name)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or(raw_name.clone());
        // Rename model weight files to a canonical name for easy discovery.
        let out_name = if file_name.ends_with(".onnx") {
            "model.onnx".to_string()
        } else if file_name.ends_with(".pth") {
            "model.pth".to_string()
        } else {
            file_name
        };
        let out_path = dest_dir.join(&out_name);
        let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn convert_rvc_pth_to_onnx(app: AppHandle, model_id: String) -> Result<String, String> {
    convert_rvc_pth_to_onnx_inner(&app, &model_id)
}

fn convert_rvc_pth_to_onnx_inner(app: &AppHandle, model_id: &str) -> Result<String, String> {
    let base = model_dir(&app).join("rvc");
    let model_dir_path = base.join(model_id);
    let onnx_path = model_dir_path.join("model.onnx");

    // Find the .pth file — may be named model.pth or keep its original name.
    let pth_path = {
        let canonical = model_dir_path.join("model.pth");
        if canonical.exists() {
            canonical
        } else {
            std::fs::read_dir(&model_dir_path)
                .ok()
                .and_then(|mut rd| {
                    rd.find(|e| {
                        e.as_ref()
                            .ok()
                            .and_then(|e| {
                                e.path()
                                    .extension()
                                    .and_then(|x| x.to_str())
                                    .map(|x| x == "pth")
                            })
                            .unwrap_or(false)
                    })
                    .and_then(|e| e.ok())
                    .map(|e| e.path())
                })
                .ok_or_else(|| "未找到 .pth 模型文件，请先下载".to_string())?
        }
    };
    if onnx_path.exists() {
        return Ok("model.onnx 已存在".to_string());
    }

    // Write the embedded Python conversion script to a temp file.
    let script = include_str!("rvc_export.py");
    let tmp_script = std::env::temp_dir().join("streamix_rvc_export.py");
    std::fs::write(&tmp_script, script).map_err(|e| e.to_string())?;

    // Try python3, then python.
    let candidates = ["python3", "python"];
    let mut python_bin = None;
    for bin in candidates {
        if std::process::Command::new(bin)
            .arg("--version")
            .output()
            .is_ok()
        {
            python_bin = Some(bin);
            break;
        }
    }
    let python = python_bin.ok_or_else(|| {
        "未找到 Python 解释器。请先安装 Python 3，然后运行: pip install torch".to_string()
    })?;

    let output = std::process::Command::new(python)
        .arg(&tmp_script)
        .arg(&pth_path)
        .arg(&onnx_path)
        .output()
        .map_err(|e| format!("无法运行 Python: {e}"))?;

    if output.status.success() {
        Ok(format!("转换成功: {}", onnx_path.display()))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Provide helpful guidance for common failures.
        let msg = if stderr.contains("No module named 'torch'") {
            "缺少 PyTorch，请运行: pip install torch".to_string()
        } else if stderr.contains("No module named") {
            format!("缺少依赖包，请运行: pip install torch\n详情: {stderr}")
        } else {
            format!("转换失败:\n{stdout}{stderr}")
        };
        Err(msg)
    }
}

fn has_rvc_pth_model(dir: &std::path::Path) -> bool {
    dir.join("model.pth").exists()
        || std::fs::read_dir(dir)
            .ok()
            .and_then(|mut d| {
                d.find(|e| {
                    e.as_ref()
                        .ok()
                        .and_then(|e| {
                            e.path()
                                .extension()
                                .and_then(|x| x.to_str())
                                .map(|x| x == "pth")
                        })
                        .unwrap_or(false)
                })
            })
            .is_some()
}

/// Returns GitHub URLs to try in order.
/// China: ghproxy first (faster when available), then direct (fallback if ghproxy is down).
/// Global: direct only.
fn gh_fallbacks(is_china: bool, github_url: &str) -> Vec<String> {
    if is_china {
        vec![
            format!("https://mirror.ghproxy.com/{github_url}"),
            github_url.to_string(),
        ]
    } else {
        vec![github_url.to_string()]
    }
}

#[cfg(feature = "tauri")]
async fn dl_silero_vad(app: AppHandle, cancel: CancellationToken) -> Result<String, String> {
    let mid = "silero-vad";
    let base = model_dir(&app);
    let out = base.join("silero_vad.onnx");
    if onnx_file_valid(&out) {
        return Ok("VAD 模型已存在".to_string());
    }

    let is_china = detect_china_ip().await;
    let hf = if is_china {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    let mut urls = vec![format!(
        "{hf}/snakers4/silero-vad/resolve/main/files/silero_vad.onnx"
    )];
    urls.extend(gh_fallbacks(
        is_china,
        "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx",
    ));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    emit_mdl(&app, mid, "downloading", 0, None, None);
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;

    let mut last_err = String::from("无可用下载地址");
    for url in &urls {
        let resp = match client.get(url.as_str()).send().await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                last_err = format!("HTTP {} ({})", r.status(), url);
                continue;
            }
            Err(e) => {
                last_err = format!("{e} ({})", url);
                continue;
            }
        };
        let total = resp.content_length().unwrap_or(0);
        let mut overall = 0u64;
        match stream_to_file(&app, mid, resp, &out, &cancel, &mut overall, total).await {
            Ok(_) => {
                emit_mdl(&app, mid, "done", 100, None, None);
                return Ok("VAD 模型下载完成".to_string());
            }
            Err(e) if e.contains("已取消") => return Err(e),
            Err(e) => {
                last_err = e;
                let _ = std::fs::remove_file(&out);
            }
        }
    }
    Err(format!("下载失败: {last_err}"))
}

#[cfg(feature = "tauri")]
async fn dl_sensevoice(app: AppHandle, cancel: CancellationToken) -> Result<String, String> {
    let mid = "sensevoice";
    let base = model_dir(&app);
    let dir_name = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";
    let filename = format!("{dir_name}.tar.bz2");
    let target = base.join(dir_name);
    let tmp = base.join("_sensevoice_dl.tar.bz2");

    let is_china = detect_china_ip().await;
    let hf = if is_china {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    let mut urls = vec![format!(
        "{hf}/csukuangfj/{dir_name}/resolve/main/{filename}"
    )];
    urls.extend(gh_fallbacks(
        is_china,
        &format!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{filename}"),
    ));

    dl_tar_model(&app, &cancel, mid, &urls, &tmp, &base).await?;

    if target.join("model.int8.onnx").exists() {
        emit_mdl(&app, mid, "done", 100, None, None);
        Ok("SenseVoice 模型已准备就绪".to_string())
    } else {
        Err("模型文件校验失败".to_string())
    }
}

#[cfg(feature = "tauri")]
async fn dl_paraformer(app: AppHandle, cancel: CancellationToken) -> Result<String, String> {
    let mid = "paraformer";
    let base = model_dir(&app);
    let dir_name = "sherpa-onnx-paraformer-zh-2023-09-14";
    let filename = format!("{dir_name}.tar.bz2");
    let target = base.join(dir_name);
    let tmp = base.join("_paraformer_dl.tar.bz2");

    let is_china = detect_china_ip().await;
    let hf = if is_china {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    let mut urls = vec![format!(
        "{hf}/csukuangfj/{dir_name}/resolve/main/{filename}"
    )];
    urls.extend(gh_fallbacks(
        is_china,
        &format!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{filename}"),
    ));

    dl_tar_model(&app, &cancel, mid, &urls, &tmp, &base).await?;

    if target.join("model.int8.onnx").exists() || target.join("model.onnx").exists() {
        emit_mdl(&app, mid, "done", 100, None, None);
        Ok("Paraformer 模型已准备就绪".to_string())
    } else {
        Err("模型文件校验失败".to_string())
    }
}

#[cfg(feature = "tauri")]
async fn dl_whisper(
    app: AppHandle,
    cancel: CancellationToken,
    size: &str,
) -> Result<String, String> {
    let mid = format!("whisper-{}", size);
    let base = model_dir(&app);
    let wd = base.join("whisper");
    let out = wd.join(format!("ggml-{}.bin", size));
    if out.exists() {
        return Ok(format!("Whisper {} 模型已存在", size));
    }

    let use_mirror = detect_china_ip().await;
    let hf_base = if use_mirror {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    let url = format!(
        "{}/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        hf_base, size
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;
    emit_mdl(&app, &mid, "downloading", 0, None, None);

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    std::fs::create_dir_all(&wd).map_err(|e| e.to_string())?;
    let mut overall = 0u64;
    stream_to_file(&app, &mid, resp, &out, &cancel, &mut overall, total).await?;

    if out.exists() {
        emit_mdl(&app, &mid, "done", 100, None, None);
        Ok(format!("Whisper {} 模型下载完成", size))
    } else {
        Err("下载后未找到模型文件".to_string())
    }
}

#[cfg(feature = "tauri")]
async fn dl_kokoro(app: AppHandle, cancel: CancellationToken) -> Result<String, String> {
    let mid = "kokoro";
    let base = model_dir(&app);
    let kd = base.join("kokoro");
    let model_file = kd.join("kokoro-v1.0.int8.onnx");
    if model_file.exists() {
        return Ok("Kokoro 模型已存在".to_string());
    }

    let use_mirror = detect_china_ip().await;
    let hf_base = if use_mirror {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    // onnx-community mirror is public (no auth required); model is at onnx/model_quantized.onnx
    let hf_id = "onnx-community/Kokoro-82M-v1.0-ONNX";

    std::fs::create_dir_all(&kd).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(kd.join("voices")).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let model_remote = "onnx/model_quantized.onnx";
    let total_size: u64 = client
        .head(&format!(
            "{}/{}/resolve/main/{}",
            hf_base, hf_id, model_remote
        ))
        .send()
        .await
        .ok()
        .and_then(|r| {
            if r.status().is_success() {
                r.headers()
                    .get(reqwest::header::CONTENT_LENGTH)?
                    .to_str()
                    .ok()?
                    .parse()
                    .ok()
            } else {
                None
            }
        })
        .unwrap_or(92_000_000);

    emit_mdl(&app, mid, "downloading", 0, None, None);

    let model_url = format!("{}/{}/resolve/main/{}", hf_base, hf_id, model_remote);
    let resp = match client.get(&model_url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => return Err(format!("主模型下载失败: HTTP {}", r.status())),
        Err(e) => return Err(format!("网络错误: {e}")),
    };

    let mut overall = 0u64;
    stream_to_file(
        &app,
        mid,
        resp,
        &model_file,
        &cancel,
        &mut overall,
        total_size,
    )
    .await
    .map_err(|e| {
        std::fs::remove_dir_all(&kd).ok();
        e
    })?;

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
                    Err(e) if e.contains("已取消") => {
                        std::fs::remove_dir_all(&kd).ok();
                        return Err(e);
                    }
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

/// 通用 tar.bz2 模型下载：依次尝试 urls 列表，首个成功即解压并返回。
#[cfg(feature = "tauri")]
async fn dl_tar_model(
    app: &AppHandle,
    cancel: &CancellationToken,
    mid: &str,
    urls: &[String],
    tmp: &std::path::Path,
    base: &std::path::Path,
) -> Result<(), String> {
    std::fs::create_dir_all(base).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| e.to_string())?;

    emit_mdl(app, mid, "downloading", 0, None, None);
    let mut last_err = String::from("无可用下载地址");

    'urls: for url in urls {
        for attempt in 1..=3u32 {
            if attempt > 1 {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            }
            let resp = match client.get(url.as_str()).send().await {
                Ok(r) if r.status().is_success() => r,
                Ok(r) => {
                    last_err = format!("HTTP {} ({})", r.status(), url);
                    continue 'urls;
                }
                Err(e) => {
                    last_err = format!("{e} ({})", url);
                    if attempt < 3 {
                        continue;
                    } else {
                        continue 'urls;
                    }
                }
            };
            let total = resp.content_length().unwrap_or(0);
            let mut overall = 0u64;
            match stream_to_file(app, mid, resp, tmp, cancel, &mut overall, total).await {
                Ok(_) => {
                    emit_mdl(app, mid, "extracting", 100, None, None);
                    let out = std::process::Command::new("tar")
                        .arg("xf")
                        .arg(tmp)
                        .arg("-C")
                        .arg(base)
                        .output()
                        .map_err(|e| format!("解压失败: {e}"))?;
                    let _ = std::fs::remove_file(tmp);
                    if !out.status.success() {
                        return Err(format!(
                            "解压失败: {}",
                            String::from_utf8_lossy(&out.stderr)
                        ));
                    }
                    return Ok(());
                }
                Err(e) if e.contains("已取消") => return Err(e),
                Err(e) => {
                    last_err = e;
                    let _ = std::fs::remove_file(tmp);
                }
            }
        } // end for attempt
    } // end 'urls for url
    Err(format!("下载失败: {last_err}"))
}

#[cfg(feature = "tauri")]
async fn dl_kokoro_sherpa(app: AppHandle, cancel: CancellationToken) -> Result<String, String> {
    let mid = "kokoro-sherpa";
    let base = model_dir(&app);
    let dir_name = "sherpa-onnx-kokoro-multi-lang-v1.1-ONNX";
    let filename = format!("{dir_name}.tar.bz2");
    let target = base.join(dir_name);
    let tmp = base.join("_kokoro_sherpa_dl.tar.bz2");

    if target.join("model.onnx").exists() || target.join("model.int8.onnx").exists() {
        return Ok("Kokoro Sherpa 模型已存在".to_string());
    }

    let is_china = detect_china_ip().await;
    let hf = if is_china {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    let mut urls = vec![format!(
        "{hf}/csukuangfj/{dir_name}/resolve/main/{filename}"
    )];
    urls.extend(gh_fallbacks(
        is_china,
        &format!("https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/{filename}"),
    ));

    dl_tar_model(&app, &cancel, mid, &urls, &tmp, &base).await?;

    fix_flat_extract(
        &base,
        &target,
        "model.onnx",
        &[
            "model.onnx",
            "model.int8.onnx",
            "voices.bin",
            "tokens.txt",
            "espeak-ng-data",
        ],
    );

    if target.join("model.onnx").exists() || target.join("model.int8.onnx").exists() {
        emit_mdl(&app, mid, "done", 100, None, None);
        Ok("Kokoro 本地 TTS 模型已准备就绪".to_string())
    } else {
        Err("模型文件校验失败".to_string())
    }
}

#[cfg(feature = "tauri")]
async fn dl_melo_tts(app: AppHandle, cancel: CancellationToken) -> Result<String, String> {
    let mid = "melo-tts";
    let base = model_dir(&app);
    let dir_name = "sherpa-onnx-melo-tts-zh_en";
    let filename = format!("{dir_name}.tar.bz2");
    let target = base.join(dir_name);
    let tmp = base.join("_melo_tts_dl.tar.bz2");

    if target.join("model.onnx").exists() {
        return Ok("MeloTTS 模型已存在".to_string());
    }

    let is_china = detect_china_ip().await;
    let hf = if is_china {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    let mut urls = vec![format!(
        "{hf}/csukuangfj/{dir_name}/resolve/main/{filename}"
    )];
    urls.extend(gh_fallbacks(
        is_china,
        &format!("https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/{filename}"),
    ));

    dl_tar_model(&app, &cancel, mid, &urls, &tmp, &base).await?;

    fix_flat_extract(
        &base,
        &target,
        "model.onnx",
        &["model.onnx", "lexicon.txt", "tokens.txt", "dict"],
    );

    if target.join("model.onnx").exists() {
        emit_mdl(&app, mid, "done", 100, None, None);
        Ok("MeloTTS 模型已准备就绪".to_string())
    } else {
        Err("模型文件校验失败".to_string())
    }
}

#[cfg(feature = "tauri")]
async fn dl_piper_zh(app: AppHandle, cancel: CancellationToken) -> Result<String, String> {
    let mid = "piper-zh";
    let base = model_dir(&app);
    let dir_name = "vits-piper-zh_CN-huayan-medium";
    let filename = format!("{dir_name}.tar.bz2");
    let target = base.join(dir_name);
    let tmp = base.join("_piper_zh_dl.tar.bz2");

    if target.join("model.onnx").exists() {
        return Ok("Piper ZH 模型已存在".to_string());
    }

    let is_china = detect_china_ip().await;
    let hf = if is_china {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    let mut urls = vec![format!(
        "{hf}/csukuangfj/{dir_name}/resolve/main/{filename}"
    )];
    urls.extend(gh_fallbacks(
        is_china,
        &format!("https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/{filename}"),
    ));

    dl_tar_model(&app, &cancel, mid, &urls, &tmp, &base).await?;

    fix_flat_extract(
        &base,
        &target,
        "model.onnx",
        &[
            "model.onnx",
            "model.onnx.json",
            "tokens.txt",
            "espeak-ng-data",
        ],
    );

    if target.join("model.onnx").exists() {
        emit_mdl(&app, mid, "done", 100, None, None);
        Ok("Piper ZH 模型已准备就绪".to_string())
    } else {
        Err("模型文件校验失败".to_string())
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn download_model(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    model_id: String,
) -> Result<String, String> {
    let cancel = CancellationToken::new();
    state
        .model_dl_cancels
        .lock()
        .unwrap()
        .insert(model_id.clone(), cancel.clone());

    let result = if let Some(item) = rvc_catalog_item(&model_id) {
        dl_rvc_model(app, cancel, item).await
    } else {
        match model_id.as_str() {
            "silero-vad" => dl_silero_vad(app, cancel).await,
            "sensevoice" => dl_sensevoice(app, cancel).await,
            "paraformer" => dl_paraformer(app, cancel).await,
            "whisper-tiny" => dl_whisper(app, cancel, "tiny").await,
            "whisper-small" => dl_whisper(app, cancel, "small").await,
            "whisper-medium" => dl_whisper(app, cancel, "medium").await,
            "kokoro" => dl_kokoro(app, cancel).await,
            "kokoro-sherpa" => dl_kokoro_sherpa(app, cancel).await,
            "melo-tts" => dl_melo_tts(app, cancel).await,
            "piper-zh" => dl_piper_zh(app, cancel).await,
            _ => Err(format!("未知模型: {}", model_id)),
        }
    };

    state.model_dl_cancels.lock().unwrap().remove(&model_id);
    result
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn cancel_model_download(
    model_id: String,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    if let Some(cancel) = state.model_dl_cancels.lock().unwrap().remove(&model_id) {
        cancel.cancel();
    }
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| e.to_string())
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

    let (overlay_tx, _) = overlay_server::new_channel();

    let state = SharedState {
        runtime: Arc::new(Runtime::new()?),
        http: api::BiliApi::new()?,
        monitor: Arc::new(Mutex::new(None)),
        storage: Arc::new(storage),
        connected_room: Arc::new(Mutex::new(saved_room)),
        monitor_log_buffer: Arc::new(Mutex::new(Vec::new())),
        overlay_tx: overlay_tx.clone(),
        #[cfg(feature = "tauri")]
        preview_tts: Arc::new(Mutex::new(None)),
        #[cfg(feature = "tauri")]
        preview_tts_playback: Arc::new(tokio::sync::Mutex::new(())),
        #[cfg(feature = "tauri")]
        model_dl_cancels: Arc::new(Mutex::new(std::collections::HashMap::new())),
        session_memory: Arc::new(Mutex::new(bot::memory::SessionMemory::new())),
        agent_runtime: Arc::new(bot::agent::AgentRuntime::new()),
        #[cfg(feature = "tauri")]
        voice_changer: Arc::new(Mutex::new(None)),
    };

    // 启动粉丝档案 LLM 分析 worker（全局单例，record_and_handle_event 会通过 try_enqueue 触发）
    {
        let worker =
            bot::profile_worker::spawn(state.storage.clone(), state.http.clone(), &state.runtime);
        bot::profile_worker::install(worker);
    }

    println!("Starting Tauri builder...");
    let storage_for_cleanup = state.storage.clone();
    let gift_storage_for_refresh = state.storage.clone();
    let gift_room_for_refresh = state.connected_room.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .menu(|app| {
            use tauri::menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};

            let close = MenuItem::with_id(
                app,
                MENU_CLOSE_MAIN_ID,
                "关闭窗口",
                true,
                Some("CmdOrCtrl+W"),
            )?;
            let quit = MenuItem::with_id(
                app,
                MENU_FORCE_QUIT_ID,
                "退出流光",
                true,
                Some("CmdOrCtrl+Q"),
            )?;
            let app_menu = SubmenuBuilder::new(app, "流光")
                .item(&close)
                .item(&quit)
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "编辑")
                .item(&PredefinedMenuItem::undo(app, Some("撤销"))?)
                .item(&PredefinedMenuItem::redo(app, Some("重做"))?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, Some("剪切"))?)
                .item(&PredefinedMenuItem::copy(app, Some("复制"))?)
                .item(&PredefinedMenuItem::paste(app, Some("粘贴"))?)
                .item(&PredefinedMenuItem::select_all(app, Some("全选"))?)
                .build()?;
            MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .build()
        })
        .on_menu_event(|app, event| {
            if event.id().0 == MENU_FORCE_QUIT_ID {
                app.exit(0);
            } else if event.id().0 == MENU_CLOSE_MAIN_ID {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.close();
                }
            }
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();

                if MAIN_CLOSE_PROMPT_OPEN.swap(true, Ordering::SeqCst) {
                    return;
                }

                use tauri_plugin_dialog::DialogExt;

                let app = window.app_handle().clone();
                let window = window.clone();
                app.dialog()
                    .message("要退出程序，还是最小化到后台？")
                    .title("关闭流光")
                    .kind(tauri_plugin_dialog::MessageDialogKind::Info)
                    .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                        "退出".to_string(),
                        "最小化".to_string(),
                    ))
                    .show(move |should_exit| {
                        MAIN_CLOSE_PROMPT_OPEN.store(false, Ordering::SeqCst);
                        if should_exit {
                            app.exit(0);
                        } else {
                            let _ = window.minimize();
                        }
                    });
            }
        })
        .setup(move |app| {
            // 启动弹幕浮层 HTTP 服务（使用独立的 overlay.toml 配置）
            let port = overlay_config::OverlayConfig::load_or_default()
                .map(|c| c.port)
                .unwrap_or(12450);
            let srv_tx = overlay_tx.clone();
            tauri::async_runtime::spawn(async move {
                overlay_server::start(port, srv_tx).await;
            });

            let handle_for_update = app.handle().clone();
            tauri::async_runtime::spawn(update_check_loop(handle_for_update));

            tauri::async_runtime::spawn(db_cleanup_loop(storage_for_cleanup));

            tauri::async_runtime::spawn(gift_catalog_refresh_loop(
                gift_storage_for_refresh,
                gift_room_for_refresh,
            ));

            // 每次启动强制关闭话筒，避免异常退出后残留开启状态
            if let Ok(mut cfg) = AppConfig::load_or_default() {
                if cfg.vad_enabled {
                    cfg.vad_enabled = false;
                    let _ = cfg.save();
                }
            }

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
            start_live_cmd,
            stop_live_cmd,
            update_room_info_cmd,
            get_live_areas,
            get_stream_addr,
            update_room_news_cmd,
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
            get_voice_changer_state,
            start_voice_changer,
            switch_voice_changer_model,
            stop_voice_changer,
            search_rvc_models,
            check_models,
            download_model,
            cancel_model_download,
            delete_model,
            open_folder,
            force_quit,
            convert_rvc_pth_to_onnx,
            get_gift_catalog,
            refresh_gift_catalog,
            get_overlay_url,
            get_wish_goal_url,
            get_lottery_url,
            get_gift_effect_url,
            get_recent_gifts_url,
            get_gift_rank_url,
            get_music_interaction_url,
            search_music_candidates,
            load_overlay_config,
            save_overlay_config,
            load_plugin_settings,
            save_plugin_settings,
            pick_plugin_resource,
            reset_wish_goal,
            simulate_wish_goal,
            simulate_lottery,
            simulate_gift_effect,
            simulate_recent_gift,
            simulate_gift_rank
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_overlay_url(_state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let cfg = overlay_config::OverlayConfig::load_or_default().map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{}", cfg.port))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_wish_goal_url(_state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let cfg = overlay_config::OverlayConfig::load_or_default().map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{}/wish-goal", cfg.port))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_lottery_url(_state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let cfg = overlay_config::OverlayConfig::load_or_default().map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{}/lottery", cfg.port))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_gift_effect_url(_state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let cfg = overlay_config::OverlayConfig::load_or_default().map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{}/gift-effect", cfg.port))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_recent_gifts_url(_state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let cfg = overlay_config::OverlayConfig::load_or_default().map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{}/recent-gifts", cfg.port))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_gift_rank_url(_state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let cfg = overlay_config::OverlayConfig::load_or_default().map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{}/gift-rank", cfg.port))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_music_interaction_url() -> Result<String, String> {
    let cfg = overlay_config::OverlayConfig::load_or_default().map_err(|e| e.to_string())?;
    Ok(format!(
        "http://127.0.0.1:{}/song-request/playlist",
        cfg.port
    ))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn search_music_candidates(
    query: String,
) -> Result<Vec<music::types::SearchCandidate>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let provider = music::providers::netease::NeteaseProvider::new(reqwest::Client::new());
    let service = music::service::MusicInteractionService::new(vec![Box::new(provider)]);
    match service
        .handle_danmu(0, "preview", &format!("点歌 {query}"))
        .await
        .map_err(|e| e.to_string())?
    {
        music::service::SongServiceReply::Candidates { candidates } => Ok(candidates),
        _ => Ok(Vec::new()),
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_gift_catalog(
    state: tauri::State<'_, SharedState>,
) -> Result<Vec<storage::GiftCatalogItem>, String> {
    state.storage.gift_catalog().map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn refresh_gift_catalog(
    state: tauri::State<'_, SharedState>,
) -> Result<Vec<storage::GiftCatalogItem>, String> {
    refresh_gift_catalog_inner(&state).await?;
    state.storage.gift_catalog().map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
async fn refresh_gift_catalog_inner(state: &tauri::State<'_, SharedState>) -> Result<(), String> {
    let room_id = state
        .connected_room
        .lock()
        .ok()
        .and_then(|r| *r)
        .or_else(|| AppConfig::load_or_default().ok().map(|c| c.room_id))
        .filter(|id| *id > 0)
        .unwrap_or(23174842);
    let gifts = fetch_gift_catalog(room_id).await?;
    state
        .storage
        .replace_gift_catalog(&gifts)
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
async fn gift_catalog_refresh_loop(
    storage: Arc<storage::Storage>,
    connected_room: Arc<Mutex<Option<i64>>>,
) {
    loop {
        let stale = storage
            .gift_catalog_stale(GIFT_CATALOG_MAX_AGE_SECS)
            .unwrap_or(true);
        if stale {
            let room_id = connected_room
                .lock()
                .ok()
                .and_then(|r| *r)
                .or_else(|| AppConfig::load_or_default().ok().map(|c| c.room_id))
                .filter(|id| *id > 0)
                .unwrap_or(23174842);
            if let Ok(gifts) = fetch_gift_catalog(room_id).await {
                let _ = storage.replace_gift_catalog(&gifts);
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(
            GIFT_CATALOG_MAX_AGE_SECS as u64,
        ))
        .await;
    }
}

#[cfg(feature = "tauri")]
fn guard_catalog_items(now: String) -> Vec<storage::GiftCatalogItem> {
    vec![
        storage::GiftCatalogItem {
            gift_id: 10001,
            name: "总督".to_string(),
            price: 19_998_000,
            image: FALLBACK_GUARD_ICON.to_string(),
            updated_at: now.clone(),
        },
        storage::GiftCatalogItem {
            gift_id: 10002,
            name: "提督".to_string(),
            price: 1_998_000,
            image: FALLBACK_GUARD_ICON.to_string(),
            updated_at: now.clone(),
        },
        storage::GiftCatalogItem {
            gift_id: 10003,
            name: "舰长".to_string(),
            price: 198_000,
            image: FALLBACK_GUARD_ICON.to_string(),
            updated_at: now,
        },
    ]
}

#[cfg(feature = "tauri")]
fn cache_guard_gift_from_event(storage: &storage::Storage, payload: &serde_json::Value) {
    let live_event = payload.get("event").unwrap_or(payload);
    if live_event.get("type").and_then(serde_json::Value::as_str) != Some("GuardBuy") {
        return;
    }
    let raw = payload.get("raw").unwrap_or(payload);
    let gift_name = live_event
        .get("gift")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            raw.pointer("/data/gift_name")
                .and_then(serde_json::Value::as_str)
        })
        .unwrap_or("舰长");
    let guard_level = raw
        .pointer("/data/guard_level")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_else(|| match gift_name {
            "总督" => 3,
            "提督" => 2,
            _ => 1,
        });
    let image = raw
        .pointer("/data/guard_icon")
        .or_else(|| raw.pointer("/data/gift_img"))
        .or_else(|| raw.pointer("/data/gift_info/img_basic"))
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(FALLBACK_GUARD_ICON);
    let (gift_id, name, price) = match guard_level {
        3 => (10001, "总督", 19_998_000),
        2 => (10002, "提督", 1_998_000),
        _ => (10003, "舰长", 198_000),
    };
    let item = storage::GiftCatalogItem {
        gift_id,
        name: name.to_string(),
        price,
        image: image.to_string(),
        updated_at: Local::now().to_rfc3339(),
    };
    let _ = storage.upsert_gift_catalog_items(&[item]);
}

#[cfg(feature = "tauri")]
async fn fetch_gift_catalog(room_id: i64) -> Result<Vec<storage::GiftCatalogItem>, String> {
    let url = format!(
        "https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/roomGiftList?platform=pc&room_id={room_id}"
    );
    let value: serde_json::Value = reqwest::Client::new()
        .get(url)
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if value.get("code").and_then(serde_json::Value::as_i64) != Some(0) {
        return Err(value
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("获取礼物列表失败")
            .to_string());
    }
    let now = Local::now().to_rfc3339();
    let mut gifts = value
        .pointer("/data/gift_config/base_config/list")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "礼物列表格式异常".to_string())?
        .iter()
        .filter_map(|item| {
            let gift_id = item
                .get("id")
                .or_else(|| item.get("gift_id"))
                .and_then(serde_json::Value::as_i64)?;
            let name = item
                .get("name")
                .and_then(serde_json::Value::as_str)?
                .trim()
                .to_string();
            let price = item
                .get("price")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0);
            let image = item
                .get("img_basic")
                .or_else(|| item.get("img_dynamic"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            if !valid_gift_catalog_item(&name, &image, price) {
                return None;
            }
            Some(storage::GiftCatalogItem {
                gift_id,
                name,
                price,
                image,
                updated_at: now.clone(),
            })
        })
        .collect::<Vec<_>>();
    gifts.extend(guard_catalog_items(now));
    gifts.sort_by(|a, b| a.price.cmp(&b.price).then_with(|| a.name.cmp(&b.name)));
    gifts.dedup_by_key(|gift| gift.gift_id);
    Ok(gifts)
}

#[cfg(feature = "tauri")]
fn valid_gift_catalog_item(name: &str, image: &str, price: i64) -> bool {
    if name.is_empty() || image.is_empty() || price < 0 {
        return false;
    }
    let lower = name.to_ascii_lowercase();
    !["测试", "test", "过期", "下架", "废弃", "失效", "debug"]
        .iter()
        .any(|needle| lower.contains(needle) || name.contains(needle))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn load_overlay_config() -> Result<overlay_config::OverlayConfig, String> {
    overlay_config::OverlayConfig::load_or_default().map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn save_overlay_config(
    config: overlay_config::OverlayConfig,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    config.save().map_err(|e| e.to_string())?;
    // 通知所有 overlay 网页客户端重新拉取配置
    overlay_server::broadcast_cfg_update(&state.overlay_tx);
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn load_plugin_settings() -> Result<plugin_settings::PluginSettings, String> {
    plugin_settings::PluginSettings::load_or_default().map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn save_plugin_settings(
    config: plugin_settings::PluginSettings,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    config.save().map_err(|e| e.to_string())?;
    overlay_server::broadcast_plugin_settings_update(&state.overlay_tx);
    Ok(())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn pick_plugin_resource(app: AppHandle, kind: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (title, filter, extensions): (&str, &str, &[&str]) = match kind.as_str() {
        "sound" => ("选择音效文件", "音频文件", &["mp3", "wav", "ogg"]),
        _ => return Err("不支持的资源类型".to_string()),
    };

    let file = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter(filter, extensions)
        .blocking_pick_file();

    match file {
        Some(path) => {
            let path = path
                .into_path()
                .map_err(|_| "无法读取所选文件路径".to_string())?;
            let ext = path
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !extensions.iter().any(|allowed| *allowed == ext) {
                return Err(format!("请选择 {} 文件", extensions.join("/")));
            }
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn reset_wish_goal(
    state: tauri::State<'_, SharedState>,
) -> Result<plugin_settings::PluginSettings, String> {
    let mut config =
        plugin_settings::PluginSettings::load_or_default().map_err(|e| e.to_string())?;
    config.reset_wish_goal();
    config.save().map_err(|e| e.to_string())?;
    overlay_server::broadcast_plugin_settings_update(&state.overlay_tx);
    Ok(config)
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn simulate_wish_goal(
    state: tauri::State<'_, SharedState>,
) -> Result<plugin_settings::PluginSettings, String> {
    let mut config =
        plugin_settings::PluginSettings::load_or_default().map_err(|e| e.to_string())?;
    config.simulate_wish_goal();
    config.save().map_err(|e| e.to_string())?;
    overlay_server::broadcast_plugin_settings_update(&state.overlay_tx);
    Ok(config)
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn simulate_lottery(
    state: tauri::State<'_, SharedState>,
) -> Result<plugin_settings::PluginSettings, String> {
    let mut config =
        plugin_settings::PluginSettings::load_or_default().map_err(|e| e.to_string())?;
    config.simulate_lottery();
    config.save().map_err(|e| e.to_string())?;
    overlay_server::broadcast_plugin_settings_update(&state.overlay_tx);
    Ok(config)
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn simulate_gift_effect(
    state: tauri::State<'_, SharedState>,
) -> Result<plugin_settings::PluginSettings, String> {
    let mut config =
        plugin_settings::PluginSettings::load_or_default().map_err(|e| e.to_string())?;
    config.simulate_gift_effect();
    config.save().map_err(|e| e.to_string())?;
    overlay_server::broadcast_plugin_settings_update(&state.overlay_tx);
    Ok(config)
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn simulate_recent_gift(
    state: tauri::State<'_, SharedState>,
) -> Result<plugin_settings::PluginSettings, String> {
    let mut config =
        plugin_settings::PluginSettings::load_or_default().map_err(|e| e.to_string())?;
    config.simulate_recent_gift();
    config.save().map_err(|e| e.to_string())?;
    overlay_server::broadcast_plugin_settings_update(&state.overlay_tx);
    Ok(config)
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn simulate_gift_rank(
    state: tauri::State<'_, SharedState>,
) -> Result<plugin_settings::PluginSettings, String> {
    let mut config =
        plugin_settings::PluginSettings::load_or_default().map_err(|e| e.to_string())?;
    config.simulate_gift_rank();
    config.save().map_err(|e| e.to_string())?;
    overlay_server::broadcast_plugin_settings_update(&state.overlay_tx);
    Ok(config)
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
