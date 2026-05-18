use anyhow::Result;
use rusqlite::Connection;

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
            source_event_id integer not null,
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::ensure_schema;

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
}
