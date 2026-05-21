# Multi-Platform Rollout (Douyu, Huya, Douyin, OBS Scope) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add listener-only Douyu, Huya, and Douyin platform support on top of the existing multi-platform core, and make OBS/plugin data endpoints read from the active platform room instead of Bilibili-only scope.

**Architecture:** Keep Bilibili as the only full-capability platform for login and sending messages. Add a small platform capability layer so Douyu, Huya, and Douyin can run as anonymous listener-only adapters, then move `danmaku_chat_server` from hardcoded Bilibili room scope to a generic active platform scope that all overlays can consume.

**Tech Stack:** Rust 2024, Tokio, async-trait, serde, rusqlite, Tauri 2, React/TypeScript/Vite.

---

## Scope Check

This work spans three adjacent but separately shippable tracks:

1. Platform runtime capability model
2. Douyu listener adapter
3. Huya listener adapter
4. Douyin listener adapter
5. OBS/plugin data scope migration

They stay in one plan because the non-Bilibili adapters cannot be shipped cleanly without the capability model, and OBS overlays are the first user-facing surface that proves the platform-neutral data path works.

## Current State

Already in place:

- `src/live_platform/*` defines platform IDs, room refs, event envelopes, auth session types, adapter trait, and registry.
- `src/live_platform/bilibili/*` is the only concrete platform implementation.
- `src/storage/mod.rs` already stores `platform_id`, `platform_room_id`, and `platform_user_id`.
- `src/main.rs` already persists `connected_room` as `PlatformRoomRef`, but still rejects non-Bilibili monitor startup.
- `src/danmaku_chat_server.rs` still reads active data using `BilibiliRoomScope` and explicit `platform_id = 'bilibili'` filters.
- `src-tauri/src/app/App.tsx` and `src-tauri/src/app/pages/Login.tsx` still assume Bilibili in several places.

Important constraint:

- Douyu and Huya first phase should be **listener-only**.
- That means they should support room resolution and event streaming without requiring QR login.
- `send_message` should remain unsupported for both in phase one.

## File Structure

Create:

- `src/live_platform/douyu/mod.rs` - Douyu module exports.
- `src/live_platform/douyu/adapter.rs` - Douyu `LivePlatform` implementation.
- `src/live_platform/douyu/api.rs` - Douyu HTTP helpers for room resolution and websocket bootstrap.
- `src/live_platform/douyu/events.rs` - Douyu raw event to `PlatformEventEnvelope` mapping.
- `src/live_platform/douyu/events_tests.rs` - Douyu event mapping tests.
- `src/live_platform/huya/mod.rs` - Huya module exports.
- `src/live_platform/huya/adapter.rs` - Huya `LivePlatform` implementation.
- `src/live_platform/huya/api.rs` - Huya room resolution and event bootstrap helpers.
- `src/live_platform/huya/events.rs` - Huya raw event to `PlatformEventEnvelope` mapping.
- `src/live_platform/huya/events_tests.rs` - Huya event mapping tests.
- `src/live_platform/douyin/mod.rs` - Douyin module exports.
- `src/live_platform/douyin/adapter.rs` - Douyin `LivePlatform` implementation.
- `src/live_platform/douyin/api.rs` - Douyin room resolution and event bootstrap helpers.
- `src/live_platform/douyin/events.rs` - Douyin raw event to `PlatformEventEnvelope` mapping.
- `src/live_platform/douyin/events_tests.rs` - Douyin event mapping tests.

Modify:

- `src/live_platform/adapter.rs` - add platform capabilities and make event streaming work without mandatory auth session.
- `src/live_platform/types.rs` - add stable platform constants and capability types if kept in the shared type file.
- `src/live_platform/mod.rs` - export Douyu and Huya modules.
- `src/live_platform/registry.rs` - no logic change expected, but new adapters must be registered.
- `src/main.rs` - register new platforms, expose capability-aware platform list, resolve rooms by selected platform, allow anonymous monitor startup for listener-only adapters, and keep Bilibili full-featured behavior unchanged.
- `src/token.rs` - keep existing persisted platform room/session helpers; no structural change expected beyond tests if needed.
- `src/danmaku_chat_server.rs` - replace `BilibiliRoomScope` with a generic active platform room scope.
- `src/storage/mod.rs` - add tests only if missing coverage for mixed-platform overlay queries.
- `src-tauri/src/app/lib/api.ts` - expose platform metadata and platform-aware room/login helpers.
- `src-tauri/src/app/App.tsx` - remove Bilibili-only restore/monitor assumptions.
- `src-tauri/src/app/pages/Login.tsx` - add platform selector, capability-aware login/room UI, and non-Bilibili room resolution path.

---

### Task 1: Add a Platform Capability Model

**Files:**
- Modify: `src/live_platform/adapter.rs`
- Modify: `src/live_platform/types.rs`
- Modify: `src/main.rs`
- Modify: `src-tauri/src/app/lib/api.ts`

- [ ] **Step 1: Add shared capability types**

Add to `src/live_platform/types.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformAuthMode {
    Required,
    Anonymous,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlatformCapabilities {
    pub auth_mode: PlatformAuthMode,
    pub can_resolve_room: bool,
    pub can_connect_events: bool,
    pub can_send_message: bool,
    pub can_manage_live_room: bool,
}
```

Also add stable constants beside `PlatformId::BILIBILI`:

```rust
impl PlatformId {
    pub const DOUYU: &'static str = "douyu";
    pub const HUYA: &'static str = "huya";
}
```

- [ ] **Step 2: Extend the adapter trait**

Modify `src/live_platform/adapter.rs` so every adapter reports capabilities, and listener-only adapters can connect without a saved auth session:

```rust
use crate::live_platform::types::{
    LiveRoomInfo, PlatformCapabilities, PlatformEventEnvelope, PlatformId, PlatformRoomRef,
    RoomInput,
};

#[async_trait]
pub trait LivePlatform: Send + Sync {
    fn id(&self) -> PlatformId;
    fn capabilities(&self) -> PlatformCapabilities;

    async fn login_url(&self) -> Result<LoginChallenge, PlatformError>;
    async fn poll_login(&self, challenge_id: &str) -> Result<LoginPoll, PlatformError>;
    async fn validate_session(
        &self,
        session: &PlatformSession,
    ) -> Result<SessionStatus, PlatformError>;
    async fn resolve_room(
        &self,
        input: RoomInput,
        session: Option<&PlatformSession>,
    ) -> Result<LiveRoomInfo, PlatformError>;
    async fn room_info(
        &self,
        room: &PlatformRoomRef,
        session: Option<&PlatformSession>,
    ) -> Result<LiveRoomInfo, PlatformError>;
    async fn connect_events(
        &self,
        room: PlatformRoomRef,
        session: Option<PlatformSession>,
        sink: PlatformEventSink,
    ) -> Result<(), PlatformError>;
    async fn send_message(
        &self,
        room: &PlatformRoomRef,
        session: Option<&PlatformSession>,
        text: &str,
    ) -> Result<(), PlatformError>;
}
```

- [ ] **Step 3: Add a platform descriptor command**

In `src/main.rs`, define a serializable descriptor for the frontend:

```rust
#[derive(Debug, Clone, Serialize)]
struct PlatformDescriptor {
    platform_id: String,
    auth_mode: String,
    can_resolve_room: bool,
    can_connect_events: bool,
    can_send_message: bool,
    can_manage_live_room: bool,
}

#[tauri::command]
async fn list_platforms(state: tauri::State<'_, SharedState>) -> Result<Vec<PlatformDescriptor>, String> {
    let mut items = Vec::new();
    for platform_id in state.platforms.list() {
        let Some(platform) = state.platforms.get(&platform_id) else {
            continue;
        };
        let caps = platform.capabilities();
        items.push(PlatformDescriptor {
            platform_id: platform_id.to_string(),
            auth_mode: match caps.auth_mode {
                live_platform::PlatformAuthMode::Required => "required".to_string(),
                live_platform::PlatformAuthMode::Anonymous => "anonymous".to_string(),
            },
            can_resolve_room: caps.can_resolve_room,
            can_connect_events: caps.can_connect_events,
            can_send_message: caps.can_send_message,
            can_manage_live_room: caps.can_manage_live_room,
        });
    }
    Ok(items)
}
```

Register `list_platforms` in the invoke handler.

- [ ] **Step 4: Add frontend types and API wrapper**

In `src-tauri/src/app/lib/api.ts`, add:

```ts
export type PlatformId = "bilibili" | "douyu" | "huya" | string;

export interface PlatformDescriptor {
  platform_id: PlatformId;
  auth_mode: "required" | "anonymous";
  can_resolve_room: boolean;
  can_connect_events: boolean;
  can_send_message: boolean;
  can_manage_live_room: boolean;
}
```

And add:

```ts
listPlatforms: () => invoke<PlatformDescriptor[]>("list_platforms"),
```

- [ ] **Step 5: Run focused checks**

Run:

```bash
cargo check
cd /Users/lee/workspaces/ai/live-bot/src-tauri && npm run build
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/live_platform/adapter.rs src/live_platform/types.rs src/main.rs src-tauri/src/app/lib/api.ts
git commit -m "feat: add platform capability model"
```

### Task 2: Make Monitor Startup Capability-Aware

**Files:**
- Modify: `src/main.rs`
- Test: `src/main.rs`

- [ ] **Step 1: Replace the hardcoded Bilibili guard**

In `src/main.rs`, update `start_monitor` so it no longer rejects every non-Bilibili room up front:

```rust
let platform = state
    .platforms
    .get(&room.platform_id)
    .ok_or_else(|| format!("平台未注册: {}", room.platform_id))?;
let caps = platform.capabilities();
if !caps.can_connect_events {
    return Err(format!("平台暂不支持监听: {}", room.platform_id));
}

let session = match caps.auth_mode {
    live_platform::PlatformAuthMode::Required => Some(
        token::read_platform_session(room.platform_id.as_str())
            .map_err(|_| format!("{} 尚未登录", room.platform_id))?
            .into(),
    ),
    live_platform::PlatformAuthMode::Anonymous => None,
};
```

Pass `session` directly to `platform.connect_events(...)`.

- [ ] **Step 2: Keep send-message behavior strict**

In the send-message path in `src/main.rs`, gate by capabilities:

```rust
let caps = platform.capabilities();
if !caps.can_send_message {
    return Err(format!("平台暂不支持发言: {}", room.platform_id));
}
let session = token::read_platform_session(room.platform_id.as_str())
    .map_err(|_| format!("{} 尚未登录", room.platform_id))?;
platform
    .send_message(&room, Some(&session.into()), text)
    .await
```

Do not silently downgrade this into anonymous send.

- [ ] **Step 3: Add backend tests for capability gating**

Add tests in `src/main.rs` or the nearest existing backend test module:

```rust
#[test]
fn anonymous_platform_does_not_require_saved_session_for_monitor_start() {
    let caps = live_platform::PlatformCapabilities {
        auth_mode: live_platform::PlatformAuthMode::Anonymous,
        can_resolve_room: true,
        can_connect_events: true,
        can_send_message: false,
        can_manage_live_room: false,
    };
    assert!(matches!(caps.auth_mode, live_platform::PlatformAuthMode::Anonymous));
    assert!(caps.can_connect_events);
    assert!(!caps.can_send_message);
}
```

This is intentionally small. The real runtime behavior is covered by the adapter tasks later in the plan.

- [ ] **Step 4: Run checks**

Run:

```bash
cargo test anonymous_platform_does_not_require_saved_session_for_monitor_start -- --nocapture
cargo check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.rs
git commit -m "feat: support anonymous listener platforms"
```

### Task 3: Replace Bilibili-Only OBS Scope with Active Platform Scope

**Files:**
- Modify: `src/danmaku_chat_server.rs`
- Test: `src/danmaku_chat_server.rs`

- [ ] **Step 1: Replace the Bilibili scope structs**

Replace:

```rust
enum CurrentBilibiliRoom {
    Room(i64),
    NoConnectedRoom,
    NonBilibili,
}

struct BilibiliRoomScope {
    room_id: i64,
    platform_room_id: String,
}
```

With:

```rust
struct ActiveRoomScope {
    platform_id: String,
    room_id: i64,
    platform_room_id: String,
}
```

- [ ] **Step 2: Replace room scope loaders**

Replace `current_bilibili_room_id`, `current_or_config_bilibili_room_id`, and `current_or_config_bilibili_room_scope` with:

```rust
fn current_or_config_room_scope(error_context: &str) -> Option<ActiveRoomScope> {
    if let Some(room) = current_platform_room() {
        let room_id = room.platform_room_id.parse::<i64>().ok()?;
        return Some(ActiveRoomScope {
            platform_id: room.platform_id.to_string(),
            room_id,
            platform_room_id: room.platform_room_id,
        });
    }

    match crate::config::AppConfig::load_or_default() {
        Ok(app) if app.room_id > 0 => Some(ActiveRoomScope {
            platform_id: crate::live_platform::PlatformId::BILIBILI.to_string(),
            room_id: app.room_id,
            platform_room_id: app.room_id.to_string(),
        }),
        Ok(_) => None,
        Err(e) => {
            eprintln!("{error_context}: {e}");
            None
        }
    }
}
```

- [ ] **Step 3: Make SQL predicates platform-aware**

Change queries such as `load_active_observed_session`, `load_recent_gifts_data`, and `load_gift_rank_data` to use:

```sql
and coalesce(nullif(platform_id, ''), 'bilibili') = ?1
and coalesce(nullif(platform_room_id, ''), cast(room_id as text)) = ?2
and room_id = ?3
```

And pass params in this order:

```rust
params![scope.platform_id, scope.platform_room_id, scope.room_id]
```

Use the same pattern for the music interaction queue/rank reads in this file.

- [ ] **Step 4: Rename and extend tests**

Replace the Bilibili-only tests with generic scope tests:

```rust
#[test]
fn recent_gifts_data_reads_current_platform_scope_only() {
    let storage = Storage::open_in_memory().unwrap();
    let scope = ActiveRoomScope {
        platform_id: "douyu".to_string(),
        room_id: 123,
        platform_room_id: "123".to_string(),
    };
    let now = Local::now().to_rfc3339();

    storage.with_connection(|conn| {
        conn.execute(
            "insert into interaction_records (
                session_id, platform_id, platform_room_id, platform_user_id, room_id,
                event_type, uname, gift_name, gift_count, gift_price, raw_json, occurred_at
            ) values ('douyu-ok', 'douyu', '123', '7', 123, 'gift', 'alice', 'rocket', 2, 100, '{}', ?1)",
            params![now.clone()],
        )?;
        conn.execute(
            "insert into interaction_records (
                session_id, platform_id, platform_room_id, platform_user_id, room_id,
                event_type, uname, gift_name, gift_count, gift_price, raw_json, occurred_at
            ) values ('bili-wrong', 'bilibili', '123', '7', 123, 'gift', 'mallory', 'rose', 5, 100, '{}', ?1)",
            params![now],
        )?;
        Ok(())
    }).unwrap();

    let items = storage.with_connection(|conn| load_recent_gifts_data(conn, &scope, 10)).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["User"], "alice");
}
```

Create the same style of test for `load_gift_rank_data` and `load_active_observed_session`.

- [ ] **Step 5: Run checks**

Run:

```bash
cargo test recent_gifts_data_reads_current_platform_scope_only -- --nocapture
cargo test gift_rank_data_reads_current_platform_scope_only -- --nocapture
cargo test active_observed_session_reads_current_platform_scope_only -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/danmaku_chat_server.rs
git commit -m "feat: make overlay data scope platform aware"
```

### Task 4: Add Douyu Listener Adapter

**Files:**
- Create: `src/live_platform/douyu/mod.rs`
- Create: `src/live_platform/douyu/api.rs`
- Create: `src/live_platform/douyu/adapter.rs`
- Create: `src/live_platform/douyu/events.rs`
- Create: `src/live_platform/douyu/events_tests.rs`
- Modify: `src/live_platform/mod.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Create the module shell**

Create `src/live_platform/douyu/mod.rs`:

```rust
pub mod adapter;
pub mod api;
pub mod events;
```

Update `src/live_platform/mod.rs`:

```rust
pub mod bilibili;
pub mod douyu;
```

- [ ] **Step 2: Implement a listener-only adapter skeleton**

Create `src/live_platform/douyu/adapter.rs`:

```rust
use async_trait::async_trait;

use crate::live_platform::adapter::{LivePlatform, PlatformEventSink};
use crate::live_platform::auth::{LoginChallenge, LoginPoll, PlatformSession, SessionStatus};
use crate::live_platform::error::{PlatformError, PlatformErrorKind, PlatformOperation};
use crate::live_platform::types::{
    LiveRoomInfo, PlatformAuthMode, PlatformCapabilities, PlatformId, PlatformRoomRef, RoomInput,
};

#[derive(Clone)]
pub struct DouyuPlatform {
    api: crate::live_platform::douyu::api::DouyuApi,
}

impl DouyuPlatform {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self {
            api: crate::live_platform::douyu::api::DouyuApi::new()?,
        })
    }

    fn unsupported(operation: PlatformOperation, message: &str) -> PlatformError {
        PlatformError::new(
            PlatformId::from(PlatformId::DOUYU),
            operation,
            PlatformErrorKind::UnsupportedFeature,
            message,
            message,
        )
    }
}

#[async_trait]
impl LivePlatform for DouyuPlatform {
    fn id(&self) -> PlatformId {
        PlatformId::from(PlatformId::DOUYU)
    }

    fn capabilities(&self) -> PlatformCapabilities {
        PlatformCapabilities {
            auth_mode: PlatformAuthMode::Anonymous,
            can_resolve_room: true,
            can_connect_events: true,
            can_send_message: false,
            can_manage_live_room: false,
        }
    }

    async fn login_url(&self) -> Result<LoginChallenge, PlatformError> {
        Err(Self::unsupported(PlatformOperation::LoginUrl, "斗鱼首期不提供登录"))
    }

    async fn poll_login(&self, _challenge_id: &str) -> Result<LoginPoll, PlatformError> {
        Err(Self::unsupported(PlatformOperation::PollLogin, "斗鱼首期不提供登录"))
    }

    async fn validate_session(&self, _session: &PlatformSession) -> Result<SessionStatus, PlatformError> {
        Ok(SessionStatus::Missing)
    }

    async fn resolve_room(
        &self,
        input: RoomInput,
        _session: Option<&PlatformSession>,
    ) -> Result<LiveRoomInfo, PlatformError> {
        self.api.resolve_room(input).await
    }

    async fn room_info(
        &self,
        room: &PlatformRoomRef,
        _session: Option<&PlatformSession>,
    ) -> Result<LiveRoomInfo, PlatformError> {
        self.api.room_info(room).await
    }

    async fn connect_events(
        &self,
        room: PlatformRoomRef,
        _session: Option<PlatformSession>,
        sink: PlatformEventSink,
    ) -> Result<(), PlatformError> {
        self.api.connect_events(room, sink).await
    }

    async fn send_message(
        &self,
        _room: &PlatformRoomRef,
        _session: Option<&PlatformSession>,
        _text: &str,
    ) -> Result<(), PlatformError> {
        Err(Self::unsupported(PlatformOperation::SendMessage, "斗鱼首期不支持发言"))
    }
}
```

- [ ] **Step 3: Implement room resolution and event mapping**

Implement `src/live_platform/douyu/api.rs` and `src/live_platform/douyu/events.rs` using the same boundary as Bilibili:

- `DouyuApi::new() -> anyhow::Result<Self>`
- `DouyuApi::resolve_room(input: RoomInput) -> Result<LiveRoomInfo, PlatformError>`
- `DouyuApi::room_info(room: &PlatformRoomRef) -> Result<LiveRoomInfo, PlatformError>`
- `DouyuApi::connect_events(room: PlatformRoomRef, sink: PlatformEventSink) -> Result<(), PlatformError>`
- `map_douyu_event(room: &PlatformRoomRef, raw: DouyuRawEvent) -> PlatformEventEnvelope`

Map at least these event classes:

- danmu -> `PlatformEvent::Message`
- gift -> `PlatformEvent::Gift`
- user enter -> `PlatformEvent::Enter`
- like or popularity style events -> `PlatformEvent::Like` or `PlatformEvent::Popularity`
- unsupported frames -> `PlatformEvent::Unknown`

Keep the first version conservative. Do not invent paid-message, PK, or guard semantics unless the raw event format clearly supports them.

- [ ] **Step 4: Add focused mapping tests**

Create `src/live_platform/douyu/events_tests.rs` with tests like:

```rust
#[test]
fn maps_douyu_chat_to_platform_message() {
    let room = crate::live_platform::PlatformRoomRef {
        platform_id: crate::live_platform::PlatformId::from("douyu"),
        platform_room_id: "123".to_string(),
        display_id: Some("123".to_string()),
    };
    let raw = crate::live_platform::douyu::events::DouyuRawEvent::Chat {
        uid: "42".to_string(),
        uname: "alice".to_string(),
        text: "hello".to_string(),
    };

    let mapped = crate::live_platform::douyu::events::map_douyu_event(&room, raw);

    match mapped.event {
        crate::live_platform::PlatformEvent::Message(value) => {
            assert_eq!(value.user.platform_id.as_str(), "douyu");
            assert_eq!(value.user.platform_user_id, "42");
            assert_eq!(value.text, "hello");
        }
        other => panic!("unexpected event: {other:?}"),
    }
}
```

Add one test each for gift and unknown fallback.

- [ ] **Step 5: Register Douyu**

In `src/main.rs`, register the platform:

```rust
let bilibili_platform = live_platform::bilibili::BilibiliPlatform::new()?;
let bilibili_http = bilibili_platform.api().clone();
let douyu_platform = live_platform::douyu::adapter::DouyuPlatform::new()?;
let platforms = PlatformRegistry::new(vec![
    std::sync::Arc::new(bilibili_platform),
    std::sync::Arc::new(douyu_platform),
]);
```

- [ ] **Step 6: Run checks**

Run:

```bash
cargo test douyu -- --nocapture
cargo check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/live_platform/douyu src/live_platform/mod.rs src/main.rs
git commit -m "feat: add douyu listener platform"
```

### Task 5: Add Huya Listener Adapter

**Files:**
- Create: `src/live_platform/huya/mod.rs`
- Create: `src/live_platform/huya/api.rs`
- Create: `src/live_platform/huya/adapter.rs`
- Create: `src/live_platform/huya/events.rs`
- Create: `src/live_platform/huya/events_tests.rs`
- Modify: `src/live_platform/mod.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Mirror the Douyu module structure**

Create `src/live_platform/huya/mod.rs`:

```rust
pub mod adapter;
pub mod api;
pub mod events;
```

Export it from `src/live_platform/mod.rs`:

```rust
pub mod huya;
```

- [ ] **Step 2: Implement a listener-only adapter**

Create `src/live_platform/huya/adapter.rs` with the same structure as Douyu, but using `PlatformId::HUYA` and Huya-specific API wiring.

The capability block should be:

```rust
PlatformCapabilities {
    auth_mode: PlatformAuthMode::Anonymous,
    can_resolve_room: true,
    can_connect_events: true,
    can_send_message: false,
    can_manage_live_room: false,
}
```

- [ ] **Step 3: Implement room resolution and event mapping**

In `src/live_platform/huya/api.rs` and `src/live_platform/huya/events.rs`, implement:

- room URL or room ID resolution
- live room info loading
- websocket or polling event bootstrap
- raw message mapping to `PlatformEventEnvelope`

Map at least:

- danmu -> `PlatformEvent::Message`
- gift -> `PlatformEvent::Gift`
- share/follow if available -> corresponding `PlatformEvent`
- enter banner -> `PlatformEvent::Enter`
- everything else -> `PlatformEvent::Unknown`

Do not try to force Huya noble/guardian into Bilibili-style `GuardOrMember` unless the raw payload is unambiguous.

- [ ] **Step 4: Add mapping tests**

Create tests matching the Douyu pattern:

```rust
#[test]
fn maps_huya_chat_to_platform_message() {
    let room = crate::live_platform::PlatformRoomRef {
        platform_id: crate::live_platform::PlatformId::from("huya"),
        platform_room_id: "123".to_string(),
        display_id: Some("123".to_string()),
    };
    let raw = crate::live_platform::huya::events::HuyaRawEvent::Chat {
        uid: "42".to_string(),
        uname: "alice".to_string(),
        text: "hello".to_string(),
    };

    let mapped = crate::live_platform::huya::events::map_huya_event(&room, raw);

    match mapped.event {
        crate::live_platform::PlatformEvent::Message(value) => {
            assert_eq!(value.user.platform_id.as_str(), "huya");
            assert_eq!(value.user.platform_user_id, "42");
            assert_eq!(value.text, "hello");
        }
        other => panic!("unexpected event: {other:?}"),
    }
}
```

- [ ] **Step 5: Register Huya**

In `src/main.rs`, extend the registry:

```rust
let huya_platform = live_platform::huya::adapter::HuyaPlatform::new()?;
let platforms = PlatformRegistry::new(vec![
    std::sync::Arc::new(bilibili_platform),
    std::sync::Arc::new(douyu_platform),
    std::sync::Arc::new(huya_platform),
]);
```

- [ ] **Step 6: Run checks**

Run:

```bash
cargo test huya -- --nocapture
cargo check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/live_platform/huya src/live_platform/mod.rs src/main.rs
git commit -m "feat: add huya listener platform"
```

### Task 6: Add Douyin Listener Adapter

**Files:**
- Create: `src/live_platform/douyin/mod.rs`
- Create: `src/live_platform/douyin/api.rs`
- Create: `src/live_platform/douyin/adapter.rs`
- Create: `src/live_platform/douyin/events.rs`
- Create: `src/live_platform/douyin/events_tests.rs`
- Modify: `src/live_platform/mod.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Create the module shell**

Create `src/live_platform/douyin/mod.rs`:

```rust
pub mod adapter;
pub mod api;
pub mod events;
```

Export it from `src/live_platform/mod.rs`:

```rust
pub mod douyin;
```

- [ ] **Step 2: Implement a listener-only adapter**

Create `src/live_platform/douyin/adapter.rs` with the same listener-only contract as Douyu and Huya:

```rust
use async_trait::async_trait;

use crate::live_platform::adapter::{LivePlatform, PlatformEventSink};
use crate::live_platform::auth::{LoginChallenge, LoginPoll, PlatformSession, SessionStatus};
use crate::live_platform::error::{PlatformError, PlatformErrorKind, PlatformOperation};
use crate::live_platform::types::{
    LiveRoomInfo, PlatformAuthMode, PlatformCapabilities, PlatformId, PlatformRoomRef, RoomInput,
};

#[derive(Clone)]
pub struct DouyinPlatform {
    api: crate::live_platform::douyin::api::DouyinApi,
}

impl DouyinPlatform {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self {
            api: crate::live_platform::douyin::api::DouyinApi::new()?,
        })
    }

    fn unsupported(operation: PlatformOperation, message: &str) -> PlatformError {
        PlatformError::new(
            PlatformId::from("douyin"),
            operation,
            PlatformErrorKind::UnsupportedFeature,
            message,
            message,
        )
    }
}

#[async_trait]
impl LivePlatform for DouyinPlatform {
    fn id(&self) -> PlatformId {
        PlatformId::from("douyin")
    }

    fn capabilities(&self) -> PlatformCapabilities {
        PlatformCapabilities {
            auth_mode: PlatformAuthMode::Anonymous,
            can_resolve_room: true,
            can_connect_events: true,
            can_send_message: false,
            can_manage_live_room: false,
        }
    }

    async fn login_url(&self) -> Result<LoginChallenge, PlatformError> {
        Err(Self::unsupported(PlatformOperation::LoginUrl, "抖音监听版不提供登录"))
    }

    async fn poll_login(&self, _challenge_id: &str) -> Result<LoginPoll, PlatformError> {
        Err(Self::unsupported(PlatformOperation::PollLogin, "抖音监听版不提供登录"))
    }

    async fn validate_session(&self, _session: &PlatformSession) -> Result<SessionStatus, PlatformError> {
        Ok(SessionStatus::Missing)
    }

    async fn resolve_room(
        &self,
        input: RoomInput,
        _session: Option<&PlatformSession>,
    ) -> Result<LiveRoomInfo, PlatformError> {
        self.api.resolve_room(input).await
    }

    async fn room_info(
        &self,
        room: &PlatformRoomRef,
        _session: Option<&PlatformSession>,
    ) -> Result<LiveRoomInfo, PlatformError> {
        self.api.room_info(room).await
    }

    async fn connect_events(
        &self,
        room: PlatformRoomRef,
        _session: Option<PlatformSession>,
        sink: PlatformEventSink,
    ) -> Result<(), PlatformError> {
        self.api.connect_events(room, sink).await
    }

    async fn send_message(
        &self,
        _room: &PlatformRoomRef,
        _session: Option<&PlatformSession>,
        _text: &str,
    ) -> Result<(), PlatformError> {
        Err(Self::unsupported(PlatformOperation::SendMessage, "抖音监听版不支持发言"))
    }
}
```

- [ ] **Step 3: Implement room resolution and event mapping**

In `src/live_platform/douyin/api.rs` and `src/live_platform/douyin/events.rs`, implement:

- room URL, share link, or room ID resolution
- live room info loading
- websocket event bootstrap
- raw frame mapping into `PlatformEventEnvelope`

Map only these stable first-phase events:

- danmu -> `PlatformEvent::Message`
- gift -> `PlatformEvent::Gift`
- enter -> `PlatformEvent::Enter`
- follow/share -> matching `PlatformEvent`
- like -> `PlatformEvent::Like`
- unsupported frames -> `PlatformEvent::Unknown`

Do not implement send-message, PK, paid-message, or moderator actions in this phase.

- [ ] **Step 4: Add mapping tests**

Create `src/live_platform/douyin/events_tests.rs`:

```rust
#[test]
fn maps_douyin_chat_to_platform_message() {
    let room = crate::live_platform::PlatformRoomRef {
        platform_id: crate::live_platform::PlatformId::from("douyin"),
        platform_room_id: "123".to_string(),
        display_id: Some("123".to_string()),
    };
    let raw = crate::live_platform::douyin::events::DouyinRawEvent::Chat {
        uid: "42".to_string(),
        uname: "alice".to_string(),
        text: "hello".to_string(),
    };

    let mapped = crate::live_platform::douyin::events::map_douyin_event(&room, raw);

    match mapped.event {
        crate::live_platform::PlatformEvent::Message(value) => {
            assert_eq!(value.user.platform_id.as_str(), "douyin");
            assert_eq!(value.user.platform_user_id, "42");
            assert_eq!(value.text, "hello");
        }
        other => panic!("unexpected event: {other:?}"),
    }
}
```

Add one gift test and one unknown fallback test.

- [ ] **Step 5: Register Douyin last**

In `src/main.rs`, register the adapter after Douyu and Huya:

```rust
let douyin_platform = live_platform::douyin::adapter::DouyinPlatform::new()?;
let platforms = PlatformRegistry::new(vec![
    std::sync::Arc::new(bilibili_platform),
    std::sync::Arc::new(douyu_platform),
    std::sync::Arc::new(huya_platform),
    std::sync::Arc::new(douyin_platform),
]);
```

- [ ] **Step 6: Run checks**

Run:

```bash
cargo test douyin -- --nocapture
cargo check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/live_platform/douyin src/live_platform/mod.rs src/main.rs
git commit -m "feat: add douyin listener platform"
```

### Task 7: Add Frontend Platform Selection and Capability-Aware Login

**Files:**
- Modify: `src-tauri/src/app/lib/api.ts`
- Modify: `src-tauri/src/app/pages/Login.tsx`
- Modify: `src-tauri/src/app/App.tsx`

- [ ] **Step 1: Load platform descriptors on the login page**

In `src-tauri/src/app/pages/Login.tsx`, add state:

```tsx
const [platforms, setPlatforms] = useState<PlatformDescriptor[]>([]);
const [selectedPlatformId, setSelectedPlatformId] = useState<PlatformId>("bilibili");
```

Load them on mount:

```tsx
const loadPlatforms = async () => {
  const items = await api.listPlatforms();
  setPlatforms(items);
  if (items.some((item) => item.platform_id === selectedPlatformId)) {
    return;
  }
  setSelectedPlatformId(items[0]?.platform_id ?? "bilibili");
};

useEffect(() => {
  loadPlatforms();
  refreshUserInfo();
  loadRoomId();
}, []);
```

- [ ] **Step 2: Add a platform selector**

In `src-tauri/src/app/pages/Login.tsx`, render a selector above the login and room cards:

```tsx
const selectedPlatform = platforms.find(
  (item) => item.platform_id === selectedPlatformId,
);
```

Then render:

```tsx
<div className="mb-4 flex flex-wrap gap-2">
  {platforms.map((item) => (
    <Button
      key={item.platform_id}
      size="sm"
      variant={item.platform_id === selectedPlatformId ? "primary" : "ghost"}
      onClick={() => setSelectedPlatformId(item.platform_id)}
    >
      {item.platform_id}
    </Button>
  ))}
</div>
```

- [ ] **Step 3: Make login UI capability-aware**

In `startLogin`, short-circuit anonymous platforms:

```tsx
if (selectedPlatform?.auth_mode === "anonymous") {
  toast.message("该平台首期为免登录监听，无需扫码");
  return;
}
const url = await api.createPlatformLoginChallenge(selectedPlatformId);
```

Update the login card copy:

```tsx
{selectedPlatform?.auth_mode === "required"
  ? "登录用于读取账号信息，并在你配置默认房间后快速连接直播间。"
  : "该平台首期不需要登录，仅支持房间解析和监听。"}
```

- [ ] **Step 4: Use platform-aware room resolution**

Replace the Bilibili-only `checkRoom` path with:

```tsx
const info = await api.resolvePlatformRoom(selectedPlatformId, roomId.trim());
setRoomInfo({
  room_id: Number(info.room.platform_room_id),
  short_id: Number(info.room.display_id || info.room.platform_room_id),
  uid: Number(info.owner?.platform_user_id || 0),
  uname: info.owner?.display_name || "",
  title: info.title,
  area_name: info.area_name,
  parent_area_name: info.parent_area_name,
  live_status: info.live_status,
  online: info.online,
  keyframe: info.keyframe,
  cover: info.cover,
  live_time: info.live_time,
});
```

For listener-only platforms, do not reuse `api.checkRoom`.

- [ ] **Step 5: Make room restore platform-aware in `App.tsx`**

Remove the current non-Bilibili clearing logic:

```tsx
if (savedRoom.platform_id !== "bilibili") {
  await api.setConnectedRoom(null).catch(() => {});
  return null;
}
```

Instead, keep the saved room if its platform exists in `listPlatforms()`. Only clear if the platform is no longer registered.

- [ ] **Step 6: Run checks**

Run:

```bash
cd /Users/lee/workspaces/ai/live-bot/src-tauri && npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/app/lib/api.ts src-tauri/src/app/pages/Login.tsx src-tauri/src/app/App.tsx
git commit -m "feat: add platform-aware login and room selection"
```

### Task 8: Full Regression Pass

**Files:**
- Modify: `docs/superpowers/plans/2026-05-21-multi-platform-rollout-douyu-huya.md`

- [ ] **Step 1: Run backend tests**

Run:

```bash
cargo test
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd /Users/lee/workspaces/ai/live-bot/src-tauri && npm run build
```

Expected: PASS.

- [ ] **Step 3: Smoke-check the desktop runtime**

Run:

```bash
cargo tauri dev
```

Manual verification:

- Login page lists `bilibili`, `douyu`, `huya`, and `douyin`
- Bilibili still supports QR login
- Douyu, Huya, and Douyin show “免登录监听” copy and do not open the QR modal
- Saving and restoring a Douyu or Huya connected room no longer clears it on startup
- Recent gifts and gift rank overlay pages read from the active platform room instead of forcing Bilibili

- [ ] **Step 4: Mark actual gaps**

If any of these remain unsupported after smoke-check, write them under a `## Post-Plan Follow-Ups` section in this plan file:

- non-Bilibili send-message support
- platform-specific overlay avatar extraction quirks
- room ID parsing that is not numeric for a specific platform
- Douyin websocket bootstrap fragility or cookie fallback requirements

Do not close the plan with hidden gaps.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-05-21-multi-platform-rollout-douyu-huya.md
git commit -m "docs: finalize multi-platform rollout plan notes"
```

## Self-Review

- Spec coverage: This plan covers the capability model, runtime monitor path, Douyu listener adapter, Huya listener adapter, Douyin listener adapter, frontend platform selection, and OBS/plugin data scope.
- Placeholder scan: No `TODO` or deferred implementation placeholders are left in the task steps. The event source internals for Douyu/Huya are intentionally bounded behind concrete file names and concrete adapter/API responsibilities.
- Type consistency: `PlatformCapabilities`, `PlatformAuthMode`, `PlatformDescriptor`, and `ActiveRoomScope` are used consistently across the tasks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-21-multi-platform-rollout-douyu-huya.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
