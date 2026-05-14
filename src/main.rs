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
                return Ok(());
            }
        } else if event == "live-event" {
            // Already handled via live-events batching in monitor.rs
            return Ok(());
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
    tokio::spawn(async move {
        if let Err(e) =
            crate::bot::monitor::run_monitor_loop(emitter, http, room_id, cancel, session_id, danmaku_buf, models)
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
async fn send_ai_message(
    state: tauri::State<'_, SharedState>,
    prompt: String,
) -> Result<String, String> {
    let config = AppConfig::load_or_default().map_err(|e| e.to_string())?;
    state
        .http
        .robot_assistant_reply(&config, &prompt)
        .await
        .map_err(|e| e.to_string())
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
        buf.drain(..).collect()
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
async fn download_update(app: AppHandle) -> Result<(), String> {
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

    // Store the installer in state or just prompt immediately after manual download too
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let changelog = update.body.as_deref().unwrap_or("无更新日志");
    app.dialog()
        .message(format!("新版本 v{} 已下载完成。\n\n【更新日志】\n{}\n\n是否现在安装并重启？", update.version, changelog))
        .title("下载完成")
        .kind(tauri_plugin_dialog::MessageDialogKind::Info)
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
            "现在安装".to_string(),
            "下次再说".to_string(),
        ))
        .show(move |result| {
            let _ = tx.send(result);
        });

    if rx.await.unwrap_or(false) {
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
#[tauri::command]
fn check_voice_models(app: AppHandle) -> Result<serde_json::Value, String> {
    let base = model_dir(&app);

    let vad_ok = base.join("silero_vad.onnx").exists();
    let asr_local_dir = base.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");
    let asr_local_ok = asr_local_dir.join("model.int8.onnx").exists()
        && asr_local_dir.join("tokens.txt").exists();

    Ok(serde_json::json!({
        "vad_model_ok": vad_ok,
        "asr_local_model_ok": asr_local_ok,
        "asr_model_dir": asr_local_dir.to_string_lossy(),
    }))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn download_sensevoice_model(app: AppHandle) -> Result<String, String> {
    let base = model_dir(&app);
    let target_dir = base.join("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17");

    // 已存在则跳过
    if target_dir.join("model.int8.onnx").exists() && target_dir.join("tokens.txt").exists() {
        return Ok("SenseVoice 模型已存在".to_string());
    }

    let use_mirror = detect_china_ip().await;
    let direct = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2";
    let mirror = "https://ghproxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2";
    let url = if use_mirror { mirror } else { direct };
    let tmp = base.join("_sensevoice_dl.tar.bz2");

    let _ = app.emit("voice-model-progress", serde_json::json!({ "stage": "downloading", "pct": 0u32 }));

    // 下载
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client.get(url).send().await.map_err(|e| format!("下载失败: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let _file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;

    use tokio::io::AsyncWriteExt;
    let tmp_path = tmp.clone();
    let app2 = app.clone();

    // 使用同步 IO 写文件，异步收数据
    let mut tmp_file = tokio::fs::File::from_std(std::fs::File::create(&tmp_path).map_err(|e| e.to_string())?);
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("下载中断: {e}"))? {
        tmp_file.write_all(&chunk).await.map_err(|e| format!("写入失败: {e}"))?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = ((downloaded as f64 / total as f64) * 100.0) as u32;
            let _ = app2.emit("voice-model-progress", serde_json::json!({
                "stage": "downloading",
                "pct": pct,
                "downloaded_mb": format!("{:.1}", downloaded as f64 / 1_048_576.0),
                "total_mb": format!("{:.1}", total as f64 / 1_048_576.0),
            }));
        }
    }
    drop(tmp_file);

    let _ = app.emit("voice-model-progress", serde_json::json!({ "stage": "extracting", "pct": 100u32 }));

    // 解压
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let output = std::process::Command::new("tar")
        .arg("xf")
        .arg(&tmp)
        .arg("-C")
        .arg(&base)
        .output()
        .map_err(|e| format!("解压失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("解压失败: {}", stderr));
    }

    // 清理临时文件
    let _ = std::fs::remove_file(&tmp);

    if target_dir.join("model.int8.onnx").exists() {
        let _ = app.emit("voice-model-progress", serde_json::json!({ "stage": "done", "pct": 100u32 }));
        Ok("SenseVoice 模型下载完成".to_string())
    } else {
        Err("解压后未找到模型文件，请检查目录结构".to_string())
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn download_vad_model(app: AppHandle) -> Result<String, String> {
    let base = model_dir(&app);
    let out_path = base.join("silero_vad.onnx");

    if out_path.exists() {
        return Ok("VAD 模型已存在".to_string());
    }

    let use_mirror = detect_china_ip().await;
    let direct = "https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx";
    let mirror = "https://ghproxy.com/https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx";
    let url = if use_mirror { mirror } else { direct };

    let _ = app.emit("vad-model-progress", serde_json::json!({ "stage": "downloading", "pct": 0u32 }));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client.get(url).send().await.map_err(|e| format!("下载失败: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::from_std(
        std::fs::File::create(&out_path).map_err(|e| e.to_string())?,
    );

    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("下载中断: {e}"))? {
        file.write_all(&chunk).await.map_err(|e| format!("写入失败: {e}"))?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = ((downloaded as f64 / total as f64) * 100.0) as u32;
            let _ = app.emit("vad-model-progress", serde_json::json!({
                "stage": "downloading",
                "pct": pct,
                "downloaded_mb": format!("{:.2}", downloaded as f64 / 1_048_576.0),
                "total_mb": format!("{:.2}", total as f64 / 1_048_576.0),
            }));
        }
    }
    drop(file);

    if out_path.exists() {
        let _ = app.emit("vad-model-progress", serde_json::json!({ "stage": "done", "pct": 100u32 }));
        Ok("VAD 模型下载完成".to_string())
    } else {
        Err("下载后未找到模型文件".to_string())
    }
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
    };

    println!("Starting Tauri builder...");
    let storage_for_cleanup = state.storage.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
            check_voice_models,
            download_sensevoice_model,
            download_vad_model,
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
