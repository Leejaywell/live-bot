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
