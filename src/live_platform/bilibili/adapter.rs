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
        let room = PlatformRoomRef {
            platform_id: Self::platform_id(),
            platform_room_id: info.room_id.to_string(),
            display_id: (info.short_id > 0).then(|| info.short_id.to_string()),
        };
        LiveRoomInfo {
            room,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn room_info(room_id: i64, short_id: i64) -> RoomInfo {
        RoomInfo {
            room_id,
            short_id,
            uid: 42,
            live_status: 1,
            live_time: "2026-05-20 12:00:00".to_string(),
            title: "test room".to_string(),
            uname: "owner".to_string(),
            area_name: "area".to_string(),
            parent_area_name: "parent".to_string(),
            online: 100,
            keyframe: "keyframe".to_string(),
            cover: "cover".to_string(),
        }
    }

    #[test]
    fn room_info_to_live_preserves_canonical_room_and_short_id() {
        let info = BilibiliPlatform::room_info_to_live(room_info(23174842, 6));

        assert_eq!(info.room.platform_id.as_str(), PlatformId::BILIBILI);
        assert_eq!(info.room.platform_room_id, "23174842");
        assert_eq!(info.room.display_id.as_deref(), Some("6"));
        assert_eq!(info.owner.as_ref().and_then(|owner| owner.numeric_id()), Some(42));
        assert_eq!(
            info.owner.as_ref().map(|owner| owner.display_name.as_str()),
            Some("owner")
        );
    }

    #[test]
    fn room_info_to_live_omits_zero_short_id() {
        let info = BilibiliPlatform::room_info_to_live(room_info(23174842, 0));

        assert_eq!(info.room.platform_room_id, "23174842");
        assert_eq!(info.room.display_id, None);
    }
}
