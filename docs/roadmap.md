# Roadmap

This project is a Bilibili-focused live-room interaction assistant. The next stage prioritizes a reliable event and data loop before adding broader UI, AI, room-management, or multi-platform capabilities.

## Current Direction

The product is not being planned as a multi-platform live-operations platform in the next stage. It should first become a dependable single-room Bilibili assistant that can observe live events, respond with configured danmu behavior, and persist enough local facts to support session summaries and user lookup.

## Confirmed Decisions

- The next stage focuses on event and data loop work before UI expansion.
- A live session is one continuous period from a Bilibili room going live until that room goes offline.
- App restart, monitor stop, or websocket reconnect does not create a new live session if the room is still live.
- Interaction records keep both stable normalized fields and the original Bilibili event payload.
- The protocol crate should expose a wrapper such as `ParsedLiveEvent { event, raw }` so existing rules can keep using normalized `LiveEvent` values.
- Notification-style live events should be persisted, including unknown commands.
- Protocol heartbeats, connection logs, and handshake traffic are not interaction records.
- The first storage shape uses one `interaction_records` table rather than one table per event type.
- `live_sessions` stores session metadata such as room ID, start/end time, and whether the times were official or observed.
- The first implementation keeps synchronous SQLite writes through explicit `Storage` entry points.
- Interaction record write failure is logged but does not stop existing interaction rules.
- The existing danmu count table remains in parallel until interaction records are proven stable.

## Next Milestone: Event And Data Loop

### Goal

Persist live-room interaction facts in a way that can support session summaries, user detail views, later analysis, and future reprocessing when Bilibili fields change.

### Scope

1. Add `ParsedLiveEvent`.
   - The protocol crate should preserve raw notification JSON alongside the existing normalized event.
   - Existing rule handling should continue to use `LiveEvent`.

2. Add live session storage.
   - Create or resume a live session when a room is observed as live.
   - End the session when the room is observed as offline.
   - First version may use observed start time when an official Bilibili start time is unavailable.

3. Add interaction record storage.
   - Store `session_id`, `room_id`, `event_type`, optional command name, optional user fields, event timestamp, common type-specific fields, and raw JSON.
   - Persist unknown notification commands as records with raw JSON.

4. Add minimal query coverage.
   - Danmu count for a live session.
   - Gift value for a live session.
   - User cumulative danmu count from interaction records.
   - Unknown command persistence.

5. Wire recording into the monitor loop.
   - Record events before or alongside rule handling.
   - Log record failures and continue rule handling.
   - Keep startup failing if SQLite cannot open.

### Out Of Scope

- Replacing the existing danmu count command with interaction-record aggregation.
- Full dashboard UI for session summaries.
- AI user profiles and natural-language SQLite queries.
- Multi-platform abstractions for Douyin, Huya, Douyu, or other platforms.
- Recording, screenshots, OBS sources, point-song tools, or plugin systems.
- Broad room-management operations such as changing title, category, cover, or moderators.

## Later Milestones

### Session And User Views

Use interaction records to show a live session summary and user detail lookup. This should come after the write path and query tests are stable.

### Configuration UI Cleanup

Replace multiline text editing for repeated config lists with table-style editors, but only after the data loop is stable enough that UI work has a clear model to display.

### Advanced Analysis

Add AI classification, fan profiles, natural-language queries, and stream advice only after interaction records have enough history to make those features meaningful.

### Expansion Decisions

Room management, point-song, OBS pages, recording, and multi-platform support are separate product expansions. Each should be planned as its own milestone instead of being mixed into the event data loop.

## Verification

Required checks for implementation work:

```bash
cargo fmt --check
cargo check --workspace
cargo test --workspace
```

Narrow tests should be added for protocol parsing, storage migrations, interaction record writes, session lifecycle behavior, and the minimal query functions before relying on manual smoke tests.
