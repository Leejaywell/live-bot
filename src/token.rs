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

#[allow(dead_code)]
fn platform_session_path(platform_id: &str) -> PathBuf {
    auth_dir().join(format!("session-{platform_id}.json"))
}

fn connected_room_path() -> PathBuf {
    auth_dir().join("connected_room")
}

#[allow(dead_code)]
fn connected_platform_room_path() -> PathBuf {
    auth_dir().join("connected_room.json")
}

// ── Session ───────────────────────────────────────────────────────────────────

/// 持久化的认证凭据，存储在 auth/session.json。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Session {
    pub cookie: String,
    #[serde(default)]
    pub refresh_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPlatformSession {
    pub platform_id: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPlatformRoom {
    pub platform_id: String,
    pub platform_room_id: String,
    pub display_id: Option<String>,
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

#[allow(dead_code)]
pub fn read_platform_session(platform_id: &str) -> Result<StoredPlatformSession> {
    let path = platform_session_path(platform_id);
    if path.exists() {
        let content = std::fs::read_to_string(path)?;
        return Ok(serde_json::from_str(&content)?);
    }

    if platform_id == "bilibili" {
        let legacy = read_session()?;
        return Ok(StoredPlatformSession {
            platform_id: platform_id.to_string(),
            payload: serde_json::json!({
                "cookie": legacy.cookie,
                "refresh_token": legacy.refresh_token
            }),
        });
    }

    Err(anyhow::anyhow!("platform session not found: {platform_id}"))
}

#[allow(dead_code)]
pub fn write_platform_session(session: &StoredPlatformSession) -> Result<()> {
    let dir = auth_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(
        platform_session_path(&session.platform_id),
        serde_json::to_string_pretty(session)?,
    )?;

    if session.platform_id == "bilibili" {
        let legacy = Session {
            cookie: session
                .payload
                .get("cookie")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            refresh_token: session
                .payload
                .get("refresh_token")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
        };
        write_session(&legacy)?;
    }

    Ok(())
}

#[allow(dead_code)]
pub fn delete_platform_session(platform_id: &str) -> Result<()> {
    let _ = std::fs::remove_file(platform_session_path(platform_id));
    if platform_id == "bilibili" {
        delete_session()?;
    }
    Ok(())
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

#[allow(dead_code)]
pub fn read_connected_platform_room() -> Option<StoredPlatformRoom> {
    if let Ok(content) = std::fs::read_to_string(connected_platform_room_path()) {
        if let Ok(room) = serde_json::from_str(&content) {
            return Some(room);
        }
    }

    read_connected_room().map(|room_id| StoredPlatformRoom {
        platform_id: "bilibili".to_string(),
        platform_room_id: room_id.to_string(),
        display_id: Some(room_id.to_string()),
    })
}

#[allow(dead_code)]
pub fn write_connected_platform_room(room: &StoredPlatformRoom) -> Result<()> {
    let dir = auth_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(
        connected_platform_room_path(),
        serde_json::to_string_pretty(room)?,
    )?;

    if room.platform_id == "bilibili" {
        if let Ok(room_id) = room.platform_room_id.parse::<i64>() {
            write_connected_room(room_id)?;
        }
    }

    Ok(())
}

#[allow(dead_code)]
pub fn delete_connected_platform_room() {
    let _ = std::fs::remove_file(connected_platform_room_path());
    delete_connected_room();
}

// ── Cookie parsing ────────────────────────────────────────────────────────────

/// HTTP 响应头中的 Set-Cookie 解析为 cookie 字符串。
pub fn parse_set_cookie(headers: &HeaderMap) -> String {
    let mut map = BTreeMap::new();
    for value in headers.get_all(SET_COOKIE) {
        let Ok(raw) = value.to_str() else { continue };
        let Some(pair) = raw.split(';').next() else {
            continue;
        };
        let Some((key, val)) = pair.split_once('=') else {
            continue;
        };
        map.entry(key.to_string())
            .or_insert_with(|| val.to_string());
    }
    map.iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_platform_room_serializes_platform_fields() {
        let room = StoredPlatformRoom {
            platform_id: "bilibili".to_string(),
            platform_room_id: "123".to_string(),
            display_id: Some("123".to_string()),
        };
        let json = serde_json::to_value(&room).unwrap();
        assert_eq!(json["platform_id"], "bilibili");
        assert_eq!(json["platform_room_id"], "123");
    }

    #[test]
    fn stored_platform_session_preserves_payload() {
        let session = StoredPlatformSession {
            platform_id: "bilibili".to_string(),
            payload: serde_json::json!({"cookie": "a=b", "refresh_token": "r"}),
        };
        let json = serde_json::to_value(&session).unwrap();
        assert_eq!(json["platform_id"], "bilibili");
        assert_eq!(json["payload"]["cookie"], "a=b");
    }
}
