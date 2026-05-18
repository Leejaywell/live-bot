//! 弹幕浮层 HTTP 服务
//!
//! GET /        → 独立弹幕浮层页面
//! GET /cfg     → 当前 OverlayConfig（JSON）
//! GET /wish-goal → 心愿目标浮层页面
//! GET /lottery → 抽奖互动浮层页面
//! GET /gift-effect → 礼物特效浮层页面
//! GET /recent-gifts → 最近礼物浮层页面
//! GET /gift-rank → 礼物排行浮层页面
//! GET /song-request → 音乐互动浮层页面
//! GET /plugin-settings → 插件配置（JSON）
//! GET /ws      → WebSocket，推送 live-event 事件流 + 配置变更通知
//! GET /proxy   → 图片代理，绕过 B站 CDN CORS 限制

use axum::{
    Router,
    body::Body,
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{Response, StatusCode, header},
    response::{Html, IntoResponse, Json},
    routing::get,
};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::broadcast;

use crate::overlay_config::OverlayConfig;
use crate::plugin_settings::PluginSettings;

const HTML: &str = include_str!("overlay.html");
const WISH_GOAL_HTML: &str = include_str!("wish_goal.html");
const LOTTERY_HTML: &str = include_str!("lottery.html");
const GIFT_EFFECT_HTML: &str = include_str!("gift_effect.html");
const RECENT_GIFTS_HTML: &str = include_str!("recent_gifts.html");
const GIFT_RANK_HTML: &str = include_str!("gift_rank.html");
const MUSIC_INTERACTION_HTML: &str = include_str!("music_interaction.html");

pub type OverlayTx = Arc<broadcast::Sender<Value>>;

pub fn new_channel() -> (OverlayTx, broadcast::Receiver<Value>) {
    let (tx, rx) = broadcast::channel(256);
    (Arc::new(tx), rx)
}

/// 让 main.rs 在 save_overlay_config 之后调用，通知所有 overlay 网页客户端重新拉取配置
pub fn broadcast_cfg_update(tx: &OverlayTx) {
    let msg = serde_json::json!({ "_overlay_cfg_update": true });
    let _ = tx.send(msg);
}

pub fn broadcast_plugin_settings_update(tx: &OverlayTx) {
    let msg = serde_json::json!({ "_plugin_settings_update": true });
    let _ = tx.send(msg);
}

pub async fn start(port: u16, tx: OverlayTx) {
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
        .route("/plugin-settings", get(plugin_settings_handler))
        .route("/local-resource", get(local_resource_handler))
        .route("/ws", get(ws_handler))
        .route("/proxy", get(proxy_handler))
        .with_state(tx);

    let addr = format!("127.0.0.1:{port}");
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("弹幕浮层服务绑定 {addr} 失败: {e}");
            return;
        }
    };
    println!("弹幕浮层服务已启动: http://{addr}");
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("弹幕浮层服务异常退出: {e}");
    }
}

// ── Route handlers ─────────────────────────────────────────────────────────────

async fn index_handler() -> Html<&'static str> {
    Html(HTML)
}

async fn wish_goal_handler() -> Html<&'static str> {
    Html(WISH_GOAL_HTML)
}

async fn lottery_handler() -> Html<&'static str> {
    Html(LOTTERY_HTML)
}

async fn gift_effect_handler() -> Html<&'static str> {
    Html(GIFT_EFFECT_HTML)
}

async fn recent_gifts_handler() -> Html<&'static str> {
    Html(RECENT_GIFTS_HTML)
}

async fn gift_rank_handler() -> Html<&'static str> {
    Html(GIFT_RANK_HTML)
}

async fn music_interaction_handler() -> Html<&'static str> {
    Html(MUSIC_INTERACTION_HTML)
}

async fn cfg_handler() -> impl IntoResponse {
    let cfg = OverlayConfig::load_or_default().unwrap_or_default();
    Json(cfg)
}

async fn plugin_settings_handler() -> impl IntoResponse {
    let cfg = PluginSettings::load_or_default().unwrap_or_default();
    Json(cfg)
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

async fn ws_handler(ws: WebSocketUpgrade, State(tx): State<OverlayTx>) -> impl IntoResponse {
    let rx = tx.subscribe();
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
