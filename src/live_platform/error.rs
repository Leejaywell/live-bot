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
        err: impl fmt::Display,
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
