mod api;
mod bot;
mod config;
mod storage;
mod token;

use anyhow::Result;
use config::AppConfig;
use std::sync::{Arc, Mutex};
use tokio::runtime::Runtime;
use tokio_util::sync::CancellationToken;

#[cfg(feature = "tauri")]
use tauri::AppHandle;

#[derive(Clone)]
struct SharedState {
    #[allow(dead_code)]
    runtime: Arc<Runtime>,
    http: api::BiliApi,
    monitor: Arc<Mutex<Option<MonitorHandle>>>,
    storage: Arc<storage::Storage>,
    connected_room: Arc<Mutex<Option<i64>>>,
    monitor_log_buffer: Arc<Mutex<Vec<String>>>,
}

struct MonitorHandle {
    cancel: CancellationToken,
    session_id: Arc<Mutex<Option<String>>>,
}

#[cfg(feature = "tauri")]
struct BufferedEmitter {
    handle: AppHandle,
    buffer: Arc<Mutex<Vec<String>>>,
}

#[cfg(feature = "tauri")]
impl bot::EventEmitter for BufferedEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) -> anyhow::Result<()> {
        if event == "monitor-log" {
            if let Some(text) = payload.as_str() {
                if let Ok(mut buf) = self.buffer.lock() {
                    buf.push(text.to_string());
                    if buf.len() > 200 {
                        buf.remove(0);
                    }
                }
            }
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

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_user_info(state: tauri::State<'_, SharedState>) -> Result<serde_json::Value, String> {
    let saved_at = token::cookie_file_modified_secs().unwrap_or(0);
    let cookie = match token::read_cookie_string() {
        Ok(c) => c,
        Err(_) => {
            return Ok(serde_json::json!({
                "uid": 0, "uname": "", "face": "", "is_login": false, "saved_at": saved_at
            }));
        }
    };
    match state.http.user_info(&cookie).await {
        Ok(info) => Ok(serde_json::json!({
            "uid": info.uid,
            "uname": info.uname,
            "face": info.face,
            "level": info.level,
            "vip_status": info.vip_status,
            "vip_type": info.vip_type,
            "coins": info.coins,
            "vip_nickname_color": info.vip_nickname_color,
            "is_login": true,
            "saved_at": saved_at
        })),
        Err(_) => {
            // Cookie expired — try refresh_token
            if let Some(rt) = token::read_refresh_token() {
                if let Ok((new_cookie, new_rt)) = state.http.refresh_cookie(&rt, &cookie).await {
                    let _ = token::write_cookie(&new_cookie);
                    if !new_rt.is_empty() {
                        let _ = token::write_refresh_token(&new_rt);
                    }
                    // Retry user_info with new cookie
                    if let Ok(info) = state.http.user_info(&new_cookie.cookie_string).await {
                        let new_saved_at = token::cookie_file_modified_secs().unwrap_or(0);
                        return Ok(serde_json::json!({
                            "uid": info.uid,
                            "uname": info.uname,
                            "face": info.face,
                            "level": info.level,
                            "vip_status": info.vip_status,
                            "vip_type": info.vip_type,
                            "coins": info.coins,
                            "vip_nickname_color": info.vip_nickname_color,
                            "is_login": true,
                            "saved_at": new_saved_at
                        }));
                    }
                }
            }
            Ok(serde_json::json!({
                "uid": 0, "uname": "", "face": "", "level": 0,
                "vip_status": 0, "vip_type": 0, "coins": 0.0, "vip_nickname_color": "",
                "is_login": false, "saved_at": saved_at
            }))
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
            token::write_cookie(&cookie).map_err(|e| e.to_string())?;
            if !refresh_token.is_empty() {
                let _ = token::write_refresh_token(&refresh_token);
            }
            // Immediately fetch user info after saving cookie
            let cookie_str = &cookie.cookie_string;
            match state.http.user_info(cookie_str).await {
                Ok(info) => Ok(serde_json::json!({
                    "status": "Success",
                    "uid": info.uid,
                    "uname": info.uname,
                    "face": info.face,
                    "level": info.level,
                    "vip_status": info.vip_status,
                    "vip_type": info.vip_type,
                    "coins": info.coins,
                    "vip_nickname_color": info.vip_nickname_color,
                    "is_login": true
                })),
                Err(_) => Ok(serde_json::json!({ "status": "Success" })),
            }
        }
        Ok(api::LoginPoll::Expired(msg)) => {
            Ok(serde_json::json!({ "status": "Expired", "message": msg }))
        }
        Ok(api::LoginPoll::Pending(msg)) => {
            Ok(serde_json::json!({ "status": "Scanning", "message": msg }))
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
    token::delete_cookie().map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn refresh_cookie(state: tauri::State<'_, SharedState>) -> Result<serde_json::Value, String> {
    let rt = token::read_refresh_token().ok_or("没有 refresh_token")?;
    let cookie = token::read_cookie_string().map_err(|e| e.to_string())?;
    let (new_cookie, new_rt) = state
        .http
        .refresh_cookie(&rt, &cookie)
        .await
        .map_err(|e| e.to_string())?;
    token::write_cookie(&new_cookie).map_err(|e| e.to_string())?;
    if !new_rt.is_empty() {
        let _ = token::write_refresh_token(&new_rt);
    }
    let saved_at = token::cookie_file_modified_secs().unwrap_or(0);
    match state.http.user_info(&new_cookie.cookie_string).await {
        Ok(info) => Ok(serde_json::json!({
            "success": true, "uid": info.uid, "uname": info.uname, "face": info.face, "saved_at": saved_at
        })),
        Err(_) => Ok(serde_json::json!({ "success": true, "saved_at": saved_at })),
    }
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_system_info() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "config_path": "etc/bilidanmaku-api.yaml",
        "db_path": "db/sqliteDataBase.db"
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

    let cancel = CancellationToken::new();
    let session_id = Arc::new(Mutex::new(None));
    let handle = MonitorHandle {
        cancel: cancel.clone(),
        session_id: session_id.clone(),
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

    let emitter = BufferedEmitter {
        handle: app.clone(),
        buffer: state.monitor_log_buffer.clone(),
    };

    tokio::spawn(async move {
        if let Err(e) =
            crate::bot::monitor::run_monitor_loop(emitter, http, room_id, cancel, session_id)
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
    let cookie = token::read_cookie_string().map_err(|e| e.to_string())?;
    state
        .http
        .send_danmu(room_id, &message, &cookie)
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
        Some(id) => std::fs::write("token/connected_room", id.to_string()).map_err(|e| e.to_string())?,
        None => { let _ = std::fs::remove_file("token/connected_room"); }
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

#[cfg(feature = "tauri")]
#[tauri::command]
async fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(url, None).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn open_config_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let path = std::env::current_dir()
        .map(|p| p.join("etc"))
        .unwrap_or_else(|_| std::path::PathBuf::from("etc"));
    app.shell()
        .open(path.to_string_lossy().to_string(), None)
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
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
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

    update
        .download_and_install(
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

    Ok(())
}

#[cfg(feature = "tauri")]
async fn try_refresh_cookie_once(http: &api::BiliApi, app: &AppHandle) {
    let Ok(cookie) = token::read_cookie_string() else { return };
    let needs_refresh = match http.check_cookie_refresh_needed(&cookie).await {
        Ok(v) => v,
        Err(_) => return,
    };
    if !needs_refresh {
        return;
    }
    let Some(rt) = token::read_refresh_token() else { return };
    match http.refresh_cookie(&rt, &cookie).await {
        Ok((new_cookie, new_rt)) => {
            let _ = token::write_cookie(&new_cookie);
            if !new_rt.is_empty() {
                let _ = token::write_refresh_token(&new_rt);
            }
            let _ = tauri::Emitter::emit(app, "cookie-refreshed", serde_json::json!({ "success": true }));
            println!("[cookie] 自动刷新成功");
        }
        Err(e) => {
            println!("[cookie] 自动刷新失败: {e}");
        }
    }
}

#[cfg(feature = "tauri")]
async fn cookie_refresh_loop(http: api::BiliApi, app: AppHandle) {
    // 启动后稍等 15 秒，等 App 完全初始化
    tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
    loop {
        try_refresh_cookie_once(&http, &app).await;
        tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
    }
}

#[cfg(feature = "tauri")]
fn main() -> Result<()> {
    println!("Starting Streamix backend...");
    ensure_dirs()?;

    println!("Loading configuration...");
    let config = AppConfig::load_or_default()?;
    let storage_path = format!(
        "{}/{}",
        config.db_path.trim_end_matches('/'),
        config.db_name
    );

    println!("Opening storage at {}...", storage_path);
    let storage = storage::Storage::open(&storage_path)?;

    let saved_room = std::fs::read_to_string("token/connected_room")
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok());

    let state = SharedState {
        runtime: Arc::new(Runtime::new()?),
        http: api::BiliApi::new()?,
        monitor: Arc::new(Mutex::new(None)),
        storage: Arc::new(storage),
        connected_room: Arc::new(Mutex::new(saved_room)),
        monitor_log_buffer: Arc::new(Mutex::new(Vec::new())),
    };

    let http_for_refresh = state.http.clone();

    println!("Starting Tauri builder...");
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .setup(move |app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(cookie_refresh_loop(http_for_refresh, handle));
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
            refresh_cookie,
            get_system_info,
            start_monitor,
            stop_monitor,
            get_monitor_status,
            get_stats,
            get_gift_stats,
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
            get_monitor_logs
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
