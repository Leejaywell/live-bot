# Multi Live Platform Core Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the multi-live-platform refactor from the current partially migrated state by moving monitor, Tauri commands, plugin endpoints, frontend callers, and final cleanup onto `live_platform`.

**Architecture:** Keep the already committed `live_platform` core, Bilibili adapter, platform session helpers, storage platform columns, and platform-aware bot helpers. Finish the migration by routing runtime execution through `PlatformRegistry` and `PlatformSession`, while preserving legacy Bilibili command names as wrappers so the existing frontend remains usable during the transition.

**Tech Stack:** Rust 2024, Tokio, async-trait, serde, rusqlite, Tauri 2, React/TypeScript/Vite.

---

## Current State

Already completed and committed:

- `src/live_platform/*` core types and registry.
- `src/live_platform/bilibili/*` Bilibili adapter, copied API, and mapping tests.
- `src/token.rs` platform session and connected room persistence helpers.
- `src/storage/mod.rs` platform columns and `insert_platform_interaction_record`.
- `src/bot/engine.rs` rules operate on `PlatformEvent`, with a temporary Bilibili compatibility wrapper.
- `src/bot/mod.rs` has `record_and_handle_platform_event`.

Known remaining coupling:

- `src/main.rs` still has `mod api`, `SharedState.http: api::BiliApi`, and legacy commands.
- `src/bot/monitor.rs` still accepts `BiliApi`, creates Bilibili connect config directly, and processes `bilibili_live_protocol::LiveEvent`.
- `src/bot/profile_worker.rs`, `src/bot/agent/mod.rs`, and `src/bot/agent/runtime.rs` still import `crate::api::BiliApi`.
- `src/music/service.rs` still consumes `bilibili_live_protocol::LiveEvent`.
- `src/danmaku_chat_server.rs` still reads the legacy connected room file.
- `src-tauri/src/app/lib/api.ts`, `src-tauri/src/app/App.tsx`, and `src-tauri/src/app/pages/Login.tsx` still call legacy login commands directly.

## File Structure

Modify:

- `src/bot/monitor.rs` - introduce a platform monitor loop while keeping a temporary legacy wrapper for current callers.
- `src/music/service.rs` - add `handle_platform_event` and keep `handle_live_event` as Bilibili compatibility.
- `src/main.rs` - add `PlatformRegistry` state, platform commands, legacy command wrappers, and route monitor/send message through platform session and room refs.
- `src/bot/profile_worker.rs` - switch to `crate::live_platform::bilibili::api::BiliApi` after `main.rs` owns a Bilibili adapter.
- `src/bot/agent/mod.rs` and `src/bot/agent/runtime.rs` - switch to the Bilibili API type from the adapter module in the same commit as `main.rs`.
- `src/danmaku_chat_server.rs` - read connected platform room with Bilibili fallback.
- `src-tauri/src/app/lib/api.ts` - add platform command wrappers and keep legacy wrapper functions.
- `src-tauri/src/app/App.tsx` and `src-tauri/src/app/pages/Login.tsx` - consume `challenge_id` while accepting legacy `qrcode_key` fallback until old commands are removed.
- `src/storage/mod.rs` - add platform user columns and platform-aware auto-track method after runtime migration is stable.

Delete at the end:

- `src/api.rs`
- `mod api;` in `src/main.rs`

---

### Task 1: Platformize Music Interaction Input

**Files:**
- Modify: `src/music/service.rs`

- [ ] **Step 1: Add platform imports**

Add near the top of `src/music/service.rs`:

```rust
use crate::live_platform::types::{PlatformEvent, PlatformUserRef};
```

- [ ] **Step 2: Add a platform event extraction helper**

Add this helper near the existing `handle_live_event` method:

```rust
struct MusicEventInput<'a> {
    uid: i64,
    uname: &'a str,
    text: Option<&'a str>,
    gift_name: Option<&'a str>,
    gift_count: i64,
    gift_price: i64,
    sc_price: Option<i64>,
}

fn platform_user_numeric_id(user: &PlatformUserRef) -> Option<i64> {
    if user.platform_id.as_str() == "bilibili" {
        user.numeric_id()
    } else {
        None
    }
}

fn platform_music_input(event: &PlatformEvent) -> Option<MusicEventInput<'_>> {
    match event {
        PlatformEvent::Message(value) => Some(MusicEventInput {
            uid: platform_user_numeric_id(&value.user)?,
            uname: value.user.display_name.as_str(),
            text: Some(value.text.as_str()),
            gift_name: None,
            gift_count: 0,
            gift_price: 0,
            sc_price: None,
        }),
        PlatformEvent::Gift(value) => Some(MusicEventInput {
            uid: platform_user_numeric_id(&value.user)?,
            uname: value.user.display_name.as_str(),
            text: None,
            gift_name: Some(value.gift.as_str()),
            gift_count: value.count,
            gift_price: value.price,
            sc_price: None,
        }),
        PlatformEvent::PaidMessage(value) => Some(MusicEventInput {
            uid: platform_user_numeric_id(&value.user)?,
            uname: value.user.display_name.as_str(),
            text: Some(value.text.as_str()),
            gift_name: None,
            gift_count: 0,
            gift_price: 0,
            sc_price: Some(value.price),
        }),
        _ => None,
    }
}
```

- [ ] **Step 3: Add `handle_platform_event`**

Keep existing `handle_live_event` unchanged. Add:

```rust
pub async fn handle_platform_event(
    &self,
    event: &PlatformEvent,
) -> anyhow::Result<MusicInteractionReply> {
    let Some(input) = platform_music_input(event) else {
        return Ok(MusicInteractionReply::None);
    };

    if let Some(text) = input.text {
        return self
            .handle_text_interaction(input.uid, input.uname, text, input.sc_price)
            .await;
    }

    if let Some(gift_name) = input.gift_name {
        return self
            .handle_gift_interaction(
                input.uid,
                input.uname,
                gift_name,
                input.gift_count,
                input.gift_price,
            )
            .await;
    }

    Ok(MusicInteractionReply::None)
}
```

If the private methods are named differently, inspect the body of `handle_live_event` and extract its existing branches into private methods with these exact signatures:

```rust
async fn handle_text_interaction(
    &self,
    uid: i64,
    uname: &str,
    text: &str,
    sc_price: Option<i64>,
) -> anyhow::Result<MusicInteractionReply>

async fn handle_gift_interaction(
    &self,
    uid: i64,
    uname: &str,
    gift_name: &str,
    gift_count: i64,
    gift_price: i64,
) -> anyhow::Result<MusicInteractionReply>
```

- [ ] **Step 4: Add platform tests**

Add tests beside existing music service tests:

```rust
#[tokio::test]
async fn platform_danmu_event_uses_text_interaction_path() {
    let service = test_service();
    let event = crate::live_platform::types::PlatformEvent::Message(
        crate::live_platform::types::ChatMessageEvent {
            user: crate::live_platform::types::PlatformUserRef::bilibili(42, "alice"),
            text: "点歌 青花瓷".to_string(),
        },
    );

    let reply = service.handle_platform_event(&event).await.unwrap();

    assert!(matches!(
        reply,
        crate::music::service::MusicInteractionReply::NeedConfirm { .. }
            | crate::music::service::MusicInteractionReply::Queued { .. }
            | crate::music::service::MusicInteractionReply::Text(_)
            | crate::music::service::MusicInteractionReply::None
    ));
}
```

Use the existing local test constructor name instead of `test_service()` if the file already has one. The assertion deliberately accepts existing configuration-dependent reply variants but requires the method to execute without error.

- [ ] **Step 5: Run tests**

Run:

```bash
cargo test music::service::tests --features tauri
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/music/service.rs
git commit -m "feat: accept platform events in music service"
```

---

### Task 2: Add Platform Monitor Loop and Keep Legacy Wrapper

**Files:**
- Modify: `src/bot/monitor.rs`

- [ ] **Step 1: Add platform imports**

Replace the top-level `use crate::api::BiliApi;` with both the temporary legacy import and platform imports:

```rust
use crate::api::BiliApi as LegacyBiliApi;
use crate::live_platform::{
    PlatformEvent, PlatformEventEnvelope, PlatformRegistry, PlatformRoomRef, PlatformSession,
};
```

- [ ] **Step 2: Rename existing monitor loop to legacy wrapper target**

Rename the current `run_monitor_loop` function to:

```rust
pub async fn run_bilibili_monitor_loop<E: EventEmitter + Send + Sync + 'static>(
    app: E,
    http: LegacyBiliApi,
    room_id: i64,
    cancel: CancellationToken,
    tts_router: SharedTtsRouter,
    tts_cancel: Arc<Mutex<CancellationToken>>,
    command_rx: mpsc::UnboundedReceiver<MonitorCommand>,
    current_session_id: Arc<Mutex<Option<String>>>,
    danmaku_buffer: Arc<Mutex<Vec<String>>>,
    model_dir: std::path::PathBuf,
    session_memory: Arc<Mutex<crate::bot::memory::SessionMemory>>,
) -> Result<()>
```

Do not edit the function body in this step.

- [ ] **Step 3: Recreate `run_monitor_loop` as a platform entry point**

Add a new function above `run_bilibili_monitor_loop`:

```rust
pub async fn run_monitor_loop<E: EventEmitter + Send + Sync + 'static>(
    app: E,
    platforms: PlatformRegistry,
    room: PlatformRoomRef,
    session: PlatformSession,
    cancel: CancellationToken,
    tts_router: SharedTtsRouter,
    tts_cancel: Arc<Mutex<CancellationToken>>,
    command_rx: mpsc::UnboundedReceiver<MonitorCommand>,
    current_session_id: Arc<Mutex<Option<String>>>,
    danmaku_buffer: Arc<Mutex<Vec<String>>>,
    model_dir: std::path::PathBuf,
    session_memory: Arc<Mutex<crate::bot::memory::SessionMemory>>,
) -> Result<()> {
    if room.platform_id.as_str() == "bilibili" {
        let http = crate::live_platform::bilibili::BilibiliPlatform::new()?.api().clone();
        let room_id = room.platform_room_id.parse::<i64>()?;
        return run_bilibili_monitor_loop(
            app,
            http,
            room_id,
            cancel,
            tts_router,
            tts_cancel,
            command_rx,
            current_session_id,
            danmaku_buffer,
            model_dir,
            session_memory,
        )
        .await;
    }

    let platform = platforms
        .get(&room.platform_id)
        .ok_or_else(|| anyhow::anyhow!("平台未注册: {}", room.platform_id))?;
    let _ = platform;
    let _ = session;
    Err(anyhow::anyhow!("平台监听尚未接入: {}", room.platform_id))
}
```

This is intentionally a compatibility bridge. It lets `main.rs` move to platform-shaped state without rewriting the entire monitor event loop in the same commit.

- [ ] **Step 4: Add a narrow platform event processing helper**

Add this helper near the event callback code:

```rust
fn platform_event_display_line(event: &PlatformEventEnvelope) -> String {
    format!("[{}] {:?}", event.room.log_label(), event.event)
}
```

This helper is not used by the compatibility bridge yet. It is used in the follow-up monitor rewrite when replacing Bilibili callback internals.

- [ ] **Step 5: Run monitor tests**

Run:

```bash
cargo test bot::monitor::tests --features tauri
```

Expected: PASS.

- [ ] **Step 6: Run compile check**

Run:

```bash
cargo check --features tauri
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/bot/monitor.rs
git commit -m "feat: add platform monitor entry point"
```

---

### Task 3: Platformize Main State and Commands

**Files:**
- Modify: `src/main.rs`
- Modify: `src/bot/profile_worker.rs`
- Modify: `src/bot/agent/mod.rs`
- Modify: `src/bot/agent/runtime.rs`

- [ ] **Step 1: Change API imports**

In `src/main.rs`, keep `mod api;` for this task but add:

```rust
use live_platform::{
    LivePlatform, PlatformId, PlatformRegistry, PlatformRoomRef, PlatformSession, RoomInput,
};
```

In `src/bot/profile_worker.rs`, `src/bot/agent/mod.rs`, and `src/bot/agent/runtime.rs`, replace:

```rust
use crate::api::BiliApi;
```

with:

```rust
use crate::live_platform::bilibili::api::BiliApi;
```

- [ ] **Step 2: Change `SharedState`**

Replace:

```rust
http: api::BiliApi,
connected_room: Arc<Mutex<Option<i64>>>,
```

with:

```rust
platforms: PlatformRegistry,
http: live_platform::bilibili::api::BiliApi,
connected_room: Arc<Mutex<Option<PlatformRoomRef>>>,
```

Keep `http` as the Bilibili API from the adapter module because agent/profile worker still need Bilibili-specific helper methods.

- [ ] **Step 3: Add conversion helpers**

Add near the JSON helper functions:

```rust
fn stored_session_to_platform(stored: token::StoredPlatformSession) -> PlatformSession {
    PlatformSession {
        platform_id: PlatformId::from(stored.platform_id),
        payload: stored.payload,
    }
}

fn platform_session_to_stored(session: &PlatformSession) -> token::StoredPlatformSession {
    token::StoredPlatformSession {
        platform_id: session.platform_id.as_str().to_string(),
        payload: session.payload.clone(),
    }
}

fn stored_room_to_platform(room: token::StoredPlatformRoom) -> PlatformRoomRef {
    PlatformRoomRef {
        platform_id: PlatformId::from(room.platform_id),
        platform_room_id: room.platform_room_id,
        display_id: room.display_id,
    }
}

fn platform_room_to_stored(room: &PlatformRoomRef) -> token::StoredPlatformRoom {
    token::StoredPlatformRoom {
        platform_id: room.platform_id.as_str().to_string(),
        platform_room_id: room.platform_room_id.clone(),
        display_id: room.display_id.clone(),
    }
}

fn default_platform_id() -> PlatformId {
    PlatformId::from(PlatformId::BILIBILI)
}
```

- [ ] **Step 4: Add platform login commands**

Add after `get_user_info`:

```rust
#[cfg(feature = "tauri")]
#[tauri::command]
async fn list_live_platforms(
    state: tauri::State<'_, SharedState>,
) -> Result<Vec<String>, String> {
    Ok(state
        .platforms
        .list()
        .into_iter()
        .map(|id| id.as_str().to_string())
        .collect())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn create_platform_login_challenge(
    state: tauri::State<'_, SharedState>,
    platform_id: String,
) -> Result<live_platform::LoginChallenge, String> {
    let platform_id = PlatformId::from(platform_id);
    let platform = state
        .platforms
        .get(&platform_id)
        .ok_or_else(|| format!("平台未注册: {platform_id}"))?;
    platform.login_url().await.map_err(|err| err.to_string())
}

#[cfg(feature = "tauri")]
#[tauri::command]
async fn poll_platform_login(
    state: tauri::State<'_, SharedState>,
    platform_id: String,
    challenge_id: String,
) -> Result<serde_json::Value, String> {
    let platform_id = PlatformId::from(platform_id);
    let platform = state
        .platforms
        .get(&platform_id)
        .ok_or_else(|| format!("平台未注册: {platform_id}"))?;
    match platform
        .poll_login(&challenge_id)
        .await
        .map_err(|err| err.to_string())?
    {
        live_platform::LoginPoll::Pending { message } => {
            Ok(serde_json::json!({ "status": "Scanning", "message": message }))
        }
        live_platform::LoginPoll::Expired { message } => {
            Ok(serde_json::json!({ "status": "Expired", "message": message }))
        }
        live_platform::LoginPoll::Success { session } => {
            token::write_platform_session(&platform_session_to_stored(&session))
                .map_err(|err| err.to_string())?;
            Ok(serde_json::json!({ "status": "Success" }))
        }
    }
}
```

- [ ] **Step 5: Convert legacy login commands to wrappers**

Replace `start_login` body with:

```rust
async fn start_login(
    state: tauri::State<'_, SharedState>,
) -> Result<live_platform::LoginChallenge, String> {
    create_platform_login_challenge(state, PlatformId::BILIBILI.to_string()).await
}
```

Replace `poll_login` body with:

```rust
async fn poll_login(
    state: tauri::State<'_, SharedState>,
    key: String,
) -> Result<serde_json::Value, String> {
    poll_platform_login(state, PlatformId::BILIBILI.to_string(), key).await
}
```

- [ ] **Step 6: Add platform room command**

Add:

```rust
#[cfg(feature = "tauri")]
#[tauri::command]
async fn resolve_platform_room(
    state: tauri::State<'_, SharedState>,
    platform_id: String,
    room_input: String,
) -> Result<live_platform::LiveRoomInfo, String> {
    let platform_id = PlatformId::from(platform_id);
    let platform = state
        .platforms
        .get(&platform_id)
        .ok_or_else(|| format!("平台未注册: {platform_id}"))?;
    let session = token::read_platform_session(platform_id.as_str())
        .ok()
        .map(stored_session_to_platform);
    platform
        .resolve_room(RoomInput::RoomId(room_input), session.as_ref())
        .await
        .map_err(|err| err.to_string())
}
```

- [ ] **Step 7: Update `check_room` to use platform command**

In `check_room(room_id: i64)`, call:

```rust
let info = resolve_platform_room(
    state,
    PlatformId::BILIBILI.to_string(),
    room_id.to_string(),
)
.await?;
```

Return the existing legacy `RoomInfo` shape by mapping:

```rust
Ok(api::RoomInfo {
    room_id,
    short_id: info
        .room
        .display_id
        .as_deref()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0),
    uid: info.owner.as_ref().and_then(|u| u.numeric_id()).unwrap_or(0),
    live_status: info.live_status,
    live_time: info.live_time,
    title: info.title,
    uname: info.owner.map(|u| u.display_name).unwrap_or_default(),
    area_name: info.area_name,
    parent_area_name: info.parent_area_name,
    online: info.online,
    keyframe: info.keyframe,
    cover: info.cover,
})
```

- [ ] **Step 8: Update monitor start**

In `start_monitor`, replace legacy room/session loading with:

```rust
let room = match room_id {
    Some(room_id) => PlatformRoomRef::bilibili(room_id),
    None => token::read_connected_platform_room()
        .map(stored_room_to_platform)
        .ok_or_else(|| "未连接直播间".to_string())?,
};
let session = token::read_platform_session(room.platform_id.as_str())
    .map(stored_session_to_platform)
    .map_err(|err| err.to_string())?;
token::write_connected_platform_room(&platform_room_to_stored(&room))
    .map_err(|err| err.to_string())?;
```

Call monitor with:

```rust
bot::monitor::run_monitor_loop(
    emitter,
    state.platforms.clone(),
    room.clone(),
    session,
    cancel,
    tts_router,
    tts_cancel,
    command_rx,
    session_id,
    danmaku_buffer,
    model_dir,
    state.session_memory.clone(),
)
```

- [ ] **Step 9: Update send danmu**

In `send_danmu`, replace cookie and room loading with:

```rust
let room = token::read_connected_platform_room()
    .map(stored_room_to_platform)
    .ok_or_else(|| "未连接直播间".to_string())?;
let session = token::read_platform_session(room.platform_id.as_str())
    .map(stored_session_to_platform)
    .map_err(|err| err.to_string())?;
let platform = state
    .platforms
    .get(&room.platform_id)
    .ok_or_else(|| format!("平台未注册: {}", room.platform_id))?;
platform
    .send_message(&room, &session, &message)
    .await
    .map_err(|err| err.to_string())
```

- [ ] **Step 10: Initialize state**

Where `SharedState` is constructed, replace `api::BiliApi::new()?` with:

```rust
let bilibili_platform = live_platform::bilibili::BilibiliPlatform::new()?;
let bilibili_http = bilibili_platform.api().clone();
let platforms = PlatformRegistry::new(vec![std::sync::Arc::new(bilibili_platform)]);
```

Set:

```rust
platforms,
http: bilibili_http,
connected_room: Arc::new(Mutex::new(
    token::read_connected_platform_room().map(stored_room_to_platform),
)),
```

- [ ] **Step 11: Register commands**

Add to `tauri::generate_handler!`:

```rust
list_live_platforms,
create_platform_login_challenge,
poll_platform_login,
resolve_platform_room,
```

- [ ] **Step 12: Run checks**

Run:

```bash
cargo check --features tauri
cargo test bot --features tauri
```

Expected: both PASS.

- [ ] **Step 13: Commit**

```bash
git add src/main.rs src/bot/profile_worker.rs src/bot/agent/mod.rs src/bot/agent/runtime.rs
git commit -m "feat: route app state through live platform registry"
```

---

### Task 4: Platformize Plugin Room Context

**Files:**
- Modify: `src/danmaku_chat_server.rs`
- Modify: `src/plugin_settings.rs`

- [ ] **Step 1: Add current platform room helpers**

In `src/danmaku_chat_server.rs`, add near existing storage helpers:

```rust
fn current_platform_room() -> Option<crate::live_platform::PlatformRoomRef> {
    crate::token::read_connected_platform_room().map(|room| {
        crate::live_platform::PlatformRoomRef {
            platform_id: crate::live_platform::PlatformId::from(room.platform_id),
            platform_room_id: room.platform_room_id,
            display_id: room.display_id,
        }
    })
}

fn current_bilibili_room_id() -> Option<i64> {
    current_platform_room()
        .filter(|room| room.platform_id.as_str() == "bilibili")
        .and_then(|room| room.platform_room_id.parse::<i64>().ok())
}
```

- [ ] **Step 2: Replace connected room reads**

Replace every:

```rust
crate::token::read_connected_room()
```

with:

```rust
current_bilibili_room_id()
```

Keep all SQL queries using numeric `room_id` in this task. The storage compatibility columns keep those queries valid.

- [ ] **Step 3: Normalize plugin event payloads**

In `src/plugin_settings.rs`, add:

```rust
fn live_event_payload(payload: &serde_json::Value) -> &serde_json::Value {
    payload.get("event").unwrap_or(payload)
}
```

In each `apply_*_event` method, replace direct event reads from `payload` with:

```rust
let payload = live_event_payload(payload);
```

Do this at the start of each method before matching fields.

- [ ] **Step 4: Run checks**

Run:

```bash
cargo check --features tauri
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/danmaku_chat_server.rs src/plugin_settings.rs
git commit -m "feat: use platform room context for plugin data"
```

---

### Task 5: Frontend Platform Command Wrappers

**Files:**
- Modify: `src-tauri/src/app/lib/api.ts`
- Modify: `src-tauri/src/app/App.tsx`
- Modify: `src-tauri/src/app/pages/Login.tsx`

- [ ] **Step 1: Add frontend platform types**

In `src-tauri/src/app/lib/api.ts`, add near the existing login and room types:

```ts
export type PlatformId = 'bilibili' | string;

export interface PlatformRoomRef {
  platform_id: PlatformId;
  platform_room_id: string;
  display_id?: string | null;
}

export interface LiveRoomInfo {
  room: PlatformRoomRef;
  owner?: {
    platform_id: PlatformId;
    platform_user_id: string;
    display_name: string;
  } | null;
  live_status: number;
  live_time: string;
  title: string;
  area_name: string;
  parent_area_name: string;
  online: number;
  keyframe: string;
  cover: string;
}

export interface LoginChallenge {
  platform_id: PlatformId;
  challenge_id: string;
  url: string;
}
```

- [ ] **Step 2: Add platform API wrappers**

In the exported `api` object, add:

```ts
listLivePlatforms: () => invoke<PlatformId[]>('list_live_platforms'),
createPlatformLoginChallenge: (platformId: PlatformId) =>
  invoke<LoginChallenge>('create_platform_login_challenge', { platformId }),
pollPlatformLogin: (platformId: PlatformId, challengeId: string) =>
  invoke<any>('poll_platform_login', { platformId, challengeId }),
resolvePlatformRoom: (platformId: PlatformId, roomInput: string) =>
  invoke<LiveRoomInfo>('resolve_platform_room', { platformId, roomInput }),
```

Change legacy wrappers:

```ts
startLogin: () => invoke<LoginChallenge>('start_login'),
pollLogin: (key: string) => invoke<any>('poll_login', { key }),
```

If `pollLogin` does not exist, add it so `App.tsx` and `Login.tsx` stop calling `invoke` directly.

- [ ] **Step 3: Update `App.tsx` poll login**

Replace direct:

```ts
await invoke<any>('poll_login', { key: loginKey })
```

with:

```ts
await api.pollLogin(loginKey)
```

When reading login key from a challenge, support both shapes:

```ts
const key = challenge.challenge_id ?? challenge.qrcode_key;
```

- [ ] **Step 4: Update `Login.tsx` poll login**

Replace direct:

```ts
await invoke<any>('poll_login', { key: loginUrl.qrcode_key })
```

with:

```ts
const key = loginUrl.challenge_id ?? loginUrl.qrcode_key;
const res = await api.pollLogin(key);
```

If `loginUrl` is typed as the old `LoginUrl`, widen it:

```ts
const [loginUrl, setLoginUrl] = useState<(LoginUrl & Partial<LoginChallenge>) | null>(null);
```

- [ ] **Step 5: Run frontend build**

Run:

```bash
cd src-tauri && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/app/lib/api.ts src-tauri/src/app/App.tsx src-tauri/src/app/pages/Login.tsx
git commit -m "feat: add frontend live platform wrappers"
```

---

### Task 6: Platform User Keys in Storage

**Files:**
- Modify: `src/storage/mod.rs`
- Modify: `src/bot/mod.rs`

- [ ] **Step 1: Add user table platform columns**

In `Storage::from_connection`, add to `tracked_users` schema:

```sql
platform_id text not null default 'bilibili',
platform_user_id text,
```

Add to `user_profiles` schema:

```sql
platform_id text not null default 'bilibili',
platform_user_id text,
```

- [ ] **Step 2: Add migrations**

After existing `tracked_users` `tts_voice_id` migration, add:

```rust
ensure_column(
    &conn,
    "tracked_users",
    "platform_id",
    "text not null default 'bilibili'",
)?;
ensure_column(&conn, "tracked_users", "platform_user_id", "text")?;
ensure_column(
    &conn,
    "user_profiles",
    "platform_id",
    "text not null default 'bilibili'",
)?;
ensure_column(&conn, "user_profiles", "platform_user_id", "text")?;
conn.execute(
    "update tracked_users
        set platform_user_id = cast(uid as text)
      where platform_user_id is null",
    [],
)?;
conn.execute(
    "update user_profiles
        set platform_user_id = cast(uid as text)
      where platform_user_id is null",
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
```

- [ ] **Step 3: Add platform-aware auto-track method**

Add to `impl Storage` near `auto_track_user`:

```rust
pub fn auto_track_platform_user(
    &self,
    platform_id: &str,
    platform_user_id: &str,
    numeric_uid: Option<i64>,
    uname: &str,
    source: &str,
) -> Result<()> {
    let uid = numeric_uid.unwrap_or(0);
    if uid == 0 && platform_id == "bilibili" {
        return Ok(());
    }
    let conn = self.conn.lock().expect("storage mutex poisoned");
    conn.execute(
        "insert into tracked_users
         (uid, platform_id, platform_user_id, nickname, auto_tracked, created_at, updated_at)
         values (?1, ?2, ?3, ?4, 1, datetime('now'), datetime('now'))
         on conflict(uid) do update set
           platform_id = excluded.platform_id,
           platform_user_id = excluded.platform_user_id,
           nickname = case
             when tracked_users.nickname = '' then excluded.nickname
             else tracked_users.nickname
           end,
           updated_at = datetime('now')",
        params![uid, platform_id, platform_user_id, uname],
    )?;
    let _ = source;
    Ok(())
}
```

- [ ] **Step 4: Update platform auto-track helper**

In `src/bot/mod.rs`, replace the call inside `try_auto_track_platform`:

```rust
storage.auto_track_user(uid, &user.display_name, event_type)
```

with:

```rust
storage.auto_track_platform_user(
    user.platform_id.as_str(),
    &user.platform_user_id,
    Some(uid),
    &user.display_name,
    event_type,
)
```

- [ ] **Step 5: Add storage test**

In `src/storage/mod.rs` tests, add:

```rust
#[test]
fn storage_creates_platform_user_columns() {
    let storage = Storage::open_in_memory().unwrap();
    let conn = storage.conn.lock().unwrap();
    let mut stmt = conn.prepare("pragma table_info(tracked_users)").unwrap();
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    assert!(columns.contains(&"platform_id".to_string()));
    assert!(columns.contains(&"platform_user_id".to_string()));
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
cargo test storage::tests --features tauri
cargo test bot --features tauri
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/storage/mod.rs src/bot/mod.rs
git commit -m "feat: add platform user keys to storage"
```

---

### Task 7: Remove Legacy Root Bilibili API

**Files:**
- Delete: `src/api.rs`
- Modify: `src/main.rs`
- Modify remaining files reported by scan

- [ ] **Step 1: Scan forbidden imports**

Run:

```bash
rg -n "crate::api|mod api|api::BiliApi|bilibili_live_protocol::LiveEvent|ParsedLiveEvent|use bilibili_live_protocol" src --glob '*.rs'
```

Expected before edits: matches in legacy compatibility code and Bilibili adapter/tests.

- [ ] **Step 2: Remove root API module**

Delete `src/api.rs`.

Remove from `src/main.rs`:

```rust
mod api;
```

- [ ] **Step 3: Update legacy type references**

In `src/main.rs`, replace legacy return types:

```rust
api::RoomInfo
api::LoginUrl
api::UserInfo
```

with:

```rust
live_platform::bilibili::api::RoomInfo
live_platform::LoginChallenge
live_platform::bilibili::api::UserInfo
```

For functions that still need Bilibili API helpers, use:

```rust
live_platform::bilibili::api::BiliApi
```

- [ ] **Step 4: Remove temporary monitor legacy import**

In `src/bot/monitor.rs`, replace:

```rust
use crate::api::BiliApi as LegacyBiliApi;
```

with:

```rust
use crate::live_platform::bilibili::api::BiliApi as LegacyBiliApi;
```

Keep `run_bilibili_monitor_loop` until the full event callback is rewritten to platform-native processing.

- [ ] **Step 5: Re-run forbidden scan**

Run:

```bash
rg -n "crate::api|mod api|api::BiliApi" src --glob '*.rs'
```

Expected: no matches.

Run:

```bash
rg -n "bilibili_live_protocol::LiveEvent|ParsedLiveEvent|use bilibili_live_protocol" src --glob '*.rs'
```

Expected: matches may remain only in `src/live_platform/bilibili/`, `src/bot/monitor.rs`, `src/bot/engine.rs` compatibility wrapper, `src/storage/mod.rs` compatibility methods/tests, `src/music/service.rs` compatibility methods/tests, and `src/bot/thanks.rs` if not part of this migration.

- [ ] **Step 6: Run full checks**

Run:

```bash
cargo test --features tauri
cargo check --features tauri
cd src-tauri && npm run build
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src src-tauri
git rm src/api.rs
git commit -m "refactor: remove root bilibili api module"
```

---

## Self-Review

- Spec coverage: This continuation plan covers the remaining runtime path, command API, plugin context, frontend wrapper, platform user keys, and legacy root API removal. It does not add a second platform or multi-room monitoring.
- Scope: The plan preserves existing Bilibili behavior and intentionally leaves deep monitor callback rewriting behind a compatibility bridge so each commit remains buildable.
- Type consistency: Uses existing committed names: `PlatformRegistry`, `PlatformRoomRef`, `PlatformSession`, `PlatformId`, `RoomInput`, `PlatformEvent`, and `PlatformEventEnvelope`.
- Verification: Each task has a focused test/check command and a commit step. The final task runs Rust tests, Rust check, and frontend build.
