# Music Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a “音乐互动” plugin-center feature with extensible Rust music search/provider logic, gift-gated song requests, queue management, and OBS-friendly playlist pages.

**Architecture:** Add a focused `src/music/` domain module that owns provider abstraction, song request commands, credits, queue scoring, and storage-facing services. Implement a Meting-inspired Rust provider interface with standardized output, but do not port or copy Meting source code; each provider adapts its own HTTP responses into Streamix-owned `MusicTrack` structs. Integrate the feature through the existing monitor event loop, `PluginSettings`, Tauri commands, plugin sidebar, and overlay HTTP server.

**Tech Stack:** Rust 2024, reqwest, serde, rusqlite, tokio, Tauri 2, React + TypeScript, existing overlay Axum server, existing Bilibili `LiveEvent` model.

---

## Scope

This plan implements the MVP plus extension points for additional providers:

- Plugin center second submenu item: `音乐互动`.
- Rust music provider abstraction modeled around Meting capabilities: `search`, `song`, `url`, `lyric`, `pic`.
- First provider: NetEase Cloud Music search/details/open URL fallback, behind a trait so Tencent/KuGou/Kuwo/Baidu can be added without changing queue logic.
- Song command parsing: `点歌 <关键词>`, `点歌 #1`, `确认 #1`, `换一批`, `我的点歌`, `取消点歌`.
- Gift credit tiers: ordinary, priority, jump queue, exclusive, playlist takeover.
- Current-session and today statistics.
- Tauri page for control/config.
- OBS web pages for playlist, now-playing, and rank.

Non-goals for this plan:

- Full audio playback inside Streamix.
- Bypassing music platform copyright restrictions.
- Implementing every Meting provider in the first pass.
- High-fidelity animations for all skins. The first pass ships `compact` and `minimal`; the model supports the other skins.

---

## File Map

Create:

- `src/music/mod.rs` — module exports and public facade.
- `src/music/types.rs` — provider-neutral domain types.
- `src/music/command.rs` — danmu command parser and tests.
- `src/music/provider.rs` — `MusicProvider` trait, registry, provider errors.
- `src/music/providers/mod.rs` — provider module exports.
- `src/music/providers/netease.rs` — NetEase HTTP adapter with response mapping.
- `src/music/search.rs` — provider fan-out, candidate scoring, per-user search contexts.
- `src/music/credits.rs` — gift amount to tier/credit logic.
- `src/music/queue.rs` — priority scoring and queue actions.
- `src/music/service.rs` — event-driven orchestration used from monitor and Tauri commands.
- `src/music/storage.rs` — SQL helpers for song requests, credits, contexts, daily stats.
- `src/music/opener.rs` — URL scheme/template safety and open target selection.
- `src/music/tests/fixtures/netease_search.json` — fixture for provider mapping tests.
- `src/music_interaction.html` — OBS playlist/now-playing/rank web page.
- `src-tauri/src/app/pages/MusicInteraction.tsx` — plugin-center page.

Modify:

- `src/main.rs` — add `mod music`, shared music service, Tauri commands, command registration.
- `src/bot/monitor.rs` — call async music handler for gift/danmu events and enqueue replies.
- `src/storage/mod.rs` — initialize music tables through `music::storage::ensure_schema`.
- `src/plugin_settings.rs` — add `MusicInteractionSettings` defaults and overlay config persistence.
- `src/overlay_server.rs` — add music interaction routes and settings payload support.
- `src-tauri/src/app/components/Sidebar.tsx` — insert `音乐互动` as the second plugin submenu item.
- `src-tauri/src/app/App.tsx` — add route `/plugins/music-interaction`.
- `src-tauri/src/app/lib/api.ts` — add TS interfaces and Tauri command wrappers.
- `Cargo.toml` — add `async-trait` for provider trait methods.

---

## Task 1: Music Domain Types And Command Parser

**Files:**
- Create: `src/music/mod.rs`
- Create: `src/music/types.rs`
- Create: `src/music/command.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Write parser tests**

Add tests at the bottom of `src/music/command.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::{parse_song_command, SongCommand};

    #[test]
    fn parses_plain_song_request() {
        assert_eq!(
            parse_song_command("点歌 晴天 周杰伦"),
            Some(SongCommand::Search { query: "晴天 周杰伦".to_string() })
        );
    }

    #[test]
    fn parses_number_confirmation() {
        assert_eq!(parse_song_command("点歌 #2"), Some(SongCommand::Confirm { index: 2 }));
        assert_eq!(parse_song_command("确认 3"), Some(SongCommand::Confirm { index: 3 }));
    }

    #[test]
    fn parses_queue_status_and_cancel() {
        assert_eq!(parse_song_command("我的点歌"), Some(SongCommand::MyRequest));
        assert_eq!(parse_song_command("取消点歌"), Some(SongCommand::CancelMine));
    }

    #[test]
    fn ignores_unrelated_danmu() {
        assert_eq!(parse_song_command("主播晚上好"), None);
        assert_eq!(parse_song_command("点歌"), None);
    }
}
```

- [ ] **Step 2: Run parser test to verify it fails**

Run:

```bash
cargo test music::command::tests::parses_plain_song_request
```

Expected: compile failure because `src/music/command.rs` does not exist.

- [ ] **Step 3: Add module files and minimal implementation**

Create `src/music/mod.rs`:

```rust
pub mod command;
pub mod types;
```

Create `src/music/types.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MusicSource {
    Netease,
    Tencent,
    Kugou,
    Baidu,
    Kuwo,
}

impl MusicSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Netease => "netease",
            Self::Tencent => "tencent",
            Self::Kugou => "kugou",
            Self::Baidu => "baidu",
            Self::Kuwo => "kuwo",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MusicTrack {
    pub source: MusicSource,
    pub song_id: String,
    pub name: String,
    pub artists: Vec<String>,
    pub album: String,
    pub pic_id: String,
    pub url_id: String,
    pub lyric_id: String,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchCandidate {
    pub track: MusicTrack,
    pub score: i64,
    pub reason: String,
}
```

Create `src/music/command.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SongCommand {
    Search { query: String },
    Confirm { index: usize },
    MoreCandidates,
    MyRequest,
    CancelMine,
}

pub fn parse_song_command(text: &str) -> Option<SongCommand> {
    let value = text.trim();
    if value == "我的点歌" {
        return Some(SongCommand::MyRequest);
    }
    if value == "取消点歌" {
        return Some(SongCommand::CancelMine);
    }
    if value == "换一批" {
        return Some(SongCommand::MoreCandidates);
    }

    for prefix in ["点歌", "确认", "选"] {
        let Some(rest) = value.strip_prefix(prefix) else {
            continue;
        };
        let rest = rest.trim();
        if rest.is_empty() {
            return None;
        }
        let index_text = rest.strip_prefix('#').unwrap_or(rest).trim();
        if let Ok(index) = index_text.parse::<usize>() {
            if index > 0 {
                return Some(SongCommand::Confirm { index });
            }
        }
        if prefix == "点歌" {
            return Some(SongCommand::Search { query: rest.to_string() });
        }
    }

    None
}
```

Modify `src/main.rs` near the other module declarations:

```rust
mod music;
```

- [ ] **Step 4: Run parser tests**

Run:

```bash
cargo test music::command::tests --lib
```

Expected: all `music::command` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main.rs src/music/mod.rs src/music/types.rs src/music/command.rs
git commit -m "feat: add music command parser"
```

---

## Task 2: Extensible Rust Music Provider Interface

**Files:**
- Create: `src/music/provider.rs`
- Create: `src/music/providers/mod.rs`
- Create: `src/music/providers/netease.rs`
- Create: `src/music/tests/fixtures/netease_search.json`
- Modify: `src/music/mod.rs`
- Modify: `Cargo.toml`

- [ ] **Step 1: Add provider mapping fixture**

Create `src/music/tests/fixtures/netease_search.json`:

```json
{
  "result": {
    "songs": [
      {
        "id": 186016,
        "name": "晴天",
        "duration": 269000,
        "artists": [{ "name": "周杰伦" }],
        "album": {
          "name": "叶惠美",
          "picId": 109951165611629000
        }
      }
    ]
  }
}
```

- [ ] **Step 2: Write provider mapping tests**

Add to `src/music/providers/netease.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::map_search_response;
    use crate::music::types::MusicSource;

    #[test]
    fn maps_netease_search_response_to_standard_tracks() {
        let raw = include_str!("../tests/fixtures/netease_search.json");
        let tracks = map_search_response(raw).expect("fixture maps");
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].source, MusicSource::Netease);
        assert_eq!(tracks[0].song_id, "186016");
        assert_eq!(tracks[0].name, "晴天");
        assert_eq!(tracks[0].artists, vec!["周杰伦"]);
        assert_eq!(tracks[0].album, "叶惠美");
        assert_eq!(tracks[0].url_id, "186016");
        assert_eq!(tracks[0].lyric_id, "186016");
        assert_eq!(tracks[0].duration_ms, Some(269000));
    }
}
```

- [ ] **Step 3: Run provider test to verify it fails**

Run:

```bash
cargo test music::providers::netease::tests::maps_netease_search_response_to_standard_tracks --lib
```

Expected: compile failure because provider modules do not exist.

- [ ] **Step 4: Add provider trait and NetEase adapter**

Modify `Cargo.toml` dependencies:

```toml
async-trait = "0.1"
```

Create `src/music/provider.rs`:

```rust
use anyhow::Result;
use async_trait::async_trait;

use crate::music::types::{MusicSource, MusicTrack};

#[derive(Debug, Clone)]
pub struct SearchOptions {
    pub page: u32,
    pub limit: u32,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self { page: 1, limit: 10 }
    }
}

#[async_trait]
pub trait MusicProvider: Send + Sync {
    fn source(&self) -> MusicSource;
    async fn search(&self, keyword: &str, options: SearchOptions) -> Result<Vec<MusicTrack>>;
    async fn song(&self, id: &str) -> Result<Option<MusicTrack>>;
    async fn url(&self, id: &str, bitrate: u32) -> Result<Option<String>>;
    async fn lyric(&self, id: &str) -> Result<Option<String>>;
    async fn pic(&self, id: &str, size: u32) -> Result<Option<String>>;
}
```

Create `src/music/providers/mod.rs`:

```rust
pub mod netease;
```

Create `src/music/providers/netease.rs`:

```rust
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use crate::music::provider::{MusicProvider, SearchOptions};
use crate::music::types::{MusicSource, MusicTrack};

#[derive(Debug, Clone)]
pub struct NeteaseProvider {
    client: Client,
    base_url: String,
}

impl NeteaseProvider {
    pub fn new(client: Client) -> Self {
        Self {
            client,
            base_url: "https://music.163.com".to_string(),
        }
    }

    pub fn with_base_url(client: Client, base_url: impl Into<String>) -> Self {
        Self {
            client,
            base_url: base_url.into(),
        }
    }
}

#[async_trait]
impl MusicProvider for NeteaseProvider {
    fn source(&self) -> MusicSource {
        MusicSource::Netease
    }

    async fn search(&self, keyword: &str, options: SearchOptions) -> Result<Vec<MusicTrack>> {
        let url = format!("{}/api/search/get/web", self.base_url.trim_end_matches('/'));
        let text = self.client
            .post(url)
            .form(&[
                ("s", keyword.to_string()),
                ("type", "1".to_string()),
                ("offset", ((options.page.saturating_sub(1)) * options.limit).to_string()),
                ("limit", options.limit.to_string()),
            ])
            .send()
            .await
            .context("netease search request failed")?
            .text()
            .await
            .context("netease search response body failed")?;
        map_search_response(&text)
    }

    async fn song(&self, id: &str) -> Result<Option<MusicTrack>> {
        let tracks = self.search(id, SearchOptions { page: 1, limit: 1 }).await?;
        Ok(tracks.into_iter().find(|track| track.song_id == id))
    }

    async fn url(&self, id: &str, _bitrate: u32) -> Result<Option<String>> {
        Ok(Some(format!("https://music.163.com/#/song?id={id}")))
    }

    async fn lyric(&self, id: &str) -> Result<Option<String>> {
        Ok(Some(format!("https://music.163.com/api/song/lyric?id={id}&lv=1&kv=1&tv=-1")))
    }

    async fn pic(&self, id: &str, size: u32) -> Result<Option<String>> {
        Ok(Some(format!("https://p1.music.126.net/{id}.jpg?param={size}y{size}")))
    }
}

#[derive(Debug, Deserialize)]
struct NeteaseSearchResponse {
    result: Option<NeteaseSearchResult>,
}

#[derive(Debug, Deserialize)]
struct NeteaseSearchResult {
    #[serde(default)]
    songs: Vec<NeteaseSong>,
}

#[derive(Debug, Deserialize)]
struct NeteaseSong {
    id: i64,
    name: String,
    #[serde(default)]
    duration: Option<i64>,
    #[serde(default)]
    artists: Vec<NeteaseArtist>,
    album: Option<NeteaseAlbum>,
}

#[derive(Debug, Deserialize)]
struct NeteaseArtist {
    name: String,
}

#[derive(Debug, Deserialize)]
struct NeteaseAlbum {
    #[serde(default)]
    name: String,
    #[serde(rename = "picId")]
    pic_id: Option<i64>,
}

pub fn map_search_response(raw: &str) -> Result<Vec<MusicTrack>> {
    let parsed: NeteaseSearchResponse = serde_json::from_str(raw)
        .context("netease search json parse failed")?;
    let songs = parsed.result.map(|value| value.songs).unwrap_or_default();
    Ok(songs.into_iter().map(|song| {
        let song_id = song.id.to_string();
        let album = song.album.as_ref().map(|value| value.name.clone()).unwrap_or_default();
        let pic_id = song.album.and_then(|value| value.pic_id).map(|value| value.to_string()).unwrap_or_default();
        MusicTrack {
            source: MusicSource::Netease,
            song_id: song_id.clone(),
            name: song.name,
            artists: song.artists.into_iter().map(|artist| artist.name).filter(|name| !name.is_empty()).collect(),
            album,
            pic_id,
            url_id: song_id.clone(),
            lyric_id: song_id,
            duration_ms: song.duration,
        }
    }).collect())
}
```

Modify `src/music/mod.rs`:

```rust
pub mod command;
pub mod provider;
pub mod providers;
pub mod types;
```

- [ ] **Step 5: Run provider tests**

Run:

```bash
cargo test music::providers::netease::tests --lib
```

Expected: provider mapping test passes.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml Cargo.lock src/music/mod.rs src/music/provider.rs src/music/providers src/music/tests/fixtures/netease_search.json
git commit -m "feat: add rust music provider abstraction"
```

---

## Task 3: Search Scoring And Candidate Contexts

**Files:**
- Create: `src/music/search.rs`
- Modify: `src/music/mod.rs`
- Modify: `src/music/types.rs`

- [ ] **Step 1: Write scoring tests**

Add to `src/music/search.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::score_track;
    use crate::music::types::{MusicSource, MusicTrack};

    fn track(name: &str, artists: &[&str]) -> MusicTrack {
        MusicTrack {
            source: MusicSource::Netease,
            song_id: "1".to_string(),
            name: name.to_string(),
            artists: artists.iter().map(|value| value.to_string()).collect(),
            album: "album".to_string(),
            pic_id: String::new(),
            url_id: "1".to_string(),
            lyric_id: "1".to_string(),
            duration_ms: Some(240000),
        }
    }

    #[test]
    fn exact_song_and_artist_scores_highest() {
        let exact = score_track("晴天 周杰伦", &track("晴天", &["周杰伦"]));
        let cover = score_track("晴天 周杰伦", &track("晴天", &["其他歌手"]));
        assert!(exact.score > cover.score);
        assert!(exact.score >= 80);
    }

    #[test]
    fn live_and_dj_versions_are_penalized() {
        let normal = score_track("晴天", &track("晴天", &["周杰伦"]));
        let live = score_track("晴天", &track("晴天 Live", &["周杰伦"]));
        let dj = score_track("晴天", &track("晴天 DJ版", &["周杰伦"]));
        assert!(normal.score > live.score);
        assert!(normal.score > dj.score);
    }
}
```

- [ ] **Step 2: Run scoring test to verify it fails**

Run:

```bash
cargo test music::search::tests --lib
```

Expected: compile failure because `src/music/search.rs` is not exported.

- [ ] **Step 3: Implement scoring**

Create `src/music/search.rs`:

```rust
use crate::music::types::{MusicTrack, SearchCandidate};

pub fn score_track(query: &str, track: &MusicTrack) -> SearchCandidate {
    let normalized_query = normalize(query);
    let song_name = normalize(&track.name);
    let artists = track.artists.iter().map(|artist| normalize(artist)).collect::<Vec<_>>();

    let mut score = 0;
    let mut reasons = Vec::new();

    if normalized_query.contains(&song_name) || song_name.contains(&normalized_query) {
        score += 50;
        reasons.push("歌名匹配");
    }
    if artists.iter().any(|artist| normalized_query.contains(artist)) {
        score += 30;
        reasons.push("歌手匹配");
    }
    if normalized_query.split_whitespace().all(|part| song_name.contains(part) || artists.iter().any(|artist| artist.contains(part))) {
        score += 10;
        reasons.push("关键词完整");
    }
    for marker in ["live", "dj", "伴奏", "翻唱", "cover"] {
        if song_name.contains(marker) && !normalized_query.contains(marker) {
            score -= 12;
        }
    }

    SearchCandidate {
        track: track.clone(),
        score,
        reason: if reasons.is_empty() { "弱匹配".to_string() } else { reasons.join("+") },
    }
}

fn normalize(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .replace('　', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
```

Modify `src/music/mod.rs`:

```rust
pub mod command;
pub mod provider;
pub mod providers;
pub mod search;
pub mod types;
```

- [ ] **Step 4: Run scoring tests**

Run:

```bash
cargo test music::search::tests --lib
```

Expected: scoring tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/music/mod.rs src/music/search.rs src/music/types.rs
git commit -m "feat: score song request candidates"
```

---

## Task 4: Music Storage Schema

**Files:**
- Create: `src/music/storage.rs`
- Modify: `src/music/mod.rs`
- Modify: `src/storage/mod.rs`

- [ ] **Step 1: Write schema smoke test**

Add to `src/music/storage.rs`:

```rust
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
```

- [ ] **Step 2: Run schema test to verify it fails**

Run:

```bash
cargo test music::storage::tests::creates_music_tables --lib
```

Expected: compile failure because storage module is missing.

- [ ] **Step 3: Implement schema helper**

Create `src/music/storage.rs`:

```rust
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
```

Modify `src/music/mod.rs`:

```rust
pub mod command;
pub mod provider;
pub mod providers;
pub mod search;
pub mod storage;
pub mod types;
```

Modify `src/storage/mod.rs` inside `Storage::from_connection` after the existing `execute_batch` block:

```rust
crate::music::storage::ensure_schema(&conn)?;
```

- [ ] **Step 4: Run schema tests**

Run:

```bash
cargo test music::storage::tests storage::tests::open_in_memory --lib
```

Expected: music schema test passes; storage still opens.

- [ ] **Step 5: Commit**

```bash
git add src/music/mod.rs src/music/storage.rs src/storage/mod.rs
git commit -m "feat: add song request storage schema"
```

---

## Task 5: Credits, Tiers, And Queue Scoring

**Files:**
- Create: `src/music/credits.rs`
- Create: `src/music/queue.rs`
- Modify: `src/music/mod.rs`
- Modify: `src/music/types.rs`

- [ ] **Step 1: Write credit and queue tests**

Add to `src/music/credits.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::{tier_for_credit, SongRequestTier};

    #[test]
    fn maps_credit_to_highest_reached_tier() {
        assert_eq!(tier_for_credit(9), None);
        assert_eq!(tier_for_credit(10), Some(SongRequestTier::Ordinary));
        assert_eq!(tier_for_credit(66), Some(SongRequestTier::Priority));
        assert_eq!(tier_for_credit(233), Some(SongRequestTier::JumpQueue));
        assert_eq!(tier_for_credit(520), Some(SongRequestTier::Exclusive));
        assert_eq!(tier_for_credit(1999), Some(SongRequestTier::PlaylistTakeover));
    }
}
```

Add to `src/music/queue.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::priority_score;
    use crate::music::credits::SongRequestTier;

    #[test]
    fn higher_tiers_sort_above_lower_tiers() {
        let ordinary = priority_score(SongRequestTier::Ordinary, 100, 0, 0);
        let jump = priority_score(SongRequestTier::JumpQueue, 233, 0, 0);
        assert!(jump > ordinary);
    }

    #[test]
    fn repeat_penalty_reduces_score() {
        let first = priority_score(SongRequestTier::Priority, 66, 0, 0);
        let repeated = priority_score(SongRequestTier::Priority, 66, 0, 2);
        assert!(first > repeated);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test music::credits::tests music::queue::tests --lib
```

Expected: compile failure because modules do not exist.

- [ ] **Step 3: Implement credits and scoring**

Create `src/music/credits.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SongRequestTier {
    Ordinary,
    Priority,
    JumpQueue,
    Exclusive,
    PlaylistTakeover,
}

impl SongRequestTier {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ordinary => "ordinary",
            Self::Priority => "priority",
            Self::JumpQueue => "jump_queue",
            Self::Exclusive => "exclusive",
            Self::PlaylistTakeover => "playlist_takeover",
        }
    }

    pub fn base_score(self) -> i64 {
        match self {
            Self::Ordinary => 1000,
            Self::Priority => 3000,
            Self::JumpQueue => 6000,
            Self::Exclusive => 9000,
            Self::PlaylistTakeover => 12000,
        }
    }
}

pub fn tier_for_credit(value: i64) -> Option<SongRequestTier> {
    match value {
        1999.. => Some(SongRequestTier::PlaylistTakeover),
        520.. => Some(SongRequestTier::Exclusive),
        233.. => Some(SongRequestTier::JumpQueue),
        66.. => Some(SongRequestTier::Priority),
        10.. => Some(SongRequestTier::Ordinary),
        _ => None,
    }
}
```

Create `src/music/queue.rs`:

```rust
use crate::music::credits::SongRequestTier;

pub fn priority_score(tier: SongRequestTier, credit_value: i64, fan_bonus: i64, repeat_count: i64) -> i64 {
    let capped_credit = credit_value.clamp(0, 2000);
    let penalty = repeat_count.max(0) * 300;
    tier.base_score() + capped_credit + fan_bonus.clamp(0, 500) - penalty
}
```

Modify `src/music/mod.rs`:

```rust
pub mod command;
pub mod credits;
pub mod provider;
pub mod providers;
pub mod queue;
pub mod search;
pub mod storage;
pub mod types;
```

- [ ] **Step 4: Run credit and queue tests**

Run:

```bash
cargo test music::credits::tests music::queue::tests --lib
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/music/mod.rs src/music/credits.rs src/music/queue.rs
git commit -m "feat: add song request credit tiers"
```

---

## Task 6: Song Request Service

**Files:**
- Create: `src/music/service.rs`
- Modify: `src/music/mod.rs`

- [ ] **Step 1: Write service behavior tests with fake provider**

Add to `src/music/service.rs`:

```rust
#[cfg(test)]
mod tests {
    use anyhow::Result;
    use async_trait::async_trait;

    use super::{MusicInteractionService, SongServiceReply};
    use crate::music::provider::{MusicProvider, SearchOptions};
    use crate::music::types::{MusicSource, MusicTrack};

    struct FakeProvider;

    #[async_trait]
    impl MusicProvider for FakeProvider {
        fn source(&self) -> MusicSource { MusicSource::Netease }
        async fn search(&self, _keyword: &str, _options: SearchOptions) -> Result<Vec<MusicTrack>> {
            Ok(vec![MusicTrack {
                source: MusicSource::Netease,
                song_id: "186016".to_string(),
                name: "晴天".to_string(),
                artists: vec!["周杰伦".to_string()],
                album: "叶惠美".to_string(),
                pic_id: String::new(),
                url_id: "186016".to_string(),
                lyric_id: "186016".to_string(),
                duration_ms: Some(269000),
            }])
        }
        async fn song(&self, _id: &str) -> Result<Option<MusicTrack>> { Ok(None) }
        async fn url(&self, id: &str, _bitrate: u32) -> Result<Option<String>> { Ok(Some(format!("https://music.163.com/#/song?id={id}"))) }
        async fn lyric(&self, _id: &str) -> Result<Option<String>> { Ok(None) }
        async fn pic(&self, _id: &str, _size: u32) -> Result<Option<String>> { Ok(None) }
    }

    #[tokio::test]
    async fn search_without_credit_returns_candidates_and_gift_prompt() {
        let service = MusicInteractionService::new_for_tests(vec![Box::new(FakeProvider)]);
        let reply = service.handle_danmu(42, "alice", "点歌 晴天").await.expect("reply");
        assert!(matches!(reply, SongServiceReply::Candidates { .. }));
        assert!(reply.to_danmu_text().contains("点歌 #1"));
    }
}
```

- [ ] **Step 2: Run service test to verify it fails**

Run:

```bash
cargo test music::service::tests::search_without_credit_returns_candidates_and_gift_prompt --lib
```

Expected: compile failure because service module is missing.

- [ ] **Step 3: Implement minimal async service facade**

Create `src/music/service.rs`:

```rust
use anyhow::Result;

use crate::music::command::{parse_song_command, SongCommand};
use crate::music::provider::{MusicProvider, SearchOptions};
use crate::music::search::score_track;
use crate::music::types::SearchCandidate;

pub enum SongServiceReply {
    Candidates { candidates: Vec<SearchCandidate> },
    Message(String),
    Ignored,
}

impl SongServiceReply {
    pub fn to_danmu_text(&self) -> String {
        match self {
            Self::Candidates { candidates } => {
                let mut lines = vec!["找到候选：".to_string()];
                for (idx, candidate) in candidates.iter().take(3).enumerate() {
                    lines.push(format!(
                        "{}. {} - {}",
                        idx + 1,
                        candidate.track.name,
                        candidate.track.artists.join("/")
                    ));
                }
                lines.push("60秒内回复 点歌 #编号 确认".to_string());
                lines.join(" ")
            }
            Self::Message(value) => value.clone(),
            Self::Ignored => String::new(),
        }
    }
}

pub struct MusicInteractionService {
    providers: Vec<Box<dyn MusicProvider>>,
}

impl MusicInteractionService {
    pub fn new_for_tests(providers: Vec<Box<dyn MusicProvider>>) -> Self {
        Self { providers }
    }

    pub async fn handle_danmu(&self, _uid: i64, _uname: &str, text: &str) -> Result<SongServiceReply> {
        let Some(command) = parse_song_command(text) else {
            return Ok(SongServiceReply::Ignored);
        };
        match command {
            SongCommand::Search { query } => {
                let mut candidates = Vec::new();
                for provider in &self.providers {
                    let tracks = provider.search(&query, SearchOptions::default()).await?;
                    candidates.extend(tracks.iter().map(|track| score_track(&query, track)));
                }
                candidates.sort_by(|a, b| b.score.cmp(&a.score));
                candidates.truncate(3);
                Ok(SongServiceReply::Candidates { candidates })
            }
            SongCommand::Confirm { .. } => Ok(SongServiceReply::Message("候选确认将在接入存储后生效".to_string())),
            SongCommand::MoreCandidates => Ok(SongServiceReply::Message("换一批将在接入分页搜索后生效".to_string())),
            SongCommand::MyRequest => Ok(SongServiceReply::Message("你当前没有排队中的点歌".to_string())),
            SongCommand::CancelMine => Ok(SongServiceReply::Message("你当前没有可取消的点歌".to_string())),
        }
    }
}
```

Modify `src/music/mod.rs`:

```rust
pub mod command;
pub mod credits;
pub mod provider;
pub mod providers;
pub mod queue;
pub mod search;
pub mod service;
pub mod storage;
pub mod types;
```

- [ ] **Step 4: Run service test**

Run:

```bash
cargo test music::service::tests --lib
```

Expected: service test passes.

- [ ] **Step 5: Commit**

```bash
git add src/music/mod.rs src/music/service.rs
git commit -m "feat: add music interaction service facade"
```

---

## Task 7: Plugin Settings And Overlay Routes

**Files:**
- Modify: `src/plugin_settings.rs`
- Modify: `src/overlay_server.rs`
- Create: `src/music_interaction.html`

- [ ] **Step 1: Write default settings test**

Add to the existing tests section in `src/plugin_settings.rs` or create one if absent:

```rust
#[cfg(test)]
mod music_interaction_tests {
    use super::PluginSettings;

    #[test]
    fn music_interaction_defaults_are_enabled_and_compact() {
        let settings = PluginSettings::default();
        assert!(settings.music_interaction.enabled);
        assert_eq!(settings.music_interaction.skin, "compact");
        assert_eq!(settings.music_interaction.stats_range, "session");
    }
}
```

- [ ] **Step 2: Run settings test to verify it fails**

Run:

```bash
cargo test plugin_settings::music_interaction_tests::music_interaction_defaults_are_enabled_and_compact --lib
```

Expected: compile failure because `music_interaction` setting does not exist.

- [ ] **Step 3: Add settings type**

Modify `PluginSettings`:

```rust
#[serde(default)]
pub music_interaction: MusicInteractionSettings,
```

Add struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct MusicInteractionSettings {
    #[serde(default = "df_true")]
    pub enabled: bool,
    #[serde(default = "df_music_skin")]
    pub skin: String,
    #[serde(default = "df_music_stats_range")]
    pub stats_range: String,
    #[serde(default = "df_true")]
    pub transparent: bool,
    #[serde(default = "df_music_width")]
    pub width: u32,
    #[serde(default = "df_music_height")]
    pub height: u32,
    #[serde(default = "df_true")]
    pub show_cover: bool,
    #[serde(default = "df_true")]
    pub show_requester: bool,
    #[serde(default = "df_true")]
    pub show_gift_tier: bool,
    #[serde(default = "df_true")]
    pub show_queue: bool,
    #[serde(default)]
    pub show_today_value: bool,
    #[serde(default = "df_music_primary_color")]
    pub primary_color: String,
    #[serde(default = "df_font_scale")]
    pub font_scale: f32,
}
```

Add defaults:

```rust
impl Default for MusicInteractionSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            skin: df_music_skin(),
            stats_range: df_music_stats_range(),
            transparent: true,
            width: df_music_width(),
            height: df_music_height(),
            show_cover: true,
            show_requester: true,
            show_gift_tier: true,
            show_queue: true,
            show_today_value: false,
            primary_color: df_music_primary_color(),
            font_scale: df_font_scale(),
        }
    }
}

fn df_music_skin() -> String { "compact".to_string() }
fn df_music_stats_range() -> String { "session".to_string() }
fn df_music_width() -> u32 { 720 }
fn df_music_height() -> u32 { 120 }
fn df_music_primary_color() -> String { "#8b5cf6".to_string() }
fn df_font_scale() -> f32 { 1.0 }
```

Update `PluginSettings::default()` to set:

```rust
music_interaction: MusicInteractionSettings::default(),
```

- [ ] **Step 4: Add overlay HTML route**

Create `src/music_interaction.html`:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>音乐互动</title>
  <style>
    html,body{margin:0;background:transparent;font-family:PingFang SC,Microsoft YaHei,sans-serif;color:#fff}
    .wrap{box-sizing:border-box;width:100vw;height:100vh;padding:12px;display:flex;align-items:center;gap:12px;background:rgba(20,20,26,.72)}
    .cover{width:72px;height:72px;border-radius:8px;background:rgba(255,255,255,.14);flex:0 0 auto}
    .main{min-width:0;flex:1}
    .title{font-size:22px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .meta{margin-top:6px;font-size:13px;color:rgba(255,255,255,.72);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .stats{font-size:12px;color:#c4b5fd;font-weight:800}
    body.minimal .wrap{height:72px;padding:8px 12px;background:rgba(0,0,0,.35)}
    body.minimal .cover{display:none}
    body.minimal .title{font-size:18px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="cover"></div>
    <div class="main">
      <div class="stats" id="stats">本场点歌 0 电池</div>
      <div class="title" id="title">今日第一首歌等待点亮</div>
      <div class="meta" id="meta">送礼点歌后将在这里显示</div>
    </div>
  </div>
  <script>
    const params = new URLSearchParams(location.search);
    document.body.className = params.get('skin') || 'compact';
  </script>
</body>
</html>
```

Modify `src/overlay_server.rs`:

```rust
const MUSIC_INTERACTION_HTML: &str = include_str!("music_interaction.html");
```

Add routes:

```rust
.route("/song-request", get(music_interaction_handler))
.route("/song-request/playlist", get(music_interaction_handler))
.route("/song-request/now-playing", get(music_interaction_handler))
.route("/song-request/rank", get(music_interaction_handler))
```

Add handler:

```rust
async fn music_interaction_handler() -> Html<&'static str> {
    Html(MUSIC_INTERACTION_HTML)
}
```

- [ ] **Step 5: Run settings test and check**

Run:

```bash
cargo test plugin_settings::music_interaction_tests --lib
cargo check --workspace
```

Expected: tests pass and workspace checks.

- [ ] **Step 6: Commit**

```bash
git add src/plugin_settings.rs src/overlay_server.rs src/music_interaction.html
git commit -m "feat: add music interaction plugin settings"
```

---

## Task 8: Tauri Commands And API Types

**Files:**
- Modify: `src/main.rs`
- Modify: `src-tauri/src/app/lib/api.ts`

- [ ] **Step 1: Add Rust commands**

Modify `src/main.rs` near overlay URL commands:

```rust
#[cfg(feature = "tauri")]
#[tauri::command]
async fn get_music_interaction_url() -> Result<String, String> {
    let cfg = overlay_config::OverlayConfig::load_or_default().map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{}/song-request/playlist", cfg.port))
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn search_music_candidates(query: String) -> Result<Vec<music::types::SearchCandidate>, String> {
    let provider = music::providers::netease::NeteaseProvider::new(reqwest::Client::new());
    let service = music::service::MusicInteractionService::new_for_tests(vec![Box::new(provider)]);
    match service.handle_danmu(0, "preview", &format!("点歌 {query}")).await.map_err(|e| e.to_string())? {
        music::service::SongServiceReply::Candidates { candidates } => Ok(candidates),
        _ => Ok(Vec::new()),
    }
}
```

Add both commands to `tauri::generate_handler!`:

```rust
get_music_interaction_url,
search_music_candidates,
```

- [ ] **Step 2: Add TypeScript API types**

Modify `src-tauri/src/app/lib/api.ts`:

```ts
export interface MusicInteractionSettings {
  Enabled: boolean;
  Skin: string;
  StatsRange: string;
  Transparent: boolean;
  Width: number;
  Height: number;
  ShowCover: boolean;
  ShowRequester: boolean;
  ShowGiftTier: boolean;
  ShowQueue: boolean;
  ShowTodayValue: boolean;
  PrimaryColor: string;
  FontScale: number;
}

export interface MusicTrack {
  source: 'Netease' | 'Tencent' | 'Kugou' | 'Baidu' | 'Kuwo';
  song_id: string;
  name: string;
  artists: string[];
  album: string;
  pic_id: string;
  url_id: string;
  lyric_id: string;
  duration_ms: number | null;
}

export interface SearchCandidate {
  track: MusicTrack;
  score: number;
  reason: string;
}
```

Add to `PluginSettings`:

```ts
MusicInteraction: MusicInteractionSettings;
```

Add API wrappers:

```ts
getMusicInteractionUrl: () => invoke<string>('get_music_interaction_url'),
searchMusicCandidates: (query: string) => invoke<SearchCandidate[]>('search_music_candidates', { query }),
```

- [ ] **Step 3: Run compile checks**

Run:

```bash
cargo check --workspace
npm run lint --prefix src-tauri
```

Expected: Rust check passes; frontend lint passes or reports only pre-existing unrelated warnings.

- [ ] **Step 4: Commit**

```bash
git add src/main.rs src-tauri/src/app/lib/api.ts
git commit -m "feat: expose music interaction commands"
```

---

## Task 9: Plugin Center UI Menu And Page

**Files:**
- Create: `src-tauri/src/app/pages/MusicInteraction.tsx`
- Modify: `src-tauri/src/app/components/Sidebar.tsx`
- Modify: `src-tauri/src/app/App.tsx`

- [ ] **Step 1: Add page component**

Create `src-tauri/src/app/pages/MusicInteraction.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Copy, Music2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, PluginSettings, SearchCandidate } from '../lib/api';
import { Button } from '../components/Button';
import { GlassCard } from '../components/GlassCard';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';

const fallbackMusic = {
  Enabled: true,
  Skin: 'compact',
  StatsRange: 'session',
  Transparent: true,
  Width: 720,
  Height: 120,
  ShowCover: true,
  ShowRequester: true,
  ShowGiftTier: true,
  ShowQueue: true,
  ShowTodayValue: false,
  PrimaryColor: '#8b5cf6',
  FontScale: 1,
};

export function MusicInteraction() {
  const [config, setConfig] = useState<PluginSettings | null>(null);
  const [overlayUrl, setOverlayUrl] = useState('');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  const music = useMemo(() => config?.MusicInteraction ?? fallbackMusic, [config]);

  useEffect(() => {
    api.loadPluginSettings().then(next => {
      setConfig({ ...next, MusicInteraction: next.MusicInteraction ?? fallbackMusic });
    }).catch(err => toast.error(String(err)));
    api.getMusicInteractionUrl().then(setOverlayUrl).catch(() => {});
  }, []);

  const saveMusic = async (patch: Partial<typeof fallbackMusic>) => {
    if (!config) return;
    const next = { ...config, MusicInteraction: { ...music, ...patch } };
    setConfig(next);
    await api.savePluginSettings(next);
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      setCandidates(await api.searchMusicCandidates(query.trim()));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSearching(false);
    }
  };

  const copyUrl = async () => {
    await navigator.clipboard.writeText(overlayUrl);
    toast.success('已复制 OBS 地址');
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-black tracking-tight flex items-center gap-2"><Music2 className="w-5 h-5" />音乐互动</h1>
          <p className="text-[12px] text-[var(--muted-text)] mt-1">点歌、队列、收益和 OBS 歌单投放</p>
        </div>
        <Toggle checked={music.Enabled} onChange={() => saveMusic({ Enabled: !music.Enabled })} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_.9fr] gap-4">
        <GlassCard className="p-4 space-y-3">
          <div className="text-[13px] font-black">搜索测试</div>
          <div className="flex gap-2">
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="点歌 晴天 周杰伦" className="h-10" />
            <Button onClick={search} disabled={searching}><Search className="w-4 h-4 mr-1" />搜索</Button>
          </div>
          <div className="space-y-2">
            {candidates.map((item, idx) => (
              <div key={`${item.track.source}-${item.track.song_id}`} className="rounded-lg border border-black/5 dark:border-white/10 p-3 bg-white/60 dark:bg-white/5">
                <div className="text-[12px] font-black">{idx + 1}. {item.track.name} - {item.track.artists.join('/') || '未知歌手'}</div>
                <div className="text-[11px] text-[var(--muted-text)] mt-1">{item.track.album} · {item.reason} · {item.score}</div>
              </div>
            ))}
            {candidates.length === 0 && <div className="text-[12px] text-[var(--muted-text)] py-8 text-center">输入关键词测试 Rust 音乐搜索</div>}
          </div>
        </GlassCard>

        <GlassCard className="p-4 space-y-4">
          <div className="text-[13px] font-black">OBS 投放</div>
          <div className="rounded-lg bg-black/5 dark:bg-white/5 p-3 text-[11px] break-all">{overlayUrl || '启动浮层服务后生成地址'}</div>
          <Button onClick={copyUrl} disabled={!overlayUrl}><Copy className="w-4 h-4 mr-1" />复制地址</Button>
          <div className="grid grid-cols-2 gap-2">
            {['compact', 'minimal'].map(skin => (
              <button key={skin} onClick={() => saveMusic({ Skin: skin })} className={`h-9 rounded-lg text-[12px] font-bold border ${music.Skin === skin ? 'border-[var(--primary-color)] text-[var(--primary-color)]' : 'border-black/10 dark:border-white/10'}`}>
                {skin}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => api.getMusicInteractionUrl().then(setOverlayUrl)}>
            <RefreshCw className="w-4 h-4 mr-1" />刷新地址
          </Button>
        </GlassCard>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Insert sidebar menu in second plugin position**

Modify plugin children in `src-tauri/src/app/components/Sidebar.tsx`:

```ts
children: [
  { path: '/plugins/chat-overlay', label: '弹幕聊天' },
  { path: '/plugins/music-interaction', label: '音乐互动' },
  { path: '/plugins/wish-goal', label: '心愿目标' },
  { path: '/plugins/lottery', label: '抽奖互动' },
  { path: '/plugins/gift-effect', label: '礼物特效' },
  { path: '/plugins/recent-gifts', label: '最近礼物' },
  { path: '/plugins/gift-rank', label: '礼物排行' },
],
```

- [ ] **Step 3: Add route**

Modify imports in `src-tauri/src/app/App.tsx`:

```ts
import { MusicInteraction } from './pages/MusicInteraction';
```

Add route:

```tsx
<Route path="/plugins/music-interaction" element={<MusicInteraction />} />
```

- [ ] **Step 4: Run frontend checks**

Run:

```bash
npm run lint --prefix src-tauri
```

Expected: lint passes or only reports pre-existing unrelated warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/app/pages/MusicInteraction.tsx src-tauri/src/app/components/Sidebar.tsx src-tauri/src/app/App.tsx
git commit -m "feat: add music interaction plugin page"
```

---

## Task 10: Monitor Event Integration

**Files:**
- Modify: `src/bot/monitor.rs`
- Modify: `src/music/service.rs`

- [ ] **Step 1: Add event handling method**

Extend `MusicInteractionService` with a gift-aware event method:

```rust
use bilibili_live_protocol::LiveEvent;

impl MusicInteractionService {
    pub async fn handle_live_event(&self, event: &LiveEvent) -> Result<SongServiceReply> {
        match event {
            LiveEvent::Danmu { user_id, user, text } => self.handle_danmu(*user_id, user, text).await,
            LiveEvent::Gift { user, gift, count, price, .. } => {
                let total = count.saturating_mul(*price);
                Ok(SongServiceReply::Message(format!("感谢 {user} 的 {gift} x{count}，已获得 {total} 电池点歌权益")))
            }
            LiveEvent::SuperChat { user, price, .. } => {
                Ok(SongServiceReply::Message(format!("感谢 {user} 的 SC，已获得 {price} 电池点歌权益")))
            }
            _ => Ok(SongServiceReply::Ignored),
        }
    }
}
```

- [ ] **Step 2: Hook monitor loop without blocking event parsing**

In `src/bot/monitor.rs`, inside the parsed event callback after the existing `replies` loop and before AI handling, create an async task:

```rust
if matches!(
    event,
    bilibili_live_protocol::LiveEvent::Danmu { .. }
        | bilibili_live_protocol::LiveEvent::Gift { .. }
        | bilibili_live_protocol::LiveEvent::SuperChat { .. }
) {
    let music_event = event.clone();
    let music_tx = event_tx.clone();
    tokio::spawn(async move {
        let provider = crate::music::providers::netease::NeteaseProvider::new(reqwest::Client::new());
        let service = crate::music::service::MusicInteractionService::new_for_tests(vec![Box::new(provider)]);
        if let Ok(reply) = service.handle_live_event(&music_event).await {
            let text = reply.to_danmu_text();
            if !text.is_empty() {
                let _ = music_tx.send(text).await;
            }
        }
    });
}
```

This is intentionally simple for the first integration. A follow-up optimization can move service construction into shared state to reuse HTTP clients and storage.

- [ ] **Step 3: Run Rust checks**

Run:

```bash
cargo check --workspace
```

Expected: workspace checks.

- [ ] **Step 4: Commit**

```bash
git add src/bot/monitor.rs src/music/service.rs
git commit -m "feat: route live events to music interaction"
```

---

## Task 11: URL Scheme Safety

**Files:**
- Create: `src/music/opener.rs`
- Modify: `src/music/mod.rs`

- [ ] **Step 1: Write URL template safety tests**

Add to `src/music/opener.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::{build_open_url, is_allowed_open_url};

    #[test]
    fn allows_configured_music_and_https_urls() {
        assert!(is_allowed_open_url("orpheus://song/186016"));
        assert!(is_allowed_open_url("https://music.163.com/#/song?id=186016"));
    }

    #[test]
    fn rejects_non_music_system_urls() {
        assert!(!is_allowed_open_url("file:///etc/passwd"));
        assert!(!is_allowed_open_url("x-apple.systempreferences://"));
    }

    #[test]
    fn builds_netease_url_from_song_id() {
        assert_eq!(
            build_open_url("https://music.163.com/#/song?id={song_id}", "186016").unwrap(),
            "https://music.163.com/#/song?id=186016"
        );
    }
}
```

- [ ] **Step 2: Run opener test to verify it fails**

Run:

```bash
cargo test music::opener::tests --lib
```

Expected: compile failure because opener module is missing.

- [ ] **Step 3: Implement opener helpers**

Create `src/music/opener.rs`:

```rust
use anyhow::{anyhow, Result};

pub fn build_open_url(template: &str, song_id: &str) -> Result<String> {
    if song_id.chars().any(|ch| !(ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')) {
        return Err(anyhow!("invalid song id"));
    }
    let url = template.replace("{song_id}", song_id);
    if !is_allowed_open_url(&url) {
        return Err(anyhow!("open url scheme is not allowed"));
    }
    Ok(url)
}

pub fn is_allowed_open_url(url: &str) -> bool {
    url.starts_with("https://music.163.com/")
        || url.starts_with("https://y.qq.com/")
        || url.starts_with("orpheus://")
        || url.starts_with("qqmusic://")
}
```

Modify `src/music/mod.rs`:

```rust
pub mod opener;
```

- [ ] **Step 4: Run opener tests**

Run:

```bash
cargo test music::opener::tests --lib
```

Expected: opener tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/music/mod.rs src/music/opener.rs
git commit -m "feat: validate music open urls"
```

---

## Task 12: Final Verification

**Files:**
- All files changed in previous tasks.

- [ ] **Step 1: Run focused Rust tests**

Run:

```bash
cargo test music:: --lib
```

Expected: all `music::` tests pass.

- [ ] **Step 2: Run workspace checks**

Run:

```bash
cargo fmt --check
cargo check --workspace
cargo test --workspace
npm run lint --prefix src-tauri
```

Expected: all commands pass. If `npm run lint --prefix src-tauri` reports existing warnings unrelated to music interaction, record the exact warning names in the implementation handoff.

- [ ] **Step 3: Manual UI smoke test**

Run:

```bash
cargo run --features tauri
```

Expected manual checks:

- Plugin center submenu shows `音乐互动` as the second child under `插件中心`.
- Opening `音乐互动` shows the search test, OBS URL, skin selector, and enabled toggle.
- Searching `晴天 周杰伦` returns candidate rows or a visible error toast when the external platform rejects the request.
- `http://127.0.0.1:<OverlayPort>/song-request/playlist?skin=compact&transparent=1` renders a transparent OBS-safe page.
- `http://127.0.0.1:<OverlayPort>/song-request/playlist?skin=minimal&transparent=1` renders the compact minimal layout.

- [ ] **Step 4: Commit verification fixes**

If formatting or lint required edits:

```bash
git add src src-tauri Cargo.toml Cargo.lock
git commit -m "chore: verify music interaction"
```

If no edits were needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Plugin center second menu named `音乐互动`: Task 9.
- Rust implementation of Meting-style capabilities without copying code: Tasks 2 and 3.
- Extensibility for providers: Task 2 trait and source enum.
- Gift tiers,插队,专属,包场 foundation: Task 5.
- User confirmation path: Tasks 1, 3, and 6.
- OBS/web playlist: Task 7 and Task 9.
- URL Scheme safety: Task 11.
- Session/today statistics schema foundation: Task 4.

Implementation risk:

- NetEase public endpoints can change; provider tests use fixtures so mapping remains testable without network.
- The first monitor integration constructs a service per event. It is acceptable for MVP verification but should be replaced with a shared service if load becomes high.
- Full persistent queue behavior requires follow-up methods in `src/music/storage.rs`; Task 4 creates the schema, and Tasks 6/10 establish the integration points.
