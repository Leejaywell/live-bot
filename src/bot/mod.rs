pub mod engine;
pub mod sender;
pub mod thanks;
pub mod timed;

use anyhow::Result;
use bilibili_live_protocol::ParsedLiveEvent;
use chrono::{DateTime, Local};

use crate::bot::engine::BotEngine;
use crate::storage::Storage;

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
) -> Result<Vec<String>> {
    storage.record_interaction(session_id, room_id, parsed)?;
    Ok(engine.handle_event(&parsed.event, Some(storage)))
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
    use bilibili_live_protocol::{LiveEvent, ParsedLiveEvent};
    use chrono::{Local, TimeZone};
    use serde_json::json;

    use super::engine::BotEngine;
    use crate::bot::testsupport::test_config;
    use crate::storage::Storage;

    #[test]
    fn records_parsed_event_and_keeps_rule_handling() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();
        let mut config = test_config();
        config.keyword_reply = true;
        config
            .keyword_reply_list
            .insert("你好".to_string(), "你好呀".to_string());
        let engine = BotEngine::new(config);
        let event = ParsedLiveEvent {
            event: LiveEvent::Danmu {
                user_id: 42,
                user: "alice".to_string(),
                text: "主播你好".to_string(),
            },
            raw: json!({
                "cmd": "DANMU_MSG",
                "info": [[], "主播你好", [42, "alice"]]
            }),
        };

        let replies =
            super::record_and_handle_event(&storage, &session_id, 8792912, &event, &engine)
                .unwrap();

        assert_eq!(replies, vec!["你好呀"]);
        assert_eq!(storage.session_danmu_count(&session_id).unwrap(), 1);
    }

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
