//! 弹幕浮层 HTTP 服务
//!
//! GET /        → 独立弹幕浮层页面（供 OBS 浏览器源使用）
//! GET /cfg     → 当前 OverlayConfig（JSON）
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

const HTML: &str = include_str!("overlay.html");

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

pub async fn start(port: u16, tx: OverlayTx) {
    let app = Router::new()
        .route("/",      get(index_handler))
        .route("/cfg",   get(cfg_handler))
        .route("/ws",    get(ws_handler))
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

async fn cfg_handler() -> impl IntoResponse {
    let cfg = OverlayConfig::load_or_default().unwrap_or_default();
    Json(cfg)
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(tx): State<OverlayTx>,
) -> impl IntoResponse {
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
