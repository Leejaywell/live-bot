use anyhow::Result;
use bilibili_live_protocol::{LiveEvent, ParsedLiveEvent};
use chrono::{DateTime, Datelike, Local};
use rusqlite::{Connection, OptionalExtension, params};
use std::sync::Mutex;

#[derive(Debug)]
pub struct Storage {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignInResult {
    pub count: i64,
    pub already_signed: bool,
}

impl Storage {
    pub fn open(path: &str) -> Result<Self> {
        std::fs::create_dir_all(
            std::path::Path::new(path)
                .parent()
                .unwrap_or_else(|| std::path::Path::new(".")),
        )?;
        Self::from_connection(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            "
            create table if not exists sign_in (
                uid integer primary key,
                last_day text not null,
                count integer not null
            );
            create table if not exists danmu_count (
                uid integer primary key,
                uname text not null,
                count integer not null default 0
            );
            create table if not exists blind_box_stat (
                id integer primary key autoincrement,
                uid integer not null,
                uname text not null,
                gift_name text not null,
                count integer not null,
                profit_loss integer not null,
                created_at text not null
            );
            create table if not exists live_sessions (
                id text primary key,
                room_id integer not null,
                started_at text not null,
                ended_at text,
                start_source text not null,
                end_source text,
                created_at text not null,
                updated_at text not null
            );
            create table if not exists interaction_records (
                id integer primary key autoincrement,
                session_id text not null,
                room_id integer not null,
                event_type text not null,
                uid integer,
                uname text,
                text text,
                gift_name text,
                gift_count integer,
                gift_price integer,
                raw_json text not null,
                occurred_at text not null
            );
            ",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn sign_in(&self, uid: i64) -> Result<SignInResult> {
        let today = today_key();
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let existing: Option<(String, i64)> = conn
            .query_row(
                "select last_day, count from sign_in where uid = ?1",
                params![uid],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;

        match existing {
            Some((last_day, count)) if last_day == today => Ok(SignInResult {
                count,
                already_signed: true,
            }),
            Some((_last_day, count)) => {
                let next = count + 1;
                conn.execute(
                    "update sign_in set last_day = ?2, count = ?3 where uid = ?1",
                    params![uid, today, next],
                )?;
                Ok(SignInResult {
                    count: next,
                    already_signed: false,
                })
            }
            None => {
                conn.execute(
                    "insert into sign_in (uid, last_day, count) values (?1, ?2, 1)",
                    params![uid, today],
                )?;
                Ok(SignInResult {
                    count: 1,
                    already_signed: false,
                })
            }
        }
    }

    pub fn increment_danmu_count(&self, uid: i64, uname: &str) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "
            insert into danmu_count (uid, uname, count) values (?1, ?2, 1)
            on conflict(uid) do update set uname = excluded.uname, count = count + 1
            ",
            params![uid, uname],
        )?;
        Ok(conn.query_row(
            "select count from danmu_count where uid = ?1",
            params![uid],
            |row| row.get(0),
        )?)
    }

    pub fn danmu_count(&self, uid: i64) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn
            .query_row(
                "select count from danmu_count where uid = ?1",
                params![uid],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0))
    }

    pub fn start_observed_live_session(
        &self,
        room_id: i64,
        started_at: DateTime<Local>,
    ) -> Result<String> {
        let session_id = format!("{room_id}:{}", started_at.to_rfc3339());
        let now = Local::now().to_rfc3339();
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "
            insert or ignore into live_sessions
                (id, room_id, started_at, start_source, created_at, updated_at)
            values (?1, ?2, ?3, 'observed', ?4, ?4)
            ",
            params![session_id, room_id, started_at.to_rfc3339(), now],
        )?;
        Ok(session_id)
    }

    #[allow(dead_code)]
    pub fn end_observed_live_session(
        &self,
        session_id: &str,
        ended_at: DateTime<Local>,
    ) -> Result<()> {
        let now = Local::now().to_rfc3339();
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "
            update live_sessions
            set ended_at = ?2, end_source = 'observed', updated_at = ?3
            where id = ?1
            ",
            params![session_id, ended_at.to_rfc3339(), now],
        )?;
        Ok(())
    }

    pub fn record_interaction(
        &self,
        session_id: &str,
        room_id: i64,
        parsed: &ParsedLiveEvent,
    ) -> Result<()> {
        let (event_type, uid, uname, text, gift_name, gift_count, gift_price) = match &parsed.event
        {
            LiveEvent::Danmu {
                user_id,
                user,
                text,
            } => (
                "danmu",
                Some(*user_id),
                Some(user.as_str()),
                Some(text.as_str()),
                None,
                None,
                None,
            ),
            LiveEvent::Gift {
                user_id,
                user,
                gift,
                count,
                price,
                ..
            } => (
                "gift",
                Some(*user_id),
                Some(user.as_str()),
                None,
                Some(gift.as_str()),
                Some(*count),
                Some(*price),
            ),
            _ => ("unknown", None, None, None, None, None, None),
        };
        let raw_json = serde_json::to_string(&parsed.raw)?;
        let occurred_at = Local::now().to_rfc3339();
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "
            insert into interaction_records
                (
                    session_id,
                    room_id,
                    event_type,
                    uid,
                    uname,
                    text,
                    gift_name,
                    gift_count,
                    gift_price,
                    raw_json,
                    occurred_at
                )
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ",
            params![
                session_id,
                room_id,
                event_type,
                uid,
                uname,
                text,
                gift_name,
                gift_count,
                gift_price,
                raw_json,
                occurred_at
            ],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn session_danmu_count(&self, session_id: &str) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn.query_row(
            "
            select count(*)
            from interaction_records
            where session_id = ?1 and event_type = 'danmu'
            ",
            params![session_id],
            |row| row.get(0),
        )?)
    }

    #[allow(dead_code)]
    pub fn session_gift_value(&self, session_id: &str) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn.query_row(
            "
            select coalesce(sum(gift_count * gift_price), 0)
            from interaction_records
            where session_id = ?1 and event_type = 'gift'
            ",
            params![session_id],
            |row| row.get(0),
        )?)
    }

    #[allow(dead_code)]
    pub fn user_interaction_danmu_count(&self, uid: i64) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn.query_row(
            "
            select count(*)
            from interaction_records
            where uid = ?1 and event_type = 'danmu'
            ",
            params![uid],
            |row| row.get(0),
        )?)
    }

    #[allow(dead_code)]
    pub fn unknown_interaction_count(&self, session_id: &str) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn.query_row(
            "
            select count(*)
            from interaction_records
            where session_id = ?1 and event_type = 'unknown'
            ",
            params![session_id],
            |row| row.get(0),
        )?)
    }

    pub fn record_blind_box_stat(
        &self,
        uid: i64,
        uname: &str,
        gift_name: &str,
        count: i64,
        profit_loss: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "
            insert into blind_box_stat
                (uid, uname, gift_name, count, profit_loss, created_at)
            values (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                uid,
                uname,
                gift_name,
                count,
                profit_loss,
                Local::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    #[cfg(test)]
    pub fn blind_box_profit_loss(&self, uid: i64) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn.query_row(
            "select coalesce(sum(profit_loss), 0) from blind_box_stat where uid = ?1",
            params![uid],
            |row| row.get(0),
        )?)
    }
}

fn today_key() -> String {
    let now = Local::now();
    format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day())
}

#[cfg(test)]
mod tests {
    use bilibili_live_protocol::{LiveEvent, ParsedLiveEvent};
    use chrono::{Local, TimeZone};
    use serde_json::json;

    use super::Storage;

    #[test]
    fn sign_in_creates_then_reports_duplicate() {
        let storage = Storage::open_in_memory().unwrap();

        let first = storage.sign_in(10).unwrap();
        assert_eq!(first.count, 1);
        assert!(!first.already_signed);

        let second = storage.sign_in(10).unwrap();
        assert_eq!(second.count, 1);
        assert!(second.already_signed);
    }

    #[test]
    fn danmu_count_increments() {
        let storage = Storage::open_in_memory().unwrap();

        assert_eq!(storage.increment_danmu_count(10, "alice").unwrap(), 1);
        assert_eq!(storage.increment_danmu_count(10, "alice").unwrap(), 2);
        assert_eq!(storage.danmu_count(10).unwrap(), 2);
    }

    #[test]
    fn observed_live_session_has_deterministic_id() {
        let storage = Storage::open_in_memory().unwrap();
        let started_at = Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap();

        let first = storage
            .start_observed_live_session(8792912, started_at)
            .unwrap();
        let second = storage
            .start_observed_live_session(8792912, started_at)
            .unwrap();

        assert_eq!(first, format!("8792912:{}", started_at.to_rfc3339()));
        assert_eq!(second, first);
    }

    #[test]
    fn ending_live_session_is_idempotent() {
        let storage = Storage::open_in_memory().unwrap();
        let started_at = Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap();
        let ended_at = Local.with_ymd_and_hms(2026, 5, 1, 22, 0, 0).unwrap();
        let session_id = storage
            .start_observed_live_session(8792912, started_at)
            .unwrap();

        storage
            .end_observed_live_session(&session_id, ended_at)
            .unwrap();
        storage
            .end_observed_live_session(&session_id, ended_at)
            .unwrap();
    }

    #[test]
    fn records_danmu_interaction_for_session_count() {
        let storage = Storage::open_in_memory().unwrap();
        let started_at = Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap();
        let session_id = storage
            .start_observed_live_session(8792912, started_at)
            .unwrap();
        let event = ParsedLiveEvent {
            event: LiveEvent::Danmu {
                user_id: 42,
                user: "alice".to_string(),
                text: "hello".to_string(),
            },
            raw: json!({
                "cmd": "DANMU_MSG",
                "info": [[], "hello", [42, "alice"]]
            }),
        };

        storage
            .record_interaction(&session_id, 8792912, &event)
            .unwrap();

        assert_eq!(storage.session_danmu_count(&session_id).unwrap(), 1);
    }

    #[test]
    fn records_gift_interaction_for_session_value() {
        let storage = Storage::open_in_memory().unwrap();
        let started_at = Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap();
        let session_id = storage
            .start_observed_live_session(8792912, started_at)
            .unwrap();
        let event = ParsedLiveEvent {
            event: LiveEvent::Gift {
                user_id: 42,
                user: "alice".to_string(),
                gift: "辣条".to_string(),
                count: 2,
                price: 100,
                original_gift_name: None,
                original_gift_price: 0,
            },
            raw: json!({
                "cmd": "SEND_GIFT",
                "data": {
                    "uid": 42,
                    "uname": "alice",
                    "giftName": "辣条",
                    "num": 2,
                    "price": 100
                }
            }),
        };

        storage
            .record_interaction(&session_id, 8792912, &event)
            .unwrap();

        assert_eq!(storage.session_gift_value(&session_id).unwrap(), 200);
    }

    #[test]
    fn counts_user_danmu_from_interaction_records_across_sessions() {
        let storage = Storage::open_in_memory().unwrap();
        let first_session = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();
        let second_session = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 2, 20, 0, 0).unwrap(),
            )
            .unwrap();

        for session_id in [&first_session, &second_session] {
            storage
                .record_interaction(
                    session_id,
                    8792912,
                    &ParsedLiveEvent {
                        event: LiveEvent::Danmu {
                            user_id: 42,
                            user: "alice".to_string(),
                            text: "hello".to_string(),
                        },
                        raw: json!({
                            "cmd": "DANMU_MSG",
                            "info": [[], "hello", [42, "alice"]]
                        }),
                    },
                )
                .unwrap();
        }

        assert_eq!(storage.user_interaction_danmu_count(42).unwrap(), 2);
    }

    #[test]
    fn records_unknown_command_interaction_for_session_count() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();
        let event = ParsedLiveEvent {
            event: LiveEvent::Command {
                name: "NEW_ACTIVITY_EVENT".to_string(),
            },
            raw: json!({
                "cmd": "NEW_ACTIVITY_EVENT",
                "data": {
                    "activity_id": 99
                }
            }),
        };

        storage
            .record_interaction(&session_id, 8792912, &event)
            .unwrap();

        assert_eq!(storage.unknown_interaction_count(&session_id).unwrap(), 1);
    }
}
