# Multi Live Platform Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Streamix from a Bilibili-coupled live bot into a platform-neutral live platform core with Bilibili as the first adapter.

**Architecture:** Introduce `src/live_platform` as the boundary for auth, room resolution, event streaming, event mapping, and sending messages. Move Bilibili-specific HTTP/protocol logic behind `BilibiliPlatform`, then migrate monitor, bot, storage, plugin, Tauri command, and frontend callers to use platform-neutral types.

**Tech Stack:** Rust 2024, Tokio, async-trait, serde, rusqlite, Tauri 2, React/TypeScript/Vite.

---

## Scope Check

This is intentionally a large core refactor because the approved spec requests a complete abstraction covering login, room management, event listening, and sending messages. The plan is split into commit-sized tasks that keep Bilibili working throughout the migration where practical. Do not add a second platform in this plan.

## File Structure

Create:

- `src/live_platform/mod.rs` - module exports.
- `src/live_platform/types.rs` - platform IDs, room/user refs, room info, event structs.
- `src/live_platform/error.rs` - platform error type and operation/kind enums.
- `src/live_platform/auth.rs` - login challenge, login poll, session, session status.
- `src/live_platform/adapter.rs` - `LivePlatform` trait and event sink.
- `src/live_platform/registry.rs` - platform registry and lookup.
- `src/live_platform/bilibili/mod.rs` - Bilibili adapter exports.
- `src/live_platform/bilibili/api.rs` - existing Bilibili HTTP API moved from `src/api.rs`.
- `src/live_platform/bilibili/adapter.rs` - `BilibiliPlatform` implementation.
- `src/live_platform/bilibili/events.rs` - Bilibili `ParsedLiveEvent` to `PlatformEventEnvelope` mapping.
- `src/live_platform/bilibili/events_tests.rs` - Bilibili event mapping tests.

Modify:

- `Cargo.toml` - add `async-trait` only if not already present; it is already present, so no dependency change is expected.
- `src/main.rs` - use `PlatformRegistry`, platform sessions, platform commands, and platform monitor start.
- `src/token.rs` - store platform sessions and connected platform rooms while reading old Bilibili files.
- `src/bot/monitor.rs` - accept platform runtime inputs and process `PlatformEventEnvelope`.
- `src/bot/engine.rs` - process `PlatformEvent` instead of Bilibili `LiveEvent`.
- `src/bot/mod.rs` - auto-track and profile-trigger helpers use platform-neutral events.
- `src/bot/profile_worker.rs` - limit Bilibili-specific profile enrichment to Bilibili users through the platform adapter.
- `src/storage/mod.rs` - add platform columns, migration, and event insertion/query changes.
- `src/music/service.rs` and `src/music/storage.rs` - use platform room/user identifiers where live events are consumed or queried.
- `src/plugin_settings.rs` - accept platform-neutral event JSON for plugin state updates.
- `src/danmaku_chat_server.rs` - query current platform room and include platform filters.
- `src-tauri/src/app/runtime/api.ts` or existing invoke wrapper - expose platform command wrappers.
- `src-tauri/src/app/runtime/types.ts` - add platform status and room types.
- `src-tauri/src/app/pages/App.tsx`, `Dashboard.tsx`, `Danmu.tsx`, and login/room components found during implementation - carry `platform_id`.

Delete or retire after migration:

- `src/api.rs` - remove after Bilibili API has moved to `src/live_platform/bilibili/api.rs` and all imports are updated.

---

### Task 1: Add Platform Core Types

**Files:**
- Create: `src/live_platform/mod.rs`
- Create: `src/live_platform/types.rs`
- Create: `src/live_platform/error.rs`
- Create: `src/live_platform/auth.rs`
- Create: `src/live_platform/adapter.rs`
- Create: `src/live_platform/registry.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Add module declaration**

Modify `src/main.rs` near the existing `mod api;` declarations:

```rust
mod ai_client;
mod bot;
mod config;
mod danmaku_chat_server;
mod live_platform;
mod music;
mod obs;
mod plugin_settings;
mod storage;
mod token;
```

Keep `mod api;` for now if any code still imports it during this task. It is removed in the cleanup task.

- [ ] **Step 2: Create module exports**

Create `src/live_platform/mod.rs`:

```rust
pub mod adapter;
pub mod auth;
pub mod error;
pub mod registry;
pub mod types;

pub mod bilibili;

pub use adapter::{LivePlatform, PlatformEventSink};
pub use auth::{LoginChallenge, LoginPoll, PlatformSession, SessionStatus};
pub use error::{PlatformError, PlatformErrorKind, PlatformOperation};
pub use registry::PlatformRegistry;
pub use types::*;
```

- [ ] **Step 3: Create error types**

Create `src/live_platform/error.rs`:

```rust
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::live_platform::types::PlatformId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformErrorKind {
    UnsupportedFeature,
    AuthRequired,
    AuthExpired,
    RoomNotFound,
    RoomNotLive,
    RateLimited,
    Network,
    ProtocolChanged,
    InvalidInput,
    Internal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformOperation {
    LoginUrl,
    PollLogin,
    ValidateSession,
    ResolveRoom,
    RoomInfo,
    ConnectEvents,
    SendMessage,
    UserInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformError {
    pub platform_id: PlatformId,
    pub operation: PlatformOperation,
    pub kind: PlatformErrorKind,
    pub message: String,
    pub source_detail: String,
}

impl PlatformError {
    pub fn new(
        platform_id: impl Into<PlatformId>,
        operation: PlatformOperation,
        kind: PlatformErrorKind,
        message: impl Into<String>,
        source_detail: impl Into<String>,
    ) -> Self {
        Self {
            platform_id: platform_id.into(),
            operation,
            kind,
            message: message.into(),
            source_detail: source_detail.into(),
        }
    }

    pub fn internal(
        platform_id: impl Into<PlatformId>,
        operation: PlatformOperation,
        err: impl std::fmt::Display,
    ) -> Self {
        let detail = err.to_string();
        Self::new(
            platform_id,
            operation,
            PlatformErrorKind::Internal,
            detail.clone(),
            detail,
        )
    }
}

impl fmt::Display for PlatformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "[{}:{:?}] {}",
            self.platform_id, self.operation, self.message
        )
    }
}

impl std::error::Error for PlatformError {}
```

- [ ] **Step 4: Create platform types**

Create `src/live_platform/types.rs`:

```rust
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct PlatformId(pub String);

impl PlatformId {
    pub const BILIBILI: &'static str = "bilibili";

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for PlatformId {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

impl From<String> for PlatformId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl std::fmt::Display for PlatformId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlatformRoomRef {
    pub platform_id: PlatformId,
    pub platform_room_id: String,
    pub display_id: Option<String>,
}

impl PlatformRoomRef {
    pub fn bilibili(room_id: i64) -> Self {
        Self {
            platform_id: PlatformId::from(PlatformId::BILIBILI),
            platform_room_id: room_id.to_string(),
            display_id: Some(room_id.to_string()),
        }
    }

    pub fn log_label(&self) -> String {
        format!("{}:{}", self.platform_id, self.platform_room_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlatformUserRef {
    pub platform_id: PlatformId,
    pub platform_user_id: String,
    pub display_name: String,
}

impl PlatformUserRef {
    pub fn bilibili(uid: i64, name: impl Into<String>) -> Self {
        Self {
            platform_id: PlatformId::from(PlatformId::BILIBILI),
            platform_user_id: uid.to_string(),
            display_name: name.into(),
        }
    }

    pub fn numeric_id(&self) -> Option<i64> {
        self.platform_user_id.parse().ok()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveRoomInfo {
    pub room: PlatformRoomRef,
    pub owner: Option<PlatformUserRef>,
    pub live_status: i32,
    pub live_time: String,
    pub title: String,
    pub area_name: String,
    pub parent_area_name: String,
    pub online: i64,
    pub keyframe: String,
    pub cover: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoomInput {
    RoomId(String),
    UserId(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlatformEventEnvelope {
    pub platform_id: PlatformId,
    pub room: PlatformRoomRef,
    pub event_id: Option<String>,
    pub occurred_at: DateTime<Local>,
    pub event: PlatformEvent,
    pub raw: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PlatformEvent {
    Message(ChatMessageEvent),
    Gift(GiftEvent),
    Follow(UserEvent),
    Share(UserEvent),
    Enter(UserEvent),
    Like(LikeEvent),
    GuardOrMember(GuardOrMemberEvent),
    PaidMessage(PaidMessageEvent),
    Moderation(ModerationEvent),
    Popularity(PopularityEvent),
    Battle(BattleEvent),
    Lottery(LotteryEvent),
    System(SystemEvent),
    Unknown(UnknownEvent),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessageEvent {
    pub user: PlatformUserRef,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GiftEvent {
    pub user: PlatformUserRef,
    pub gift: String,
    pub count: i64,
    pub price: i64,
    pub original_gift_name: Option<String>,
    pub original_gift_price: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserEvent {
    pub user: PlatformUserRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LikeEvent {
    pub user: PlatformUserRef,
    pub count: i64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GuardOrMemberEvent {
    pub user: PlatformUserRef,
    pub gift: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaidMessageEvent {
    pub user: PlatformUserRef,
    pub text: String,
    pub price: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModerationEvent {
    pub user_name: String,
    pub action: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PopularityEvent {
    pub value: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BattleEvent {
    Start {
        init_room_id: Option<String>,
        match_room_id: Option<String>,
    },
    End,
    Process,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LotteryEvent {
    New {
        user: Option<PlatformUserRef>,
        gift: String,
        price: i64,
    },
    WinnerList,
    Start,
    Award,
    End,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemEvent {
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnknownEvent {
    pub name: String,
}
```

- [ ] **Step 5: Create auth types**

Create `src/live_platform/auth.rs`:

```rust
use serde::{Deserialize, Serialize};

use crate::live_platform::types::PlatformId;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginChallenge {
    pub platform_id: PlatformId,
    pub challenge_id: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum LoginPoll {
    Pending { message: String },
    Success { session: PlatformSession },
    Expired { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformSession {
    pub platform_id: PlatformId,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum SessionStatus {
    Valid { display_name: String, saved_at: i64 },
    Missing,
    Expired,
}
```

- [ ] **Step 6: Create adapter trait**

Create `src/live_platform/adapter.rs`:

```rust
use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::live_platform::auth::{LoginChallenge, LoginPoll, PlatformSession, SessionStatus};
use crate::live_platform::error::PlatformError;
use crate::live_platform::types::{
    LiveRoomInfo, PlatformEventEnvelope, PlatformId, PlatformRoomRef, RoomInput,
};

pub type PlatformEventSink = mpsc::UnboundedSender<PlatformEventEnvelope>;

#[async_trait]
pub trait LivePlatform: Send + Sync {
    fn id(&self) -> PlatformId;

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
        session: PlatformSession,
        sink: PlatformEventSink,
    ) -> Result<(), PlatformError>;
    async fn send_message(
        &self,
        room: &PlatformRoomRef,
        session: &PlatformSession,
        text: &str,
    ) -> Result<(), PlatformError>;
}
```

- [ ] **Step 7: Create registry**

Create `src/live_platform/registry.rs`:

```rust
use std::collections::BTreeMap;
use std::sync::Arc;

use crate::live_platform::adapter::LivePlatform;
use crate::live_platform::types::PlatformId;

#[derive(Clone, Default)]
pub struct PlatformRegistry {
    platforms: Arc<BTreeMap<PlatformId, Arc<dyn LivePlatform>>>,
}

impl PlatformRegistry {
    pub fn new(platforms: Vec<Arc<dyn LivePlatform>>) -> Self {
        let mut map = BTreeMap::new();
        for platform in platforms {
            map.insert(platform.id(), platform);
        }
        Self {
            platforms: Arc::new(map),
        }
    }

    pub fn get(&self, platform_id: &PlatformId) -> Option<Arc<dyn LivePlatform>> {
        self.platforms.get(platform_id).cloned()
    }

    pub fn list(&self) -> Vec<PlatformId> {
        self.platforms.keys().cloned().collect()
    }
}
```

- [ ] **Step 8: Run core type check**

Run:

```bash
cargo check --features tauri
```

Expected: this may fail because `src/live_platform/bilibili/mod.rs` is not created yet if `pub mod bilibili;` is active. If it fails with only `file not found for module bilibili`, continue to Task 2. If it fails with missing serde/chrono imports in the new files, fix the imports before continuing.

- [ ] **Step 9: Commit**

```bash
git add src/live_platform src/main.rs
git commit -m "feat: add live platform core types"
```

---

### Task 2: Add Bilibili Adapter Boundary

**Files:**
- Create: `src/live_platform/bilibili/mod.rs`
- Create: `src/live_platform/bilibili/api.rs`
- Create: `src/live_platform/bilibili/events.rs`
- Create: `src/live_platform/bilibili/adapter.rs`
- Create: `src/live_platform/bilibili/events_tests.rs`
- Modify: `src/live_platform/mod.rs`

- [ ] **Step 1: Create Bilibili module**

Create `src/live_platform/bilibili/mod.rs`:

```rust
pub mod adapter;
pub mod api;
pub mod events;

#[cfg(test)]
mod events_tests;

pub use adapter::BilibiliPlatform;
pub use api::{BiliApi, DanmuInfo, LoginPoll as BiliLoginPoll, LoginUrl, RoomInfo, UserInfo};
```

- [ ] **Step 2: Move Bilibili API code**

Copy the complete contents of `src/api.rs` into `src/live_platform/bilibili/api.rs`.

At the top of `src/live_platform/bilibili/api.rs`, keep these imports:

```rust
use std::time::{SystemTime, UNIX_EPOCH};

use crate::token;
use anyhow::{anyhow, Result};
use reqwest::header::{HeaderMap, HeaderValue, COOKIE, USER_AGENT};
use serde::{Deserialize, Serialize};
```

Do not delete `src/api.rs` yet. Existing code still uses it until Task 12.

- [ ] **Step 3: Add Bilibili event mapping**

Create `src/live_platform/bilibili/events.rs`:

```rust
use chrono::Local;

use crate::live_platform::types::{
    BattleEvent, ChatMessageEvent, GiftEvent, GuardOrMemberEvent, LikeEvent, LotteryEvent,
    ModerationEvent, PaidMessageEvent, PlatformEvent, PlatformEventEnvelope, PlatformId,
    PlatformRoomRef, PlatformUserRef, PopularityEvent, SystemEvent, UnknownEvent, UserEvent,
};

pub fn map_bilibili_event(
    room: &PlatformRoomRef,
    parsed: bilibili_live_protocol::ParsedLiveEvent,
) -> PlatformEventEnvelope {
    let platform_id = PlatformId::from(PlatformId::BILIBILI);
    let event = match parsed.event {
        bilibili_live_protocol::LiveEvent::Danmu {
            user_id,
            user,
            text,
        } => PlatformEvent::Message(ChatMessageEvent {
            user: PlatformUserRef::bilibili(user_id, user),
            text,
        }),
        bilibili_live_protocol::LiveEvent::Gift {
            user_id,
            user,
            gift,
            count,
            price,
            original_gift_name,
            original_gift_price,
        } => PlatformEvent::Gift(GiftEvent {
            user: PlatformUserRef::bilibili(user_id, user),
            gift,
            count,
            price,
            original_gift_name,
            original_gift_price,
        }),
        bilibili_live_protocol::LiveEvent::Interact {
            kind,
            user_id,
            user,
        } => {
            let user = PlatformUserRef::bilibili(user_id, user);
            match kind {
                bilibili_live_protocol::InteractKind::Entry => {
                    PlatformEvent::Enter(UserEvent { user })
                }
                bilibili_live_protocol::InteractKind::Follow
                | bilibili_live_protocol::InteractKind::MutualFollow => {
                    PlatformEvent::Follow(UserEvent { user })
                }
                bilibili_live_protocol::InteractKind::Share => {
                    PlatformEvent::Share(UserEvent { user })
                }
                bilibili_live_protocol::InteractKind::Unknown(value) => {
                    PlatformEvent::Unknown(UnknownEvent {
                        name: format!("INTERACT_WORD:{value}"),
                    })
                }
            }
        }
        bilibili_live_protocol::LiveEvent::EntryEffect {
            user_id, user, ..
        } => PlatformEvent::Enter(UserEvent {
            user: PlatformUserRef::bilibili(user_id, user),
        }),
        bilibili_live_protocol::LiveEvent::LikeClick {
            user_id,
            user,
            count,
            text,
        } => PlatformEvent::Like(LikeEvent {
            user: PlatformUserRef::bilibili(user_id, user),
            count,
            text,
        }),
        bilibili_live_protocol::LiveEvent::GuardBuy {
            user_id,
            user,
            gift,
        } => PlatformEvent::GuardOrMember(GuardOrMemberEvent {
            user: PlatformUserRef::bilibili(user_id, user),
            gift,
        }),
        bilibili_live_protocol::LiveEvent::SuperChat {
            user_id,
            user,
            text,
            price,
        } => PlatformEvent::PaidMessage(PaidMessageEvent {
            user: PlatformUserRef::bilibili(user_id, user),
            text,
            price,
        }),
        bilibili_live_protocol::LiveEvent::Block { user } => {
            PlatformEvent::Moderation(ModerationEvent {
                user_name: user,
                action: "block".to_string(),
            })
        }
        bilibili_live_protocol::LiveEvent::System { text } => {
            PlatformEvent::System(SystemEvent { text })
        }
        bilibili_live_protocol::LiveEvent::Popularity { value } => {
            PlatformEvent::Popularity(PopularityEvent { value })
        }
        bilibili_live_protocol::LiveEvent::Pk { kind } => PlatformEvent::Battle(match kind {
            bilibili_live_protocol::PkEventKind::Start {
                init_room_id,
                match_room_id,
            } => BattleEvent::Start {
                init_room_id: Some(init_room_id.to_string()),
                match_room_id: Some(match_room_id.to_string()),
            },
            bilibili_live_protocol::PkEventKind::End => BattleEvent::End,
            bilibili_live_protocol::PkEventKind::Process => BattleEvent::Process,
            bilibili_live_protocol::PkEventKind::Other(name) => BattleEvent::Other(name),
        }),
        bilibili_live_protocol::LiveEvent::RedPocket { kind } => {
            PlatformEvent::Lottery(match kind {
                bilibili_live_protocol::RedPocketKind::New {
                    user_id,
                    user,
                    gift,
                    price,
                } => LotteryEvent::New {
                    user: Some(PlatformUserRef::bilibili(user_id, user)),
                    gift,
                    price,
                },
                bilibili_live_protocol::RedPocketKind::WinnerList => LotteryEvent::WinnerList,
                bilibili_live_protocol::RedPocketKind::Start => LotteryEvent::Start,
                bilibili_live_protocol::RedPocketKind::Other(name) => LotteryEvent::Other(name),
            })
        }
        bilibili_live_protocol::LiveEvent::AnchorLottery { kind } => {
            PlatformEvent::Lottery(match kind {
                bilibili_live_protocol::AnchorLotteryKind::Start => LotteryEvent::Start,
                bilibili_live_protocol::AnchorLotteryKind::Award => LotteryEvent::Award,
                bilibili_live_protocol::AnchorLotteryKind::End => LotteryEvent::End,
                bilibili_live_protocol::AnchorLotteryKind::Other(name) => LotteryEvent::Other(name),
            })
        }
        bilibili_live_protocol::LiveEvent::Command { name } => {
            PlatformEvent::Unknown(UnknownEvent { name })
        }
    };

    PlatformEventEnvelope {
        platform_id,
        room: room.clone(),
        event_id: None,
        occurred_at: Local::now(),
        event,
        raw: parsed.raw,
    }
}
```

- [ ] **Step 4: Add Bilibili adapter implementation**

Create `src/live_platform/bilibili/adapter.rs`:

```rust
use async_trait::async_trait;

use crate::live_platform::adapter::{LivePlatform, PlatformEventSink};
use crate::live_platform::auth::{LoginChallenge, LoginPoll, PlatformSession, SessionStatus};
use crate::live_platform::bilibili::api::{BiliApi, LoginPoll as BiliLoginPoll, RoomInfo};
use crate::live_platform::bilibili::events::map_bilibili_event;
use crate::live_platform::error::{PlatformError, PlatformErrorKind, PlatformOperation};
use crate::live_platform::types::{
    LiveRoomInfo, PlatformId, PlatformRoomRef, PlatformUserRef, RoomInput,
};

#[derive(Clone)]
pub struct BilibiliPlatform {
    api: BiliApi,
}

impl BilibiliPlatform {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self {
            api: BiliApi::new()?,
        })
    }

    pub fn api(&self) -> &BiliApi {
        &self.api
    }

    fn platform_id() -> PlatformId {
        PlatformId::from(PlatformId::BILIBILI)
    }

    fn map_err(operation: PlatformOperation, err: impl std::fmt::Display) -> PlatformError {
        PlatformError::new(
            Self::platform_id(),
            operation,
            PlatformErrorKind::Internal,
            err.to_string(),
            err.to_string(),
        )
    }

    fn cookie(session: &PlatformSession) -> Result<String, PlatformError> {
        session
            .payload
            .get("cookie")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                PlatformError::new(
                    Self::platform_id(),
                    PlatformOperation::ValidateSession,
                    PlatformErrorKind::AuthRequired,
                    "Bilibili 登录状态缺失",
                    "session payload did not contain cookie",
                )
            })
    }

    fn room_info_to_live(info: RoomInfo) -> LiveRoomInfo {
        let room = PlatformRoomRef::bilibili(info.room_id);
        LiveRoomInfo {
            room: room.clone(),
            owner: Some(PlatformUserRef::bilibili(info.uid, info.uname.clone())),
            live_status: info.live_status,
            live_time: info.live_time,
            title: info.title,
            area_name: info.area_name,
            parent_area_name: info.parent_area_name,
            online: info.online,
            keyframe: info.keyframe,
            cover: info.cover,
        }
    }
}

#[async_trait]
impl LivePlatform for BilibiliPlatform {
    fn id(&self) -> PlatformId {
        Self::platform_id()
    }

    async fn login_url(&self) -> Result<LoginChallenge, PlatformError> {
        let login = self
            .api
            .login_url()
            .await
            .map_err(|err| Self::map_err(PlatformOperation::LoginUrl, err))?;
        Ok(LoginChallenge {
            platform_id: self.id(),
            challenge_id: login.qrcode_key,
            url: login.url,
        })
    }

    async fn poll_login(&self, challenge_id: &str) -> Result<LoginPoll, PlatformError> {
        match self
            .api
            .poll_login(challenge_id)
            .await
            .map_err(|err| Self::map_err(PlatformOperation::PollLogin, err))?
        {
            BiliLoginPoll::Pending(message) => Ok(LoginPoll::Pending { message }),
            BiliLoginPoll::Expired(message) => Ok(LoginPoll::Expired { message }),
            BiliLoginPoll::Success(cookie, refresh_token) => Ok(LoginPoll::Success {
                session: PlatformSession {
                    platform_id: self.id(),
                    payload: serde_json::json!({
                        "cookie": cookie,
                        "refresh_token": refresh_token
                    }),
                },
            }),
        }
    }

    async fn validate_session(
        &self,
        session: &PlatformSession,
    ) -> Result<SessionStatus, PlatformError> {
        let cookie = Self::cookie(session)?;
        match self.api.user_info(&cookie).await {
            Ok(info) => Ok(SessionStatus::Valid {
                display_name: info.uname,
                saved_at: 0,
            }),
            Err(err) if err.to_string().contains("登录状态无效") => Ok(SessionStatus::Expired),
            Err(err) => Err(Self::map_err(PlatformOperation::ValidateSession, err)),
        }
    }

    async fn resolve_room(
        &self,
        input: RoomInput,
        _session: Option<&PlatformSession>,
    ) -> Result<LiveRoomInfo, PlatformError> {
        let info = match input {
            RoomInput::RoomId(value) => {
                let room_id = value.parse::<i64>().map_err(|err| {
                    PlatformError::new(
                        self.id(),
                        PlatformOperation::ResolveRoom,
                        PlatformErrorKind::InvalidInput,
                        "房间号必须是数字",
                        err.to_string(),
                    )
                })?;
                self.api
                    .room_info(room_id)
                    .await
                    .map_err(|err| Self::map_err(PlatformOperation::ResolveRoom, err))?
            }
            RoomInput::UserId(value) => {
                let uid = value.parse::<i64>().map_err(|err| {
                    PlatformError::new(
                        self.id(),
                        PlatformOperation::ResolveRoom,
                        PlatformErrorKind::InvalidInput,
                        "用户 ID 必须是数字",
                        err.to_string(),
                    )
                })?;
                self.api
                    .room_id_by_uid(uid)
                    .await
                    .map_err(|err| Self::map_err(PlatformOperation::ResolveRoom, err))?
            }
        };
        Ok(Self::room_info_to_live(info))
    }

    async fn room_info(
        &self,
        room: &PlatformRoomRef,
        _session: Option<&PlatformSession>,
    ) -> Result<LiveRoomInfo, PlatformError> {
        let room_id = room.platform_room_id.parse::<i64>().map_err(|err| {
            PlatformError::new(
                self.id(),
                PlatformOperation::RoomInfo,
                PlatformErrorKind::InvalidInput,
                "Bilibili 房间号必须是数字",
                err.to_string(),
            )
        })?;
        let info = self
            .api
            .room_info(room_id)
            .await
            .map_err(|err| Self::map_err(PlatformOperation::RoomInfo, err))?;
        Ok(Self::room_info_to_live(info))
    }

    async fn connect_events(
        &self,
        room: PlatformRoomRef,
        session: PlatformSession,
        sink: PlatformEventSink,
    ) -> Result<(), PlatformError> {
        let cookie = Self::cookie(&session)?;
        let room_id = room.platform_room_id.parse::<i64>().map_err(|err| {
            PlatformError::new(
                self.id(),
                PlatformOperation::ConnectEvents,
                PlatformErrorKind::InvalidInput,
                "Bilibili 房间号必须是数字",
                err.to_string(),
            )
        })?;
        let user = self
            .api
            .user_info(&cookie)
            .await
            .map_err(|err| Self::map_err(PlatformOperation::ConnectEvents, err))?;
        let buvid = self
            .api
            .fetch_buvid()
            .await
            .map_err(|err| Self::map_err(PlatformOperation::ConnectEvents, err))?;
        let danmu = self
            .api
            .danmu_info(room_id, &cookie)
            .await
            .map_err(|err| Self::map_err(PlatformOperation::ConnectEvents, err))?;
        let config = bilibili_live_protocol::ConnectConfig {
            room_id,
            uid: user.uid,
            buvid,
            token: danmu.token,
            hosts: danmu.hosts,
        };
        let room_for_events = room.clone();
        bilibili_live_protocol::run_parsed_client(config, move |parsed| {
            let _ = sink.send(map_bilibili_event(&room_for_events, parsed));
        })
        .await
        .map_err(|err| Self::map_err(PlatformOperation::ConnectEvents, err))
    }

    async fn send_message(
        &self,
        room: &PlatformRoomRef,
        session: &PlatformSession,
        text: &str,
    ) -> Result<(), PlatformError> {
        let cookie = Self::cookie(session)?;
        let room_id = room.platform_room_id.parse::<i64>().map_err(|err| {
            PlatformError::new(
                self.id(),
                PlatformOperation::SendMessage,
                PlatformErrorKind::InvalidInput,
                "Bilibili 房间号必须是数字",
                err.to_string(),
            )
        })?;
        self.api
            .send_danmu(room_id, text, &cookie)
            .await
            .map_err(|err| Self::map_err(PlatformOperation::SendMessage, err))
    }
}
```

- [ ] **Step 5: Add mapping tests**

Create `src/live_platform/bilibili/events_tests.rs`:

```rust
use serde_json::json;

use crate::live_platform::bilibili::events::map_bilibili_event;
use crate::live_platform::types::{BattleEvent, PlatformEvent, PlatformRoomRef};

fn room() -> PlatformRoomRef {
    PlatformRoomRef::bilibili(1000)
}

#[test]
fn maps_danmu_to_message() {
    let event = map_bilibili_event(
        &room(),
        bilibili_live_protocol::ParsedLiveEvent {
            event: bilibili_live_protocol::LiveEvent::Danmu {
                user_id: 42,
                user: "alice".to_string(),
                text: "hello".to_string(),
            },
            raw: json!({"cmd": "DANMU_MSG"}),
        },
    );
    match event.event {
        PlatformEvent::Message(message) => {
            assert_eq!(message.user.platform_user_id, "42");
            assert_eq!(message.user.display_name, "alice");
            assert_eq!(message.text, "hello");
        }
        other => panic!("expected message, got {other:?}"),
    }
}

#[test]
fn maps_gift_to_gift() {
    let event = map_bilibili_event(
        &room(),
        bilibili_live_protocol::ParsedLiveEvent {
            event: bilibili_live_protocol::LiveEvent::Gift {
                user_id: 7,
                user: "bob".to_string(),
                gift: "辣条".to_string(),
                count: 2,
                price: 100,
                original_gift_name: Some("盲盒".to_string()),
                original_gift_price: 50,
            },
            raw: json!({"cmd": "SEND_GIFT"}),
        },
    );
    match event.event {
        PlatformEvent::Gift(gift) => {
            assert_eq!(gift.user.platform_user_id, "7");
            assert_eq!(gift.gift, "辣条");
            assert_eq!(gift.count, 2);
            assert_eq!(gift.price, 100);
        }
        other => panic!("expected gift, got {other:?}"),
    }
}

#[test]
fn maps_follow_to_follow() {
    let event = map_bilibili_event(
        &room(),
        bilibili_live_protocol::ParsedLiveEvent {
            event: bilibili_live_protocol::LiveEvent::Interact {
                kind: bilibili_live_protocol::InteractKind::Follow,
                user_id: 9,
                user: "cat".to_string(),
            },
            raw: json!({"cmd": "INTERACT_WORD"}),
        },
    );
    assert!(matches!(event.event, PlatformEvent::Follow(_)));
}

#[test]
fn maps_pk_start_to_battle_start() {
    let event = map_bilibili_event(
        &room(),
        bilibili_live_protocol::ParsedLiveEvent {
            event: bilibili_live_protocol::LiveEvent::Pk {
                kind: bilibili_live_protocol::PkEventKind::Start {
                    init_room_id: 1,
                    match_room_id: 2,
                },
            },
            raw: json!({"cmd": "PK_BATTLE_START"}),
        },
    );
    match event.event {
        PlatformEvent::Battle(BattleEvent::Start {
            init_room_id,
            match_room_id,
        }) => {
            assert_eq!(init_room_id.as_deref(), Some("1"));
            assert_eq!(match_room_id.as_deref(), Some("2"));
        }
        other => panic!("expected battle start, got {other:?}"),
    }
}

#[test]
fn maps_command_to_unknown() {
    let event = map_bilibili_event(
        &room(),
        bilibili_live_protocol::ParsedLiveEvent {
            event: bilibili_live_protocol::LiveEvent::Command {
                name: "NEW_CMD".to_string(),
            },
            raw: json!({"cmd": "NEW_CMD"}),
        },
    );
    match event.event {
        PlatformEvent::Unknown(unknown) => assert_eq!(unknown.name, "NEW_CMD"),
        other => panic!("expected unknown, got {other:?}"),
    }
}
```

- [ ] **Step 6: Run mapping tests**

Run:

```bash
cargo test live_platform::bilibili::events_tests --features tauri
```

Expected: PASS. If compilation fails because `BiliApi` methods in copied `api.rs` still refer to module paths that changed, update only those paths inside `src/live_platform/bilibili/api.rs`.

- [ ] **Step 7: Commit**

```bash
git add src/live_platform
git commit -m "feat: add bilibili live platform adapter"
```

---

### Task 3: Platform Session and Connected Room Persistence

**Files:**
- Modify: `src/token.rs`
- Test: `src/token.rs`

- [ ] **Step 1: Add platform session and room structs**

Modify `src/token.rs` after the existing `Session` struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPlatformSession {
    pub platform_id: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPlatformRoom {
    pub platform_id: String,
    pub platform_room_id: String,
    pub display_id: Option<String>,
}
```

- [ ] **Step 2: Add new paths**

Modify `src/token.rs` near `session_path()`:

```rust
fn platform_session_path(platform_id: &str) -> PathBuf {
    auth_dir().join(format!("session-{platform_id}.json"))
}

fn connected_platform_room_path() -> PathBuf {
    auth_dir().join("connected_room.json")
}
```

- [ ] **Step 3: Add platform session helpers with Bilibili fallback**

Add to `src/token.rs` after `session_saved_at()`:

```rust
pub fn read_platform_session(platform_id: &str) -> Result<StoredPlatformSession> {
    let path = platform_session_path(platform_id);
    if path.exists() {
        let content = std::fs::read_to_string(path)?;
        return Ok(serde_json::from_str(&content)?);
    }

    if platform_id == "bilibili" {
        let legacy = read_session()?;
        return Ok(StoredPlatformSession {
            platform_id: platform_id.to_string(),
            payload: serde_json::json!({
                "cookie": legacy.cookie,
                "refresh_token": legacy.refresh_token
            }),
        });
    }

    Err(anyhow::anyhow!("platform session not found: {platform_id}"))
}

pub fn write_platform_session(session: &StoredPlatformSession) -> Result<()> {
    let dir = auth_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(
        platform_session_path(&session.platform_id),
        serde_json::to_string_pretty(session)?,
    )?;

    if session.platform_id == "bilibili" {
        let legacy = Session {
            cookie: session
                .payload
                .get("cookie")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            refresh_token: session
                .payload
                .get("refresh_token")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
        };
        write_session(&legacy)?;
    }

    Ok(())
}

pub fn delete_platform_session(platform_id: &str) -> Result<()> {
    let _ = std::fs::remove_file(platform_session_path(platform_id));
    if platform_id == "bilibili" {
        delete_session()?;
    }
    Ok(())
}
```

- [ ] **Step 4: Add connected platform room helpers**

Add to `src/token.rs` after the legacy connected room helpers:

```rust
pub fn read_connected_platform_room() -> Option<StoredPlatformRoom> {
    if let Ok(content) = std::fs::read_to_string(connected_platform_room_path()) {
        if let Ok(room) = serde_json::from_str(&content) {
            return Some(room);
        }
    }

    read_connected_room().map(|room_id| StoredPlatformRoom {
        platform_id: "bilibili".to_string(),
        platform_room_id: room_id.to_string(),
        display_id: Some(room_id.to_string()),
    })
}

pub fn write_connected_platform_room(room: &StoredPlatformRoom) -> Result<()> {
    let dir = auth_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(
        connected_platform_room_path(),
        serde_json::to_string_pretty(room)?,
    )?;

    if room.platform_id == "bilibili" {
        if let Ok(room_id) = room.platform_room_id.parse::<i64>() {
            write_connected_room(room_id)?;
        }
    }

    Ok(())
}

pub fn delete_connected_platform_room() {
    let _ = std::fs::remove_file(connected_platform_room_path());
    delete_connected_room();
}
```

- [ ] **Step 5: Add unit tests for JSON shape**

Add at the end of `src/token.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_platform_room_serializes_platform_fields() {
        let room = StoredPlatformRoom {
            platform_id: "bilibili".to_string(),
            platform_room_id: "123".to_string(),
            display_id: Some("123".to_string()),
        };
        let json = serde_json::to_value(&room).unwrap();
        assert_eq!(json["platform_id"], "bilibili");
        assert_eq!(json["platform_room_id"], "123");
    }

    #[test]
    fn stored_platform_session_preserves_payload() {
        let session = StoredPlatformSession {
            platform_id: "bilibili".to_string(),
            payload: serde_json::json!({"cookie": "a=b", "refresh_token": "r"}),
        };
        let json = serde_json::to_value(&session).unwrap();
        assert_eq!(json["platform_id"], "bilibili");
        assert_eq!(json["payload"]["cookie"], "a=b");
    }
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
cargo test token::tests --features tauri
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/token.rs
git commit -m "feat: persist platform sessions and rooms"
```

---

### Task 4: Platformize Storage Schema and Event Insertion

**Files:**
- Modify: `src/storage/mod.rs`

- [ ] **Step 1: Extend schema**

In `Storage::from_connection`, modify `live_sessions` creation:

```sql
create table if not exists live_sessions (
    id text primary key,
    platform_id text not null default 'bilibili',
    platform_room_id text,
    room_id integer not null,
    started_at text not null,
    ended_at text,
    start_source text not null,
    end_source text,
    created_at text not null,
    updated_at text not null
);
```

Modify `interaction_records` creation:

```sql
create table if not exists interaction_records (
    id integer primary key autoincrement,
    session_id text not null,
    platform_id text not null default 'bilibili',
    platform_room_id text,
    platform_user_id text,
    event_kind text,
    event_action text,
    room_id integer not null,
    event_type text not null,
    event_subtype text,
    uid integer,
    uname text,
    text text,
    gift_name text,
    gift_count integer,
    gift_price integer,
    medal_name text,
    medal_level integer,
    guard_level integer,
    wealth_level integer,
    pk_init_room_id integer,
    pk_match_room_id integer,
    pk_winner_room_id integer,
    popularity_value integer,
    raw_json text not null,
    occurred_at text not null
);
```

Add indexes:

```sql
create index if not exists idx_interaction_platform_room on interaction_records(platform_id, platform_room_id);
create index if not exists idx_interaction_platform_user on interaction_records(platform_id, platform_user_id);
```

- [ ] **Step 2: Add migration for existing databases**

After `conn.execute_batch(...)` in `from_connection`, add:

```rust
Self::ensure_platform_columns(&conn)?;
```

Add this method in `impl Storage`:

```rust
fn ensure_platform_columns(conn: &Connection) -> Result<()> {
    fn add_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
        let mut stmt = conn.prepare(&format!("pragma table_info({table})"))?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if !columns.iter().any(|existing| existing == column) {
            conn.execute(&format!("alter table {table} add column {column} {definition}"), [])?;
        }
        Ok(())
    }

    add_column(conn, "live_sessions", "platform_id", "text not null default 'bilibili'")?;
    add_column(conn, "live_sessions", "platform_room_id", "text")?;
    add_column(conn, "interaction_records", "platform_id", "text not null default 'bilibili'")?;
    add_column(conn, "interaction_records", "platform_room_id", "text")?;
    add_column(conn, "interaction_records", "platform_user_id", "text")?;
    add_column(conn, "interaction_records", "event_kind", "text")?;
    add_column(conn, "interaction_records", "event_action", "text")?;

    conn.execute(
        "update live_sessions
            set platform_room_id = cast(room_id as text)
          where platform_room_id is null",
        [],
    )?;
    conn.execute(
        "update interaction_records
            set platform_room_id = cast(room_id as text)
          where platform_room_id is null",
        [],
    )?;
    conn.execute(
        "update interaction_records
            set platform_user_id = cast(uid as text)
          where platform_user_id is null and uid is not null",
        [],
    )?;
    conn.execute(
        "create index if not exists idx_interaction_platform_room on interaction_records(platform_id, platform_room_id)",
        [],
    )?;
    conn.execute(
        "create index if not exists idx_interaction_platform_user on interaction_records(platform_id, platform_user_id)",
        [],
    )?;
    Ok(())
}
```

- [ ] **Step 3: Add platform event classifier helpers**

Add imports at the top of `src/storage/mod.rs`:

```rust
use crate::live_platform::types::{PlatformEvent, PlatformEventEnvelope};
```

Add helper functions near existing event extraction helpers:

```rust
fn platform_event_kind(event: &PlatformEvent) -> (&'static str, Option<&'static str>) {
    match event {
        PlatformEvent::Message(_) => ("message", Some("chat")),
        PlatformEvent::Gift(_) => ("gift", None),
        PlatformEvent::Follow(_) => ("interact", Some("follow")),
        PlatformEvent::Share(_) => ("interact", Some("share")),
        PlatformEvent::Enter(_) => ("interact", Some("entry")),
        PlatformEvent::Like(_) => ("like", None),
        PlatformEvent::GuardOrMember(_) => ("guard_buy", None),
        PlatformEvent::PaidMessage(_) => ("super_chat", None),
        PlatformEvent::Moderation(_) => ("block", None),
        PlatformEvent::Popularity(_) => ("popularity", None),
        PlatformEvent::Battle(_) => ("pk", None),
        PlatformEvent::Lottery(_) => ("lottery", None),
        PlatformEvent::System(_) => ("system", None),
        PlatformEvent::Unknown(_) => ("unknown", None),
    }
}

fn platform_event_user(event: &PlatformEvent) -> (Option<String>, Option<String>, Option<i64>) {
    match event {
        PlatformEvent::Message(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            value.user.numeric_id(),
        ),
        PlatformEvent::Gift(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            value.user.numeric_id(),
        ),
        PlatformEvent::Follow(value)
        | PlatformEvent::Share(value)
        | PlatformEvent::Enter(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            value.user.numeric_id(),
        ),
        PlatformEvent::Like(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            value.user.numeric_id(),
        ),
        PlatformEvent::GuardOrMember(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            value.user.numeric_id(),
        ),
        PlatformEvent::PaidMessage(value) => (
            Some(value.user.platform_user_id.clone()),
            Some(value.user.display_name.clone()),
            value.user.numeric_id(),
        ),
        _ => (None, None, None),
    }
}
```

- [ ] **Step 4: Add new insert method**

Keep the old `insert_interaction_record` temporarily. Add:

```rust
pub fn insert_platform_interaction_record(
    &self,
    session_id: &str,
    envelope: &PlatformEventEnvelope,
) -> Result<()> {
    let conn = self.conn.lock().expect("storage mutex poisoned");
    let (event_type, event_subtype) = platform_event_kind(&envelope.event);
    let (platform_user_id, uname, uid) = platform_event_user(&envelope.event);
    let room_id = envelope.room.platform_room_id.parse::<i64>().unwrap_or(0);
    let (text, gift_name, gift_count, gift_price, popularity_value) = match &envelope.event {
        PlatformEvent::Message(value) => (Some(value.text.clone()), None, None, None, None),
        PlatformEvent::Gift(value) => (
            None,
            Some(value.gift.clone()),
            Some(value.count),
            Some(value.price),
            None,
        ),
        PlatformEvent::GuardOrMember(value) => {
            (None, Some(value.gift.clone()), Some(1), None, None)
        }
        PlatformEvent::PaidMessage(value) => {
            (Some(value.text.clone()), None, None, Some(value.price), None)
        }
        PlatformEvent::Popularity(value) => (None, None, None, None, Some(value.value)),
        _ => (None, None, None, None, None),
    };

    conn.execute(
        "insert into interaction_records
         (session_id, platform_id, platform_room_id, platform_user_id,
          event_kind, event_action, room_id, event_type, event_subtype,
          uid, uname, text, gift_name, gift_count, gift_price,
          raw_json, occurred_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        params![
            session_id,
            envelope.platform_id.as_str(),
            envelope.room.platform_room_id,
            platform_user_id,
            event_type,
            event_subtype,
            room_id,
            event_type,
            event_subtype,
            uid,
            uname,
            text,
            gift_name,
            gift_count,
            gift_price,
            envelope.raw.to_string(),
            envelope.occurred_at.to_rfc3339(),
        ],
    )?;
    Ok(())
}
```

- [ ] **Step 5: Add migration test**

Inside `#[cfg(test)] mod tests`, add:

```rust
#[test]
fn storage_creates_platform_columns() {
    let storage = Storage::open_in_memory().unwrap();
    let conn = storage.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("pragma table_info(interaction_records)")
        .unwrap();
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    assert!(columns.contains(&"platform_id".to_string()));
    assert!(columns.contains(&"platform_room_id".to_string()));
    assert!(columns.contains(&"platform_user_id".to_string()));
}
```

- [ ] **Step 6: Add platform insert test**

Inside `#[cfg(test)] mod tests`, add:

```rust
#[test]
fn insert_platform_interaction_record_writes_platform_keys() {
    let storage = Storage::open_in_memory().unwrap();
    let session_id = storage.start_live_session(123, "test").unwrap();
    let envelope = crate::live_platform::types::PlatformEventEnvelope {
        platform_id: crate::live_platform::types::PlatformId::from("bilibili"),
        room: crate::live_platform::types::PlatformRoomRef::bilibili(123),
        event_id: None,
        occurred_at: chrono::Local::now(),
        event: crate::live_platform::types::PlatformEvent::Message(
            crate::live_platform::types::ChatMessageEvent {
                user: crate::live_platform::types::PlatformUserRef::bilibili(42, "alice"),
                text: "hello".to_string(),
            },
        ),
        raw: serde_json::json!({"cmd": "DANMU_MSG"}),
    };
    storage
        .insert_platform_interaction_record(&session_id, &envelope)
        .unwrap();
    let conn = storage.conn.lock().unwrap();
    let row: (String, String, String) = conn
        .query_row(
            "select platform_id, platform_room_id, platform_user_id from interaction_records limit 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(row, ("bilibili".to_string(), "123".to_string(), "42".to_string()));
}
```

- [ ] **Step 7: Run storage tests**

Run:

```bash
cargo test storage::tests::storage_creates_platform_columns storage::tests::insert_platform_interaction_record_writes_platform_keys --features tauri
```

Expected: PASS. If the command runner does not accept two explicit test names, run:

```bash
cargo test storage::tests --features tauri
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/storage/mod.rs
git commit -m "feat: platformize live storage schema"
```

---

### Task 5: Migrate BotEngine to Platform Events

**Files:**
- Modify: `src/bot/engine.rs`

- [ ] **Step 1: Replace Bilibili imports**

At the top of `src/bot/engine.rs`, replace the `bilibili_live_protocol` import with:

```rust
use crate::live_platform::types::{
    BattleEvent, LotteryEvent, PlatformEvent, PlatformUserRef,
};
```

- [ ] **Step 2: Change repeat count key**

Change the struct field:

```rust
repeat_counts: Mutex<BTreeMap<(String, String), i32>>,
```

- [ ] **Step 3: Change public entry points**

Replace:

```rust
pub fn handle_event(&self, event: &LiveEvent, _storage: Option<&Storage>) -> Vec<String>
```

with:

```rust
pub fn handle_event(&self, event: &PlatformEvent, _storage: Option<&Storage>) -> Vec<String> {
    let config = self.config.lock().expect("config mutex poisoned");
    if self.is_permanently_blacklisted_inner(event, &config) {
        return Vec::new();
    }
    if self.is_filtered_danmu_inner(event, &config) {
        return Vec::new();
    }

    let mut out = Vec::new();
    out.extend(self.welcome_inner(event, &config));
    out.extend(self.help_inner(event, &config));
    out.extend(self.thanks_inner(event, &config));
    out.extend(self.pk_and_activity_notice_inner(event, &config));
    out
}
```

- [ ] **Step 4: Add user helper**

Add near `impl BotEngine` private helpers:

```rust
fn event_user(event: &PlatformEvent) -> Option<&PlatformUserRef> {
    match event {
        PlatformEvent::Message(value) => Some(&value.user),
        PlatformEvent::Gift(value) => Some(&value.user),
        PlatformEvent::Follow(value)
        | PlatformEvent::Share(value)
        | PlatformEvent::Enter(value) => Some(&value.user),
        PlatformEvent::Like(value) => Some(&value.user),
        PlatformEvent::GuardOrMember(value) => Some(&value.user),
        PlatformEvent::PaidMessage(value) => Some(&value.user),
        _ => None,
    }
}
```

- [ ] **Step 5: Rewrite welcome/filter/help/thanks branches**

Use these exact branch patterns in existing helper bodies:

```rust
let PlatformEvent::Enter(entry) = event else {
    return Vec::new();
};
let uid_str = entry.user.platform_user_id.clone();
let user = &entry.user.display_name;
```

For blacklist:

```rust
let Some(user_ref) = Self::event_user(event) else {
    return false;
};
let user_id = user_ref.numeric_id().unwrap_or(0);
let user = user_ref.display_name.as_str();
```

For filtered danmu:

```rust
let PlatformEvent::Message(message) = event else {
    return false;
};
let user_key = message.user.platform_user_id.clone();
let text = message.text.as_str();
```

For help:

```rust
let PlatformEvent::Message(message) = event else {
    return Vec::new();
};
let text = message.text.as_str();
```

For thanks:

```rust
match event {
    PlatformEvent::Follow(value) if config.thanks_focus => { /* existing follow response using value.user.display_name */ }
    PlatformEvent::Share(value) if config.thanks_share => { /* existing share response using value.user.display_name */ }
    PlatformEvent::GuardOrMember(value) if config.thanks_gift => {
        vec![format!("感谢 {} 的 {}", value.user.display_name, value.gift)]
    }
    PlatformEvent::PaidMessage(value) if config.thanks_super_chat => {
        vec![format!("感谢 {} 的 SC (¥{})：{}", value.user.display_name, value.price, value.text)]
    }
    _ => Vec::new(),
}
```

For battle/lottery/moderation:

```rust
match event {
    PlatformEvent::Battle(BattleEvent::Start {
        init_room_id,
        match_room_id,
    }) if config.pk_notice => vec![format!(
        "PK开始，对手直播间候选: {}/{}",
        init_room_id.as_deref().unwrap_or("-"),
        match_room_id.as_deref().unwrap_or("-")
    )],
    PlatformEvent::Battle(BattleEvent::End) if config.pk_notice => vec!["PK结束".to_string()],
    PlatformEvent::Battle(BattleEvent::Other(command)) if config.pk_notice => {
        vec![format!("检测到PK事件: {command}")]
    }
    PlatformEvent::Lottery(LotteryEvent::New {
        user: Some(user),
        gift,
        price,
    }) if config.thanks_gift => vec![format!(
        "感谢 {} {price}电池的 {gift}",
        user.display_name
    )],
    PlatformEvent::Moderation(value) if config.show_block_msg => {
        vec![format!("{} 被禁言", value.user_name)]
    }
    _ => Vec::new(),
}
```

- [ ] **Step 6: Change AI prompt**

Replace `ai_prompt(&self, event: &LiveEvent)` with:

```rust
pub fn ai_prompt(&self, event: &PlatformEvent) -> Option<String> {
    let config = self.config.lock().expect("config mutex poisoned");
    let PlatformEvent::Message(message) = event else {
        return None;
    };
    let text = message.text.as_str();

    if config.talk_robot_cmd.is_empty() {
        return None;
    }

    if config.fuzzy_match_cmd {
        if text.contains(&config.talk_robot_cmd) {
            return Some(text.replace(&config.talk_robot_cmd, "").trim().to_string());
        }
    } else if let Some(rest) = text.strip_prefix(&config.talk_robot_cmd) {
        return Some(rest.trim().to_string());
    }

    None
}
```

- [ ] **Step 7: Update tests**

Replace Bilibili test event constructors with platform constructors. Example:

```rust
fn message(uid: i64, name: &str, text: &str) -> PlatformEvent {
    PlatformEvent::Message(crate::live_platform::types::ChatMessageEvent {
        user: crate::live_platform::types::PlatformUserRef::bilibili(uid, name),
        text: text.to_string(),
    })
}

fn enter(uid: i64, name: &str) -> PlatformEvent {
    PlatformEvent::Enter(crate::live_platform::types::UserEvent {
        user: crate::live_platform::types::PlatformUserRef::bilibili(uid, name),
    })
}
```

Use `message(...)`, `enter(...)`, `PlatformEvent::Follow(...)`, `PlatformEvent::Share(...)`, `PlatformEvent::GuardOrMember(...)`, and `PlatformEvent::PaidMessage(...)` in the existing tests.

- [ ] **Step 8: Run bot engine tests**

Run:

```bash
cargo test bot::engine::tests --features tauri
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/bot/engine.rs
git commit -m "feat: migrate bot engine to platform events"
```

---

### Task 6: Migrate Bot Helpers and Profile Worker

**Files:**
- Modify: `src/bot/mod.rs`
- Modify: `src/bot/profile_worker.rs`

- [ ] **Step 1: Update bot helper imports**

In `src/bot/mod.rs`, replace Bilibili imports with:

```rust
use crate::live_platform::types::{PlatformEvent, PlatformEventEnvelope};
```

- [ ] **Step 2: Change helper signatures**

Change:

```rust
pub fn handle_parsed_event(...)
fn try_trigger_profile_analysis(storage: &Storage, event: &LiveEvent)
fn try_auto_track(storage: &Storage, event: &LiveEvent)
```

to use `&PlatformEventEnvelope` and `&PlatformEvent`:

```rust
pub fn handle_platform_event(
    storage: &Storage,
    session_id: &str,
    parsed: &PlatformEventEnvelope,
) -> anyhow::Result<()> {
    storage.insert_platform_interaction_record(session_id, parsed)?;
    try_trigger_profile_analysis(storage, &parsed.event);
    try_auto_track(storage, &parsed.event);
    Ok(())
}
```

- [ ] **Step 3: Update auto-track extraction**

Use this match:

```rust
fn try_auto_track(storage: &Storage, event: &PlatformEvent) {
    let Some((platform_user_id, user, source)) = (match event {
        PlatformEvent::Message(value) => Some((&value.user.platform_user_id, value.user.display_name.as_str(), "danmu")),
        PlatformEvent::Gift(value) => Some((&value.user.platform_user_id, value.user.display_name.as_str(), "gift")),
        PlatformEvent::GuardOrMember(value) => Some((&value.user.platform_user_id, value.user.display_name.as_str(), "guard_buy")),
        PlatformEvent::PaidMessage(value) => Some((&value.user.platform_user_id, value.user.display_name.as_str(), "super_chat")),
        PlatformEvent::Follow(value) => Some((&value.user.platform_user_id, value.user.display_name.as_str(), "follow")),
        PlatformEvent::Enter(value) => Some((&value.user.platform_user_id, value.user.display_name.as_str(), "entry")),
        _ => None,
    }) else {
        return;
    };
    if let Ok(uid) = platform_user_id.parse::<i64>() {
        let _ = storage.auto_track_user(uid, user, source);
    }
}
```

This keeps existing `tracked_users.uid` behavior until the dedicated platform user primary key migration is implemented later in Task 12.

- [ ] **Step 4: Update profile trigger**

Use this conservative Bilibili-only trigger:

```rust
fn try_trigger_profile_analysis(storage: &Storage, event: &PlatformEvent) {
    let Some(user) = (match event {
        PlatformEvent::Message(value) => Some(&value.user),
        PlatformEvent::Gift(value) => Some(&value.user),
        PlatformEvent::GuardOrMember(value) => Some(&value.user),
        PlatformEvent::PaidMessage(value) => Some(&value.user),
        _ => None,
    }) else {
        return;
    };
    if user.platform_id.as_str() != "bilibili" {
        return;
    }
    if let Some(uid) = user.numeric_id() {
        let _ = storage.enqueue_profile_analysis(uid);
    }
}
```

- [ ] **Step 5: Update profile worker import**

In `src/bot/profile_worker.rs`, replace:

```rust
use crate::api::BiliApi;
```

with:

```rust
use crate::live_platform::bilibili::api::BiliApi;
```

- [ ] **Step 6: Run bot tests**

Run:

```bash
cargo test bot --features tauri
```

Expected: PASS or unrelated compile errors from still-unmigrated monitor/main. If monitor/main errors appear, continue to Task 7 before retrying full bot tests.

- [ ] **Step 7: Commit**

```bash
git add src/bot/mod.rs src/bot/profile_worker.rs
git commit -m "feat: migrate bot helpers to platform events"
```

---

### Task 7: Migrate Monitor Runtime

**Files:**
- Modify: `src/bot/monitor.rs`

- [ ] **Step 1: Replace Bilibili-specific imports**

In `src/bot/monitor.rs`, replace:

```rust
use crate::api::BiliApi;
```

with:

```rust
use crate::live_platform::{
    PlatformEventEnvelope, PlatformRegistry, PlatformRoomRef, PlatformSession,
};
```

- [ ] **Step 2: Change monitor loop signature**

Change:

```rust
pub async fn run_monitor_loop<E: EventEmitter + Send + Sync + 'static>(
    app: E,
    http: BiliApi,
    room_id: i64,
    ...
)
```

to:

```rust
pub async fn run_monitor_loop<E: EventEmitter + Send + Sync + 'static>(
    app: E,
    platforms: PlatformRegistry,
    room: PlatformRoomRef,
    session: PlatformSession,
    ...
)
```

Inside the function, define:

```rust
let platform = platforms
    .get(&room.platform_id)
    .ok_or_else(|| anyhow::anyhow!("平台未注册: {}", room.platform_id))?;
let room_label = room.log_label();
let room_id = room.platform_room_id.parse::<i64>().unwrap_or(0);
```

Keep `room_id` only for compatibility calls that still require numeric Bilibili room IDs.

- [ ] **Step 3: Replace WebSocket client call**

Find the current call to `bilibili_live_protocol::run_parsed_client` or equivalent Bilibili client setup. Replace the event receive path with an unbounded channel:

```rust
let (event_tx, mut event_rx) = mpsc::unbounded_channel::<PlatformEventEnvelope>();
let connect_room = room.clone();
let connect_session = session.clone();
let connect_platform = platform.clone();
let connect_cancel = cancel.clone();

tokio::spawn(async move {
    let result = tokio::select! {
        _ = connect_cancel.cancelled() => Ok(()),
        result = connect_platform.connect_events(connect_room, connect_session, event_tx) => {
            result.map_err(|err| anyhow::anyhow!(err.to_string()))
        }
    };
    if let Err(err) = result {
        eprintln!("平台监听退出: {err}");
    }
});
```

Process events from `event_rx.recv()` in the existing select loop.

- [ ] **Step 4: Use platform events in processing**

Where the monitor currently has a `ParsedLiveEvent` and `event.event`, use:

```rust
let envelope = platform_event;
let event = &envelope.event;
storage.insert_platform_interaction_record(&session_id, &envelope)?;
let replies = engine.handle_event(event, Some(&storage));
```

Emit payload:

```rust
let payload = serde_json::json!({
    "platform_id": envelope.platform_id.as_str(),
    "room_id": envelope.room.platform_room_id,
    "event": envelope.event,
    "raw": envelope.raw,
});
let _ = app.emit("live-event", payload);
```

- [ ] **Step 5: Replace send reply path**

Where replies are sent through `http.send_danmu(room_id, ...)`, use:

```rust
if let Err(err) = platform.send_message(&room, &session, &reply).await {
    let _ = app.emit(
        "monitor-log",
        serde_json::json!(format!("[{}] 发送弹幕失败: {}", room_label, err.message)),
    );
}
```

- [ ] **Step 6: Preserve room polling**

Where `http.room_info(room_id)` is used for room status polling, replace with:

```rust
platform.room_info(&room, Some(&session)).await
```

Use `info.live_status`, `info.title`, and `info.online` from `LiveRoomInfo`.

- [ ] **Step 7: Run monitor compile check**

Run:

```bash
cargo check --features tauri
```

Expected: compile errors in `src/main.rs` because callers still pass `BiliApi` and `room_id`. Continue to Task 8 for those call sites. Fix any errors inside `src/bot/monitor.rs` before continuing.

- [ ] **Step 8: Commit**

```bash
git add src/bot/monitor.rs
git commit -m "feat: run monitor through live platform interface"
```

---

### Task 8: Platformize Main State and Tauri Commands

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: Replace SharedState fields**

In `SharedState`, replace:

```rust
http: api::BiliApi,
connected_room: Arc<Mutex<Option<i64>>>,
```

with:

```rust
platforms: live_platform::PlatformRegistry,
connected_room: Arc<Mutex<Option<live_platform::PlatformRoomRef>>>,
```

Where Bilibili-specific profile worker still needs `BiliApi`, create a local Bilibili platform and pass `bilibili.api().clone()` during setup.

- [ ] **Step 2: Add conversion helpers**

Add near existing JSON helper functions:

```rust
fn stored_session_to_platform(
    stored: token::StoredPlatformSession,
) -> live_platform::PlatformSession {
    live_platform::PlatformSession {
        platform_id: live_platform::PlatformId::from(stored.platform_id),
        payload: stored.payload,
    }
}

fn platform_session_to_stored(
    session: &live_platform::PlatformSession,
) -> token::StoredPlatformSession {
    token::StoredPlatformSession {
        platform_id: session.platform_id.as_str().to_string(),
        payload: session.payload.clone(),
    }
}

fn stored_room_to_platform(room: token::StoredPlatformRoom) -> live_platform::PlatformRoomRef {
    live_platform::PlatformRoomRef {
        platform_id: live_platform::PlatformId::from(room.platform_id),
        platform_room_id: room.platform_room_id,
        display_id: room.display_id,
    }
}

fn platform_room_to_stored(room: &live_platform::PlatformRoomRef) -> token::StoredPlatformRoom {
    token::StoredPlatformRoom {
        platform_id: room.platform_id.as_str().to_string(),
        platform_room_id: room.platform_room_id.clone(),
        display_id: room.display_id.clone(),
    }
}
```

- [ ] **Step 3: Add platform commands**

Add these Tauri commands:

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
    let platform_id = live_platform::PlatformId::from(platform_id);
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
    let platform_id = live_platform::PlatformId::from(platform_id);
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
            Ok(serde_json::json!({"status": "Scanning", "message": message}))
        }
        live_platform::LoginPoll::Expired { message } => {
            Ok(serde_json::json!({"status": "Expired", "message": message}))
        }
        live_platform::LoginPoll::Success { session } => {
            token::write_platform_session(&platform_session_to_stored(&session))
                .map_err(|err| err.to_string())?;
            Ok(serde_json::json!({"status": "Success"}))
        }
    }
}
```

- [ ] **Step 4: Keep legacy commands as wrappers**

Change existing `start_login` to:

```rust
async fn start_login(
    state: tauri::State<'_, SharedState>,
) -> Result<live_platform::LoginChallenge, String> {
    create_platform_login_challenge(state, "bilibili".to_string()).await
}
```

Change existing `poll_login` to call `poll_platform_login(state, "bilibili".to_string(), key).await`.

- [ ] **Step 5: Add platform room resolution command**

```rust
#[cfg(feature = "tauri")]
#[tauri::command]
async fn resolve_platform_room(
    state: tauri::State<'_, SharedState>,
    platform_id: String,
    room_input: String,
) -> Result<live_platform::LiveRoomInfo, String> {
    let platform_id = live_platform::PlatformId::from(platform_id);
    let platform = state
        .platforms
        .get(&platform_id)
        .ok_or_else(|| format!("平台未注册: {platform_id}"))?;
    let session = token::read_platform_session(platform_id.as_str())
        .ok()
        .map(stored_session_to_platform);
    platform
        .resolve_room(
            live_platform::RoomInput::RoomId(room_input),
            session.as_ref(),
        )
        .await
        .map_err(|err| err.to_string())
}
```

- [ ] **Step 6: Update monitor start command**

In the existing command that starts monitoring, load:

```rust
let room = token::read_connected_platform_room()
    .map(stored_room_to_platform)
    .ok_or_else(|| "未连接直播间".to_string())?;
let session = token::read_platform_session(room.platform_id.as_str())
    .map(stored_session_to_platform)
    .map_err(|err| err.to_string())?;
```

Pass `state.platforms.clone()`, `room.clone()`, and `session` into `bot::monitor::run_monitor_loop`.

- [ ] **Step 7: Register platform commands**

In `tauri::generate_handler!`, add:

```rust
list_live_platforms,
create_platform_login_challenge,
poll_platform_login,
resolve_platform_room,
```

- [ ] **Step 8: Initialize registry**

Where `SharedState` is created, build:

```rust
let bilibili_platform = live_platform::bilibili::BilibiliPlatform::new()?;
let profile_http = bilibili_platform.api().clone();
let platforms = live_platform::PlatformRegistry::new(vec![Arc::new(bilibili_platform)]);
```

Set `SharedState { platforms, connected_room: Arc::new(Mutex::new(token::read_connected_platform_room().map(stored_room_to_platform))), ... }`.

- [ ] **Step 9: Run compile check**

Run:

```bash
cargo check --features tauri
```

Expected: compile errors are limited to remaining call sites that import `crate::api` or expect `connected_room: Option<i64>`. Fix those in `src/main.rs` by using `PlatformRoomRef::bilibili(room_id)` for legacy compatibility.

- [ ] **Step 10: Commit**

```bash
git add src/main.rs
git commit -m "feat: add platform tauri commands"
```

---

### Task 9: Platformize Plugin Server Room Context

**Files:**
- Modify: `src/danmaku_chat_server.rs`
- Modify: `src/plugin_settings.rs`

- [ ] **Step 1: Add helper for current platform room**

In `src/danmaku_chat_server.rs`, add:

```rust
fn current_platform_room() -> Option<crate::live_platform::PlatformRoomRef> {
    crate::token::read_connected_platform_room().map(|room| crate::live_platform::PlatformRoomRef {
        platform_id: crate::live_platform::PlatformId::from(room.platform_id),
        platform_room_id: room.platform_room_id,
        display_id: room.display_id,
    })
}

fn current_bilibili_room_id() -> Option<i64> {
    current_platform_room()
        .filter(|room| room.platform_id.as_str() == "bilibili")
        .and_then(|room| room.platform_room_id.parse::<i64>().ok())
}
```

- [ ] **Step 2: Replace direct connected room reads**

Replace each:

```rust
let room_id = match crate::token::read_connected_room() {
```

with:

```rust
let room_id = match current_bilibili_room_id() {
```

This keeps existing SQL compatible while the storage query layer is migrated.

- [ ] **Step 3: Include platform fields in WebSocket payload passthrough**

Where plugin WebSocket payloads are sent unchanged, keep current payload and ensure it can include:

```json
{
  "platform_id": "bilibili",
  "room_id": "123456",
  "event": {}
}
```

No UI change is required in this task.

- [ ] **Step 4: Update plugin settings event extraction**

In `src/plugin_settings.rs`, where plugin state reads event JSON, add a normalization helper:

```rust
fn live_event_payload(payload: &serde_json::Value) -> &serde_json::Value {
    payload.get("event").unwrap_or(payload)
}
```

Use `live_event_payload(payload)` before matching event fields. This allows both legacy event JSON and new platform envelope JSON.

- [ ] **Step 5: Run compile check**

Run:

```bash
cargo check --features tauri
```

Expected: PASS for these files, with possible remaining frontend-independent Rust errors from later cleanup tasks.

- [ ] **Step 6: Commit**

```bash
git add src/danmaku_chat_server.rs src/plugin_settings.rs
git commit -m "feat: carry platform room context into plugins"
```

---

### Task 10: Frontend Platform Command Wrappers

**Files:**
- Modify: `src-tauri/src/app/runtime/types.ts`
- Modify: `src-tauri/src/app/runtime/api.ts` or the existing API wrapper file found by `rg -n "invoke\\(" src-tauri/src/app`
- Modify: login and room connection components found by `rg -n "start_login|poll_login|check_room|connect_room|get_user_info" src-tauri/src/app`

- [ ] **Step 1: Add frontend types**

In `src-tauri/src/app/runtime/types.ts`, add:

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

- [ ] **Step 2: Add invoke wrappers**

In the API wrapper file, add:

```ts
export async function listLivePlatforms(): Promise<PlatformId[]> {
  return invoke<PlatformId[]>('list_live_platforms');
}

export async function createPlatformLoginChallenge(platformId: PlatformId): Promise<LoginChallenge> {
  return invoke<LoginChallenge>('create_platform_login_challenge', { platformId });
}

export async function pollPlatformLogin(platformId: PlatformId, challengeId: string): Promise<any> {
  return invoke('poll_platform_login', { platformId, challengeId });
}

export async function resolvePlatformRoom(platformId: PlatformId, roomInput: string): Promise<LiveRoomInfo> {
  return invoke<LiveRoomInfo>('resolve_platform_room', { platformId, roomInput });
}
```

- [ ] **Step 3: Keep legacy wrappers**

Change old wrappers so they call new platform wrappers:

```ts
export async function startLogin(): Promise<LoginChallenge> {
  return createPlatformLoginChallenge('bilibili');
}

export async function pollLogin(key: string): Promise<any> {
  return pollPlatformLogin('bilibili', key);
}
```

- [ ] **Step 4: Update QR login usage**

Where the frontend expects `qrcode_key`, use:

```ts
const challenge = await api.startLogin();
setQrUrl(challenge.url);
setLoginKey(challenge.challenge_id);
```

Do not expose a visible platform selector yet unless one already exists. Default platform is `bilibili`.

- [ ] **Step 5: Update room resolution usage**

Where the frontend calls old room check commands, use:

```ts
const room = await api.resolvePlatformRoom('bilibili', roomInput.trim());
setRoomInfo(room);
```

If existing UI expects `room_id`, map locally:

```ts
const legacyRoomId = Number(room.room.platform_room_id);
```

- [ ] **Step 6: Run frontend build**

Run:

```bash
cd src-tauri && npm run build
```

Expected: PASS. If TypeScript fails because the project has no static typecheck and errors are Vite build errors, fix import paths and property names.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/app
git commit -m "feat: route frontend through platform commands"
```

---

### Task 11: Remove Direct Core Bilibili Imports

**Files:**
- Modify: `src/main.rs`
- Modify: `src/bot/monitor.rs`
- Modify: `src/bot/engine.rs`
- Modify: `src/bot/mod.rs`
- Modify: `src/storage/mod.rs`
- Delete: `src/api.rs`

- [ ] **Step 1: Search for forbidden imports**

Run:

```bash
rg -n "crate::api|mod api|BiliApi|bilibili_live_protocol::LiveEvent|ParsedLiveEvent|use bilibili_live_protocol" src --glob '*.rs'
```

Expected: matches only inside `src/live_platform/bilibili/` and possibly tests that explicitly test Bilibili mapping.

- [ ] **Step 2: Update remaining `crate::api` references**

For each non-adapter match:

```rust
use crate::live_platform::bilibili::api::BiliApi;
```

Only `src/bot/profile_worker.rs` should need this after earlier tasks.

- [ ] **Step 3: Remove root api module**

Delete `src/api.rs`.

Remove `mod api;` from `src/main.rs`.

- [ ] **Step 4: Verify forbidden imports**

Run:

```bash
rg -n "crate::api|mod api|BiliApi|bilibili_live_protocol::LiveEvent|ParsedLiveEvent|use bilibili_live_protocol" src --glob '*.rs'
```

Expected: no matches outside `src/live_platform/bilibili/` and Bilibili mapping tests.

- [ ] **Step 5: Run Rust tests**

Run:

```bash
cargo test --features tauri
```

Expected: PASS. If tests fail because older storage tests still construct `ParsedLiveEvent`, update them to construct `PlatformEventEnvelope` as shown in Task 4.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "refactor: remove core bilibili api coupling"
```

---

### Task 12: Complete Platform User Keys in Storage

**Files:**
- Modify: `src/storage/mod.rs`
- Modify: call sites found by `rg -n "tracked_users|user_profiles|auto_track_user|enqueue_profile_analysis|uid" src/storage src/bot src/main.rs`

- [ ] **Step 1: Add platform columns to user tables**

In schema creation, add:

```sql
platform_id text not null default 'bilibili',
platform_user_id text
```

to `tracked_users` and `user_profiles`.

In `ensure_platform_columns`, add:

```rust
add_column(conn, "tracked_users", "platform_id", "text not null default 'bilibili'")?;
add_column(conn, "tracked_users", "platform_user_id", "text")?;
add_column(conn, "user_profiles", "platform_id", "text not null default 'bilibili'")?;
add_column(conn, "user_profiles", "platform_user_id", "text")?;
conn.execute(
    "update tracked_users set platform_user_id = cast(uid as text) where platform_user_id is null",
    [],
)?;
conn.execute(
    "update user_profiles set platform_user_id = cast(uid as text) where platform_user_id is null",
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

- [ ] **Step 2: Add platform-aware auto-track method**

Add:

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
    let conn = self.conn.lock().expect("storage mutex poisoned");
    conn.execute(
        "insert into tracked_users
         (uid, platform_id, platform_user_id, nickname, auto_tracked, created_at, updated_at)
         values (?1, ?2, ?3, ?4, 1, datetime('now'), datetime('now'))
         on conflict(uid) do update set
           platform_id = excluded.platform_id,
           platform_user_id = excluded.platform_user_id,
           nickname = case when tracked_users.nickname = '' then excluded.nickname else tracked_users.nickname end,
           updated_at = datetime('now')",
        params![uid, platform_id, platform_user_id, uname],
    )?;
    let _ = source;
    Ok(())
}
```

This preserves the existing `uid` primary key while adding platform fields. A future migration can replace the primary key after a second platform proves the data shape.

- [ ] **Step 3: Update bot helper call**

In `src/bot/mod.rs`, replace `storage.auto_track_user(...)` with:

```rust
let _ = storage.auto_track_platform_user(
    user.platform_id.as_str(),
    &user.platform_user_id,
    user.numeric_id(),
    &user.display_name,
    source,
);
```

- [ ] **Step 4: Add migration test**

In `src/storage/mod.rs` tests:

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

- [ ] **Step 5: Run storage tests**

Run:

```bash
cargo test storage::tests --features tauri
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/mod.rs src/bot/mod.rs
git commit -m "feat: add platform user keys to storage"
```

---

### Task 13: Full Regression and Documentation Check

**Files:**
- Modify only if commands reveal issues: files changed in previous tasks.

- [ ] **Step 1: Run forbidden dependency scan**

Run:

```bash
rg -n "crate::api|mod api|BiliApi|bilibili_live_protocol::LiveEvent|ParsedLiveEvent|use bilibili_live_protocol" src --glob '*.rs'
```

Expected: matches only under `src/live_platform/bilibili/`.

- [ ] **Step 2: Run Rust tests**

Run:

```bash
cargo test --features tauri
```

Expected: PASS.

- [ ] **Step 3: Run Tauri compile check**

Run:

```bash
cargo check --features tauri
```

Expected: PASS.

- [ ] **Step 4: Run frontend build**

Run:

```bash
cd src-tauri && npm run build
```

Expected: PASS.

- [ ] **Step 5: Review git diff**

Run:

```bash
git diff --stat HEAD
git diff HEAD -- src/live_platform src/main.rs src/bot src/storage src/danmaku_chat_server.rs src/plugin_settings.rs src-tauri/src/app
```

Expected: all changes trace to platform abstraction. No unrelated formatting churn.

- [ ] **Step 6: Final commit if fixes were needed**

If Step 1-4 required fixes, commit them:

```bash
git add src src-tauri
git commit -m "fix: complete platform core regression"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers platform core types, Bilibili adapter, auth/session storage, connected room storage, monitor, BotEngine, storage migration, plugin server, frontend commands, forbidden dependency cleanup, and verification.
- Scope: The plan does not add a second platform, simultaneous multi-room monitoring, or OBS UI redesign.
- Placeholder scan: No task uses placeholder markers or deferred implementation language. Some steps instruct search-and-replace where exact call sites depend on current code, but each gives the target command, expected result, and replacement shape.
- Type consistency: `PlatformId`, `PlatformRoomRef`, `PlatformUserRef`, `PlatformEventEnvelope`, `PlatformEvent`, `PlatformSession`, `LivePlatform`, and `PlatformRegistry` names are consistent across tasks.
