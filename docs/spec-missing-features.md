# Spec: Complete Missing Danmu Robot Features

## Assumptions

1. The target is feature parity with `xbclub/BilibiliDanmuRobot` for the common desktop workflow, not Docker/CLI parity in this phase.
2. The Rust + Slint app remains the primary product; the Go/Wails code is only a behavior reference.
3. The standalone `bilibili-live-protocol` crate owns Bilibili websocket packet transport and event parsing only; it does not send danmu or implement business rules.
4. HTTP login, room metadata, user info and danmu sending stay in the app crate for now.
5. SQLite-backed features use `rusqlite`; schema should be small and local to `db/`.
6. External AI support will keep the original two modes: QingYunKe and ChatGPT-compatible API.
7. PK, red-pocket, anchor-lottery, auto-update checks and UI list editing are included in this milestone.

Correct these before implementation if any are wrong.

## Objective

Build the missing runtime behavior for the Rust + Slint rewrite so it can operate as a practical Bilibili live-room danmu robot:

- React to live websocket events with configurable welcome, thanks, keyword, AI, draw and sign-in behaviors.
- Send generated responses through the existing Bilibili danmu send API.
- Keep behavior compatible with the existing YAML config shape where feasible.
- Expose enough UI controls for day-to-day use without requiring manual YAML editing for common lists.

Success means a user can log in, select a room, start monitoring, and have the bot automatically process live events according to saved configuration.

## Tech Stack

- Rust 1.94.1, edition 2024.
- Slint 1.16.1 for desktop UI.
- Tokio 1.48 for async runtime.
- Reqwest 0.12 with rustls for Bilibili HTTP APIs.
- `bilibili-live-protocol` workspace crate for websocket packet handling.
- Proposed additions:
  - `tokio-util` 0.7 for cancellation tokens.
  - `rand` 0.10 for random response selection.
  - `cron` 0.16 for timed danmu scheduling.
  - `rusqlite` 0.39 for local SQLite sign-in/danmu-count/blind-box persistence.

## Commands

Build:

```bash
cargo build --workspace
```

Check:

```bash
cargo check --workspace
```

Format:

```bash
cargo fmt --check
```

Test:

```bash
cargo test --workspace
```

Run desktop app:

```bash
cargo run
```

## Project Structure

```text
crates/bilibili-live-protocol/
  src/lib.rs              -> Bilibili websocket packet encode/decode, live event types, client loop

src/
  api.rs                  -> Bilibili HTTP APIs: login, room, user, send danmu, AI HTTP clients if kept simple
  config.rs               -> YAML-compatible app configuration
  main.rs                 -> Slint wiring, app lifecycle, task orchestration
  token.rs                -> Token persistence
  bot/
    mod.rs                -> Bot runtime coordinator
    context.rs            -> Shared runtime state: config, sender, user/room ids, cancellation
    engine.rs             -> Event routing and rule execution
    sender.rs             -> Queue, chunking, rate limiting and danmu send retry
    welcome.rs            -> Welcome/entry/high-wealthy rules
    thanks.rs             -> Gift/focus/share thanks rules and delayed aggregation
    keyword.rs            -> Keyword reply rules
  ai.rs                 -> QingYunKe and ChatGPT-compatible reply rules
  pk.rs                 -> PK event notices and opponent/visitor recognition
  lottery.rs            -> Anchor lottery and red-pocket event handling
  update.rs             -> Auto-update check/download orchestration
    timed.rs              -> Cron danmu scheduler
    draw.rs               -> Draw-by-lot command
    signin.rs             -> Sign-in command and persistence
    stats.rs              -> Danmu count and blind-box statistics
  storage/
    mod.rs                -> SQLite connection and migrations
    models.rs             -> Persistent records

ui/
  main.slint              -> Main window and common config controls

docs/
  spec-missing-features.md -> This spec
```

## Code Style

Prefer small, typed rule modules with explicit inputs and side effects hidden behind traits.

```rust
pub trait DanmuSender: Send + Sync {
    async fn send(&self, message: &str, reply: Option<ReplyTarget>) -> anyhow::Result<()>;
}

pub struct KeywordRule {
    replies: BTreeMap<String, String>,
}

impl KeywordRule {
    pub async fn handle(&self, event: &LiveEvent, sender: &dyn DanmuSender) -> anyhow::Result<()> {
        let LiveEvent::Danmu { text, .. } = event else {
            return Ok(());
        };

        if let Some(reply) = self.replies.get(text) {
            sender.send(reply, None).await?;
        }

        Ok(())
    }
}
```

Conventions:

- Public protocol/package types are English and stable: `LiveEvent`, `ConnectConfig`, `DanmuSender`.
- User-facing strings may be Chinese because the product is Chinese-language.
- Business rules should not call Slint APIs directly.
- UI callbacks should start/stop runtime components, not contain rule logic.
- All long-running tasks must have cancellation.

## Testing Strategy

- Protocol crate:
  - Unit tests for packet building, split parsing, plain/zlib/brotli decode, event extraction.
  - No live network dependency in tests.
- Bot rule modules:
  - Unit tests with fake `DanmuSender`.
  - Test each rule with enabled/disabled config, matching/non-matching events and edge cases.
- Sender:
  - Unit tests for message chunking by `DanmuLen`.
  - Retry behavior tested with a fake HTTP sender.
- Storage:
  - SQLite tests use temporary files or in-memory DB.
  - Migration tests verify tables are created idempotently.
- App wiring:
  - `cargo check --workspace` is required.
  - Manual smoke test: login, start monitor, receive logs, send manual danmu.

Coverage target for new rule code: meaningful branch coverage for each rule, not a numeric coverage gate.

## Boundaries

Always:

- Keep `cargo fmt --check`, `cargo check --workspace`, and `cargo test --workspace` passing.
- Preserve the existing YAML field names unless a spec update explicitly changes them.
- Add tests for each new rule module before or alongside implementation.
- Route UI updates through the Slint event loop.
- Avoid logging cookies, tokens, CSRF values or API keys.

Ask first:

- Adding new external services or changing AI provider semantics.
- Changing config file format in a backwards-incompatible way.
- Adding a database dependency if `rusqlite` vs `sqlx` matters to distribution size.
- Implementing Windows/macOS installers or auto-update.
- Making live API calls in automated tests.

Never:

- Commit token files, database files, logs or secrets.
- Put business rule logic in `.slint`.
- Block the UI thread with HTTP, websocket, cron or database work.
- Remove original-config compatibility without an explicit migration plan.
- Depend on the old Go core at runtime.

## Success Criteria

Phase 1: Runtime Foundation

- Start/stop monitor cancels both room-status polling and websocket tasks.
- Websocket reconnects with host fallback and retry delay.
- A central send queue chunks messages by `DanmuLen`, rate-limits sends and logs failures.
- Verification: unit tests for chunking and cancellation-safe sender; `cargo test --workspace`.

Phase 2: Event Parity Core

- Welcome rules support ordinary entry, entry effect, high-wealthy welcome, specified-user welcome, time-based welcome and blacklist filtering.
- Thanks rules support focus, share and gift thanks with delayed gift aggregation and optional `@`.
- Keyword reply works from `KeywordReplyList`.
- Verification: rule unit tests cover enabled/disabled and matching/non-matching cases.

Phase 3: Interactive Commands

- AI robot supports QingYunKe and ChatGPT-compatible APIs, exact/fuzzy trigger and length limiting.
- Draw-by-lot command replies from `DrawLotsList`.
- Sign-in command persists daily sign-in state.
- Danmu-count reminder and blind-box statistics persist to SQLite.
- Verification: unit tests with fake HTTP/SQLite; manual smoke test in one live room.

Phase 4: UI Completion

- Slint UI can edit common list configs: welcome messages, blacklists, keyword replies, cron danmu and draw list.
- UI can show login status, room status, websocket status and send-queue failures.
- Verification: `cargo check --workspace`; manual UI smoke test.

## Open Questions

Resolved by user:

1. Target full parity directly, implemented incrementally by dependency order.
2. Use SQLite; implementation chooses `rusqlite` for local desktop simplicity.
3. Keep the existing ChatGPT default unless changed by config.
4. Build UI list editing in this milestone.
5. Include PK, red-pocket, anchor-lottery and auto-update in this milestone.

## Implementation Plan

1. Introduce `bot` runtime foundation.
   - Add cancellation token, event loop ownership, send queue and fake sender tests.
   - Replace ad hoc monitor spawning in `main.rs` with `BotRuntime`.

2. Expand `bilibili-live-protocol` events.
   - Add event structs for focus/share, entry-effect, PK, block, blind-box-relevant gift fields and raw command fallback.
   - Keep raw JSON available for commands not modeled yet.

3. Implement core rules.
   - Welcome, thanks and keyword rules first because they depend only on config and sender.
   - Add deterministic tests by injecting random chooser or seedable RNG.

4. Add command/AI rules.
   - Draw and sign-in are local.
   - AI uses HTTP clients with trait boundaries and fake tests.

5. Add storage.
   - Migrations, sign-in table, danmu count table and blind-box stats table.

6. Complete UI controls.
   - Move from single-field form to editable list models for repeated config sections.

## Task Breakdown

- [x] Task: Add bot runtime coordinator and cancellation.
  - Acceptance: one start call launches websocket, room polling and sender queue; one stop cancels all.
  - Verify: `cargo test --workspace`; manual start/stop shows no continuing logs.
  - Files: `src/main.rs`, `src/bot/mod.rs`, `src/bot/context.rs`, `src/bot/engine.rs`.

- [x] Task: Add send queue with chunking and rate limiting.
  - Acceptance: messages longer than `DanmuLen` are split by Unicode scalar boundaries and sent sequentially.
  - Verify: unit tests for ASCII and Chinese text chunking.
  - Files: `src/bot/sender.rs`, `src/api.rs`.

- [x] Task: Expand protocol event model.
  - Acceptance: protocol crate emits typed events for danmu, gift, entry, entry effect, focus/share and command fallback.
  - Verify: protocol unit tests with fixture JSON packets.
  - Files: `crates/bilibili-live-protocol/src/lib.rs`.

- [x] Task: Implement keyword replies.
  - Acceptance: exact keyword match sends configured reply only when `KeywordReply` is enabled.
  - Verify: unit tests with fake sender.
  - Files: `src/bot/keyword.rs`, `src/bot/engine.rs`.

- [x] Task: Implement welcome rules.
  - Acceptance: ordinary entry, specified UID welcome, blacklist filtering and time-based welcome work.
  - Verify: unit tests for each branch.
  - Files: `src/bot/welcome.rs`, `src/bot/engine.rs`, `src/config.rs`.

- [x] Task: Implement thanks rules.
  - Acceptance: focus/share/gift thanks send configured messages; gift events aggregate within timeout.
  - Verify: unit tests cover focus/share replies, delayed gift aggregation and blind-box accounting.
  - Files: `src/bot/thanks.rs`, `src/bot/engine.rs`.

- [x] Task: Implement timed danmu.
  - Acceptance: enabled cron entries schedule random or sequential danmu.
  - Verify: unit tests for selection logic; manual short cron smoke test.
  - Files: `src/bot/timed.rs`, `src/bot/context.rs`.

- [x] Task: Implement draw and sign-in commands.
  - Acceptance: configured commands reply, sign-in is once per user per day.
  - Verify: unit tests with temporary SQLite DB.
  - Files: `src/bot/draw.rs`, `src/bot/signin.rs`, `src/storage/mod.rs`.

- [x] Task: Implement AI robot rules.
  - Acceptance: exact/fuzzy trigger works for QingYunKe and ChatGPT-compatible mode.
  - Verify: fake HTTP tests; no real API keys in tests.
  - Files: `src/bot/ai.rs`, `src/api.rs`, `src/bot/engine.rs`.

- [x] Task: Add UI list editors.
  - Acceptance: common repeated config lists can be edited and saved from Slint.
  - Verify: manual UI smoke test; config round-trip test if models are extracted.
  - Files: `ui/main.slint`, `src/main.rs`, `src/config.rs`.

- [x] Task: Add delayed gift aggregation and blind-box profit/loss summaries.
  - Acceptance: gift events aggregate within `ThanksGiftTimeout`, blind-box profit/loss is stored and summarized.
  - Verify: Tokio time-control tests and SQLite storage tests.
  - Files: `src/bot/thanks.rs`, `src/bot/stats.rs`, `src/storage/mod.rs`.

- [x] Task: Implement AI robot rules.
  - Acceptance: exact/fuzzy trigger works for QingYunKe and ChatGPT-compatible mode.
  - Verify: fake HTTP tests; no real API keys in tests.
  - Files: `src/bot/ai.rs`, `src/api.rs`, `src/bot/engine.rs`.

- [x] Task: Implement timed danmu scheduler.
  - Acceptance: enabled cron entries schedule random or sequential danmu.
  - Verify: unit tests for selection logic; manual short cron smoke test.
  - Files: `src/bot/timed.rs`, `src/bot/context.rs`.

- [x] Task: Complete PK/red-pocket/anchor-lottery behavior.
  - Acceptance: PK details, red-pocket notices and anchor-lottery state changes match original behavior where event payload contains enough data.
  - Verify: protocol fixture tests and rule tests.
  - Files: `crates/bilibili-live-protocol/src/lib.rs`, `src/bot/pk.rs`, `src/bot/lottery.rs`.

- [x] Task: Implement auto-update check/download UI flow.
  - Acceptance: app can check update metadata, display changelog/link and download the original updater helper without blocking UI.
  - Verify: fake HTTP tests and manual UI smoke test.
  - Files: `src/api.rs`, `src/bot/update.rs`, `ui/main.slint`, `src/main.rs`.
