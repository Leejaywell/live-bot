# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A single-room Bilibili live-room interaction assistant written in Rust. It observes one Bilibili live room over WebSocket, runs configured automation rules against the event stream (welcome, thanks, keyword reply, AI reply, timed danmu, sign-in, lottery), and persists interaction facts to local SQLite. Domain language and product framing are defined in `CONTEXT.md` and `docs/roadmap.md` — read them before adding features. In particular: a "Live Session" follows the room's live/offline boundary, **not** the app process lifecycle, and interaction records (not the legacy danmu count) are the long-term source of historical event facts.

## Build / run / verify

The repo is a Cargo workspace with one root crate (`bili_danmu_robot_rs`, single binary at `src/main.rs`) and one workspace member (`crates/bilibili-live-protocol`). The desktop shell supports both **Tauri** and **Slint native** backends via Cargo features.

```bash
# Tauri (default)
cargo run
cargo build --release

# Slint
cargo run --features slint --no-default-features
cargo build --release --features slint --no-default-features
```

`build.rs` compiles `ui/main.slint` via `slint_build::compile` when the `slint` feature is enabled, or runs `tauri_build::build()` when `tauri` is enabled.

Verification commands:

```bash
cargo fmt --check
cargo check --workspace
cargo test --workspace
```

Run a single test:

```bash
cargo test --workspace <test_name_substring>
cargo test -p bilibili-live-protocol <test_name_substring>
```

First launch creates `etc/`, `token/`, `logs/`, `downloads/` next to the binary's working dir.

## Architecture

### Layered crates

- `crates/bilibili-live-protocol` — pure WebSocket protocol crate (handshake, zlib/brotli framing, heartbeat, notification parsing). Public types include `LiveEvent` (normalized), `ParsedLiveEvent { event, raw }` (event + original JSON payload), and connection helpers. **Per ADR `docs/adr/0001-...md`, raw JSON is preserved at this boundary** so storage can keep the original payload while rules keep using `LiveEvent`. Don't fold raw JSON into `LiveEvent` itself.
- Root crate — Bilibili HTTP API (`src/api.rs`), TOML config (`src/config.rs`), token persistence (`src/token.rs`), SQLite storage (`src/storage/mod.rs`), bot rules (`src/bot/`), and the Slint UI shell (`src/main.rs` + `ui/main.slint`).

### Event and data loop

The current milestone (see `docs/roadmap.md` "Next Milestone: Event And Data Loop") wires recording into the monitor loop:

1. WebSocket notifications are decoded into `ParsedLiveEvent` by the protocol crate.
2. `bot::record_and_handle_event` in `src/bot/mod.rs` writes one `interaction_records` row via `Storage::record_interaction`, then invokes `BotEngine::handle_event` for rule output. Recording failures are logged but **must not** stop rule handling.
3. `bot::update_observed_session_for_room_status` opens/closes a `live_sessions` row when the room transitions live↔offline. Restart while still live must resume the existing session, not start a new one.
4. `BotEngine` (`src/bot/engine.rs`) is the single dispatcher: blacklist → danmu filter → tracking → rules (`newcomer_notice`, `help`, `keyword_reply`, `draw_by_lot`, `sign_in`, `welcome`, `thanks`, `pk_and_activity_notice`). Rules return `Vec<String>` (danmu replies) which the sender layer rate-limits and length-splits.

### Storage

`src/storage/mod.rs` (~1600 lines) holds the schema, migrations, and all query/write entry points. SQLite access is synchronous and serialized via `Mutex<Connection>`. Notable shape:

- `interaction_records` is one wide table keyed by `session_id`, with normalized columns plus a raw-JSON column. Unknown notification commands are persisted with raw JSON only.
- `live_sessions` tracks room id, start/end time, and whether times were observed or official.
- The legacy `danmu_count` table is kept in parallel; do not yet route the `查询弹幕` reply through `interaction_records`.
- Tests use `Storage::open_in_memory()`. The DB path in production comes from `AppConfig::db_path` + `db_name`; the default checked-in DB lives at `db/sqliteDataBase.db`.

### Config

`etc/bilidanmaku-api.toml`, deserialized by `AppConfig`. Field names use **PascalCase** via `#[serde(rename_all = "PascalCase")]` for compatibility with the upstream `xbclub/BilibiliDanmuRobot` config. New fields should add `#[serde(default)]` to keep older configs loadable.

### Slint UI shell

`src/main.rs` owns the runtime: a `tokio::Runtime` for async work, a `BiliApi` HTTP client, and a `MonitorHandle` (cancel token + tokio task) for the live WebSocket. UI callbacks (`load_config`, `save_config`, `start_login`, `check_login`, `check_room`, `start_monitor`, `stop_monitor`, `send_danmu`, `query_user_detail`, `check_update`, `download_update`) are wired in `wire_callbacks` and dispatch back into Slint via the `MainWindow` weak handle. UI definitions and design tokens live in `ui/main.slint` (~1100 lines, including `Glass`, `Btn`, `Toggle`, `NavItem`, `AutoCard`, `StatTile` components).

## Working notes

- Read `docs/roadmap.md` "Confirmed Decisions" before making structural changes — many shape choices (one wide `interaction_records` table, observed vs. official session times, synchronous SQLite, keeping legacy danmu count) are deliberate and called out as such.
- The reference project `BilibiliDanmuRobot/` (vendored at the repo root) and `/Users/lee/workspaces/clang/Bilibili-MagicalDanmaku` are read-only references for porting features — they aren't built by this workspace.
- The README lives in Chinese; UI strings and log messages are also Chinese. Keep new user-facing strings consistent with the surrounding locale.
- Design prompts for the Slint UI live in `docs/stitch/slint.md` and `docs/figma/slint.md` (中文 + 英文版各一份)。
