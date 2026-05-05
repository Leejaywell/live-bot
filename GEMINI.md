# GEMINI.md

This file provides context and instructions for AI agents working in this repository.

## Project Overview

**Live Bot** (Bilibili Danmu Robot RS) is a Bilibili live-room interaction assistant rewritten in Rust. It observes live-room events (danmu, gifts, etc.) via WebSocket, applies configured automation rules, and persists interaction data to a local SQLite database.

- **Primary Platform:** Bilibili (Live Room Interaction).
- **Core Tech Stack:** Rust, Slint (UI), Tauri (UI Shell), SQLite (Storage), Tokio (Async).
- **Key Features:** Automated welcome/thanks, keyword replies, AI responses (ChatGPT/QingYunKe), timed danmu, sign-in, lottery, and interaction data analysis.

## Project Structure

- `crates/bilibili-live-protocol`: Pure WebSocket protocol handling for Bilibili live events.
- `src/api.rs`: Bilibili HTTP API client (Login, Room info, Send danmu).
- `src/bot/`: Robot engine and interaction rules.
- `src/storage/`: SQLite database schema, migrations, and query logic.
- `src/config.rs`: YAML configuration (compatible with legacy formats).
- `src/token.rs`: Cookie/Token persistence.
- `src/main.rs`: Application entry point and UI callback wiring.
- `ui/main.slint`: UI definitions and components.

## Building and Running

The project supports two UI backends via Cargo features: **Tauri** (default) and **Slint**.

### Commands

- **Run (Tauri):** `cargo run`
- **Run (Slint Native):** `cargo run --features slint --no-default-features`
- **Build (Release):** `cargo build --release`
- **Test:** `cargo test --workspace`
- **Lint:** `cargo fmt --check && cargo check --workspace`

### First Launch
On first run, the app creates several directories next to the working directory:
- `etc/`: Configuration files (`bilidanmaku-api.yaml`).
- `token/`: Auth tokens.
- `logs/`: Runtime logs.
- `db/`: SQLite database.

## Development Conventions

### Domain Language (See CONTEXT.md)
- **Live Session**: Boundary defined by room live/offline status (persists across app restarts).
- **Interaction Record**: Persisted fact derived from a live event (includes original raw JSON).
- **Danmu Reply**: Message sent by the bot in response to events.
- **Interaction Rule**: Behavior logic (welcome, keyword, etc.).

### Architecture & Style
- **Config Compatibility**: YAML fields use `PascalCase` (via `#[serde(rename_all = "PascalCase")]`) to match legacy projects.
- **SQLite Storage**: Access is synchronous and serialized via `Mutex<Connection>` in `src/storage/mod.rs`.
- **Event Handling**: WebSocket notifications are parsed into `ParsedLiveEvent { event, raw }`. Raw JSON **must** be preserved in storage.
- **Locale**: UI and logs are primarily in Chinese. Keep new strings consistent.
- **Error Handling**: Interaction record write failures should be logged but should not stop rule execution.

## Documentation References
- `CONTEXT.md`: Detailed domain language and product framing.
- `CLAUDE.md`: Technical guide for AI tools.
- `docs/roadmap.md`: Current implementation focus and confirmed decisions.
- `README.md`: General overview and TODO list.
