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

#[derive(Debug, Clone, PartialEq, Eq)]
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
