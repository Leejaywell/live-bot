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
//! GET /recent-events → 最近事件（JSON）
//! GET /gift-catalog → 礼物名到缓存图地址的映射（JSON）
//! GET /recent-gifts-data → 最近礼物历史（JSON）
//! GET /gift-rank-data → 今日礼物排行历史（JSON）
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
use std::collections::BTreeMap;
use std::path::{Path as FsPath, PathBuf};
use std::sync::{Arc, OnceLock};
use tokio::sync::broadcast;

use crate::music::storage::QueueItem;
use crate::plugin_settings::PluginSettings;
use crate::storage::Storage;

const DANMAKU_CHAT_HTML: &str = include_str!("danmaku_chat.html");

pub type DanmakuChatTx = Arc<broadcast::Sender<Value>>;

#[derive(Clone)]
struct AppState {
    tx: DanmakuChatTx,
    asset_roots: Arc<Vec<PathBuf>>,
}

pub fn new_channel() -> (DanmakuChatTx, broadcast::Receiver<Value>) {
    let (tx, rx) = broadcast::channel(256);
    (Arc::new(tx), rx)
}

/// 让 main.rs 在 save_danmaku_chat_config 之后调用，通知所有弹幕聊天网页客户端重新拉取配置
pub fn broadcast_cfg_update(tx: &DanmakuChatTx) {
    let msg = serde_json::json!({ "_danmaku_chat_cfg_update": true });
    let _ = tx.send(msg);
}

pub fn broadcast_plugin_settings_update(tx: &DanmakuChatTx) {
    let msg = serde_json::json!({ "_plugin_settings_update": true });
    let _ = tx.send(msg);
}

pub async fn start(port: u16, tx: DanmakuChatTx, resource_dir: Option<PathBuf>) {
    let state = AppState {
        tx,
        asset_roots: Arc::new(danmaku_chat_asset_roots(resource_dir.as_deref())),
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
        .route("/recent-events", get(recent_events_handler))
        .route("/gift-catalog", get(gift_catalog_handler))
        .route("/recent-gifts-data", get(recent_gifts_data_handler))
        .route("/gift-rank-data", get(gift_rank_data_handler))
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

fn danmaku_chat_asset_roots(resource_dir: Option<&FsPath>) -> Vec<PathBuf> {
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

#[derive(Deserialize)]
struct RecentEventsQuery {
    limit: Option<usize>,
}

async fn recent_events_handler(Query(query): Query<RecentEventsQuery>) -> impl IntoResponse {
    Json(observed_recent_events(query.limit.unwrap_or(20)))
}

async fn gift_catalog_handler() -> impl IntoResponse {
    Json(observed_gift_catalog())
}

async fn recent_gifts_data_handler(Query(query): Query<RecentEventsQuery>) -> impl IntoResponse {
    Json(observed_recent_gifts_data(query.limit.unwrap_or(3)))
}

async fn gift_rank_data_handler(Query(query): Query<RecentEventsQuery>) -> impl IntoResponse {
    Json(observed_gift_rank_data(query.limit.unwrap_or(3)))
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

enum CurrentBilibiliRoom {
    Room(i64),
    NoConnectedRoom,
    NonBilibili,
}

struct BilibiliRoomScope {
    room_id: i64,
    platform_room_id: String,
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
    let room_id = match current_or_config_bilibili_room_id("音乐互动读取配置失败") {
        Some(room_id) => room_id,
        None => return Vec::new(),
    };
    let storage = match danmaku_chat_storage() {
        Ok(storage) => storage,
        Err(e) => {
            eprintln!("音乐互动打开存储失败: {e}");
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
            eprintln!("音乐互动读取队列失败: {e}");
            Vec::new()
        }
    }
}

fn observed_song_rank() -> Vec<SongRankItem> {
    let room_id = match current_or_config_bilibili_room_id("音乐互动排行读取配置失败") {
        Some(room_id) => room_id,
        None => return Vec::new(),
    };
    let storage = match danmaku_chat_storage() {
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

fn observed_recent_events(limit: usize) -> Vec<Value> {
    let room_id = match current_or_config_bilibili_room_id("弹幕聊天读取房间配置失败") {
        Some(room_id) => room_id,
        None => return Vec::new(),
    };
    let storage = match danmaku_chat_storage() {
        Ok(storage) => storage,
        Err(e) => {
            eprintln!("弹幕聊天打开存储失败: {e}");
            return Vec::new();
        }
    };
    let limit = limit.clamp(1, 80) as i64;

    let result = storage.with_connection(|conn| {
        let active_session_id = conn
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
        let Some(active_session_id) = active_session_id else {
            return Ok(Vec::new());
        };
        let mut stmt = conn.prepare(
            "select event_type, event_subtype, uid, uname, text, gift_name, gift_count, gift_price,
                    medal_name, medal_level, guard_level, raw_json, occurred_at
             from interaction_records
             where session_id = ?1
               and room_id = ?2
               and event_type in ('danmu', 'gift', 'super_chat', 'guard_buy', 'entry_effect', 'interact')
             order by occurred_at desc
             limit ?3",
        )?;
        let rows = stmt.query_map(params![active_session_id, room_id, limit], |row| {
            let event_type: String = row.get(0)?;
            let event_subtype: Option<String> = row.get(1)?;
            let uid: Option<i64> = row.get(2)?;
            let uname: Option<String> = row.get(3)?;
            let text: Option<String> = row.get(4)?;
            let gift_name: Option<String> = row.get(5)?;
            let gift_count: Option<i64> = row.get(6)?;
            let gift_price: Option<i64> = row.get(7)?;
            let medal_name: Option<String> = row.get(8)?;
            let medal_level: Option<i64> = row.get(9)?;
            let guard_level: Option<i64> = row.get(10)?;
            let raw_json: String = row.get(11)?;
            let occurred_at: String = row.get(12)?;
            let raw = serde_json::from_str::<Value>(&raw_json).unwrap_or(Value::Null);
            let value = match event_type.as_str() {
                "danmu" => serde_json::json!({
                    "type": "Danmu",
                    "subtype": event_subtype,
                    "uid": uid,
                    "user": uname.unwrap_or_else(|| "观众".to_string()),
                    "text": text.unwrap_or_default(),
                    "medalName": medal_name,
                    "medalLevel": medal_level,
                    "guardLevel": guard_level.unwrap_or(0),
                    "time": occurred_at,
                    "raw": raw,
                }),
                "gift" => serde_json::json!({
                    "type": "Gift",
                    "subtype": event_subtype,
                    "uid": uid,
                    "user": uname.unwrap_or_else(|| "观众".to_string()),
                    "gift": gift_name.unwrap_or_else(|| "礼物".to_string()),
                    "count": gift_count.unwrap_or(1),
                    "price": gift_price.unwrap_or(0),
                    "medalName": medal_name,
                    "medalLevel": medal_level,
                    "guardLevel": guard_level.unwrap_or(0),
                    "time": occurred_at,
                    "raw": raw,
                }),
                "super_chat" => serde_json::json!({
                    "type": "SuperChat",
                    "subtype": event_subtype,
                    "uid": uid,
                    "user": uname.unwrap_or_else(|| "观众".to_string()),
                    "text": text.unwrap_or_default(),
                    "price": gift_price.unwrap_or(0),
                    "medalName": medal_name,
                    "medalLevel": medal_level,
                    "guardLevel": guard_level.unwrap_or(0),
                    "time": occurred_at,
                    "raw": raw,
                }),
                "guard_buy" => serde_json::json!({
                    "type": "GuardBuy",
                    "subtype": event_subtype,
                    "uid": uid,
                    "user": uname.unwrap_or_else(|| "观众".to_string()),
                    "gift": gift_name.unwrap_or_else(|| "大航海".to_string()),
                    "count": gift_count.unwrap_or(1),
                    "price": gift_price.unwrap_or(0),
                    "medalName": medal_name,
                    "medalLevel": medal_level,
                    "guardLevel": guard_level.unwrap_or(0),
                    "time": occurred_at,
                    "raw": raw,
                }),
                "entry_effect" => serde_json::json!({
                    "type": "EntryEffect",
                    "subtype": event_subtype,
                    "uid": uid,
                    "user": uname.unwrap_or_else(|| "观众".to_string()),
                    "text": text.unwrap_or_default(),
                    "medalName": medal_name,
                    "medalLevel": medal_level,
                    "guardLevel": guard_level.unwrap_or(0),
                    "time": occurred_at,
                    "raw": raw,
                }),
                "interact" => serde_json::json!({
                    "type": "Interact",
                    "subtype": event_subtype,
                    "uid": uid,
                    "user": uname.unwrap_or_else(|| "观众".to_string()),
                    "text": text.unwrap_or_default(),
                    "medalName": medal_name,
                    "medalLevel": medal_level,
                    "guardLevel": guard_level.unwrap_or(0),
                    "time": occurred_at,
                    "raw": raw,
                }),
                _ => serde_json::json!(null),
            };
            Ok(value)
        })?;

        let mut items = Vec::new();
        for row in rows {
            let value = row?;
            if !value.is_null() {
                items.push(value);
            }
        }
        items.reverse();
        Ok(items)
    });

    match result {
        Ok(items) => items,
        Err(e) => {
            eprintln!("弹幕聊天读取最近事件失败: {e}");
            Vec::new()
        }
    }
}

fn observed_gift_catalog() -> BTreeMap<String, String> {
    if matches!(current_bilibili_room_id(), CurrentBilibiliRoom::NonBilibili) {
        return BTreeMap::new();
    }

    let storage = match danmaku_chat_storage() {
        Ok(storage) => storage,
        Err(e) => {
            eprintln!("弹幕聊天打开礼物目录失败: {e}");
            return BTreeMap::new();
        }
    };

    let result = storage.with_connection(|conn| {
        let mut stmt = conn.prepare(
            "select name, image
             from live_gift_catalog
             where name <> '' and image <> ''
             order by updated_at desc, gift_id desc",
        )?;
        let rows = stmt.query_map([], |row| {
            let name: String = row.get(0)?;
            let image: String = row.get(1)?;
            Ok((name, image))
        })?;

        let mut items = BTreeMap::new();
        for row in rows {
            let (name, image) = row?;
            items.entry(name).or_insert(image);
        }
        Ok(items)
    });

    match result {
        Ok(items) => items,
        Err(e) => {
            eprintln!("弹幕聊天读取礼物目录失败: {e}");
            BTreeMap::new()
        }
    }
}

fn observed_recent_gifts_data(limit: usize) -> Vec<Value> {
    let scope = match current_or_config_bilibili_room_scope("最近礼物读取房间配置失败") {
        Some(scope) => scope,
        None => return Vec::new(),
    };
    let storage = match danmaku_chat_storage() {
        Ok(storage) => storage,
        Err(e) => {
            eprintln!("最近礼物打开存储失败: {e}");
            return Vec::new();
        }
    };
    let limit = limit.clamp(1, 20) as i64;

    let result = storage.with_connection(|conn| load_recent_gifts_data(conn, &scope, limit));

    match result {
        Ok(items) => items,
        Err(e) => {
            eprintln!("最近礼物读取失败: {e}");
            Vec::new()
        }
    }
}

fn observed_gift_rank_data(limit: usize) -> Vec<Value> {
    let scope = match current_or_config_bilibili_room_scope("礼物排行读取房间配置失败") {
        Some(scope) => scope,
        None => return Vec::new(),
    };
    let storage = match danmaku_chat_storage() {
        Ok(storage) => storage,
        Err(e) => {
            eprintln!("礼物排行打开存储失败: {e}");
            return Vec::new();
        }
    };
    let limit = limit.clamp(1, 20) as i64;

    let result = storage.with_connection(|conn| load_gift_rank_data(conn, &scope, limit));

    match result {
        Ok(items) => items,
        Err(e) => {
            eprintln!("礼物排行读取失败: {e}");
            Vec::new()
        }
    }
}

fn danmaku_chat_storage() -> anyhow::Result<Arc<Storage>> {
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

fn current_platform_room() -> Option<crate::live_platform::PlatformRoomRef> {
    crate::token::read_connected_platform_room().map(|room| crate::live_platform::PlatformRoomRef {
        platform_id: crate::live_platform::PlatformId::from(room.platform_id),
        platform_room_id: room.platform_room_id,
        display_id: room.display_id,
    })
}

fn current_bilibili_room_id() -> CurrentBilibiliRoom {
    let Some(room) = current_platform_room() else {
        return CurrentBilibiliRoom::NoConnectedRoom;
    };
    if room.platform_id.as_str() != "bilibili" {
        return CurrentBilibiliRoom::NonBilibili;
    }
    room.platform_room_id
        .parse::<i64>()
        .map(CurrentBilibiliRoom::Room)
        .unwrap_or(CurrentBilibiliRoom::NonBilibili)
}

fn current_or_config_bilibili_room_id(error_context: &str) -> Option<i64> {
    match current_bilibili_room_id() {
        CurrentBilibiliRoom::Room(room_id) => Some(room_id),
        CurrentBilibiliRoom::NonBilibili => None,
        CurrentBilibiliRoom::NoConnectedRoom => match crate::config::AppConfig::load_or_default() {
            Ok(app) => Some(app.room_id),
            Err(e) => {
                eprintln!("{error_context}: {e}");
                None
            }
        },
    }
}

fn current_or_config_bilibili_room_scope(error_context: &str) -> Option<BilibiliRoomScope> {
    current_or_config_bilibili_room_id(error_context).map(|room_id| BilibiliRoomScope {
        room_id,
        platform_room_id: room_id.to_string(),
    })
}

fn load_recent_gifts_data(
    conn: &rusqlite::Connection,
    scope: &BilibiliRoomScope,
    limit: i64,
) -> anyhow::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "select uname, gift_name, gift_count, raw_json, occurred_at
         from interaction_records
         where room_id = ?1
           and coalesce(nullif(platform_id, ''), 'bilibili') = 'bilibili'
           and coalesce(nullif(platform_room_id, ''), cast(room_id as text)) = ?2
           and event_type in ('gift', 'guard_buy')
         order by occurred_at desc
         limit ?3",
    )?;
    let rows = stmt.query_map(params![scope.room_id, scope.platform_room_id, limit], |row| {
        let user: Option<String> = row.get(0)?;
        let gift: Option<String> = row.get(1)?;
        let count: Option<i64> = row.get(2)?;
        let raw_json: String = row.get(3)?;
        let occurred_at: String = row.get(4)?;
        let raw = serde_json::from_str::<Value>(&raw_json).unwrap_or(Value::Null);
        let avatar = raw
            .pointer("/data/face")
            .or_else(|| raw.pointer("/data/uface"))
            .or_else(|| raw.pointer("/data/user_info/face"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        Ok(serde_json::json!({
            "User": user.unwrap_or_else(|| "观众".to_string()),
            "Gift": gift.unwrap_or_else(|| "礼物".to_string()),
            "Count": count.unwrap_or(1).max(1),
            "Avatar": avatar,
            "OccurredAt": occurred_at,
        }))
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn load_gift_rank_data(
    conn: &rusqlite::Connection,
    scope: &BilibiliRoomScope,
    limit: i64,
) -> anyhow::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "select uname,
                coalesce(sum(case when gift_price > 0 then gift_count * gift_price else gift_count end), 0) as total_value,
                coalesce(sum(gift_count), 0) as total_count,
                max(raw_json) as raw_json
         from interaction_records
         where room_id = ?1
           and coalesce(nullif(platform_id, ''), 'bilibili') = 'bilibili'
           and coalesce(nullif(platform_room_id, ''), cast(room_id as text)) = ?2
           and event_type in ('gift', 'guard_buy')
           and date(occurred_at, 'localtime') = date('now', 'localtime')
         group by uname
         order by total_value desc, total_count desc, max(occurred_at) desc
         limit ?3",
    )?;
    let rows = stmt.query_map(params![scope.room_id, scope.platform_room_id, limit], |row| {
        let user: Option<String> = row.get(0)?;
        let value: Option<i64> = row.get(1)?;
        let count: Option<i64> = row.get(2)?;
        let raw_json: Option<String> = row.get(3)?;
        let raw = raw_json
            .as_deref()
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
            .unwrap_or(Value::Null);
        let avatar = raw
            .pointer("/data/face")
            .or_else(|| raw.pointer("/data/uface"))
            .or_else(|| raw.pointer("/data/user_info/face"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        Ok(serde_json::json!({
            "User": user.unwrap_or_else(|| "观众".to_string()),
            "Value": value.unwrap_or(0).max(0),
            "Count": count.unwrap_or(0).max(0),
            "Avatar": avatar,
        }))
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
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
    let allowed = q.url.starts_with("https://")
        && (q.url.contains(".hdslb.com/") || q.url.contains(".bilibili.com/"));
    if !allowed {
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

#[cfg(test)]
mod tests {
    use super::{BilibiliRoomScope, load_gift_rank_data, load_recent_gifts_data};
    use crate::storage::Storage;
    use chrono::{Duration, Local};
    use rusqlite::params;
    use serde_json::json;

    #[test]
    fn recent_gifts_data_only_reads_bilibili_room_scope() {
        let storage = Storage::open_in_memory().unwrap();
        let scope = BilibiliRoomScope {
            room_id: 123,
            platform_room_id: "123".to_string(),
        };
        let now = Local::now();

        storage
            .with_connection(|conn| {
                conn.execute(
                    "insert into interaction_records (
                        session_id, platform_id, platform_room_id, platform_user_id, room_id,
                        event_type, uname, gift_name, gift_count, gift_price, raw_json, occurred_at
                    ) values ('bili', 'bilibili', '123', '7', 123, 'gift', 'alice', 'rose', 2, 100, ?1, ?2)",
                    params![json!({"data":{"face":"https://example.com/alice.png"}}).to_string(), now.to_rfc3339()],
                )?;
                conn.execute(
                    "insert into interaction_records (
                        session_id, platform_id, platform_room_id, platform_user_id, room_id,
                        event_type, uname, gift_name, gift_count, gift_price, raw_json, occurred_at
                    ) values ('douyin', 'douyin', '123', '7', 123, 'gift', 'mallory', 'rocket', 5, 100, '{}', ?1)",
                    params![now.to_rfc3339()],
                )?;
                Ok(())
            })
            .unwrap();

        let items = storage
            .with_connection(|conn| load_recent_gifts_data(conn, &scope, 10))
            .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["User"], "alice");
        assert_eq!(items[0]["Gift"], "rose");
    }

    #[test]
    fn gift_rank_data_only_reads_bilibili_room_scope() {
        let storage = Storage::open_in_memory().unwrap();
        let scope = BilibiliRoomScope {
            room_id: 123,
            platform_room_id: "123".to_string(),
        };
        let now = Local::now();
        let today = now.to_rfc3339();
        let yesterday = (now - Duration::days(1)).to_rfc3339();

        storage
            .with_connection(|conn| {
                conn.execute(
                    "insert into interaction_records (
                        session_id, platform_id, platform_room_id, platform_user_id, room_id,
                        event_type, uname, gift_name, gift_count, gift_price, raw_json, occurred_at
                    ) values ('bili-1', 'bilibili', '123', '7', 123, 'gift', 'alice', 'rose', 2, 100, ?1, ?2)",
                    params![json!({"data":{"face":"https://example.com/alice.png"}}).to_string(), today],
                )?;
                conn.execute(
                    "insert into interaction_records (
                        session_id, platform_id, platform_room_id, platform_user_id, room_id,
                        event_type, uname, gift_name, gift_count, gift_price, raw_json, occurred_at
                    ) values ('douyin-1', 'douyin', '123', '7', 123, 'gift', 'mallory', 'rocket', 5, 100, '{}', ?1)",
                    params![Local::now().to_rfc3339()],
                )?;
                conn.execute(
                    "insert into interaction_records (
                        session_id, platform_id, platform_room_id, platform_user_id, room_id,
                        event_type, uname, gift_name, gift_count, gift_price, raw_json, occurred_at
                    ) values ('bili-old', 'bilibili', '123', '8', 123, 'gift', 'bob', 'heart', 9, 10, '{}', ?1)",
                    params![yesterday],
                )?;
                Ok(())
            })
            .unwrap();

        let items = storage
            .with_connection(|conn| load_gift_rank_data(conn, &scope, 10))
            .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["User"], "alice");
        assert_eq!(items[0]["Value"], 200);
    }
}
