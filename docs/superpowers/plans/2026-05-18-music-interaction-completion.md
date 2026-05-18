# Music Interaction Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the paid song-request loop: gifts create credits, users confirm candidates into a persistent queue, OBS reads the queue, and the主播 can safely open/play queued songs.

**Architecture:** Keep the existing `src/music/` boundary. Add storage-facing methods in `src/music/storage.rs`, then wire them into `MusicInteractionService` and the existing monitor loop. UI and OBS routes should read backend state rather than keeping local-only preview state.

**Tech Stack:** Rust 2024, rusqlite, tokio, reqwest, Tauri 2 commands, existing Axum overlay server, React + TypeScript.

---

## Current State

Already done:
- Music provider abstraction and NetEase adapter.
- Song command parser and search scoring.
- Basic credit tiers and queue score helper.
- SQL schema for music tables.
- Music plugin settings, OBS URL, plugin-center page.
- Monitor hook for Danmu/Gift/SuperChat.
- URL scheme safety helper.

Still missing:
- Gift/SC credits are not written to `song_request_credits`.
- Search candidates are not saved as user confirmation context.
- `点歌 #1 / 确认 #1` does not create `song_requests`.
- UI confirmation is frontend-only.
- OBS page is static and does not show real queue/now-playing/rank.
- Safe opener helper is not connected to a request-id-based open command.
- `MusicInteraction.enabled` is read once at monitor websocket startup.

---

## File Map

- Modify: `src/music/storage.rs` — repository methods for credits, search contexts, queue rows, status transitions, and stats reads.
- Modify: `src/storage/mod.rs` — expose a small locked-connection helper used by music services.
- Modify: `src/music/service.rs` — gift credit intake, candidate context persistence, confirm/enqueue/cancel/status orchestration.
- Modify: `src/bot/monitor.rs` — pass storage/session/room into music service and refresh enabled setting cheaply.
- Modify: `src/main.rs` — Tauri commands for confirming candidates, reading queue state, opening queued songs.
- Modify: `src/overlay_server.rs` — JSON endpoints for playlist/now-playing/rank.
- Modify: `src/music_interaction.html` — fetch overlay JSON and render real skins.
- Modify: `src-tauri/src/app/lib/api.ts` — typed wrappers for queue/confirm/open commands.
- Modify: `src-tauri/src/app/pages/MusicInteraction.tsx` — use backend confirm/queue state instead of local-only confirmation.

---

## Task 1: Music Storage Repository Methods

**Files:**
- Modify: `src/music/storage.rs`
- Modify: `src/storage/mod.rs`

- [ ] **Step 1: Add failing storage tests**

Append these tests to `src/music/storage.rs`:

```rust
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
        source_event_id: 9001,
        expires_at: "2099-01-01T00:00:00+08:00".to_string(),
    };

    insert_credit(&conn, &credit).expect("insert credit");

    assert_eq!(pending_credit_value(&conn, "session-1", 42).expect("pending"), 233);
    assert_eq!(session_pending_value(&conn, "session-1", 100).expect("session pending"), 233);
}

#[test]
fn search_context_round_trips_candidates() {
    let conn = Connection::open_in_memory().expect("db opens");
    ensure_schema(&conn).expect("schema");
    let candidates = vec![SearchCandidate {
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
    }];

    save_search_context(&conn, "session-1", 42, "晴天", &candidates, "2099-01-01T00:00:00+08:00")
        .expect("save context");
    let loaded = latest_search_context(&conn, "session-1", 42).expect("query").expect("context");

    assert_eq!(loaded.query, "晴天");
    assert_eq!(loaded.candidates[0].track.song_id, "186016");
}

#[test]
fn enqueue_request_consumes_credit_and_lists_queue() {
    let conn = Connection::open_in_memory().expect("db opens");
    ensure_schema(&conn).expect("schema");
    let credit_id = insert_credit(&conn, &NewSongCredit {
        session_id: "session-1".to_string(),
        room_id: 100,
        uid: 42,
        uname: "alice".to_string(),
        credit_value: 66,
        tier: "priority".to_string(),
        source_type: "gift".to_string(),
        source_event_id: 9001,
        expires_at: "2099-01-01T00:00:00+08:00".to_string(),
    }).expect("credit");

    let request_id = insert_song_request(&conn, &NewSongRequest {
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
    }).expect("request");
    mark_credit_used(&conn, credit_id, request_id).expect("consume");

    let queue = list_queue(&conn, "session-1", 100).expect("queue");
    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0].request_id, request_id);
    assert_eq!(pending_credit_value(&conn, "session-1", 42).expect("pending"), 0);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test -q music::storage
```

Expected: compile failure for missing `NewSongCredit`, `insert_credit`, `pending_credit_value`, `save_search_context`, `latest_search_context`, `NewSongRequest`, `insert_song_request`, `mark_credit_used`, and `list_queue`.

- [ ] **Step 3: Implement storage structs and methods**

Add this helper inside `impl Storage` in `src/storage/mod.rs`:

```rust
pub fn with_connection<T, F>(&self, f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T>,
{
    let conn = self.conn.lock().expect("storage mutex poisoned");
    f(&conn)
}
```

Add these imports and public structs near the top of `src/music/storage.rs`:

```rust
use chrono::Local;
use rusqlite::{Connection, OptionalExtension, params};

use crate::music::types::SearchCandidate;

#[derive(Debug, Clone)]
pub struct NewSongCredit {
    pub session_id: String,
    pub room_id: i64,
    pub uid: i64,
    pub uname: String,
    pub credit_value: i64,
    pub tier: String,
    pub source_type: String,
    pub source_event_id: i64,
    pub expires_at: String,
}

#[derive(Debug, Clone)]
pub struct StoredSearchContext {
    pub id: i64,
    pub query: String,
    pub candidates: Vec<SearchCandidate>,
}

#[derive(Debug, Clone)]
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
```

Add these functions below `ensure_schema`:

```rust
fn now_text() -> String {
    Local::now().to_rfc3339()
}

pub fn insert_credit(conn: &Connection, credit: &NewSongCredit) -> Result<i64> {
    let now = now_text();
    conn.execute(
        "insert into song_request_credits
        (session_id, room_id, uid, uname, credit_value, tier, source_type, source_event_id, expires_at, created_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            credit.session_id,
            credit.room_id,
            credit.uid,
            credit.uname,
            credit.credit_value,
            credit.tier,
            credit.source_type,
            credit.source_event_id,
            credit.expires_at,
            now,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn pending_credit_value(conn: &Connection, session_id: &str, uid: i64) -> Result<i64> {
    Ok(conn.query_row(
        "select coalesce(sum(credit_value), 0)
         from song_request_credits
         where session_id = ?1 and uid = ?2 and used_at is null and expires_at > ?3",
        params![session_id, uid, now_text()],
        |row| row.get(0),
    )?)
}

pub fn session_pending_value(conn: &Connection, session_id: &str, room_id: i64) -> Result<i64> {
    Ok(conn.query_row(
        "select coalesce(sum(credit_value), 0)
         from song_request_credits
         where session_id = ?1 and room_id = ?2 and used_at is null and expires_at > ?3",
        params![session_id, room_id, now_text()],
        |row| row.get(0),
    )?)
}

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

pub fn latest_search_context(
    conn: &Connection,
    session_id: &str,
    uid: i64,
) -> Result<Option<StoredSearchContext>> {
    let now = now_text();
    let row = conn
        .query_row(
            "select id, query, candidates_json
             from song_search_contexts
             where session_id = ?1 and uid = ?2 and expires_at > ?3
             order by id desc
             limit 1",
            params![session_id, uid, now],
            |row| {
                let json: String = row.get(2)?;
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, json))
            },
        )
        .optional()?;
    row.map(|(id, query, json)| {
        let candidates = serde_json::from_str(&json)?;
        Ok(StoredSearchContext { id, query, candidates })
    })
    .transpose()
}

pub fn insert_song_request(conn: &Connection, request: &NewSongRequest) -> Result<i64> {
    let now = now_text();
    conn.execute(
        "insert into song_requests
        (session_id, room_id, uid, uname, source, song_id, song_name, artist_names, album_name, pic_url,
         lyric_id, url_id, duration_ms, requested_text, tier, credit_value, priority_score, status,
         source_event_id, created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'queued', ?18, ?19, ?19)",
        params![
            request.session_id,
            request.room_id,
            request.uid,
            request.uname,
            request.source,
            request.song_id,
            request.song_name,
            request.artist_names,
            request.album_name,
            request.pic_url,
            request.lyric_id,
            request.url_id,
            request.duration_ms,
            request.requested_text,
            request.tier,
            request.credit_value,
            request.priority_score,
            request.source_event_id,
            now,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn oldest_pending_credit(conn: &Connection, session_id: &str, uid: i64) -> Result<Option<(i64, i64, String)>> {
    conn.query_row(
        "select id, credit_value, tier
         from song_request_credits
         where session_id = ?1 and uid = ?2 and used_at is null and expires_at > ?3
         order by credit_value desc, id asc
         limit 1",
        params![session_id, uid, now_text()],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional().map_err(Into::into)
}

pub fn mark_credit_used(conn: &Connection, credit_id: i64, request_id: i64) -> Result<()> {
    conn.execute(
        "update song_request_credits set used_request_id = ?1, used_at = ?2 where id = ?3 and used_at is null",
        params![request_id, now_text(), credit_id],
    )?;
    Ok(())
}

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
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
}
```

- [ ] **Step 4: Run storage tests**

Run:

```bash
cargo test -q music::storage
```

Expected: all music storage tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/music/storage.rs src/storage/mod.rs
git commit -m "feat: add music request storage operations"
```

---

## Task 2: Gift Credits And Confirmation Service

**Files:**
- Modify: `src/music/service.rs`
- Modify: `src/bot/monitor.rs`

- [ ] **Step 1: Add failing service tests**

Add tests to `src/music/service.rs`:

```rust
#[tokio::test]
async fn gift_event_records_credit_when_storage_is_available() {
    let storage = Arc::new(Storage::open_in_memory().expect("storage"));
    let service = MusicInteractionService::new_for_tests_with_storage(
        vec![Box::new(FakeProvider::with_tracks(vec![track("晴天", &["周杰伦"], "186016")]))],
        storage.clone(),
        100,
        Arc::new(Mutex::new(Some("session-1".to_string()))),
    );
    let event = bilibili_live_protocol::LiveEvent::Gift {
        user_id: 42,
        user: "alice".to_string(),
        gift: "辣条".to_string(),
        count: 1,
        price: 100,
        original_gift_name: None,
        original_gift_price: 100,
    };

    service.handle_live_event(&event).await.expect("gift handled");

    let pending = storage.with_connection(|conn| {
        crate::music::storage::pending_credit_value(conn, "session-1", 42)
    }).expect("pending");
    assert_eq!(pending, 100);
}

#[tokio::test]
async fn confirm_uses_latest_context_and_consumes_credit() {
    let storage = Arc::new(Storage::open_in_memory().expect("storage"));
    let session = Arc::new(Mutex::new(Some("session-1".to_string())));
    let service = MusicInteractionService::new_for_tests_with_storage(
        vec![Box::new(FakeProvider::with_tracks(vec![track("晴天", &["周杰伦"], "186016")]))],
        storage.clone(),
        100,
        session,
    );
    service.handle_danmu(42, "alice", "点歌 晴天").await.expect("search");
    service.handle_live_event(&bilibili_live_protocol::LiveEvent::Gift {
        user_id: 42,
        user: "alice".to_string(),
        gift: "小花花".to_string(),
        count: 1,
        price: 66,
        original_gift_name: None,
        original_gift_price: 66,
    }).await.expect("credit");

    let reply = service.handle_danmu(42, "alice", "确认 #1").await.expect("confirm");

    assert!(reply.to_danmu_text().contains("已加入点歌队列"));
    let queue = storage.with_connection(|conn| crate::music::storage::list_queue(conn, "session-1", 100))
        .expect("queue");
    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0].song_name, "晴天");
}
```

Add the needed test imports:

```rust
use std::sync::{Arc, Mutex};
use crate::storage::Storage;
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test -q music::service::tests::gift_event_records_credit_when_storage_is_available music::service::tests::confirm_uses_latest_context_and_consumes_credit
```

Expected: compile failure for missing storage-aware constructor and storage integration.

- [ ] **Step 3: Add storage-aware service fields**

Modify `MusicInteractionService`:

```rust
pub struct MusicInteractionService {
    providers: Vec<Box<dyn MusicProvider>>,
    storage: Option<Arc<Storage>>,
    room_id: i64,
    session_id: Option<Arc<Mutex<Option<String>>>>,
}
```

Add constructors:

```rust
pub fn new(providers: Vec<Box<dyn MusicProvider>>) -> Self {
    Self {
        providers,
        storage: None,
        room_id: 0,
        session_id: None,
    }
}

pub fn new_with_storage(
    providers: Vec<Box<dyn MusicProvider>>,
    storage: Arc<Storage>,
    room_id: i64,
    session_id: Arc<Mutex<Option<String>>>,
) -> Self {
    Self {
        providers,
        storage: Some(storage),
        room_id,
        session_id: Some(session_id),
    }
}

pub fn new_for_tests_with_storage(
    providers: Vec<Box<dyn MusicProvider>>,
    storage: Arc<Storage>,
    room_id: i64,
    session_id: Arc<Mutex<Option<String>>>,
) -> Self {
    Self::new_with_storage(providers, storage, room_id, session_id)
}
```

Add helpers:

```rust
fn current_session_id(&self) -> Option<String> {
    self.session_id
        .as_ref()
        .and_then(|value| value.lock().ok().and_then(|guard| guard.clone()))
}

fn context_expires_at() -> String {
    (chrono::Local::now() + chrono::Duration::seconds(60)).to_rfc3339()
}

fn credit_expires_at() -> String {
    (chrono::Local::now() + chrono::Duration::hours(24)).to_rfc3339()
}
```

- [ ] **Step 4: Persist search contexts and confirmations**

In the `SongCommand::Search` branch, after candidates are sorted/truncated and before returning:

```rust
if let (Some(storage), Some(session_id)) = (&self.storage, self.current_session_id()) {
    let _ = storage.with_connection(|conn| {
        crate::music::storage::save_search_context(
            conn,
            &session_id,
            _uid,
            &query,
            &candidates,
            &Self::context_expires_at(),
        )
    });
}
```

Replace the `SongCommand::Confirm` placeholder with:

```rust
SongCommand::Confirm { index } => {
    let Some(storage) = &self.storage else {
        return Ok(SongServiceReply::Message("候选确认将在接入存储后生效".to_string()));
    };
    let Some(session_id) = self.current_session_id() else {
        return Ok(SongServiceReply::Message("当前没有直播场次，暂不能确认点歌".to_string()));
    };
    let request_id = storage.with_connection_mut(|conn| {
        let context = crate::music::storage::latest_search_context(conn, &session_id, _uid)?
            .ok_or_else(|| anyhow!("没有可确认的候选，请先发送 点歌 歌名"))?;
        let candidate = context.candidates.get(index.saturating_sub(1))
            .ok_or_else(|| anyhow!("候选编号不存在"))?;
        let (credit_id, credit_value, tier) = crate::music::storage::oldest_pending_credit(conn, &session_id, _uid)?
            .ok_or_else(|| anyhow!("还没有可用点歌权益，请先送礼解锁"))?;
        let tier_enum = crate::music::credits::tier_for_credit(credit_value)
            .unwrap_or(crate::music::credits::SongRequestTier::Ordinary);
        let score = crate::music::queue::priority_score(tier_enum, credit_value, 0, 0);
        crate::music::storage::insert_song_request_and_consume_credit(conn, credit_id, &crate::music::storage::NewSongRequest {
            session_id: session_id.clone(),
            room_id: self.room_id,
            uid: _uid,
            uname: _uname.to_string(),
            source: candidate.track.source.as_str().to_string(),
            song_id: candidate.track.song_id.clone(),
            song_name: candidate.track.name.clone(),
            artist_names: artists_text(&candidate.track.artists),
            album_name: Some(candidate.track.album.clone()),
            pic_url: None,
            lyric_id: candidate.track.lyric_id.clone(),
            url_id: candidate.track.url_id.clone(),
            duration_ms: candidate.track.duration_ms,
            requested_text: format!("确认 #{index}"),
            tier,
            credit_value,
            priority_score: score,
            source_event_id: None,
        })
    })?;
    Ok(SongServiceReply::Message(format!("已加入点歌队列 #{request_id}")))
}
```

- [ ] **Step 5: Persist Gift and SuperChat credits**

In `handle_live_event`, replace Gift/SuperChat placeholder handling with:

```rust
bilibili_live_protocol::LiveEvent::Gift { user_id, user, gift, count, price, .. } => {
    self.record_credit(*user_id, user, price.saturating_mul(*count as i64), "gift", 0)?;
    Ok(SongServiceReply::Message(format!(
        "感谢 {user} 赠送 {gift} x{count}，点歌权益已记录"
    )))
}
bilibili_live_protocol::LiveEvent::SuperChat { user_id, user, price, .. } => {
    self.record_credit(*user_id, user, *price, "super_chat", 0)?;
    Ok(SongServiceReply::Message(format!(
        "感谢 {user} 的醒目留言，点歌权益已记录（{price}元）"
    )))
}
```

Add:

```rust
fn record_credit(&self, uid: i64, uname: &str, credit_value: i64, source_type: &str, source_event_id: i64) -> Result<()> {
    let Some(storage) = &self.storage else {
        return Ok(());
    };
    let Some(session_id) = self.current_session_id() else {
        return Ok(());
    };
    let Some(tier) = crate::music::credits::tier_for_credit(credit_value) else {
        return Ok(());
    };
    storage.with_connection(|conn| {
        crate::music::storage::insert_credit(conn, &crate::music::storage::NewSongCredit {
            session_id,
            room_id: self.room_id,
            uid,
            uname: uname.to_string(),
            credit_value,
            tier: tier.as_str().to_string(),
            source_type: source_type.to_string(),
            source_event_id,
            expires_at: Self::credit_expires_at(),
        })
    })?;
    Ok(())
}
```

- [ ] **Step 6: Pass storage into monitor service**

In `src/bot/monitor.rs`, replace the music service constructor with:

```rust
let music_service = music_interaction_enabled.then(|| {
    Arc::new(MusicInteractionService::new_with_storage(
        vec![Box::new(NeteaseProvider::new(reqwest::Client::new()))],
        storage.clone(),
        room_id,
        current_session_id.clone(),
    ))
});
```

- [ ] **Step 7: Run service tests**

Run:

```bash
cargo test -q music::service
cargo check -q
```

Expected: service tests and check pass.

- [ ] **Step 8: Commit**

```bash
git add src/music/service.rs src/bot/monitor.rs
git commit -m "feat: persist music credits and confirmations"
```

---

## Task 3: Tauri Queue Commands And Plugin UI Integration

**Files:**
- Modify: `src/main.rs`
- Modify: `src-tauri/src/app/lib/api.ts`
- Modify: `src-tauri/src/app/pages/MusicInteraction.tsx`

- [ ] **Step 1: Add Tauri commands**

Add command functions to `src/main.rs` near `search_music_candidates`:

```rust
#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_music_queue() -> Result<Vec<music::storage::QueueItem>, String> {
    let config = AppConfig::load_or_default().map_err(|e| e.to_string())?;
    let session_id = bot::observed_session_id(config.room_id, false).unwrap_or_else(|| "manual".to_string());
    let storage = storage::Storage::open(&config::db_path().to_string_lossy()).map_err(|e| e.to_string())?;
    storage.with_connection(|conn| music::storage::list_queue(conn, &session_id, config.room_id))
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn confirm_music_candidate(uid: i64, uname: String, index: usize) -> Result<String, String> {
    let config = AppConfig::load_or_default().map_err(|e| e.to_string())?;
    let storage = std::sync::Arc::new(storage::Storage::open(&config::db_path().to_string_lossy()).map_err(|e| e.to_string())?);
    let session = std::sync::Arc::new(std::sync::Mutex::new(Some(
        bot::observed_session_id(config.room_id, false).unwrap_or_else(|| "manual".to_string())
    )));
    let service = music::service::MusicInteractionService::new_with_storage(
        vec![Box::new(music::providers::netease::NeteaseProvider::new(reqwest::Client::new()))],
        storage,
        config.room_id,
        session,
    );
    service.handle_danmu(uid, &uname, &format!("确认 #{index}")).await
        .map(|reply| reply.to_danmu_text())
        .map_err(|e| e.to_string())
}
```

Add the commands to `tauri::generate_handler!`:

```rust
get_music_queue,
confirm_music_candidate,
```

- [ ] **Step 2: Add frontend API wrappers**

In `src-tauri/src/app/lib/api.ts`, add:

```ts
export interface MusicQueueItem {
  requestId: number;
  uid: number;
  uname: string;
  songName: string;
  artistNames: string;
  tier: string;
  creditValue: number;
  priorityScore: number;
  status: string;
  createdAt: string;
}
```

Add wrappers to `api`:

```ts
getMusicQueue: () => invoke<MusicQueueItem[]>('get_music_queue'),
confirmMusicCandidate: (uid: number, uname: string, index: number) =>
  invoke<string>('confirm_music_candidate', { uid, uname, index }),
```

- [ ] **Step 3: Replace local-only confirmation in page**

In `MusicInteraction.tsx`, keep `selectedCandidate`, but replace confirm handlers with:

```tsx
const confirmCandidate = async (candidate: SearchCandidate) => {
  const index = candidates.findIndex(item => candidateKey(item) === candidateKey(candidate)) + 1;
  if (index <= 0) return;
  try {
    const message = await api.confirmMusicCandidate(0, '主播预览', index);
    setConfirmedCandidate(candidate);
    toast.success(message || '已确认候选歌曲');
    setQueue(await api.getMusicQueue());
  } catch (err) {
    toast.error(`确认失败: ${err}`);
  }
};
```

Add queue state:

```tsx
const [queue, setQueue] = useState<MusicQueueItem[]>([]);
```

Load queue after settings load:

```tsx
api.getMusicQueue().then(setQueue).catch(() => setQueue([]));
```

Render a compact queue list under the candidate panel:

```tsx
{queue.length > 0 && (
  <div className="mt-4 rounded-2xl border border-[var(--surface-border)] bg-[var(--control-bg)] p-4">
    <div className="mb-2 text-[12px] font-black">当前队列</div>
    <div className="space-y-2">
      {queue.slice(0, 6).map(item => (
        <div key={item.requestId} className="grid grid-cols-[1fr_auto] gap-2 text-[12px]">
          <span className="truncate">{item.songName} - {item.artistNames}</span>
          <span className="text-[var(--muted-text)]">{item.tier}</span>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm run build --prefix src-tauri
```

Expected: Vite build succeeds, existing chunk-size warning is acceptable.

- [ ] **Step 5: Commit**

```bash
git add src/main.rs src-tauri/src/app/lib/api.ts src-tauri/src/app/pages/MusicInteraction.tsx
git commit -m "feat: confirm music candidates into queue"
```

---

## Task 4: OBS Queue JSON And Live Overlay

**Files:**
- Modify: `src/overlay_server.rs`
- Modify: `src/music_interaction.html`

- [ ] **Step 1: Add overlay JSON routes**

In `src/overlay_server.rs`, add routes:

```rust
.route("/song-request/api/queue", get(music_queue_handler))
.route("/song-request/api/now-playing", get(music_now_playing_handler))
.route("/song-request/api/rank", get(music_rank_handler))
```

Add handlers:

```rust
async fn music_queue_handler() -> impl IntoResponse {
    let app = crate::config::AppConfig::load_or_default().unwrap_or_default();
    let session_id = crate::bot::observed_session_id(app.room_id, false).unwrap_or_else(|| "manual".to_string());
    let Ok(storage) = crate::storage::Storage::open(&crate::config::db_path().to_string_lossy()) else {
        return axum::Json(serde_json::json!({ "items": [] }));
    };
    let items = storage.with_connection(|conn| crate::music::storage::list_queue(conn, &session_id, app.room_id))
        .unwrap_or_default();
    axum::Json(serde_json::json!({ "items": items }))
}

async fn music_now_playing_handler() -> impl IntoResponse {
    let app = crate::config::AppConfig::load_or_default().unwrap_or_default();
    let session_id = crate::bot::observed_session_id(app.room_id, false).unwrap_or_else(|| "manual".to_string());
    let Ok(storage) = crate::storage::Storage::open(&crate::config::db_path().to_string_lossy()) else {
        return axum::Json(serde_json::json!({ "item": null }));
    };
    let item = storage.with_connection(|conn| crate::music::storage::list_queue(conn, &session_id, app.room_id))
        .unwrap_or_default()
        .into_iter()
        .find(|item| item.status == "playing")
        .or_else(|| storage.with_connection(|conn| crate::music::storage::list_queue(conn, &session_id, app.room_id)).unwrap_or_default().into_iter().next());
    axum::Json(serde_json::json!({ "item": item }))
}

async fn music_rank_handler() -> impl IntoResponse {
    axum::Json(serde_json::json!({ "items": [] }))
}
```

- [ ] **Step 2: Make HTML poll the queue**

Replace the static script in `src/music_interaction.html` with:

```html
<script>
  const params = new URLSearchParams(location.search);
  document.body.className = params.get('skin') || 'compact';
  async function load() {
    const view = location.pathname.endsWith('/now-playing') ? 'now-playing' : 'queue';
    const res = await fetch(`/song-request/api/${view === 'now-playing' ? 'now-playing' : 'queue'}`, { cache: 'no-store' });
    const data = await res.json();
    const item = data.item || (data.items && data.items[0]);
    document.getElementById('title').textContent = item ? item.songName : '今日第一首歌等待点亮';
    document.getElementById('meta').textContent = item ? `${item.artistNames} · ${item.uname}` : '送礼点歌后将在这里显示';
    document.getElementById('stats').textContent = item ? `${item.tier} · ${item.creditValue} 电池` : '本场点歌 0 电池';
  }
  load();
  setInterval(load, 3000);
</script>
```

- [ ] **Step 3: Smoke test routes**

Run the app or overlay server as normally done in this repo, then open:

```text
http://127.0.0.1:<overlay-port>/song-request/playlist
http://127.0.0.1:<overlay-port>/song-request/api/queue
```

Expected: HTML renders without JavaScript errors; JSON returns `{ "items": [] }` when queue is empty.

- [ ] **Step 4: Commit**

```bash
git add src/overlay_server.rs src/music_interaction.html
git commit -m "feat: expose music queue overlay data"
```

---

## Task 5: Safe Request-ID Music Open Command

**Files:**
- Modify: `src/music/storage.rs`
- Modify: `src/main.rs`
- Modify: `src-tauri/src/app/lib/api.ts`
- Modify: `src-tauri/src/app/pages/MusicInteraction.tsx`

- [ ] **Step 1: Add storage lookup**

Add to `src/music/storage.rs`:

```rust
#[derive(Debug, Clone)]
pub struct OpenableSongRequest {
    pub request_id: i64,
    pub source: String,
    pub song_id: String,
    pub url_id: String,
}

pub fn openable_song_request(conn: &Connection, request_id: i64) -> Result<Option<OpenableSongRequest>> {
    conn.query_row(
        "select id, source, song_id, url_id from song_requests where id = ?1 and status in ('queued', 'playing')",
        params![request_id],
        |row| Ok(OpenableSongRequest {
            request_id: row.get(0)?,
            source: row.get(1)?,
            song_id: row.get(2)?,
            url_id: row.get(3)?,
        }),
    ).optional().map_err(Into::into)
}
```

- [ ] **Step 2: Add Tauri open command**

Add to `src/main.rs`:

```rust
#[cfg(feature = "tauri")]
#[tauri::command]
async fn open_music_request(app: AppHandle, request_id: i64) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let storage = storage::Storage::open(&config::db_path().to_string_lossy()).map_err(|e| e.to_string())?;
    let request = storage.with_connection(|conn| music::storage::openable_song_request(conn, request_id))
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "点歌请求不存在或不可播放".to_string())?;
    let template = match request.source.as_str() {
        "netease" => "orpheus://song/{song_id}",
        "tencent" => "qqmusic://song/{song_id}",
        _ => "https://music.163.com/#/song?id={song_id}",
    };
    let url = music::opener::build_open_url(template, &request.url_id).map_err(|e| e.to_string())?;
    app.opener().open_url(url.clone(), None::<&str>).map_err(|e| e.to_string())?;
    Ok(url)
}
```

Register:

```rust
open_music_request,
```

- [ ] **Step 3: Add frontend API and button**

In `api.ts`:

```ts
openMusicRequest: (requestId: number) => invoke<string>('open_music_request', { requestId }),
```

In `MusicInteraction.tsx`, add a play/open button in queue rows:

```tsx
<Button size="sm" onClick={async () => {
  try {
    await api.openMusicRequest(item.requestId);
    toast.success('已打开歌曲');
  } catch (err) {
    toast.error(`打开失败: ${err}`);
  }
}}>
  打开
</Button>
```

- [ ] **Step 4: Run checks**

Run:

```bash
cargo test -q music::opener::tests
cargo check -q
npm run build --prefix src-tauri
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/music/storage.rs src/main.rs src-tauri/src/app/lib/api.ts src-tauri/src/app/pages/MusicInteraction.tsx
git commit -m "feat: open queued music requests safely"
```

---

## Task 6: Runtime Enabled Setting Refresh

**Files:**
- Modify: `src/bot/monitor.rs`

- [ ] **Step 1: Add helper**

Add this helper near the monitor loop helpers:

```rust
fn music_interaction_enabled() -> bool {
    crate::plugin_settings::PluginSettings::load_or_default()
        .map(|settings| settings.music_interaction.enabled)
        .unwrap_or(false)
}
```

- [ ] **Step 2: Refresh before handling each music event**

In the music event block, before acquiring the semaphore:

```rust
if !music_interaction_enabled() {
    return;
}
```

If the code is inside a closure where `return` exits too much, use:

```rust
if music_interaction_enabled() {
    // existing music service handling block
}
```

- [ ] **Step 3: Run check**

Run:

```bash
cargo check -q
```

Expected: check passes.

- [ ] **Step 4: Commit**

```bash
git add src/bot/monitor.rs
git commit -m "fix: refresh music interaction enablement"
```

---

## Task 7: Final Verification

**Files:**
- No intended code changes unless verification finds a defect.

- [ ] **Step 1: Run focused tests**

```bash
cargo test -q music::
```

Expected: all music tests pass.

- [ ] **Step 2: Run Rust checks**

```bash
cargo fmt --check
cargo check --workspace
cargo test --workspace --bins --tests
```

Expected: all pass.

- [ ] **Step 3: Run frontend build**

```bash
npm run build --prefix src-tauri
```

Expected: build passes. Existing chunk-size warnings are acceptable.

- [ ] **Step 4: Document known workspace doctest issue**

Run:

```bash
cargo test --workspace
```

Expected: if doctests still fail in `streamix-voice` because of `libsherpa-onnx-c-api.dylib` or local TTS doc examples, record it in the final response as unrelated existing risk.

---

## Self-Review

Spec coverage:
- Gift/SC credits: Task 2.
- Candidate confirmation: Task 2 and Task 3.
- Persistent queue: Task 1 and Task 2.
- OBS playlist/now-playing: Task 4.
- Safe system URL scheme opening: Task 5.
- Runtime enable/disable behavior: Task 6.
- Verification: Task 7.

Placeholder scan:
- No `TBD`, `TODO`, or “implement later” placeholders are used as task instructions.

Type consistency:
- Storage functions introduced in Task 1 are used by service and commands in later tasks.
- Frontend `MusicQueueItem` matches Rust `QueueItem` with `camelCase` serialization.
