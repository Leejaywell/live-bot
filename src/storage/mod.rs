use anyhow::Result;
use bilibili_live_protocol::{InteractKind, LiveEvent, ParsedLiveEvent, PkEventKind};
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveSessionSummary {
    pub danmu_count: i64,
    pub gift_value: i64,
    pub interact_count: i64,
    pub entry_count: i64,
    pub follow_count: i64,
    pub share_count: i64,
    pub guard_buy_count: i64,
    pub guard_buyer_count: i64,
    pub peak_popularity: i64,
    pub average_popularity: i64,
    pub unknown_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserDetail {
    pub uid: i64,
    pub uname: Option<String>,
    pub danmu_count: i64,
    pub recent_danmu: Option<String>,
    pub gift_count: i64,
    pub gift_value: i64,
    pub recent_gift: Option<String>,
    pub entry_count: i64,
    pub medal_name: Option<String>,
    pub medal_level: Option<i64>,
    pub guard_level: Option<i64>,
    pub wealth_level: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PkHistoryRecord {
    pub event_subtype: Option<String>,
    pub init_room_id: Option<i64>,
    pub match_room_id: Option<i64>,
    pub winner_room_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PkSessionSummary {
    pub battle_count: i64,
    pub current_opponent_room_id: Option<i64>,
    pub last_opponent_room_id: Option<i64>,
    pub process_count: i64,
    pub win_count: i64,
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
                event_subtype text,
                uid integer,
                uname text,
                text text,
                gift_name text,
                gift_count integer,
                gift_price integer,
                medal_name text,
                medal_level integer,
                guard_level integer,
                wealth_level integer,
                pk_init_room_id integer,
                pk_match_room_id integer,
                pk_winner_room_id integer,
                popularity_value integer,
                raw_json text not null,
                occurred_at text not null
            );
            ",
        )?;
        ensure_column(&conn, "interaction_records", "event_subtype", "text")?;
        ensure_column(&conn, "interaction_records", "medal_name", "text")?;
        ensure_column(&conn, "interaction_records", "medal_level", "integer")?;
        ensure_column(&conn, "interaction_records", "guard_level", "integer")?;
        ensure_column(&conn, "interaction_records", "wealth_level", "integer")?;
        ensure_column(&conn, "interaction_records", "pk_init_room_id", "integer")?;
        ensure_column(&conn, "interaction_records", "pk_match_room_id", "integer")?;
        ensure_column(&conn, "interaction_records", "pk_winner_room_id", "integer")?;
        ensure_column(&conn, "interaction_records", "popularity_value", "integer")?;
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
        let (
            event_type,
            event_subtype,
            uid,
            uname,
            text,
            gift_name,
            gift_count,
            gift_price,
            pk_init_room_id,
            pk_match_room_id,
            pk_winner_room_id,
            popularity_value,
        ) = match &parsed.event {
            LiveEvent::Danmu {
                user_id,
                user,
                text,
            } => (
                "danmu",
                None,
                Some(*user_id),
                Some(user.as_str()),
                Some(text.as_str()),
                None,
                None,
                None,
                None,
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
                None,
                Some(*user_id),
                Some(user.as_str()),
                None,
                Some(gift.as_str()),
                Some(*count),
                Some(*price),
                None,
                None,
                None,
                None,
            ),
            LiveEvent::Interact {
                kind,
                user_id,
                user,
            } => (
                "interact",
                Some(interact_kind_name(*kind)),
                Some(*user_id),
                Some(user.as_str()),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ),
            LiveEvent::GuardBuy {
                user_id,
                user,
                gift,
            } => (
                "guard_buy",
                None,
                Some(*user_id),
                Some(user.as_str()),
                None,
                Some(gift.as_str()),
                None,
                None,
                None,
                None,
                None,
                None,
            ),
            LiveEvent::EntryEffect { user_id, user, .. } => (
                "entry_effect",
                None,
                Some(*user_id),
                Some(user.as_str()),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ),
            LiveEvent::Popularity { value } => (
                "popularity",
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(*value),
            ),
            LiveEvent::Pk { kind } => match kind {
                PkEventKind::Start {
                    init_room_id,
                    match_room_id,
                } => (
                    "pk",
                    Some("start"),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    Some(*init_room_id),
                    Some(*match_room_id),
                    None,
                    None,
                ),
                PkEventKind::End => (
                    "pk",
                    Some("end"),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    extract_pk_winner_room_id(&parsed.raw),
                    None,
                ),
                PkEventKind::Process => (
                    "pk",
                    Some("process"),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                ),
                PkEventKind::Other(command) => (
                    "pk",
                    Some("other"),
                    None,
                    None,
                    Some(command.as_str()),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                ),
            },
            _ => (
                "unknown", None, None, None, None, None, None, None, None, None, None, None,
            ),
        };
        let raw_json = serde_json::to_string(&parsed.raw)?;
        let medal_name = extract_medal_name(&parsed.raw);
        let medal_level = extract_medal_level(&parsed.raw);
        let guard_level = extract_guard_level(parsed);
        let wealth_level = extract_wealth_level(parsed);
        let occurred_at = Local::now().to_rfc3339();
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "
            insert into interaction_records
                (
                    session_id,
                    room_id,
                    event_type,
                    event_subtype,
                    uid,
                    uname,
                    text,
                    gift_name,
                    gift_count,
                    gift_price,
                    medal_name,
                    medal_level,
                    guard_level,
                    wealth_level,
                    pk_init_room_id,
                    pk_match_room_id,
                    pk_winner_room_id,
                    popularity_value,
                    raw_json,
                    occurred_at
                )
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
            ",
            params![
                session_id,
                room_id,
                event_type,
                event_subtype,
                uid,
                uname,
                text,
                gift_name,
                gift_count,
                gift_price,
                medal_name,
                medal_level,
                guard_level,
                wealth_level,
                pk_init_room_id,
                pk_match_room_id,
                pk_winner_room_id,
                popularity_value,
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
    pub fn session_interact_count(&self, session_id: &str) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn.query_row(
            "
            select count(*)
            from interaction_records
            where session_id = ?1 and event_type = 'interact'
            ",
            params![session_id],
            |row| row.get(0),
        )?)
    }

    #[allow(dead_code)]
    pub fn session_interact_subtype_count(&self, session_id: &str, subtype: &str) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn.query_row(
            "
            select count(*)
            from interaction_records
            where session_id = ?1 and event_type = 'interact' and event_subtype = ?2
            ",
            params![session_id, subtype],
            |row| row.get(0),
        )?)
    }

    #[allow(dead_code)]
    pub fn session_guard_buy_count(&self, session_id: &str) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn.query_row(
            "
            select count(*)
            from interaction_records
            where session_id = ?1 and event_type = 'guard_buy'
            ",
            params![session_id],
            |row| row.get(0),
        )?)
    }

    #[allow(dead_code)]
    pub fn session_guard_buyer_count(&self, session_id: &str) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn.query_row(
            "
            select count(distinct uid)
            from interaction_records
            where session_id = ?1 and event_type = 'guard_buy' and uid is not null
            ",
            params![session_id],
            |row| row.get(0),
        )?)
    }

    #[allow(dead_code)]
    pub fn session_popularity_stats(&self, session_id: &str) -> Result<(i64, i64)> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn.query_row(
            "
            select
                coalesce(max(popularity_value), 0),
                coalesce(cast(avg(popularity_value) as integer), 0)
            from interaction_records
            where session_id = ?1
              and event_type = 'popularity'
              and popularity_value is not null
            ",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
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
    pub fn user_detail(&self, uid: i64) -> Result<UserDetail> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let uname = conn
            .query_row(
                "
                select uname
                from interaction_records
                where uid = ?1 and uname is not null
                order by id desc
                limit 1
                ",
                params![uid],
                |row| row.get(0),
            )
            .optional()?;
        let danmu_count = conn.query_row(
            "
            select count(*)
            from interaction_records
            where uid = ?1 and event_type = 'danmu'
            ",
            params![uid],
            |row| row.get(0),
        )?;
        let recent_danmu = conn
            .query_row(
                "
                select text
                from interaction_records
                where uid = ?1 and event_type = 'danmu' and text is not null
                order by id desc
                limit 1
                ",
                params![uid],
                |row| row.get(0),
            )
            .optional()?;
        let (gift_count, gift_value) = conn.query_row(
            "
            select
                coalesce(sum(gift_count), 0),
                coalesce(sum(gift_count * gift_price), 0)
            from interaction_records
            where uid = ?1 and event_type = 'gift'
            ",
            params![uid],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let recent_gift = conn
            .query_row(
                "
                select gift_name
                from interaction_records
                where uid = ?1 and event_type = 'gift' and gift_name is not null
                order by id desc
                limit 1
                ",
                params![uid],
                |row| row.get(0),
            )
            .optional()?;
        let entry_count = conn.query_row(
            "
            select count(*)
            from interaction_records
            where uid = ?1 and event_type = 'interact' and event_subtype = 'entry'
            ",
            params![uid],
            |row| row.get(0),
        )?;
        let medal_name = latest_optional_string(&conn, uid, "medal_name")?;
        let medal_level = latest_optional_i64(&conn, uid, "medal_level")?;
        let guard_level = latest_optional_i64(&conn, uid, "guard_level")?;
        let wealth_level = latest_optional_i64(&conn, uid, "wealth_level")?;
        Ok(UserDetail {
            uid,
            uname,
            danmu_count,
            recent_danmu,
            gift_count,
            gift_value,
            recent_gift,
            entry_count,
            medal_name,
            medal_level,
            guard_level,
            wealth_level,
        })
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

    #[allow(dead_code)]
    pub fn session_pk_history(&self, session_id: &str) -> Result<Vec<PkHistoryRecord>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut stmt = conn.prepare(
            "
            select event_subtype, pk_init_room_id, pk_match_room_id, pk_winner_room_id
            from interaction_records
            where session_id = ?1 and event_type = 'pk'
            order by id asc
            ",
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok(PkHistoryRecord {
                event_subtype: row.get(0)?,
                init_room_id: row.get(1)?,
                match_room_id: row.get(2)?,
                winner_room_id: row.get(3)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    #[allow(dead_code)]
    pub fn session_pk_summary(
        &self,
        session_id: &str,
        home_room_id: i64,
    ) -> Result<PkSessionSummary> {
        let history = self.session_pk_history(session_id)?;
        let battle_count = history
            .iter()
            .filter(|record| record.event_subtype.as_deref() == Some("start"))
            .count() as i64;
        let process_count = history
            .iter()
            .filter(|record| record.event_subtype.as_deref() == Some("process"))
            .count() as i64;
        let win_count = history
            .iter()
            .filter(|record| record.winner_room_id == Some(home_room_id))
            .count() as i64;
        let last_opponent_room_id = history
            .iter()
            .rev()
            .find_map(|record| opponent_room_id(record, home_room_id));
        let current_opponent_room_id = history
            .iter()
            .rev()
            .find_map(|record| match record.event_subtype.as_deref() {
                Some("end") => Some(None),
                Some("start") => Some(opponent_room_id(record, home_room_id)),
                _ => None,
            })
            .flatten();

        Ok(PkSessionSummary {
            battle_count,
            current_opponent_room_id,
            last_opponent_room_id,
            process_count,
            win_count,
        })
    }

    #[allow(dead_code)]
    pub fn live_session_summary(&self, session_id: &str) -> Result<LiveSessionSummary> {
        let (peak_popularity, average_popularity) = self.session_popularity_stats(session_id)?;
        Ok(LiveSessionSummary {
            danmu_count: self.session_danmu_count(session_id)?,
            gift_value: self.session_gift_value(session_id)?,
            interact_count: self.session_interact_count(session_id)?,
            entry_count: self.session_interact_subtype_count(session_id, "entry")?,
            follow_count: self.session_interact_subtype_count(session_id, "follow")?,
            share_count: self.session_interact_subtype_count(session_id, "share")?,
            guard_buy_count: self.session_guard_buy_count(session_id)?,
            guard_buyer_count: self.session_guard_buyer_count(session_id)?,
            peak_popularity,
            average_popularity,
            unknown_count: self.unknown_interaction_count(session_id)?,
        })
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

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("pragma table_info({table})"))?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("alter table {table} add column {column} {definition}"),
        [],
    )?;
    Ok(())
}

fn interact_kind_name(kind: InteractKind) -> &'static str {
    match kind {
        InteractKind::Entry => "entry",
        InteractKind::Follow | InteractKind::MutualFollow => "follow",
        InteractKind::Share => "share",
        InteractKind::Unknown(_) => "unknown",
    }
}

fn extract_medal_name(raw: &serde_json::Value) -> Option<String> {
    raw.pointer("/info/3/1")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_medal_level(raw: &serde_json::Value) -> Option<i64> {
    raw.pointer("/info/3/0").and_then(serde_json::Value::as_i64)
}

fn extract_guard_level(parsed: &ParsedLiveEvent) -> Option<i64> {
    match &parsed.event {
        LiveEvent::EntryEffect { guard_level, .. } => Some(*guard_level),
        _ => parsed
            .raw
            .pointer("/data/uinfo/guard/level")
            .and_then(serde_json::Value::as_i64),
    }
}

fn extract_wealth_level(parsed: &ParsedLiveEvent) -> Option<i64> {
    match &parsed.event {
        LiveEvent::EntryEffect { wealth_level, .. } => Some(*wealth_level),
        _ => parsed
            .raw
            .pointer("/data/uinfo/wealth/level")
            .and_then(serde_json::Value::as_i64),
    }
}

fn extract_pk_winner_room_id(raw: &serde_json::Value) -> Option<i64> {
    raw.pointer("/data/winner/room_id")
        .or_else(|| raw.pointer("/data/winner_info/room_id"))
        .or_else(|| raw.pointer("/data/winner_room_id"))
        .and_then(serde_json::Value::as_i64)
}

fn opponent_room_id(record: &PkHistoryRecord, home_room_id: i64) -> Option<i64> {
    match (record.init_room_id, record.match_room_id) {
        (Some(init), Some(matched)) if init == home_room_id => Some(matched),
        (Some(init), Some(matched)) if matched == home_room_id => Some(init),
        (_, Some(matched)) => Some(matched),
        (Some(init), _) => Some(init),
        _ => None,
    }
}

fn latest_optional_string(conn: &Connection, uid: i64, column: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            &format!(
                "
                select {column}
                from interaction_records
                where uid = ?1 and {column} is not null
                order by id desc
                limit 1
                "
            ),
            params![uid],
            |row| row.get(0),
        )
        .optional()?)
}

fn latest_optional_i64(conn: &Connection, uid: i64, column: &str) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            &format!(
                "
                select {column}
                from interaction_records
                where uid = ?1 and {column} is not null
                order by id desc
                limit 1
                "
            ),
            params![uid],
            |row| row.get(0),
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use bilibili_live_protocol::{InteractKind, LiveEvent, ParsedLiveEvent, PkEventKind};
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

    #[test]
    fn records_interact_event_separately_from_unknown() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();
        let event = ParsedLiveEvent {
            event: LiveEvent::Interact {
                kind: InteractKind::Entry,
                user_id: 42,
                user: "alice".to_string(),
            },
            raw: json!({
                "cmd": "INTERACT_WORD",
                "data": {
                    "msg_type": 1,
                    "uid": 42,
                    "uname": "alice"
                }
            }),
        };

        storage
            .record_interaction(&session_id, 8792912, &event)
            .unwrap();

        assert_eq!(storage.session_interact_count(&session_id).unwrap(), 1);
        assert_eq!(storage.unknown_interaction_count(&session_id).unwrap(), 0);
    }

    #[test]
    fn records_guard_buy_event_separately_from_unknown() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();
        let event = ParsedLiveEvent {
            event: LiveEvent::GuardBuy {
                user_id: 42,
                user: "alice".to_string(),
                gift: "舰长".to_string(),
            },
            raw: json!({
                "cmd": "GUARD_BUY",
                "data": {
                    "uid": 42,
                    "username": "alice",
                    "gift_name": "舰长"
                }
            }),
        };

        storage
            .record_interaction(&session_id, 8792912, &event)
            .unwrap();

        assert_eq!(storage.session_guard_buy_count(&session_id).unwrap(), 1);
        assert_eq!(storage.unknown_interaction_count(&session_id).unwrap(), 0);
    }

    #[test]
    fn records_pk_start_with_opponent_rooms() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();
        let event = ParsedLiveEvent {
            event: LiveEvent::Pk {
                kind: PkEventKind::Start {
                    init_room_id: 100,
                    match_room_id: 200,
                },
            },
            raw: json!({
                "cmd": "PK_BATTLE_START_NEW",
                "data": {
                    "init_info": { "room_id": 100 },
                    "match_info": { "room_id": 200 }
                }
            }),
        };

        storage
            .record_interaction(&session_id, 8792912, &event)
            .unwrap();

        let history = storage.session_pk_history(&session_id).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].event_subtype.as_deref(), Some("start"));
        assert_eq!(history[0].init_room_id, Some(100));
        assert_eq!(history[0].match_room_id, Some(200));
        assert_eq!(history[0].winner_room_id, None);
        assert_eq!(storage.unknown_interaction_count(&session_id).unwrap(), 0);
    }

    #[test]
    fn session_pk_summary_reports_opponent_and_wins() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(100, Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap())
            .unwrap();
        let events = [
            ParsedLiveEvent {
                event: LiveEvent::Pk {
                    kind: PkEventKind::Start {
                        init_room_id: 100,
                        match_room_id: 200,
                    },
                },
                raw: json!({"cmd": "PK_BATTLE_START_NEW"}),
            },
            ParsedLiveEvent {
                event: LiveEvent::Pk {
                    kind: PkEventKind::Process,
                },
                raw: json!({"cmd": "PK_BATTLE_PROCESS"}),
            },
            ParsedLiveEvent {
                event: LiveEvent::Pk {
                    kind: PkEventKind::End,
                },
                raw: json!({
                    "cmd": "PK_BATTLE_SETTLE",
                    "data": {
                        "winner": { "room_id": 100 }
                    }
                }),
            },
        ];

        for event in events {
            storage
                .record_interaction(&session_id, 100, &event)
                .unwrap();
        }

        let summary = storage.session_pk_summary(&session_id, 100).unwrap();

        assert_eq!(summary.battle_count, 1);
        assert_eq!(summary.current_opponent_room_id, None);
        assert_eq!(summary.last_opponent_room_id, Some(200));
        assert_eq!(summary.process_count, 1);
        assert_eq!(summary.win_count, 1);
    }

    #[test]
    fn live_session_summary_aggregates_recorded_interactions() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();
        let events = [
            ParsedLiveEvent {
                event: LiveEvent::Danmu {
                    user_id: 1,
                    user: "alice".to_string(),
                    text: "hello".to_string(),
                },
                raw: json!({"cmd": "DANMU_MSG"}),
            },
            ParsedLiveEvent {
                event: LiveEvent::Gift {
                    user_id: 2,
                    user: "bob".to_string(),
                    gift: "辣条".to_string(),
                    count: 2,
                    price: 100,
                    original_gift_name: None,
                    original_gift_price: 0,
                },
                raw: json!({"cmd": "SEND_GIFT"}),
            },
            ParsedLiveEvent {
                event: LiveEvent::Interact {
                    kind: InteractKind::Entry,
                    user_id: 3,
                    user: "carol".to_string(),
                },
                raw: json!({"cmd": "INTERACT_WORD"}),
            },
            ParsedLiveEvent {
                event: LiveEvent::GuardBuy {
                    user_id: 4,
                    user: "dave".to_string(),
                    gift: "舰长".to_string(),
                },
                raw: json!({"cmd": "GUARD_BUY"}),
            },
            ParsedLiveEvent {
                event: LiveEvent::Command {
                    name: "NEW_ACTIVITY_EVENT".to_string(),
                },
                raw: json!({"cmd": "NEW_ACTIVITY_EVENT"}),
            },
        ];

        for event in events {
            storage
                .record_interaction(&session_id, 8792912, &event)
                .unwrap();
        }

        let summary = storage.live_session_summary(&session_id).unwrap();

        assert_eq!(summary.danmu_count, 1);
        assert_eq!(summary.gift_value, 200);
        assert_eq!(summary.interact_count, 1);
        assert_eq!(summary.guard_buy_count, 1);
        assert_eq!(summary.unknown_count, 1);
    }

    #[test]
    fn live_session_summary_includes_popularity_stats() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();

        for value in [100, 250, 150] {
            storage
                .record_interaction(
                    &session_id,
                    8792912,
                    &ParsedLiveEvent {
                        event: LiveEvent::Popularity { value },
                        raw: json!({
                            "operation": 3,
                            "popularity": value
                        }),
                    },
                )
                .unwrap();
        }

        let summary = storage.live_session_summary(&session_id).unwrap();

        assert_eq!(summary.peak_popularity, 250);
        assert_eq!(summary.average_popularity, 166);
    }

    #[test]
    fn live_session_summary_breaks_down_interact_kinds() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();
        let events = [
            (InteractKind::Entry, 1, "alice"),
            (InteractKind::Follow, 2, "bob"),
            (InteractKind::Share, 3, "carol"),
        ];

        for (kind, user_id, user) in events {
            storage
                .record_interaction(
                    &session_id,
                    8792912,
                    &ParsedLiveEvent {
                        event: LiveEvent::Interact {
                            kind,
                            user_id,
                            user: user.to_string(),
                        },
                        raw: json!({"cmd": "INTERACT_WORD"}),
                    },
                )
                .unwrap();
        }

        let summary = storage.live_session_summary(&session_id).unwrap();

        assert_eq!(summary.entry_count, 1);
        assert_eq!(summary.follow_count, 1);
        assert_eq!(summary.share_count, 1);
    }

    #[test]
    fn live_session_summary_counts_unique_guard_buyers() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();

        for gift in ["舰长", "提督"] {
            storage
                .record_interaction(
                    &session_id,
                    8792912,
                    &ParsedLiveEvent {
                        event: LiveEvent::GuardBuy {
                            user_id: 42,
                            user: "alice".to_string(),
                            gift: gift.to_string(),
                        },
                        raw: json!({"cmd": "GUARD_BUY"}),
                    },
                )
                .unwrap();
        }

        let summary = storage.live_session_summary(&session_id).unwrap();

        assert_eq!(summary.guard_buy_count, 2);
        assert_eq!(summary.guard_buyer_count, 1);
    }

    #[test]
    fn user_detail_summarizes_interaction_history() {
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

        let events = [
            (
                &first_session,
                ParsedLiveEvent {
                    event: LiveEvent::Danmu {
                        user_id: 42,
                        user: "alice".to_string(),
                        text: "first".to_string(),
                    },
                    raw: json!({"cmd": "DANMU_MSG"}),
                },
            ),
            (
                &second_session,
                ParsedLiveEvent {
                    event: LiveEvent::Danmu {
                        user_id: 42,
                        user: "alice".to_string(),
                        text: "latest".to_string(),
                    },
                    raw: json!({"cmd": "DANMU_MSG"}),
                },
            ),
            (
                &second_session,
                ParsedLiveEvent {
                    event: LiveEvent::Gift {
                        user_id: 42,
                        user: "alice".to_string(),
                        gift: "辣条".to_string(),
                        count: 3,
                        price: 100,
                        original_gift_name: None,
                        original_gift_price: 0,
                    },
                    raw: json!({"cmd": "SEND_GIFT"}),
                },
            ),
            (
                &second_session,
                ParsedLiveEvent {
                    event: LiveEvent::Interact {
                        kind: InteractKind::Entry,
                        user_id: 42,
                        user: "alice".to_string(),
                    },
                    raw: json!({"cmd": "INTERACT_WORD"}),
                },
            ),
        ];

        for (session_id, event) in events {
            storage
                .record_interaction(session_id, 8792912, &event)
                .unwrap();
        }

        let detail = storage.user_detail(42).unwrap();

        assert_eq!(detail.uid, 42);
        assert_eq!(detail.uname.as_deref(), Some("alice"));
        assert_eq!(detail.danmu_count, 2);
        assert_eq!(detail.recent_danmu.as_deref(), Some("latest"));
        assert_eq!(detail.gift_count, 3);
        assert_eq!(detail.gift_value, 300);
        assert_eq!(detail.recent_gift.as_deref(), Some("辣条"));
        assert_eq!(detail.entry_count, 1);
    }

    #[test]
    fn user_detail_includes_latest_medal_and_guard_fields() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();
        let danmu = ParsedLiveEvent {
            event: LiveEvent::Danmu {
                user_id: 42,
                user: "alice".to_string(),
                text: "hello".to_string(),
            },
            raw: json!({
                "cmd": "DANMU_MSG",
                "info": [
                    [],
                    "hello",
                    [42, "alice"],
                    [21, "舰团牌"]
                ]
            }),
        };
        let entry_effect = ParsedLiveEvent {
            event: LiveEvent::EntryEffect {
                user_id: 42,
                user: "alice".to_string(),
                guard_level: 3,
                wealth_level: 18,
            },
            raw: json!({
                "cmd": "ENTRY_EFFECT",
                "data": {
                    "uid": 42,
                    "uinfo": {
                        "guard": { "level": 3 },
                        "wealth": { "level": 18 }
                    }
                }
            }),
        };

        storage
            .record_interaction(&session_id, 8792912, &danmu)
            .unwrap();
        storage
            .record_interaction(&session_id, 8792912, &entry_effect)
            .unwrap();

        let detail = storage.user_detail(42).unwrap();

        assert_eq!(detail.medal_name.as_deref(), Some("舰团牌"));
        assert_eq!(detail.medal_level, Some(21));
        assert_eq!(detail.guard_level, Some(3));
        assert_eq!(detail.wealth_level, Some(18));
    }
}
