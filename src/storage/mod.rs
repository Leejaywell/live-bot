use anyhow::Result;
use bilibili_live_protocol::{InteractKind, LiveEvent, ParsedLiveEvent, PkEventKind};
use chrono::{DateTime, Datelike, Local, Timelike};
use rusqlite::{Connection, OptionalExtension, params};
use std::sync::Mutex;

use crate::live_platform::types::{PlatformEvent, PlatformEventEnvelope};

#[derive(Debug)]
pub struct Storage {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
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

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct GiftStat {
    pub name: String,
    pub value: i64,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct UserGiftStat {
    pub uid: i64,
    pub uname: String,
    pub gift_value: i64,
    pub gift_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct DailyStats {
    pub date: String,
    pub danmu_count: i64,
    pub entry_count: i64,
    pub gift_count: i64,
    pub follow_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct CheckUserResult {
    pub status: String,
    pub nickname: String,
    pub alias: String,
    pub notes: String,
    pub tts_provider_id: String,
    pub tts_voice_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct KnownUser {
    pub uid: i64,
    pub nickname: String,
    pub alias: String,
    pub notes: String,
    pub tts_provider_id: String,
    pub tts_voice_id: String,
    pub danmu_count: i64,
    pub gift_value: i64,
    pub session_count: i64,
    pub last_seen: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UserProfile {
    pub uid: i64,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub total_danmu_count: i64,
    pub total_gift_value: i64,
    pub total_sc_value: i64,
    pub enter_count: i64,
    /// JSON 字符串：{"0": 3, "14": 12, ...} 24 小时活跃直方图
    pub active_hours: String,
    pub fan_level: i64,
    pub is_guard: i64,
    pub ai_summary: String,
    /// JSON 字符串数组
    pub ai_tags: String,
    /// JSON 字符串数组
    pub ai_topics: String,
    pub ai_summary_updated_at: Option<String>,
    pub ai_summary_version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PkHistoryRecord {
    pub event_subtype: Option<String>,
    pub init_room_id: Option<i64>,
    pub match_room_id: Option<i64>,
    pub winner_room_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PkSessionSummary {
    pub battle_count: i64,
    pub current_opponent_room_id: Option<i64>,
    pub last_opponent_room_id: Option<i64>,
    pub process_count: i64,
    pub win_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct GiftCatalogItem {
    pub gift_id: i64,
    pub name: String,
    pub price: i64,
    pub image: String,
    pub updated_at: String,
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
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

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
                platform_id text not null default 'bilibili',
                platform_room_id text,
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
                platform_id text not null default 'bilibili',
                platform_room_id text,
                platform_user_id text,
                event_kind text,
                event_action text,
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
            create index if not exists idx_interaction_session on interaction_records(session_id);
            create index if not exists idx_interaction_uid on interaction_records(uid);
            create index if not exists idx_interaction_room on interaction_records(room_id);
            create index if not exists idx_interaction_platform_room on interaction_records(platform_id, platform_room_id);
            create index if not exists idx_interaction_platform_user on interaction_records(platform_id, platform_user_id);
            create index if not exists idx_interaction_time on interaction_records(occurred_at);
            create table if not exists tracked_users (
                uid integer primary key,
                platform_id text not null default 'bilibili',
                platform_user_id text,
                nickname text not null default '',
                alias text not null default '',
                notes text not null default '',
                tts_provider_id text not null default '',
                tts_voice_id text not null default '',
                status text not null default 'active',
                auto_tracked integer not null default 0,
                created_at text not null,
                updated_at text not null
            );
            create index if not exists idx_tracked_users_status on tracked_users(status);
            create index if not exists idx_tracked_users_platform_user on tracked_users(platform_id, platform_user_id);
            create table if not exists live_gift_catalog (
                gift_id integer primary key,
                name text not null,
                price integer not null,
                image text not null,
                updated_at text not null
            );
            create index if not exists idx_live_gift_catalog_name on live_gift_catalog(name);
            create table if not exists user_profiles (
                uid integer primary key,
                platform_id text not null default 'bilibili',
                platform_user_id text,
                first_seen_at text not null,
                last_seen_at text not null,
                total_danmu_count integer not null default 0,
                total_gift_value integer not null default 0,
                total_sc_value integer not null default 0,
                enter_count integer not null default 0,
                active_hours text not null default '',
                fan_level integer not null default 0,
                is_guard integer not null default 0,
                ai_summary text not null default '',
                ai_tags text not null default '',
                ai_topics text not null default '',
                ai_summary_updated_at text,
                ai_summary_version integer not null default 0
            );
            create index if not exists idx_user_profiles_last_seen on user_profiles(last_seen_at);
            create index if not exists idx_user_profiles_ai_updated on user_profiles(ai_summary_updated_at);
            create index if not exists idx_user_profiles_platform_user on user_profiles(platform_id, platform_user_id);
            ",
        )?;
        ensure_column(&conn, "interaction_records", "event_subtype", "text")?;
        ensure_column(
            &conn,
            "live_sessions",
            "platform_id",
            "text not null default 'bilibili'",
        )?;
        ensure_column(&conn, "live_sessions", "platform_room_id", "text")?;
        ensure_column(
            &conn,
            "interaction_records",
            "platform_id",
            "text not null default 'bilibili'",
        )?;
        ensure_column(&conn, "interaction_records", "platform_room_id", "text")?;
        ensure_column(&conn, "interaction_records", "platform_user_id", "text")?;
        ensure_column(&conn, "interaction_records", "event_kind", "text")?;
        ensure_column(&conn, "interaction_records", "event_action", "text")?;
        ensure_column(&conn, "interaction_records", "medal_name", "text")?;
        ensure_column(&conn, "interaction_records", "medal_level", "integer")?;
        ensure_column(&conn, "interaction_records", "guard_level", "integer")?;
        ensure_column(&conn, "interaction_records", "wealth_level", "integer")?;
        ensure_column(&conn, "interaction_records", "pk_init_room_id", "integer")?;
        ensure_column(&conn, "interaction_records", "pk_match_room_id", "integer")?;
        ensure_column(&conn, "interaction_records", "pk_winner_room_id", "integer")?;
        ensure_column(&conn, "interaction_records", "popularity_value", "integer")?;
        ensure_column(
            &conn,
            "tracked_users",
            "platform_id",
            "text not null default 'bilibili'",
        )?;
        ensure_column(&conn, "tracked_users", "platform_user_id", "text")?;
        ensure_column(
            &conn,
            "tracked_users",
            "tts_provider_id",
            "text not null default ''",
        )?;
        ensure_column(
            &conn,
            "tracked_users",
            "tts_voice_id",
            "text not null default ''",
        )?;
        ensure_column(
            &conn,
            "user_profiles",
            "platform_id",
            "text not null default 'bilibili'",
        )?;
        ensure_column(&conn, "user_profiles", "platform_user_id", "text")?;
        conn.execute(
            "update live_sessions
                set platform_room_id = cast(room_id as text)
              where platform_room_id is null",
            [],
        )?;
        conn.execute(
            "update interaction_records
                set platform_room_id = cast(room_id as text)
              where platform_room_id is null",
            [],
        )?;
        conn.execute(
            "update interaction_records
                set platform_user_id = cast(uid as text)
              where platform_user_id is null and uid is not null",
            [],
        )?;
        conn.execute(
            "update tracked_users
                set platform_user_id = cast(uid as text)
              where platform_user_id is null and uid is not null",
            [],
        )?;
        conn.execute(
            "update user_profiles
                set platform_user_id = cast(uid as text)
              where platform_user_id is null and uid is not null",
            [],
        )?;
        conn.execute(
            "create index if not exists idx_interaction_platform_room on interaction_records(platform_id, platform_room_id)",
            [],
        )?;
        conn.execute(
            "create index if not exists idx_interaction_platform_user on interaction_records(platform_id, platform_user_id)",
            [],
        )?;
        conn.execute(
            "create index if not exists idx_tracked_users_platform_user on tracked_users(platform_id, platform_user_id)",
            [],
        )?;
        conn.execute(
            "create index if not exists idx_user_profiles_platform_user on user_profiles(platform_id, platform_user_id)",
            [],
        )?;
        // 一次性迁移：将 interaction_records 里满足条件的历史用户播种到 tracked_users。
        // 仅播种明确属于 Bilibili 的历史记录，避免其他平台的纯数字 platform_user_id
        // 在重启时被错误映射成默认 Bilibili tracked user。
        conn.execute_batch(
            "
            insert or ignore into tracked_users (
                uid,
                platform_id,
                platform_user_id,
                nickname,
                alias,
                notes,
                status,
                auto_tracked,
                created_at,
                updated_at
            )
            select
                uid,
                'bilibili',
                cast(uid as text),
                max(uname),
                '',
                '',
                'active',
                1,
                datetime('now'),
                datetime('now')
            from interaction_records
            where uid is not null
              and uid != 0
              and coalesce(platform_id, 'bilibili') = 'bilibili'
              and coalesce(platform_user_id, cast(uid as text)) = cast(uid as text)
            group by uid
            having
                coalesce(sum(coalesce(gift_count, 0) * coalesce(gift_price, 0)), 0) > 0
                or count(case when event_type = 'danmu' then 1 end) >= 3
                or count(case when event_type in ('guard_buy', 'follow', 'share', 'super_chat') then 1 end) > 0;
            ",
        )?;
        crate::music::storage::ensure_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    #[allow(dead_code)]
    pub fn with_connection<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T>,
    {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        f(&conn)
    }

    /// Runs a closure with mutable access to the underlying SQLite connection.
    ///
    /// Use this for transaction-scoped helpers only. Do not call other `Storage`
    /// methods from inside the closure because they will try to lock the same
    /// mutex again.
    #[allow(dead_code)]
    pub fn with_connection_mut<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Connection) -> Result<T>,
    {
        let mut conn = self.conn.lock().expect("storage mutex poisoned");
        f(&mut conn)
    }

    pub fn replace_gift_catalog(&self, gifts: &[GiftCatalogItem]) -> Result<()> {
        let mut conn = self.conn.lock().expect("storage mutex poisoned");
        let tx = conn.transaction()?;
        tx.execute("delete from live_gift_catalog", [])?;
        {
            let mut stmt = tx.prepare(
                "insert into live_gift_catalog (gift_id, name, price, image, updated_at)
                 values (?1, ?2, ?3, ?4, ?5)",
            )?;
            for gift in gifts {
                stmt.execute(params![
                    gift.gift_id,
                    gift.name,
                    gift.price,
                    gift.image,
                    gift.updated_at
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn upsert_gift_catalog_items(&self, gifts: &[GiftCatalogItem]) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut stmt = conn.prepare(
            "insert into live_gift_catalog (gift_id, name, price, image, updated_at)
             values (?1, ?2, ?3, ?4, ?5)
             on conflict(gift_id) do update set
                name = excluded.name,
                price = excluded.price,
                image = excluded.image,
                updated_at = excluded.updated_at",
        )?;
        for gift in gifts {
            stmt.execute(params![
                gift.gift_id,
                gift.name,
                gift.price,
                gift.image,
                gift.updated_at
            ])?;
        }
        Ok(())
    }

    pub fn gift_catalog(&self) -> Result<Vec<GiftCatalogItem>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut stmt = conn.prepare(
            "select gift_id, name, price, image, updated_at
             from live_gift_catalog
             order by price asc, name asc",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(GiftCatalogItem {
                gift_id: row.get(0)?,
                name: row.get(1)?,
                price: row.get(2)?,
                image: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn gift_catalog_stale(&self, max_age_secs: i64) -> Result<bool> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let latest: Option<String> = conn
            .query_row("select max(updated_at) from live_gift_catalog", [], |row| {
                row.get(0)
            })
            .optional()?
            .flatten();
        let Some(latest) = latest else {
            return Ok(true);
        };
        let Ok(updated_at) = chrono::DateTime::parse_from_rfc3339(&latest) else {
            return Ok(true);
        };
        Ok((Local::now() - updated_at.with_timezone(&Local)).num_seconds() >= max_age_secs)
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

        // 增量更新粉丝档案统计 (uid > 0 才记录)
        if let Some(uid_val) = uid {
            if uid_val > 0 {
                let now = Local::now();
                let is_guard_event = matches!(parsed.event, LiveEvent::GuardBuy { .. });
                let sc_price = match &parsed.event {
                    LiveEvent::SuperChat { price, .. } => Some(*price),
                    _ => None,
                };
                let platform_user_id = uid_val.to_string();
                upsert_user_profile_stats(
                    &conn,
                    uid_val,
                    "bilibili",
                    platform_user_id.as_str(),
                    event_type,
                    event_subtype,
                    gift_count,
                    gift_price,
                    sc_price,
                    medal_level,
                    is_guard_event,
                    &occurred_at,
                    now.hour(),
                )?;
            }
        }

        Ok(())
    }

    #[allow(dead_code)]
    pub fn insert_platform_interaction_record(
        &self,
        session_id: &str,
        envelope: &PlatformEventEnvelope,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let (event_kind, event_action, event_type, event_subtype) =
            platform_event_classification(&envelope.event);
        let (platform_user_id, uname, uid) = platform_event_user(&envelope.event);
        let room_id = envelope.room.platform_room_id.parse::<i64>().unwrap_or(0);
        let (text, gift_name, gift_count, gift_price, popularity_value) = match &envelope.event {
            PlatformEvent::Message(value) => (Some(value.text.clone()), None, None, None, None),
            PlatformEvent::Gift(value) => (
                None,
                Some(value.gift.clone()),
                Some(value.count),
                Some(value.price),
                None,
            ),
            PlatformEvent::GuardOrMember(value) => {
                (None, Some(value.gift.clone()), Some(1), None, None)
            }
            PlatformEvent::PaidMessage(value) => (
                Some(value.text.clone()),
                None,
                None,
                Some(value.price),
                None,
            ),
            PlatformEvent::Popularity(value) => (None, None, None, None, Some(value.value)),
            _ => (None, None, None, None, None),
        };
        let raw_json = envelope.raw.to_string();
        let occurred_at = envelope.occurred_at.to_rfc3339();

        conn.execute(
            "
            insert into interaction_records
                (
                    session_id,
                    platform_id,
                    platform_room_id,
                    platform_user_id,
                    event_kind,
                    event_action,
                    room_id,
                    event_type,
                    event_subtype,
                    uid,
                    uname,
                    text,
                    gift_name,
                    gift_count,
                    gift_price,
                    popularity_value,
                    raw_json,
                    occurred_at
                )
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
            ",
            params![
                session_id,
                envelope.platform_id.as_str(),
                envelope.room.platform_room_id.as_str(),
                platform_user_id,
                event_kind,
                event_action,
                room_id,
                event_type,
                event_subtype,
                uid,
                uname,
                text,
                gift_name,
                gift_count,
                gift_price,
                popularity_value,
                raw_json,
                occurred_at,
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

    pub fn periodic_summary(&self, days: i64) -> Result<LiveSessionSummary> {
        let start_date = if days == 0 {
            today_key()
        } else {
            let start = Local::now() - chrono::Duration::days(days);
            format!(
                "{:04}-{:02}-{:02}",
                start.year(),
                start.month(),
                start.day()
            )
        };

        let conn = self.conn.lock().expect("storage mutex poisoned");

        let danmu_count = conn.query_row(
            "select count(*) from interaction_records where occurred_at >= ?1 and event_type = 'danmu'",
            params![start_date],
            |row| row.get(0),
        )?;
        let gift_value = conn.query_row(
            "select coalesce(sum(gift_count * gift_price), 0) from interaction_records where occurred_at >= ?1 and event_type = 'gift'",
            params![start_date],
            |row| row.get(0),
        )?;
        let interact_count = conn.query_row(
            "select count(*) from interaction_records where occurred_at >= ?1 and event_type = 'interact'",
            params![start_date],
            |row| row.get(0),
        )?;
        let entry_count = conn.query_row(
            "select count(*) from interaction_records where occurred_at >= ?1 and event_type = 'interact' and event_subtype = 'entry'",
            params![start_date],
            |row| row.get(0),
        )?;
        let follow_count = conn.query_row(
            "select count(*) from interaction_records where occurred_at >= ?1 and event_type = 'interact' and event_subtype = 'follow'",
            params![start_date],
            |row| row.get(0),
        )?;
        let share_count = conn.query_row(
            "select count(*) from interaction_records where occurred_at >= ?1 and event_type = 'interact' and event_subtype = 'share'",
            params![start_date],
            |row| row.get(0),
        )?;
        let guard_buy_count = conn.query_row(
            "select count(*) from interaction_records where occurred_at >= ?1 and event_type = 'guard_buy'",
            params![start_date],
            |row| row.get(0),
        )?;
        let guard_buyer_count = conn.query_row(
            "select count(distinct uid) from interaction_records where occurred_at >= ?1 and event_type = 'guard_buy' and uid is not null",
            params![start_date],
            |row| row.get(0),
        )?;
        let (peak_popularity, average_popularity) = conn.query_row(
            "select coalesce(max(popularity_value), 0), coalesce(cast(avg(popularity_value) as integer), 0) from interaction_records where occurred_at >= ?1 and event_type = 'popularity'",
            params![start_date],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let unknown_count = conn.query_row(
            "select count(*) from interaction_records where occurred_at >= ?1 and event_type = 'unknown'",
            params![start_date],
            |row| row.get(0),
        )?;

        Ok(LiveSessionSummary {
            danmu_count,
            gift_value,
            interact_count,
            entry_count,
            follow_count,
            share_count,
            guard_buy_count,
            guard_buyer_count,
            peak_popularity,
            average_popularity,
            unknown_count,
        })
    }

    pub fn daily_interaction_counts(&self, days: i64) -> Result<Vec<DailyStats>> {
        let start_date = if days <= 0 {
            today_key()
        } else {
            let start = Local::now() - chrono::Duration::days(days);
            format!(
                "{:04}-{:02}-{:02}",
                start.year(),
                start.month(),
                start.day()
            )
        };
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut stmt = conn.prepare(
            "
            select
                date(occurred_at) as day,
                count(case when event_type = 'danmu' then 1 end) as danmu_count,
                count(case when event_type = 'interact' and event_subtype = 'entry' then 1 end) as entry_count,
                count(case when event_type = 'gift' then 1 end) as gift_count,
                count(case when event_type = 'interact' and event_subtype in ('follow','mutual_follow') then 1 end) as follow_count
            from interaction_records
            where occurred_at >= ?1
            group by date(occurred_at)
            order by day asc
            ",
        )?;
        let rows = stmt.query_map(params![start_date], |row| {
            Ok(DailyStats {
                date: row.get(0)?,
                danmu_count: row.get(1)?,
                entry_count: row.get(2)?,
                gift_count: row.get(3)?,
                follow_count: row.get(4)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn gift_top_n(&self, days: i64, n: i32) -> Result<Vec<GiftStat>> {
        let start_date = if days == 0 {
            today_key()
        } else {
            let start = Local::now() - chrono::Duration::days(days);
            format!(
                "{:04}-{:02}-{:02}",
                start.year(),
                start.month(),
                start.day()
            )
        };

        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut stmt = conn.prepare(
            "
            select gift_name, sum(gift_count * gift_price) as total_value, sum(gift_count) as total_count
            from interaction_records
            where occurred_at >= ?1 and event_type = 'gift' and gift_name is not null
            group by gift_name
            order by total_value desc
            limit ?2
            ",
        )?;
        let rows = stmt.query_map(params![start_date, n], |row| {
            Ok(GiftStat {
                name: row.get(0)?,
                value: row.get(1)?,
                count: row.get(2)?,
            })
        })?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn user_gift_top_n(&self, days: i64, n: i32) -> Result<Vec<UserGiftStat>> {
        let start_date = if days == 0 {
            today_key()
        } else {
            let start = Local::now() - chrono::Duration::days(days);
            format!(
                "{:04}-{:02}-{:02}",
                start.year(),
                start.month(),
                start.day()
            )
        };

        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut stmt = conn.prepare(
            "
            SELECT uid, uname, SUM(gift_count * gift_price) as gift_value, SUM(gift_count) as gift_count
            FROM interaction_records
            WHERE occurred_at >= ?1 AND event_type = 'gift' AND uid IS NOT NULL AND uname IS NOT NULL
            GROUP BY uid
            ORDER BY gift_value DESC
            LIMIT ?2
            ",
        )?;
        let rows = stmt.query_map(params![start_date, n], |row| {
            Ok(UserGiftStat {
                uid: row.get(0)?,
                uname: row.get(1)?,
                gift_value: row.get(2)?,
                gift_count: row.get(3)?,
            })
        })?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
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

    pub fn get_tracked_users(&self, limit: i64) -> Result<Vec<KnownUser>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut stmt = conn.prepare(
            "
            select
                t.uid,
                t.nickname,
                t.alias,
                t.notes,
                coalesce(t.tts_provider_id, ''),
                coalesce(t.tts_voice_id, ''),
                coalesce(s.danmu_count, 0),
                coalesce(s.gift_value, 0),
                coalesce(s.session_count, 0),
                coalesce(s.last_seen, t.created_at)
            from tracked_users t
            left join (
                select uid,
                    count(case when event_type = 'danmu' then 1 end) as danmu_count,
                    coalesce(sum(case when event_type = 'gift' then gift_count * gift_price else 0 end), 0) as gift_value,
                    count(distinct session_id) as session_count,
                    max(occurred_at) as last_seen
                from interaction_records
                where uid is not null
                group by uid
            ) s on s.uid = t.uid
            where t.status = 'active'
            order by coalesce(s.last_seen, t.created_at) desc
            limit ?1
            ",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(KnownUser {
                uid: row.get(0)?,
                nickname: row.get(1)?,
                alias: row.get(2)?,
                notes: row.get(3)?,
                tts_provider_id: row.get(4)?,
                tts_voice_id: row.get(5)?,
                danmu_count: row.get(6)?,
                gift_value: row.get(7)?,
                session_count: row.get(8)?,
                last_seen: row.get(9)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn check_tracked_user(&self, uid: i64) -> Result<Option<CheckUserResult>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.query_row(
            "select status, nickname, alias, notes, coalesce(tts_provider_id, ''), coalesce(tts_voice_id, '') from tracked_users where uid = ?1",
            params![uid],
            |row| {
                Ok(CheckUserResult {
                    status: row.get(0)?,
                    nickname: row.get(1)?,
                    alias: row.get(2)?,
                    notes: row.get(3)?,
                    tts_provider_id: row.get(4)?,
                    tts_voice_id: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn add_tracked_user(
        &self,
        uid: i64,
        nickname: &str,
        alias: &str,
        notes: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let now = Local::now().to_rfc3339();
        conn.execute(
            "insert into tracked_users (uid, platform_user_id, nickname, alias, notes, status, auto_tracked, created_at, updated_at)
             values (?1, cast(?1 as text), ?2, ?3, ?4, 'active', 0, ?5, ?5)",
            params![uid, nickname, alias, notes, now],
        )?;
        Ok(())
    }

    pub fn restore_tracked_user(&self, uid: i64, alias: &str, notes: &str) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "update tracked_users set status = 'active', alias = ?2, notes = ?3, updated_at = ?4 where uid = ?1",
            params![uid, alias, notes, Local::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn update_tracked_user(&self, uid: i64, alias: &str, notes: &str) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "update tracked_users set alias = ?2, notes = ?3, updated_at = ?4 where uid = ?1",
            params![uid, alias, notes, Local::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn update_tracked_user_tts_voice(
        &self,
        uid: i64,
        tts_provider_id: &str,
        tts_voice_id: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "update tracked_users set tts_provider_id = ?2, tts_voice_id = ?3, updated_at = ?4 where uid = ?1",
            params![
                uid,
                tts_provider_id.trim(),
                tts_voice_id.trim(),
                Local::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn soft_delete_tracked_user(&self, uid: i64) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "update tracked_users set status = 'deleted', updated_at = ?2 where uid = ?1",
            params![uid, Local::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn auto_track_user(&self, uid: i64, uname: &str, event_type: &str) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let existing: Option<String> = conn
            .query_row(
                "select status from tracked_users where uid = ?1",
                params![uid],
                |r| r.get(0),
            )
            .optional()?;
        let now = Local::now().to_rfc3339();
        match existing.as_deref() {
            Some("active") => {
                conn.execute(
                    "update tracked_users
                        set nickname = ?2,
                            platform_user_id = coalesce(platform_user_id, cast(?1 as text)),
                            updated_at = ?3
                      where uid = ?1",
                    params![uid, uname, now],
                )?;
            }
            Some("deleted") => {}
            _ => {
                let qualifies = match event_type {
                    "gift" | "guard_buy" | "follow" | "share" | "super_chat" => true,
                    "danmu" => {
                        let count: i64 = conn.query_row(
                            "select count(*) from interaction_records where uid = ?1 and event_type = 'danmu'",
                            params![uid],
                            |r| r.get(0),
                        )?;
                        count >= 3
                    }
                    _ => false,
                };
                if qualifies {
                    conn.execute(
                        "insert or ignore into tracked_users (uid, platform_user_id, nickname, alias, notes, status, auto_tracked, created_at, updated_at)
                         values (?1, cast(?1 as text), ?2, '', '', 'active', 1, ?3, ?3)",
                        params![uid, uname, now],
                    )?;
                }
            }
        }
        Ok(())
    }

    pub fn auto_track_platform_user(
        &self,
        platform_id: &str,
        platform_user_id: &str,
        fallback_uid: Option<i64>,
        uname: &str,
        event_type: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let existing: Option<(i64, String)> = conn
            .query_row(
                "select uid, status
                   from tracked_users
                  where platform_id = ?1 and platform_user_id = ?2",
                params![platform_id, platform_user_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let now = Local::now().to_rfc3339();

        match existing {
            Some((uid, status)) if status == "active" => {
                conn.execute(
                    "update tracked_users
                        set nickname = ?2,
                            updated_at = ?3
                      where uid = ?1",
                    params![uid, uname, now],
                )?;
                return Ok(());
            }
            Some((_, status)) if status == "deleted" => return Ok(()),
            Some(_) => return Ok(()),
            None => {}
        }

        let Some(uid) = fallback_uid.filter(|uid| *uid > 0) else {
            return Ok(());
        };
        if platform_id != "bilibili" || platform_user_id.parse::<i64>().ok() != Some(uid) {
            return Ok(());
        }
        let existing_by_uid: Option<String> = conn
            .query_row(
                "select status from tracked_users where uid = ?1",
                params![uid],
                |row| row.get(0),
            )
            .optional()?;

        match existing_by_uid.as_deref() {
            Some("active") => {
                conn.execute(
                    "update tracked_users
                        set platform_id = ?2,
                            platform_user_id = ?3,
                            nickname = ?4,
                            updated_at = ?5
                      where uid = ?1",
                    params![uid, platform_id, platform_user_id, uname, now],
                )?;
            }
            Some("deleted") => {}
            _ => {
                let qualifies = match event_type {
                    "gift" | "guard_buy" | "follow" | "share" | "super_chat" => true,
                    "danmu" => {
                        let count: i64 = conn.query_row(
                            "select count(*)
                               from interaction_records
                              where platform_id = ?1
                                and platform_user_id = ?2
                                and event_type = 'danmu'",
                            params![platform_id, platform_user_id],
                            |row| row.get(0),
                        )?;
                        count >= 3
                    }
                    _ => false,
                };
                if qualifies {
                    conn.execute(
                        "insert or ignore into tracked_users (
                            uid,
                            platform_id,
                            platform_user_id,
                            nickname,
                            alias,
                            notes,
                            status,
                            auto_tracked,
                            created_at,
                            updated_at
                        )
                        values (?1, ?2, ?3, ?4, '', '', 'active', 1, ?5, ?5)",
                        params![uid, platform_id, platform_user_id, uname, now],
                    )?;
                }
            }
        }
        Ok(())
    }

    // ── 粉丝档案 (user_profiles) ────────────────────────────────────

    pub fn get_user_profile(&self, uid: i64) -> Result<Option<UserProfile>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn
            .query_row(
                "select uid, first_seen_at, last_seen_at,
                        total_danmu_count, total_gift_value, total_sc_value, enter_count,
                        active_hours, fan_level, is_guard,
                        ai_summary, ai_tags, ai_topics,
                        ai_summary_updated_at, ai_summary_version
                 from user_profiles where uid = ?1",
                params![uid],
                map_user_profile,
            )
            .optional()?)
    }

    /// 按最近活跃排序的分页列表
    #[allow(dead_code)] // 前端 UI 用，暂未接入
    pub fn list_user_profiles(&self, offset: i64, limit: i64) -> Result<Vec<UserProfile>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut stmt = conn.prepare(
            "select uid, first_seen_at, last_seen_at,
                    total_danmu_count, total_gift_value, total_sc_value, enter_count,
                    active_hours, fan_level, is_guard,
                    ai_summary, ai_tags, ai_topics,
                    ai_summary_updated_at, ai_summary_version
             from user_profiles
             order by last_seen_at desc
             limit ?1 offset ?2",
        )?;
        let rows = stmt.query_map(params![limit, offset], map_user_profile)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// 写回 LLM 分析结果。tags / topics 已经是 JSON 字符串。
    pub fn update_profile_ai_fields(
        &self,
        uid: i64,
        summary: &str,
        tags_json: &str,
        topics_json: &str,
        version: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let now = Local::now().to_rfc3339();
        conn.execute(
            "update user_profiles
             set ai_summary = ?2,
                 ai_tags = ?3,
                 ai_topics = ?4,
                 ai_summary_updated_at = ?5,
                 ai_summary_version = ?6
             where uid = ?1",
            params![uid, summary, tags_json, topics_json, now, version],
        )?;
        Ok(())
    }

    /// 查找需要 LLM 分析的 uid：
    ///   - 满足 total_danmu_count >= min_danmu
    ///   - ai_summary_updated_at 为 NULL 或距今超过 stale_after_days
    #[allow(dead_code)] // 启动 sweep 用，暂未接入
    pub fn fetch_uids_needing_ai_summary(
        &self,
        min_danmu: i64,
        stale_after_days: i64,
        limit: i64,
    ) -> Result<Vec<i64>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let cutoff = (Local::now() - chrono::Duration::days(stale_after_days)).to_rfc3339();
        let mut stmt = conn.prepare(
            "select uid from user_profiles
             where total_danmu_count >= ?1
               and (ai_summary_updated_at is null or ai_summary_updated_at < ?2)
             order by last_seen_at desc
             limit ?3",
        )?;
        let rows = stmt.query_map(params![min_danmu, cutoff, limit], |r| r.get::<_, i64>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// 取该 uid 最近 N 条弹幕文本（仅 danmu 事件），按时间倒序。LLM 输入用。
    pub fn recent_danmu_for_uid(&self, uid: i64, limit: i64) -> Result<Vec<String>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut stmt = conn.prepare(
            "select text from interaction_records
             where uid = ?1 and event_type = 'danmu' and text is not null
             order by id desc
             limit ?2",
        )?;
        let rows = stmt.query_map(params![uid, limit], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn cleanup_old_records(&self, days: i64) -> Result<usize> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let cutoff = (Local::now() - chrono::Duration::days(days)).to_rfc3339();
        let count = conn.execute(
            "delete from interaction_records where occurred_at < ?1",
            params![cutoff],
        )?;
        conn.execute(
            "delete from blind_box_stat where created_at < ?1",
            params![cutoff],
        )?;
        Ok(count)
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

    pub fn get_blind_box_stats(&self, days: i64) -> Result<Vec<(String, i64)>> {
        let start_date = if days == 0 {
            today_key()
        } else {
            let start = Local::now() - chrono::Duration::days(days);
            format!(
                "{:04}-{:02}-{:02}",
                start.year(),
                start.month(),
                start.day()
            )
        };

        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut stmt = conn.prepare(
            "
            select substr(created_at, 1, 10) as day, sum(profit_loss) as total
            from blind_box_stat
            where created_at >= ?1
            group by day
            order by day asc
            ",
        )?;
        let rows = stmt.query_map(params![start_date], |row| Ok((row.get(0)?, row.get(1)?)))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
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

fn platform_event_classification(
    event: &PlatformEvent,
) -> (
    &'static str,
    Option<&'static str>,
    &'static str,
    Option<&'static str>,
) {
    match event {
        PlatformEvent::Message(_) => ("message", Some("chat"), "danmu", None),
        PlatformEvent::Gift(_) => ("gift", None, "gift", None),
        PlatformEvent::Follow(_) => ("interact", Some("follow"), "interact", Some("follow")),
        PlatformEvent::Share(_) => ("interact", Some("share"), "interact", Some("share")),
        PlatformEvent::Enter(_) => ("interact", Some("entry"), "interact", Some("entry")),
        PlatformEvent::Like(_) => ("like", None, "unknown", None),
        PlatformEvent::GuardOrMember(_) => ("guard_buy", None, "guard_buy", None),
        PlatformEvent::PaidMessage(_) => ("super_chat", None, "super_chat", None),
        PlatformEvent::Moderation(_) => ("block", None, "block", None),
        PlatformEvent::Popularity(_) => ("popularity", None, "popularity", None),
        PlatformEvent::Battle(_) => ("battle", None, "pk", None),
        PlatformEvent::Lottery(_) => ("lottery", None, "unknown", None),
        PlatformEvent::System(_) => ("system", None, "unknown", None),
        PlatformEvent::Unknown(_) => ("unknown", None, "unknown", None),
    }
}

fn platform_event_user(event: &PlatformEvent) -> (Option<String>, Option<String>, Option<i64>) {
    match event {
        PlatformEvent::Message(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            legacy_uid_for_platform_user(&value.user),
        ),
        PlatformEvent::Gift(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            legacy_uid_for_platform_user(&value.user),
        ),
        PlatformEvent::Follow(value)
        | PlatformEvent::Share(value)
        | PlatformEvent::Enter(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            legacy_uid_for_platform_user(&value.user),
        ),
        PlatformEvent::Like(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            legacy_uid_for_platform_user(&value.user),
        ),
        PlatformEvent::GuardOrMember(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            legacy_uid_for_platform_user(&value.user),
        ),
        PlatformEvent::PaidMessage(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            legacy_uid_for_platform_user(&value.user),
        ),
        _ => (None, None, None),
    }
}

fn legacy_uid_for_platform_user(user: &crate::live_platform::types::PlatformUserRef) -> Option<i64> {
    (user.platform_id.as_str() == crate::live_platform::types::PlatformId::BILIBILI)
        .then(|| user.numeric_id())
        .flatten()
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

fn map_user_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<UserProfile> {
    Ok(UserProfile {
        uid: row.get(0)?,
        first_seen_at: row.get(1)?,
        last_seen_at: row.get(2)?,
        total_danmu_count: row.get(3)?,
        total_gift_value: row.get(4)?,
        total_sc_value: row.get(5)?,
        enter_count: row.get(6)?,
        active_hours: row.get(7)?,
        fan_level: row.get(8)?,
        is_guard: row.get(9)?,
        ai_summary: row.get(10)?,
        ai_tags: row.get(11)?,
        ai_topics: row.get(12)?,
        ai_summary_updated_at: row.get(13)?,
        ai_summary_version: row.get(14)?,
    })
}

/// 增量更新 user_profiles 统计字段（与 record_interaction 在同事务/同连接下调用）
/// 使用 SQLite JSON1 扩展更新 active_hours 直方图。
#[allow(clippy::too_many_arguments)]
fn upsert_user_profile_stats(
    conn: &Connection,
    uid: i64,
    platform_id: &str,
    platform_user_id: &str,
    event_type: &str,
    event_subtype: Option<&str>,
    gift_count: Option<i64>,
    gift_price: Option<i64>,
    sc_price: Option<i64>,
    medal_level: Option<i64>,
    is_guard_event: bool,
    occurred_at: &str,
    hour: u32,
) -> Result<()> {
    let danmu_delta: i64 = if event_type == "danmu" { 1 } else { 0 };
    let gift_value_delta: i64 = if event_type == "gift" {
        gift_count
            .unwrap_or(0)
            .saturating_mul(gift_price.unwrap_or(0))
    } else {
        0
    };
    let sc_value_delta: i64 = if event_type == "super_chat" {
        sc_price.unwrap_or(0)
    } else {
        0
    };
    let enter_delta: i64 = if event_type == "interact" && event_subtype == Some("entry") {
        1
    } else {
        0
    };
    let is_guard_flag: i64 = if is_guard_event { 1 } else { 0 };
    let fan_level_val: i64 = medal_level.unwrap_or(0);
    let hour_path = format!("$.\"{hour}\"");

    conn.execute(
        "
        insert into user_profiles (
            uid, platform_id, platform_user_id, first_seen_at, last_seen_at,
            total_danmu_count, total_gift_value, total_sc_value, enter_count,
            active_hours, fan_level, is_guard
        )
        values (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, json_set('{}', ?9, 1), ?10, ?11)
        on conflict(uid) do update set
            platform_id = excluded.platform_id,
            platform_user_id = excluded.platform_user_id,
            last_seen_at = excluded.last_seen_at,
            total_danmu_count = total_danmu_count + ?5,
            total_gift_value  = total_gift_value  + ?6,
            total_sc_value    = total_sc_value    + ?7,
            enter_count       = enter_count       + ?8,
            active_hours = json_set(
                case when json_valid(active_hours) then active_hours else '{}' end,
                ?9,
                coalesce(
                    json_extract(
                        case when json_valid(active_hours) then active_hours else '{}' end,
                        ?9
                    ),
                    0
                ) + 1
            ),
            fan_level = case when ?10 > 0 then ?10 else fan_level end,
            is_guard  = case when ?11 = 1 then 1 else is_guard end
        ",
        params![
            uid,
            platform_id,
            platform_user_id,
            occurred_at,
            danmu_delta,
            gift_value_delta,
            sc_value_delta,
            enter_delta,
            hour_path,
            fan_level_val,
            is_guard_flag,
        ],
    )?;
    Ok(())
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
    use rusqlite::params;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::Storage;

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
    fn storage_creates_platform_columns() {
        let storage = Storage::open_in_memory().unwrap();
        let conn = storage.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("pragma table_info(interaction_records)")
            .unwrap();
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert!(columns.contains(&"platform_id".to_string()));
        assert!(columns.contains(&"platform_room_id".to_string()));
        assert!(columns.contains(&"platform_user_id".to_string()));
    }

    #[test]
    fn storage_creates_platform_user_columns() {
        let storage = Storage::open_in_memory().unwrap();
        let conn = storage.conn.lock().unwrap();

        for table in ["tracked_users", "user_profiles"] {
            let mut stmt = conn
                .prepare(&format!("pragma table_info({table})"))
                .unwrap();
            let columns = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .collect::<std::result::Result<Vec<_>, _>>()
                .unwrap();
            assert!(columns.contains(&"platform_id".to_string()));
            assert!(columns.contains(&"platform_user_id".to_string()));
        }
    }

    #[test]
    fn insert_platform_interaction_record_writes_platform_keys() {
        let storage = Storage::open_in_memory().unwrap();
        let started_at = Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap();
        let session_id = storage
            .start_observed_live_session(123, started_at)
            .unwrap();
        let envelope = crate::live_platform::types::PlatformEventEnvelope {
            platform_id: crate::live_platform::types::PlatformId::from("bilibili"),
            room: crate::live_platform::types::PlatformRoomRef::bilibili(123),
            event_id: None,
            occurred_at: Local::now(),
            event: crate::live_platform::types::PlatformEvent::Message(
                crate::live_platform::types::ChatMessageEvent {
                    user: crate::live_platform::types::PlatformUserRef::bilibili(42, "alice"),
                    text: "hello".to_string(),
                },
            ),
            raw: serde_json::json!({"cmd": "DANMU_MSG"}),
        };
        storage
            .insert_platform_interaction_record(&session_id, &envelope)
            .unwrap();
        let conn = storage.conn.lock().unwrap();
        let row: (String, String, String, String, String) = conn
            .query_row(
                "select platform_id, platform_room_id, platform_user_id, event_kind, event_type from interaction_records limit 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .unwrap();
        assert_eq!(
            row,
            (
                "bilibili".to_string(),
                "123".to_string(),
                "42".to_string(),
                "message".to_string(),
                "danmu".to_string()
            )
        );
    }

    #[test]
    fn insert_platform_interaction_record_isolates_legacy_uid_to_bilibili() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                123,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();

        let bili_event = crate::live_platform::types::PlatformEventEnvelope {
            platform_id: crate::live_platform::types::PlatformId::from("bilibili"),
            room: crate::live_platform::types::PlatformRoomRef::bilibili(123),
            event_id: None,
            occurred_at: Local::now(),
            event: crate::live_platform::types::PlatformEvent::Message(
                crate::live_platform::types::ChatMessageEvent {
                    user: crate::live_platform::types::PlatformUserRef::bilibili(42, "alice"),
                    text: "bili hello".to_string(),
                },
            ),
            raw: json!({"cmd": "DANMU_MSG"}),
        };
        let douyin_event = crate::live_platform::types::PlatformEventEnvelope {
            platform_id: crate::live_platform::types::PlatformId::from("douyin"),
            room: crate::live_platform::types::PlatformRoomRef {
                platform_id: crate::live_platform::types::PlatformId::from("douyin"),
                platform_room_id: "dy-room".to_string(),
                display_id: Some("dy-room".to_string()),
            },
            event_id: None,
            occurred_at: Local::now(),
            event: crate::live_platform::types::PlatformEvent::Message(
                crate::live_platform::types::ChatMessageEvent {
                    user: crate::live_platform::types::PlatformUserRef {
                        platform_id: crate::live_platform::types::PlatformId::from("douyin"),
                        platform_user_id: "42".to_string(),
                        display_name: "mallory".to_string(),
                    },
                    text: "dy hello".to_string(),
                },
            ),
            raw: json!({"type": "chat"}),
        };

        storage
            .insert_platform_interaction_record(&session_id, &bili_event)
            .unwrap();
        storage
            .insert_platform_interaction_record(&session_id, &douyin_event)
            .unwrap();

        let conn = storage.conn.lock().unwrap();
        let rows: Vec<(String, String, Option<i64>)> = conn
            .prepare(
                "select platform_id, platform_user_id, uid
                 from interaction_records
                 where platform_user_id = '42'
                 order by id",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        drop(conn);

        assert_eq!(
            rows,
            vec![
                ("bilibili".to_string(), "42".to_string(), Some(42)),
                ("douyin".to_string(), "42".to_string(), None),
            ]
        );

        assert_eq!(storage.user_interaction_danmu_count(42).unwrap(), 1);
        let detail = storage.user_detail(42).unwrap();
        assert_eq!(detail.uname.as_deref(), Some("alice"));
        assert_eq!(detail.danmu_count, 1);
        assert_eq!(detail.recent_danmu.as_deref(), Some("bili hello"));
    }

    #[test]
    fn record_interaction_persists_user_profile_platform_keys() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = storage
            .start_observed_live_session(
                8792912,
                Local.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap(),
            )
            .unwrap();

        storage
            .record_interaction(
                &session_id,
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

        let conn = storage.conn.lock().unwrap();
        let row: (String, String) = conn
            .query_row(
                "select platform_id, platform_user_id from user_profiles where uid = 42",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, ("bilibili".to_string(), "42".to_string()));
    }

    #[test]
    fn startup_seed_only_migrates_legacy_bilibili_numeric_users() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("live-bot-storage-seed-{unique}.sqlite"));
        let path_str = path.to_string_lossy().to_string();

        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch(
                "
                create table interaction_records (
                    id integer primary key autoincrement,
                    session_id text not null,
                    platform_id text,
                    platform_room_id text,
                    platform_user_id text,
                    room_id integer not null,
                    event_type text not null,
                    uid integer,
                    uname text,
                    gift_count integer,
                    gift_price integer,
                    raw_json text not null,
                    occurred_at text not null
                );
                ",
            )
            .unwrap();

            for _ in 0..3 {
                conn.execute(
                    "insert into interaction_records (
                        session_id,
                        platform_id,
                        platform_user_id,
                        room_id,
                        event_type,
                        uid,
                        uname,
                        raw_json,
                        occurred_at
                    ) values ('legacy-session', null, null, 100, 'danmu', 7, 'legacy-bili', '{}', ?1)",
                    params![Local::now().to_rfc3339()],
                )
                .unwrap();
                conn.execute(
                    "insert into interaction_records (
                        session_id,
                        platform_id,
                        platform_user_id,
                        room_id,
                        event_type,
                        uid,
                        uname,
                        raw_json,
                        occurred_at
                    ) values ('multi-platform-session', 'douyin', '42', 200, 'danmu', 42, 'mallory', '{}', ?1)",
                    params![Local::now().to_rfc3339()],
                )
                .unwrap();
            }
        }

        let storage = Storage::open(&path_str).unwrap();
        storage
            .with_connection(|conn| {
                let seeded_users = conn
                    .prepare(
                        "select uid, platform_id, platform_user_id, nickname
                         from tracked_users
                         order by uid",
                    )?
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                assert_eq!(
                    seeded_users,
                    vec![(
                        7,
                        "bilibili".to_string(),
                        "7".to_string(),
                        "legacy-bili".to_string()
                    )]
                );
                Ok(())
            })
            .unwrap();

        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn user_profile_conflict_update_preserves_platform_keys() {
        let storage = Storage::open_in_memory().unwrap();
        let conn = storage.conn.lock().unwrap();

        super::upsert_user_profile_stats(
            &conn,
            42,
            "douyin",
            "abc-42",
            "danmu",
            None,
            None,
            None,
            None,
            Some(3),
            false,
            &Local::now().to_rfc3339(),
            9,
        )
        .unwrap();
        super::upsert_user_profile_stats(
            &conn,
            42,
            "douyin",
            "abc-42",
            "gift",
            None,
            Some(2),
            Some(100),
            None,
            None,
            true,
            &Local::now().to_rfc3339(),
            10,
        )
        .unwrap();

        let row: (String, String, i64, i64, i64) = conn
            .query_row(
                "select platform_id, platform_user_id, total_danmu_count, total_gift_value, is_guard
                 from user_profiles
                 where uid = 42",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(row, ("douyin".to_string(), "abc-42".to_string(), 1, 200, 1));
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

    #[test]
    fn cleanup_old_records_removes_expired_data() {
        let storage = Storage::open_in_memory().unwrap();
        let session_id = "test_session";
        let room_id = 8792912;

        // Insert a fresh record
        storage
            .record_interaction(
                session_id,
                room_id,
                &ParsedLiveEvent {
                    event: LiveEvent::Danmu {
                        user_id: 1,
                        user: "a".to_string(),
                        text: "now".to_string(),
                    },
                    raw: json!({"cmd":"DANMU_MSG"}),
                },
            )
            .unwrap();

        // Manual insert of an old record (SQLite specific)
        {
            let conn = storage.conn.lock().unwrap();
            let old_time = (Local::now() - chrono::Duration::days(40)).to_rfc3339();
            conn.execute(
                "insert into interaction_records (session_id, room_id, event_type, raw_json, occurred_at) values (?1, ?2, ?3, ?4, ?5)",
                params![session_id, room_id, "danmu", "{}", old_time],
            ).unwrap();
        }

        assert_eq!(storage.session_danmu_count(session_id).unwrap(), 2);

        // Cleanup records older than 30 days
        let deleted = storage.cleanup_old_records(30).unwrap();
        assert_eq!(deleted, 1);
        assert_eq!(storage.session_danmu_count(session_id).unwrap(), 1);
    }
}
