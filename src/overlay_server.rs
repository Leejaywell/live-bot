//! 弹幕聊天 HTTP 服务
//!
//! GET /        → 弹幕聊天页面
//! GET /cfg     → 当前 DanmakuChatSettings（JSON）
//! GET /wish-goal → 心愿目标页面
//! GET /lottery → 抽奖互动页面
//! GET /gift-effect → 礼物特效页面
//! GET /recent-gifts → 最近礼物页面
//! GET /gift-rank → 礼物排行页面
//! GET /song-request → 音乐互动页面
//! GET /song-request/api/queue → 音乐互动队列（JSON）
//! GET /song-request/api/now-playing → 当前播放歌曲（JSON）
//! GET /song-request/api/rank → 音乐互动排行（JSON）
//! GET /plugin-settings → 插件配置（JSON）
//! GET /ws      → WebSocket，推送 live-event 事件流 + 配置变更通知
//! GET /proxy   → 图片代理，绕过 B站 CDN CORS 限制

use axum::{
    Router,
    body::Body,
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{Response, StatusCode, header},
    response::{Html, IntoResponse, Json},
    routing::get,
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path as FsPath, PathBuf};
use std::sync::{Arc, OnceLock};
use tokio::sync::broadcast;

use crate::music::storage::QueueItem;
use crate::plugin_settings::PluginSettings;
use crate::storage::Storage;

const DANMAKU_CHAT_HTML: &str = include_str!("danmaku_chat.html");

pub type OverlayTx = Arc<broadcast::Sender<Value>>;

#[derive(Clone)]
struct AppState {
    tx: OverlayTx,
    asset_roots: Arc<Vec<PathBuf>>,
}

pub fn new_channel() -> (OverlayTx, broadcast::Receiver<Value>) {
    let (tx, rx) = broadcast::channel(256);
    (Arc::new(tx), rx)
}

/// 让 main.rs 在 save_danmaku_chat_config 之后调用，通知所有弹幕聊天网页客户端重新拉取配置
pub fn broadcast_cfg_update(tx: &OverlayTx) {
    let msg = serde_json::json!({ "_overlay_cfg_update": true });
    let _ = tx.send(msg);
}

pub fn broadcast_plugin_settings_update(tx: &OverlayTx) {
    let msg = serde_json::json!({ "_plugin_settings_update": true });
    let _ = tx.send(msg);
}

pub async fn start(port: u16, tx: OverlayTx, resource_dir: Option<PathBuf>) {
    let state = AppState {
        tx,
        asset_roots: Arc::new(overlay_asset_roots(resource_dir.as_deref())),
    };

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/cfg", get(cfg_handler))
        .route("/wish-goal", get(wish_goal_handler))
        .route("/lottery", get(lottery_handler))
        .route("/gift-effect", get(gift_effect_handler))
        .route("/recent-gifts", get(recent_gifts_handler))
        .route("/gift-rank", get(gift_rank_handler))
        .route("/song-request", get(music_interaction_handler))
        .route("/song-request/playlist", get(music_interaction_handler))
        .route("/song-request/now-playing", get(music_interaction_handler))
        .route("/song-request/rank", get(music_interaction_handler))
        .route("/song-request/api/queue", get(song_queue_handler))
        .route(
            "/song-request/api/now-playing",
            get(song_now_playing_handler),
        )
        .route("/song-request/api/rank", get(song_rank_handler))
        .route("/plugin-settings", get(plugin_settings_handler))
        .route("/local-resource", get(local_resource_handler))
        .route(
            "/danmaku-chat-assets/{*path}",
            get(danmaku_chat_asset_handler),
        )
        .route("/ws", get(ws_handler))
        .route("/proxy", get(proxy_handler))
        .with_state(state);

    let addr = format!("127.0.0.1:{port}");
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("弹幕聊天服务绑定 {addr} 失败: {e}");
            return;
        }
    };
    println!("弹幕聊天服务已启动: http://{addr}");
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("弹幕聊天服务异常退出: {e}");
    }
}

// ── Route handlers ─────────────────────────────────────────────────────────────

async fn index_handler() -> Html<&'static str> {
    danmaku_chat_shell()
}

async fn wish_goal_handler() -> Html<&'static str> {
    danmaku_chat_shell()
}

async fn lottery_handler() -> Html<&'static str> {
    danmaku_chat_shell()
}

async fn gift_effect_handler() -> Html<&'static str> {
    danmaku_chat_shell()
}

async fn recent_gifts_handler() -> Html<&'static str> {
    danmaku_chat_shell()
}

async fn gift_rank_handler() -> Html<&'static str> {
    danmaku_chat_shell()
}

async fn music_interaction_handler() -> Html<&'static str> {
    danmaku_chat_shell()
}

fn danmaku_chat_shell() -> Html<&'static str> {
    Html(DANMAKU_CHAT_HTML)
}

fn overlay_asset_roots(resource_dir: Option<&FsPath>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(resource_dir) = resource_dir {
        roots.push(resource_dir.join("src-tauri/dist/assets"));
        roots.push(resource_dir.join("dist/assets"));
        roots.push(resource_dir.join("assets"));
    }
    roots.push(PathBuf::from("src-tauri/dist/assets"));
    roots
}

async fn danmaku_chat_asset_handler(
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Response<Body> {
    let safe_path = path.trim_start_matches('/');
    if safe_path.contains("..") || safe_path.contains('\\') {
        return empty_response(StatusCode::FORBIDDEN);
    }
    let Some((full_path, bytes)) = state.asset_roots.iter().find_map(|root| {
        let candidate = root.join(safe_path);
        std::fs::read(&candidate)
            .ok()
            .map(|bytes| (candidate, bytes))
    }) else {
        return empty_response(StatusCode::NOT_FOUND);
    };
    let content_type = match full_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
    {
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

async fn cfg_handler() -> impl IntoResponse {
    let cfg = PluginSettings::load_or_default()
        .map(|settings| settings.danmaku_chat)
        .unwrap_or_default();
    Json(cfg)
}

async fn plugin_settings_handler() -> impl IntoResponse {
    let cfg = PluginSettings::load_or_default().unwrap_or_default();
    Json(cfg)
}

#[derive(Serialize)]
struct QueueResponse {
    items: Vec<QueueItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NowPlayingResponse {
    item: Option<QueueItem>,
}

#[derive(Serialize)]
struct RankResponse {
    items: Vec<SongRankItem>,
}

#[derive(Serialize)]
struct SongRankItem {
    uname: String,
    value: i64,
    count: i64,
    tier: String,
}

async fn song_queue_handler() -> impl IntoResponse {
    Json(QueueResponse {
        items: observed_music_queue(),
    })
}

async fn song_now_playing_handler() -> impl IntoResponse {
    let item = observed_music_queue()
        .into_iter()
        .find(|item| item.status == "playing");
    Json(NowPlayingResponse { item })
}

async fn song_rank_handler() -> impl IntoResponse {
    Json(RankResponse {
        items: observed_song_rank(),
    })
}

fn observed_music_queue() -> Vec<QueueItem> {
    let room_id = match crate::token::read_connected_room() {
        Some(room_id) => room_id,
        None => match crate::config::AppConfig::load_or_default() {
            Ok(app) => app.room_id,
            Err(e) => {
                eprintln!("音乐互动浮层读取配置失败: {e}");
                return Vec::new();
            }
        },
    };
    let storage = match overlay_storage() {
        Ok(storage) => storage,
        Err(e) => {
            eprintln!("音乐互动浮层打开存储失败: {e}");
            return Vec::new();
        }
    };

    let result = storage.with_connection(|conn| {
        let session = conn
            .query_row(
                "select id, room_id
                 from live_sessions
                 where start_source = 'observed'
                   and ended_at is null
                   and room_id = ?1
                 order by started_at desc
                 limit 1",
                params![room_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let Some((session_id, room_id)) = session else {
            return Ok(Vec::new());
        };
        crate::music::storage::list_queue(conn, &session_id, room_id)
    });

    match result {
        Ok(items) => items,
        Err(e) => {
            eprintln!("音乐互动浮层读取队列失败: {e}");
            Vec::new()
        }
    }
}

fn observed_song_rank() -> Vec<SongRankItem> {
    let room_id = match crate::token::read_connected_room() {
        Some(room_id) => room_id,
        None => match crate::config::AppConfig::load_or_default() {
            Ok(app) => app.room_id,
            Err(e) => {
                eprintln!("音乐互动排行读取配置失败: {e}");
                return Vec::new();
            }
        },
    };
    let storage = match overlay_storage() {
        Ok(storage) => storage,
        Err(e) => {
            eprintln!("音乐互动排行打开存储失败: {e}");
            return Vec::new();
        }
    };

    let result = storage.with_connection(|conn| {
        let session_id = conn
            .query_row(
                "select id
                 from live_sessions
                 where start_source = 'observed'
                   and ended_at is null
                   and room_id = ?1
                 order by started_at desc
                 limit 1",
                params![room_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(session_id) = session_id else {
            return Ok(Vec::new());
        };

        let mut stmt = conn.prepare(
            "select
                grouped.uid,
                (
                  select sr_name.uname
                  from song_requests sr_name
                  where sr_name.session_id = ?1
                    and sr_name.room_id = ?2
                    and sr_name.uid = grouped.uid
                  order by sr_name.created_at desc, sr_name.id desc
                  limit 1
                ) as uname,
                sum(credit_value) as value,
                count(*) as request_count,
                (
                  select sr_tier.tier
                  from song_requests sr_tier
                  where sr_tier.session_id = ?1
                    and sr_tier.room_id = ?2
                    and sr_tier.uid = grouped.uid
                  order by sr_tier.credit_value desc, sr_tier.id asc
                  limit 1
                ) as tier
             from song_requests grouped
             where grouped.session_id = ?1
               and grouped.room_id = ?2
             group by grouped.uid
             order by value desc, request_count desc, uid asc
             limit 20",
        )?;
        let rows = stmt.query_map(params![session_id, room_id], |row| {
            Ok(SongRankItem {
                uname: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                value: row.get(2)?,
                count: row.get(3)?,
                tier: row
                    .get::<_, Option<String>>(4)?
                    .unwrap_or_else(|| "normal".to_string()),
            })
        })?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    });

    match result {
        Ok(items) => items,
        Err(e) => {
            eprintln!("音乐互动排行读取失败: {e}");
            Vec::new()
        }
    }
}

fn overlay_storage() -> anyhow::Result<Arc<Storage>> {
    static STORAGE: OnceLock<Arc<Storage>> = OnceLock::new();
    if let Some(storage) = STORAGE.get() {
        return Ok(Arc::clone(storage));
    }

    let path = crate::config::db_path();
    let storage = Arc::new(Storage::open(&path.to_string_lossy())?);
    if STORAGE.set(Arc::clone(&storage)).is_err() {
        if let Some(storage) = STORAGE.get() {
            return Ok(Arc::clone(storage));
        }
    }
    Ok(storage)
}

async fn local_resource_handler(Query(q): Query<ProxyQuery>) -> Response<Body> {
    let Ok(cfg) = PluginSettings::load_or_default() else {
        return empty_response(StatusCode::NOT_FOUND);
    };
    let allowed = [
        cfg.wish_goal.custom_sound_path,
        cfg.gift_effect.custom_sound_path,
    ];
    if !allowed
        .iter()
        .any(|path| !path.is_empty() && path == &q.url)
    {
        return empty_response(StatusCode::FORBIDDEN);
    }
    let path = std::path::PathBuf::from(&q.url);
    if !path.is_file() {
        return empty_response(StatusCode::NOT_FOUND);
    }
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => return empty_response(StatusCode::NOT_FOUND),
    };
    let ct = match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, ct)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from(bytes))
        .unwrap()
}

fn empty_response(status: StatusCode) -> Response<Body> {
    Response::builder()
        .status(status)
        .body(Body::empty())
        .unwrap()
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    let rx = state.tx.subscribe();
    ws.on_upgrade(|socket| handle_ws(socket, rx))
}

async fn handle_ws(mut socket: WebSocket, mut rx: broadcast::Receiver<Value>) {
    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(val) => {
                        if socket.send(Message::Text(val.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                if msg.is_none() { break; }
                // ignore client → server messages
            }
        }
    }
}

// ── Image proxy (hdslb.com / bilibili.com only) ────────────────────────────────

#[derive(Deserialize)]
struct ProxyQuery {
    url: String,
}

async fn proxy_handler(Query(q): Query<ProxyQuery>) -> Response<Body> {
    if !q.url.starts_with("https://i") || !q.url.contains("hdslb.com") {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Body::empty())
            .unwrap();
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let resp = match client.get(&q.url).send().await {
        Ok(r) if r.status().is_success() => r,
        _ => {
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::empty())
                .unwrap();
        }
    };

    let ct = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_owned();

    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::empty())
                .unwrap();
        }
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, ct)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .body(Body::from(bytes))
        .unwrap()
}
