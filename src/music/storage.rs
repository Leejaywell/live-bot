use anyhow::{Result, anyhow};
use chrono::{DateTime, Local};
use rusqlite::{Connection, OptionalExtension, params};

use crate::music::types::SearchCandidate;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct NewSongCredit {
    pub session_id: String,
    pub room_id: i64,
    pub uid: i64,
    pub uname: String,
    pub credit_value: i64,
    pub tier: String,
    pub source_type: String,
    pub source_event_id: Option<i64>,
    pub expires_at: String,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct StoredSearchContext {
    pub id: i64,
    pub query: String,
    pub candidates: Vec<SearchCandidate>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct NewSongRequest {
    pub session_id: String,
    pub room_id: i64,
    pub uid: i64,
    pub uname: String,
    pub source: String,
    pub song_id: String,
    pub song_name: String,
    pub artist_names: String,
    pub album_name: Option<String>,
    pub pic_url: Option<String>,
    pub lyric_id: String,
    pub url_id: String,
    pub duration_ms: Option<i64>,
    pub requested_text: String,
    pub tier: String,
    pub credit_value: i64,
    pub priority_score: i64,
    pub source_event_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct QueueItem {
    pub request_id: i64,
    pub uid: i64,
    pub uname: String,
    pub song_name: String,
    pub artist_names: String,
    pub tier: String,
    pub credit_value: i64,
    pub priority_score: i64,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
pub struct OpenableSongRequest {
    pub request_id: i64,
    pub source: String,
    pub song_id: String,
    pub url_id: String,
}

pub fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        create table if not exists song_requests (
            id integer primary key autoincrement,
            session_id text not null,
            room_id integer not null,
            uid integer not null,
            uname text not null,
            source text not null,
            song_id text not null,
            song_name text not null,
            artist_names text not null,
            album_name text,
            pic_url text,
            lyric_id text,
            url_id text,
            duration_ms integer,
            requested_text text not null,
            tier text not null,
            credit_value integer not null,
            priority_score integer not null,
            status text not null,
            position_snapshot integer,
            source_event_id integer,
            created_at text not null,
            updated_at text not null,
            played_at text,
            finished_at text
        );
        create index if not exists idx_song_requests_session_status on song_requests(session_id, status);
        create index if not exists idx_song_requests_uid_status on song_requests(uid, status);

        create table if not exists song_request_credits (
            id integer primary key autoincrement,
            session_id text not null,
            room_id integer not null,
            uid integer not null,
            uname text not null,
            credit_value integer not null,
            tier text not null,
            source_type text not null,
            source_event_id integer,
            expires_at text not null,
            used_request_id integer,
            created_at text not null,
            used_at text
        );
        create index if not exists idx_song_request_credits_uid on song_request_credits(uid, expires_at, used_at);

        create table if not exists song_search_contexts (
            id integer primary key autoincrement,
            session_id text not null,
            uid integer not null,
            query text not null,
            candidates_json text not null,
            expires_at text not null,
            created_at text not null
        );
        create index if not exists idx_song_search_contexts_uid on song_search_contexts(uid, expires_at);

        create table if not exists song_request_stats_daily (
            stat_date text not null,
            room_id integer not null,
            request_count integer not null default 0,
            played_count integer not null default 0,
            skipped_count integer not null default 0,
            failed_count integer not null default 0,
            consumed_value integer not null default 0,
            pending_value integer not null default 0,
            refunded_value integer not null default 0,
            top_uid integer,
            top_uname text,
            updated_at text not null,
            primary key (stat_date, room_id)
        );

        create table if not exists song_blocklist (
            id integer primary key autoincrement,
            kind text not null,
            value text not null,
            reason text,
            created_at text not null
        );
        ",
    )?;
    migrate_song_request_credits_source_event_id_nullable(conn)?;
    Ok(())
}

fn migrate_song_request_credits_source_event_id_nullable(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("pragma table_info(song_request_credits)")?;
    let columns = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, i64>(3)?))
    })?;

    let mut source_event_id_is_not_null = false;
    for column in columns {
        let (name, not_null) = column?;
        if name == "source_event_id" {
            source_event_id_is_not_null = not_null == 1;
            break;
        }
    }
    if !source_event_id_is_not_null {
        return Ok(());
    }

    conn.execute_batch(
        "
        begin;
        alter table song_request_credits rename to song_request_credits_old;
        create table song_request_credits (
            id integer primary key autoincrement,
            session_id text not null,
            room_id integer not null,
            uid integer not null,
            uname text not null,
            credit_value integer not null,
            tier text not null,
            source_type text not null,
            source_event_id integer,
            expires_at text not null,
            used_request_id integer,
            created_at text not null,
            used_at text
        );
        insert into song_request_credits
            (id, session_id, room_id, uid, uname, credit_value, tier, source_type, source_event_id,
             expires_at, used_request_id, created_at, used_at)
        select id, session_id, room_id, uid, uname, credit_value, tier, source_type, source_event_id,
               expires_at, used_request_id, created_at, used_at
        from song_request_credits_old;
        drop table song_request_credits_old;
        create index if not exists idx_song_request_credits_uid on song_request_credits(uid, expires_at, used_at);
        commit;
        ",
    )?;
    Ok(())
}

#[allow(dead_code)]
fn now_text() -> String {
    Local::now().to_rfc3339()
}

#[allow(dead_code)]
fn is_future_expires_at(expires_at: &str, now: DateTime<Local>) -> Result<bool> {
    let expires_at = DateTime::parse_from_rfc3339(expires_at)?;
    Ok(expires_at.timestamp_millis() > now.timestamp_millis())
}

#[allow(dead_code)]
fn is_readable_future_expires_at(expires_at: &str, now: DateTime<Local>) -> bool {
    is_future_expires_at(expires_at, now).unwrap_or(false)
}

#[allow(dead_code)]
pub fn insert_credit(conn: &Connection, credit: &NewSongCredit) -> Result<i64> {
    let now = now_text();
    conn.execute(
        "insert into song_request_credits
        (session_id, room_id, uid, uname, credit_value, tier, source_type, source_event_id, expires_at, created_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            &credit.session_id,
            credit.room_id,
            credit.uid,
            &credit.uname,
            credit.credit_value,
            &credit.tier,
            &credit.source_type,
            credit.source_event_id,
            &credit.expires_at,
            now,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

#[allow(dead_code)]
pub fn pending_credit_value(conn: &Connection, session_id: &str, uid: i64) -> Result<i64> {
    let now = Local::now();
    let mut stmt = conn.prepare(
        "select credit_value, expires_at
         from song_request_credits
         where session_id = ?1 and uid = ?2 and used_at is null",
    )?;
    let rows = stmt.query_map(params![session_id, uid], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut total = 0;
    for row in rows {
        let (credit_value, expires_at) = row?;
        if is_readable_future_expires_at(&expires_at, now) {
            total += credit_value;
        }
    }
    Ok(total)
}

#[allow(dead_code)]
pub fn session_pending_value(conn: &Connection, session_id: &str, room_id: i64) -> Result<i64> {
    let now = Local::now();
    let mut stmt = conn.prepare(
        "select credit_value, expires_at
         from song_request_credits
         where session_id = ?1 and room_id = ?2 and used_at is null",
    )?;
    let rows = stmt.query_map(params![session_id, room_id], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut total = 0;
    for row in rows {
        let (credit_value, expires_at) = row?;
        if is_readable_future_expires_at(&expires_at, now) {
            total += credit_value;
        }
    }
    Ok(total)
}

#[allow(dead_code)]
pub fn save_search_context(
    conn: &Connection,
    session_id: &str,
    uid: i64,
    query: &str,
    candidates: &[SearchCandidate],
    expires_at: &str,
) -> Result<i64> {
    let json = serde_json::to_string(candidates)?;
    conn.execute(
        "insert into song_search_contexts (session_id, uid, query, candidates_json, expires_at, created_at)
         values (?1, ?2, ?3, ?4, ?5, ?6)",
        params![session_id, uid, query, json, expires_at, now_text()],
    )?;
    Ok(conn.last_insert_rowid())
}

#[allow(dead_code)]
pub fn latest_search_context(
    conn: &Connection,
    session_id: &str,
    uid: i64,
) -> Result<Option<StoredSearchContext>> {
    let now = Local::now();
    let mut stmt = conn.prepare(
        "select id, query, candidates_json, expires_at
             from song_search_contexts
             where session_id = ?1 and uid = ?2
             order by id desc",
    )?;
    let rows = stmt.query_map(params![session_id, uid], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    for row in rows {
        let (id, query, json, expires_at) = row?;
        if is_readable_future_expires_at(&expires_at, now) {
            let candidates = serde_json::from_str(&json)?;
            return Ok(Some(StoredSearchContext {
                id,
                query,
                candidates,
            }));
        }
    }
    Ok(None)
}

#[allow(dead_code)]
pub fn insert_song_request(conn: &Connection, request: &NewSongRequest) -> Result<i64> {
    let now = now_text();
    conn.execute(
        "insert into song_requests
        (session_id, room_id, uid, uname, source, song_id, song_name, artist_names, album_name, pic_url,
         lyric_id, url_id, duration_ms, requested_text, tier, credit_value, priority_score, status,
         source_event_id, created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'queued', ?18, ?19, ?19)",
        params![
            &request.session_id,
            request.room_id,
            request.uid,
            &request.uname,
            &request.source,
            &request.song_id,
            &request.song_name,
            &request.artist_names,
            request.album_name.as_deref(),
            request.pic_url.as_deref(),
            &request.lyric_id,
            &request.url_id,
            request.duration_ms,
            &request.requested_text,
            &request.tier,
            request.credit_value,
            request.priority_score,
            request.source_event_id,
            now,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

#[allow(dead_code)]
pub fn oldest_pending_credit(
    conn: &Connection,
    session_id: &str,
    uid: i64,
) -> Result<Option<(i64, i64, String)>> {
    let now = Local::now();
    let mut stmt = conn.prepare(
        "select id, credit_value, tier, expires_at
             from song_request_credits
             where session_id = ?1 and uid = ?2 and used_at is null
             order by credit_value desc, id asc
            ",
    )?;
    let rows = stmt.query_map(params![session_id, uid], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    for row in rows {
        let (id, credit_value, tier, expires_at) = row?;
        if is_readable_future_expires_at(&expires_at, now) {
            return Ok(Some((id, credit_value, tier)));
        }
    }
    Ok(None)
}

#[allow(dead_code)]
pub fn mark_credit_used(conn: &Connection, credit_id: i64, request_id: i64) -> Result<()> {
    let (expires_at, credit_session_id, credit_room_id, credit_uid, credit_value, credit_tier) =
        conn.query_row(
            "select expires_at, session_id, room_id, uid, credit_value, tier
             from song_request_credits
             where id = ?1 and used_at is null",
            params![credit_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| anyhow!("song request credit is missing or already used: {credit_id}"))?;
    if !is_future_expires_at(&expires_at, Local::now())? {
        return Err(anyhow!("song request credit is expired: {credit_id}"));
    }

    let request_matches = conn
        .query_row(
            "select 1
             from song_requests
             where id = ?1
               and session_id = ?2
               and room_id = ?3
               and uid = ?4
               and credit_value = ?5
               and tier = ?6",
            params![
                request_id,
                credit_session_id,
                credit_room_id,
                credit_uid,
                credit_value,
                credit_tier,
            ],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some();
    if !request_matches {
        return Err(anyhow!(
            "song request credit does not match request: credit_id={credit_id}, request_id={request_id}"
        ));
    }

    let rows_affected = conn.execute(
        "update song_request_credits
         set used_request_id = ?1, used_at = ?2
         where id = ?3 and used_at is null",
        params![request_id, now_text(), credit_id],
    )?;
    if rows_affected != 1 {
        return Err(anyhow!("song request credit was not consumed: {credit_id}"));
    }
    Ok(())
}

#[allow(dead_code)]
pub fn insert_song_request_and_consume_credit(
    conn: &mut Connection,
    credit_id: i64,
    request: &NewSongRequest,
) -> Result<i64> {
    let tx = conn.transaction()?;
    let request_id = insert_song_request(&tx, request)?;
    mark_credit_used(&tx, credit_id, request_id)?;
    tx.commit()?;
    Ok(request_id)
}

#[allow(dead_code)]
pub fn list_queue(conn: &Connection, session_id: &str, room_id: i64) -> Result<Vec<QueueItem>> {
    let mut stmt = conn.prepare(
        "select id, uid, uname, song_name, artist_names, tier, credit_value, priority_score, status, created_at
         from song_requests
         where session_id = ?1 and room_id = ?2 and status in ('queued', 'playing')
         order by case status when 'playing' then 0 else 1 end, priority_score desc, id asc",
    )?;
    let rows = stmt.query_map(params![session_id, room_id], |row| {
        Ok(QueueItem {
            request_id: row.get(0)?,
            uid: row.get(1)?,
            uname: row.get(2)?,
            song_name: row.get(3)?,
            artist_names: row.get(4)?,
            tier: row.get(5)?,
            credit_value: row.get(6)?,
            priority_score: row.get(7)?,
            status: row.get(8)?,
            created_at: row.get(9)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[allow(dead_code)]
pub fn openable_song_request(
    conn: &Connection,
    request_id: i64,
    session_id: &str,
    room_id: i64,
) -> Result<Option<OpenableSongRequest>> {
    conn.query_row(
        "select id, source, song_id, url_id
         from song_requests
         where id = ?1
           and session_id = ?2
           and room_id = ?3
           and status in ('queued', 'playing')",
        params![request_id, session_id, room_id],
        |row| {
            Ok(OpenableSongRequest {
                request_id: row.get(0)?,
                source: row.get(1)?,
                song_id: row.get(2)?,
                url_id: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

#[allow(dead_code)]
pub fn mark_song_request_playing(
    conn: &mut Connection,
    request_id: i64,
    session_id: &str,
    room_id: i64,
) -> Result<()> {
    let tx = conn.transaction()?;
    let exists = tx
        .query_row(
            "select 1
             from song_requests
             where id = ?1
               and session_id = ?2
               and room_id = ?3
               and status in ('queued', 'playing')",
            params![request_id, session_id, room_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some();
    if !exists {
        return Err(anyhow!(
            "song request is not openable in active session: {request_id}"
        ));
    }

    let now = now_text();
    tx.execute(
        "update song_requests
         set status = 'queued', updated_at = ?1, played_at = null
         where session_id = ?2 and room_id = ?3 and status = 'playing'",
        params![now, session_id, room_id],
    )?;
    let rows_affected = tx.execute(
        "update song_requests
         set status = 'playing', updated_at = ?1, played_at = ?1
         where id = ?2
           and session_id = ?3
           and room_id = ?4
           and status = 'queued'",
        params![now, request_id, session_id, room_id],
    )?;
    if rows_affected != 1 {
        return Err(anyhow!("song request was not marked playing: {request_id}"));
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, FixedOffset, Local};
    use rusqlite::Connection;

    use crate::music::types::{MusicSource, MusicTrack, SearchCandidate};

    use super::ensure_schema;
    use super::latest_search_context;
    use super::{
        NewSongCredit, NewSongRequest, insert_credit, insert_song_request,
        insert_song_request_and_consume_credit, list_queue, mark_credit_used,
        mark_song_request_playing, oldest_pending_credit, openable_song_request,
        pending_credit_value, save_search_context, session_pending_value,
    };

    fn song_request() -> NewSongRequest {
        NewSongRequest {
            session_id: "session-1".to_string(),
            room_id: 100,
            uid: 42,
            uname: "alice".to_string(),
            source: "netease".to_string(),
            song_id: "186016".to_string(),
            song_name: "晴天".to_string(),
            artist_names: "周杰伦".to_string(),
            album_name: Some("叶惠美".to_string()),
            pic_url: None,
            lyric_id: "186016".to_string(),
            url_id: "186016".to_string(),
            duration_ms: Some(269000),
            requested_text: "点歌 晴天".to_string(),
            tier: "priority".to_string(),
            credit_value: 66,
            priority_score: 3066,
            source_event_id: None,
        }
    }

    fn search_candidate() -> SearchCandidate {
        SearchCandidate {
            track: MusicTrack {
                source: MusicSource::Netease,
                song_id: "186016".to_string(),
                name: "晴天".to_string(),
                artists: vec!["周杰伦".to_string()],
                album: "叶惠美".to_string(),
                pic_id: String::new(),
                url_id: "186016".to_string(),
                lyric_id: "186016".to_string(),
                duration_ms: Some(269000),
            },
            score: 100,
            reason: "歌名匹配".to_string(),
        }
    }

    #[test]
    fn creates_music_tables() {
        let conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema applies");
        let count: i64 = conn
            .query_row(
                "select count(*) from sqlite_master where type = 'table' and name in ('song_requests', 'song_request_credits', 'song_search_contexts', 'song_request_stats_daily', 'song_blocklist')",
                [],
                |row| row.get(0),
            )
            .expect("count reads");
        assert_eq!(count, 5);
    }

    #[test]
    fn migrates_old_credit_source_event_id_not_null_schema() {
        let conn = Connection::open_in_memory().expect("db opens");
        conn.execute_batch(
            "
            create table song_request_credits (
                id integer primary key autoincrement,
                session_id text not null,
                room_id integer not null,
                uid integer not null,
                uname text not null,
                credit_value integer not null,
                tier text not null,
                source_type text not null,
                source_event_id integer not null,
                expires_at text not null,
                used_request_id integer,
                created_at text not null,
                used_at text
            );
            create index idx_song_request_credits_uid on song_request_credits(uid, expires_at, used_at);
            insert into song_request_credits
                (session_id, room_id, uid, uname, credit_value, tier, source_type, source_event_id,
                 expires_at, created_at)
            values
                ('session-1', 100, 42, 'alice', 233, 'jump_queue', 'gift', 9001,
                 '2099-01-01T00:00:00+08:00', '2026-01-01T00:00:00+08:00');
            ",
        )
        .expect("old schema");

        ensure_schema(&conn).expect("schema migrates");
        ensure_schema(&conn).expect("schema remains idempotent");

        let source_event_id_not_null: i64 = conn
            .query_row(
                "select [notnull] from pragma_table_info('song_request_credits') where name = 'source_event_id'",
                [],
                |row| row.get(0),
            )
            .expect("column reads");
        assert_eq!(source_event_id_not_null, 0);

        let preserved_source_event_id: i64 = conn
            .query_row(
                "select source_event_id from song_request_credits where uid = 42",
                [],
                |row| row.get(0),
            )
            .expect("old row preserved");
        assert_eq!(preserved_source_event_id, 9001);

        insert_credit(
            &conn,
            &NewSongCredit {
                session_id: "session-1".to_string(),
                room_id: 100,
                uid: 43,
                uname: "bob".to_string(),
                credit_value: 66,
                tier: "priority".to_string(),
                source_type: "sc".to_string(),
                source_event_id: None,
                expires_at: "2099-01-01T00:00:00+08:00".to_string(),
            },
        )
        .expect("insert nullable source event id");

        let inserted_source_event_id: Option<i64> = conn
            .query_row(
                "select source_event_id from song_request_credits where uid = 43",
                [],
                |row| row.get(0),
            )
            .expect("inserted row reads");
        assert_eq!(inserted_source_event_id, None);

        let index_count: i64 = conn
            .query_row(
                "select count(*) from sqlite_master where type = 'index' and name = 'idx_song_request_credits_uid'",
                [],
                |row| row.get(0),
            )
            .expect("index reads");
        assert_eq!(index_count, 1);
    }

    #[test]
    fn credit_insert_and_pending_totals_work() {
        let conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");
        let credit = NewSongCredit {
            session_id: "session-1".to_string(),
            room_id: 100,
            uid: 42,
            uname: "alice".to_string(),
            credit_value: 233,
            tier: "jump_queue".to_string(),
            source_type: "gift".to_string(),
            source_event_id: Some(9001),
            expires_at: "2099-01-01T00:00:00+08:00".to_string(),
        };

        insert_credit(&conn, &credit).expect("insert credit");

        assert_eq!(
            pending_credit_value(&conn, "session-1", 42).expect("pending"),
            233
        );
        assert_eq!(
            session_pending_value(&conn, "session-1", 100).expect("session pending"),
            233
        );
    }

    #[test]
    fn mixed_timezone_future_credit_counts_as_pending() {
        let conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");
        let west_ten = FixedOffset::west_opt(10 * 60 * 60).expect("offset");
        let expires_at = (Local::now() + Duration::minutes(30))
            .with_timezone(&west_ten)
            .to_rfc3339();

        insert_credit(
            &conn,
            &NewSongCredit {
                session_id: "session-1".to_string(),
                room_id: 100,
                uid: 42,
                uname: "alice".to_string(),
                credit_value: 233,
                tier: "jump_queue".to_string(),
                source_type: "gift".to_string(),
                source_event_id: Some(9001),
                expires_at,
            },
        )
        .expect("insert credit");

        assert_eq!(
            pending_credit_value(&conn, "session-1", 42).expect("pending"),
            233
        );
    }

    #[test]
    fn expired_credits_are_ignored() {
        let conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");

        insert_credit(
            &conn,
            &NewSongCredit {
                session_id: "session-1".to_string(),
                room_id: 100,
                uid: 42,
                uname: "alice".to_string(),
                credit_value: 233,
                tier: "jump_queue".to_string(),
                source_type: "gift".to_string(),
                source_event_id: Some(9001),
                expires_at: "2000-01-01T00:00:00+08:00".to_string(),
            },
        )
        .expect("insert credit");

        assert_eq!(
            pending_credit_value(&conn, "session-1", 42).expect("pending"),
            0
        );
        assert_eq!(
            session_pending_value(&conn, "session-1", 100).expect("session pending"),
            0
        );
    }

    #[test]
    fn search_context_round_trips_candidates() {
        let conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");
        let candidates = vec![search_candidate()];

        save_search_context(
            &conn,
            "session-1",
            42,
            "晴天",
            &candidates,
            "2099-01-01T00:00:00+08:00",
        )
        .expect("save context");
        let loaded = latest_search_context(&conn, "session-1", 42)
            .expect("query")
            .expect("context");

        assert_eq!(loaded.query, "晴天");
        assert_eq!(loaded.candidates[0].track.song_id, "186016");
    }

    #[test]
    fn enqueue_request_consumes_credit_and_lists_queue() {
        let conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");
        let credit_id = insert_credit(
            &conn,
            &NewSongCredit {
                session_id: "session-1".to_string(),
                room_id: 100,
                uid: 42,
                uname: "alice".to_string(),
                credit_value: 66,
                tier: "priority".to_string(),
                source_type: "gift".to_string(),
                source_event_id: Some(9001),
                expires_at: "2099-01-01T00:00:00+08:00".to_string(),
            },
        )
        .expect("credit");

        let request_id = insert_song_request(&conn, &song_request()).expect("request");
        mark_credit_used(&conn, credit_id, request_id).expect("consume");

        let queue = list_queue(&conn, "session-1", 100).expect("queue");
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].request_id, request_id);
        assert_eq!(
            pending_credit_value(&conn, "session-1", 42).expect("pending"),
            0
        );
    }

    #[test]
    fn openable_song_request_only_returns_queued_or_playing_rows() {
        let conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");

        let queued_id = insert_song_request(&conn, &song_request()).expect("queued request");
        let playing_id = insert_song_request(&conn, &song_request()).expect("playing request");
        let finished_id = insert_song_request(&conn, &song_request()).expect("finished request");
        conn.execute(
            "update song_requests set status = 'playing' where id = ?1",
            [playing_id],
        )
        .expect("mark playing");
        conn.execute(
            "update song_requests set status = 'finished' where id = ?1",
            [finished_id],
        )
        .expect("mark finished");

        let queued = openable_song_request(&conn, queued_id, "session-1", 100)
            .expect("queued lookup")
            .expect("queued openable");
        assert_eq!(queued.request_id, queued_id);
        assert_eq!(queued.source, "netease");
        assert_eq!(queued.song_id, "186016");
        assert_eq!(queued.url_id, "186016");

        let playing = openable_song_request(&conn, playing_id, "session-1", 100)
            .expect("playing lookup")
            .expect("playing openable");
        assert_eq!(playing.request_id, playing_id);

        assert_eq!(
            openable_song_request(&conn, finished_id, "session-1", 100).expect("finished lookup"),
            None
        );
        assert_eq!(
            openable_song_request(&conn, 999, "session-1", 100).expect("missing lookup"),
            None
        );
    }

    #[test]
    fn openable_song_request_is_scoped_to_session_and_room() {
        let conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");

        let mut other_session_request = song_request();
        other_session_request.session_id = "session-2".to_string();
        let other_session_id =
            insert_song_request(&conn, &other_session_request).expect("other session request");

        let mut other_room_request = song_request();
        other_room_request.room_id = 200;
        let other_room_id =
            insert_song_request(&conn, &other_room_request).expect("other room request");

        assert_eq!(
            openable_song_request(&conn, other_session_id, "session-1", 100)
                .expect("other session lookup"),
            None
        );
        assert_eq!(
            openable_song_request(&conn, other_room_id, "session-1", 100)
                .expect("other room lookup"),
            None
        );

        let active_id = insert_song_request(&conn, &song_request()).expect("active request");
        assert_eq!(
            openable_song_request(&conn, active_id, "session-1", 100)
                .expect("active lookup")
                .expect("active openable")
                .request_id,
            active_id
        );
    }

    #[test]
    fn mark_song_request_playing_demotes_existing_playing_in_same_session_room() {
        let mut conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");

        let existing_id = insert_song_request(&conn, &song_request()).expect("existing request");
        let target_id = insert_song_request(&conn, &song_request()).expect("target request");
        conn.execute(
            "update song_requests set status = 'playing' where id = ?1",
            [existing_id],
        )
        .expect("mark existing playing");

        mark_song_request_playing(&mut conn, target_id, "session-1", 100).expect("mark playing");

        let queue = list_queue(&conn, "session-1", 100).expect("queue");
        assert_eq!(queue[0].request_id, target_id);
        assert_eq!(queue[0].status, "playing");
        assert!(
            queue
                .iter()
                .any(|item| item.request_id == existing_id && item.status == "queued")
        );
    }

    #[test]
    fn mark_song_request_playing_rejects_wrong_session_room_and_finished_rows() {
        let mut conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");

        let active_id = insert_song_request(&conn, &song_request()).expect("active request");
        let mut other_session_request = song_request();
        other_session_request.session_id = "session-2".to_string();
        let other_session_id =
            insert_song_request(&conn, &other_session_request).expect("other session request");
        let mut other_room_request = song_request();
        other_room_request.room_id = 200;
        let other_room_id =
            insert_song_request(&conn, &other_room_request).expect("other room request");
        conn.execute(
            "update song_requests set status = 'finished' where id = ?1",
            [active_id],
        )
        .expect("mark finished");

        assert!(mark_song_request_playing(&mut conn, active_id, "session-1", 100).is_err());
        assert!(mark_song_request_playing(&mut conn, other_session_id, "session-1", 100).is_err());
        assert!(mark_song_request_playing(&mut conn, other_room_id, "session-1", 100).is_err());
    }

    #[test]
    fn mark_credit_used_errors_for_invalid_credit_states() {
        let conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");

        assert!(mark_credit_used(&conn, 999, 1).is_err());

        let used_credit_id = insert_credit(
            &conn,
            &NewSongCredit {
                session_id: "session-1".to_string(),
                room_id: 100,
                uid: 42,
                uname: "alice".to_string(),
                credit_value: 66,
                tier: "priority".to_string(),
                source_type: "gift".to_string(),
                source_event_id: Some(9001),
                expires_at: "2099-01-01T00:00:00+08:00".to_string(),
            },
        )
        .expect("used credit");
        let used_request_id = insert_song_request(&conn, &song_request()).expect("used request");
        mark_credit_used(&conn, used_credit_id, used_request_id).expect("first consume");
        assert!(mark_credit_used(&conn, used_credit_id, 2).is_err());

        let expired_credit_id = insert_credit(
            &conn,
            &NewSongCredit {
                session_id: "session-1".to_string(),
                room_id: 100,
                uid: 42,
                uname: "alice".to_string(),
                credit_value: 66,
                tier: "priority".to_string(),
                source_type: "gift".to_string(),
                source_event_id: Some(9002),
                expires_at: "2000-01-01T00:00:00+08:00".to_string(),
            },
        )
        .expect("expired credit");
        assert!(mark_credit_used(&conn, expired_credit_id, 3).is_err());
    }

    #[test]
    fn mark_credit_used_rejects_nonexistent_request_id() {
        let conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");
        let credit_id = insert_credit(
            &conn,
            &NewSongCredit {
                session_id: "session-1".to_string(),
                room_id: 100,
                uid: 42,
                uname: "alice".to_string(),
                credit_value: 66,
                tier: "priority".to_string(),
                source_type: "gift".to_string(),
                source_event_id: Some(9001),
                expires_at: "2099-01-01T00:00:00+08:00".to_string(),
            },
        )
        .expect("credit");

        assert!(mark_credit_used(&conn, credit_id, 999).is_err());
        assert_eq!(
            pending_credit_value(&conn, "session-1", 42).expect("pending"),
            66
        );
    }

    #[test]
    fn atomic_helper_queues_request_and_consumes_credit() {
        let mut conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");
        let credit_id = insert_credit(
            &conn,
            &NewSongCredit {
                session_id: "session-1".to_string(),
                room_id: 100,
                uid: 42,
                uname: "alice".to_string(),
                credit_value: 66,
                tier: "priority".to_string(),
                source_type: "gift".to_string(),
                source_event_id: Some(9001),
                expires_at: "2099-01-01T00:00:00+08:00".to_string(),
            },
        )
        .expect("credit");

        let request_id =
            insert_song_request_and_consume_credit(&mut conn, credit_id, &song_request())
                .expect("request and consume");

        let queue = list_queue(&conn, "session-1", 100).expect("queue");
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].request_id, request_id);
        assert_eq!(
            pending_credit_value(&conn, "session-1", 42).expect("pending"),
            0
        );
    }

    #[test]
    fn atomic_helper_rejects_mismatched_credit_and_rolls_back() {
        let cases = [
            ("session mismatch", "session-2", 100, 42, 66, "priority"),
            ("user mismatch", "session-1", 100, 43, 66, "priority"),
            ("value mismatch", "session-1", 100, 42, 233, "priority"),
        ];

        for (name, session_id, room_id, uid, credit_value, tier) in cases {
            let mut conn = Connection::open_in_memory().expect("db opens");
            ensure_schema(&conn).expect("schema");
            let credit_id = insert_credit(
                &conn,
                &NewSongCredit {
                    session_id: session_id.to_string(),
                    room_id,
                    uid,
                    uname: "alice".to_string(),
                    credit_value,
                    tier: tier.to_string(),
                    source_type: "gift".to_string(),
                    source_event_id: Some(9001),
                    expires_at: "2099-01-01T00:00:00+08:00".to_string(),
                },
            )
            .expect("credit");

            assert!(
                insert_song_request_and_consume_credit(&mut conn, credit_id, &song_request())
                    .is_err(),
                "{name}"
            );
            assert!(
                list_queue(&conn, "session-1", 100)
                    .expect("queue")
                    .is_empty(),
                "{name}"
            );
            assert_eq!(
                pending_credit_value(&conn, session_id, uid).expect("pending"),
                credit_value,
                "{name}"
            );
        }
    }

    #[test]
    fn malformed_expires_at_rows_are_ignored_by_reads() {
        let conn = Connection::open_in_memory().expect("db opens");
        ensure_schema(&conn).expect("schema");
        insert_credit(
            &conn,
            &NewSongCredit {
                session_id: "session-1".to_string(),
                room_id: 100,
                uid: 42,
                uname: "alice".to_string(),
                credit_value: 233,
                tier: "jump_queue".to_string(),
                source_type: "gift".to_string(),
                source_event_id: Some(9001),
                expires_at: "not-a-date".to_string(),
            },
        )
        .expect("malformed credit");

        assert_eq!(
            pending_credit_value(&conn, "session-1", 42).expect("pending"),
            0
        );
        assert_eq!(
            session_pending_value(&conn, "session-1", 100).expect("session pending"),
            0
        );
        assert_eq!(
            oldest_pending_credit(&conn, "session-1", 42).expect("oldest"),
            None
        );

        let candidates = vec![search_candidate()];
        let valid_id = save_search_context(
            &conn,
            "session-1",
            42,
            "valid",
            &candidates,
            "2099-01-01T00:00:00+08:00",
        )
        .expect("valid context");
        save_search_context(
            &conn,
            "session-1",
            42,
            "malformed",
            &candidates,
            "not-a-date",
        )
        .expect("malformed context");

        let loaded = latest_search_context(&conn, "session-1", 42)
            .expect("query")
            .expect("context");
        assert_eq!(loaded.id, valid_id);
        assert_eq!(loaded.query, "valid");
    }
}
