pub mod agent;
pub mod engine;
pub mod memory;
pub mod monitor;
pub mod profile_worker;
pub mod sender;
pub mod thanks;
pub mod timed;

use anyhow::Result;
use bilibili_live_protocol::{LiveEvent, ParsedLiveEvent};
use chrono::{DateTime, Local};

use crate::bot::engine::BotEngine;
use crate::storage::Storage;

pub trait EventEmitter: Send + Sync + 'static {
    fn emit(&self, event: &str, payload: serde_json::Value) -> Result<()>;
}

#[cfg(feature = "tauri")]
impl EventEmitter for tauri::AppHandle {
    fn emit(&self, event: &str, payload: serde_json::Value) -> Result<()> {
        tauri::Emitter::emit(self, event, payload).map_err(|e| anyhow::anyhow!(e.to_string()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionStatusChange {
    Started(String),
    Ended(String),
    Unchanged,
}

pub fn record_and_handle_event(
    storage: &Storage,
    session_id: &str,
    room_id: i64,
    parsed: &ParsedLiveEvent,
    engine: &BotEngine,
    should_record: bool,
) -> Result<Vec<String>> {
    if should_record {
        storage.record_interaction(session_id, room_id, parsed)?;
        try_auto_track(storage, &parsed.event);
        try_trigger_profile_analysis(storage, &parsed.event);
    }
    Ok(engine.handle_event(&parsed.event, Some(storage)))
}

/// 弹幕事件触发的粉丝档案分析：
///   - 首次到 5 条弹幕（且 AI 摘要为空）
///   - 之后每累计 50 条且距上次分析 > 7 天
/// 入队后由 profile_worker 异步消费。
fn try_trigger_profile_analysis(storage: &Storage, event: &LiveEvent) {
    let uid = match event {
        LiveEvent::Danmu { user_id, .. } if *user_id > 0 => *user_id,
        _ => return,
    };
    let profile = match storage.get_user_profile(uid) {
        Ok(Some(p)) => p,
        _ => return,
    };
    let count = profile.total_danmu_count;
    let should = match count {
        5 => profile.ai_summary.is_empty(),
        n if n > 5 && n % 50 == 0 => is_summary_stale(&profile, 7),
        _ => false,
    };
    if should {
        crate::bot::profile_worker::try_enqueue(uid);
    }
}

fn is_summary_stale(profile: &crate::storage::UserProfile, days: i64) -> bool {
    let Some(last) = profile.ai_summary_updated_at.as_deref() else {
        return true;
    };
    match chrono::DateTime::parse_from_rfc3339(last) {
        Ok(t) => (Local::now() - t.with_timezone(&Local)).num_days() >= days,
        Err(_) => true,
    }
}

fn try_auto_track(storage: &Storage, event: &LiveEvent) {
    let (uid, uname, event_type) = match event {
        LiveEvent::Danmu { user_id, user, .. } => (*user_id, user.as_str(), "danmu"),
        LiveEvent::Gift { user_id, user, .. } => (*user_id, user.as_str(), "gift"),
        LiveEvent::GuardBuy { user_id, user, .. } => (*user_id, user.as_str(), "guard_buy"),
        LiveEvent::SuperChat { user_id, user, .. } => (*user_id, user.as_str(), "super_chat"),
        LiveEvent::Interact {
            user_id,
            user,
            kind,
        } => {
            use bilibili_live_protocol::InteractKind;
            let event_type = match kind {
                InteractKind::Follow | InteractKind::MutualFollow => "follow",
                InteractKind::Share => "share",
                _ => return,
            };
            (*user_id, user.as_str(), event_type)
        }
        _ => return,
    };
    if uid == 0 {
        return;
    }
    if let Err(e) = storage.auto_track_user(uid, uname, event_type) {
        eprintln!("[warn] auto_track_user uid={uid}: {e}");
    }
}

pub fn update_observed_session_for_room_status(
    storage: &Storage,
    current_session_id: &mut Option<String>,
    room_id: i64,
    live_status: i32,
    observed_at: DateTime<Local>,
) -> Result<SessionStatusChange> {
    if live_status == 1 {
        if current_session_id.is_none() {
            let session_id = storage.start_observed_live_session(room_id, observed_at)?;
            *current_session_id = Some(session_id.clone());
            return Ok(SessionStatusChange::Started(session_id));
        }
        return Ok(SessionStatusChange::Unchanged);
    }

    if let Some(session_id) = current_session_id.take() {
        storage.end_observed_live_session(&session_id, observed_at)?;
        return Ok(SessionStatusChange::Ended(session_id));
    }

    Ok(SessionStatusChange::Unchanged)
}

#[cfg(test)]
mod tests {
    use chrono::{Local, TimeZone};

    use crate::storage::Storage;

    #[test]
    fn observed_session_follows_live_status_boundary() {
        let storage = Storage::open_in_memory().unwrap();
        let mut current_session_id = None;
        let started_at = Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap();
        let ended_at = Local.with_ymd_and_hms(2026, 5, 1, 22, 0, 0).unwrap();

        let started = super::update_observed_session_for_room_status(
            &storage,
            &mut current_session_id,
            8792912,
            1,
            started_at,
        )
        .unwrap();

        let session_id = match started {
            super::SessionStatusChange::Started(session_id) => session_id,
            other => panic!("expected session start, got {other:?}"),
        };
        assert_eq!(current_session_id.as_deref(), Some(session_id.as_str()));

        let ended = super::update_observed_session_for_room_status(
            &storage,
            &mut current_session_id,
            8792912,
            0,
            ended_at,
        )
        .unwrap();

        assert_eq!(ended, super::SessionStatusChange::Ended(session_id));
        assert!(current_session_id.is_none());
    }
}

#[cfg(test)]
pub mod testsupport {
    use crate::config::AppConfig;

    pub fn test_config() -> AppConfig {
        let mut config = AppConfig::default();
        config.danmu_len = 20;
        config
    }
}
