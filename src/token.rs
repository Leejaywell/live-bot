use std::path::PathBuf;

use anyhow::Result;
use reqwest::header::{HeaderMap, SET_COOKIE};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const APP_ID: &str = "com.streamix.app";

// ── 路径 ──────────────────────────────────────────────────────────────────────

fn auth_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_ID)
        .join("auth")
}

fn session_path() -> PathBuf {
    auth_dir().join("session.json")
}

fn connected_room_path() -> PathBuf {
    auth_dir().join("connected_room")
}

// ── Session ───────────────────────────────────────────────────────────────────

/// 持久化的认证凭据，存储在 auth/session.json。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Session {
    pub cookie: String,
    #[serde(default)]
    pub refresh_token: String,
}

pub fn read_session() -> Result<Session> {
    let content = std::fs::read_to_string(session_path())?;
    Ok(serde_json::from_str(&content)?)
}

pub fn write_session(session: &Session) -> Result<()> {
    let dir = auth_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(session_path(), serde_json::to_string_pretty(session)?)?;
    Ok(())
}

pub fn delete_session() -> Result<()> {
    let _ = std::fs::remove_file(session_path());
    Ok(())
}

pub fn session_saved_at() -> Option<i64> {
    std::fs::metadata(session_path())
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs()
        .try_into()
        .ok()
}

// ── Connected room ────────────────────────────────────────────────────────────

pub fn read_connected_room() -> Option<i64> {
    std::fs::read_to_string(connected_room_path())
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

pub fn write_connected_room(room_id: i64) -> Result<()> {
    let dir = auth_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(connected_room_path(), room_id.to_string())?;
    Ok(())
}

pub fn delete_connected_room() {
    let _ = std::fs::remove_file(connected_room_path());
}

// ── Cookie parsing ────────────────────────────────────────────────────────────

/// HTTP 响应头中的 Set-Cookie 解析为 cookie 字符串。
pub fn parse_set_cookie(headers: &HeaderMap) -> String {
    let mut map = BTreeMap::new();
    for value in headers.get_all(SET_COOKIE) {
        let Ok(raw) = value.to_str() else { continue };
        let Some(pair) = raw.split(';').next() else { continue };
        let Some((key, val)) = pair.split_once('=') else { continue };
        map.entry(key.to_string()).or_insert_with(|| val.to_string());
    }
    map.iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}
