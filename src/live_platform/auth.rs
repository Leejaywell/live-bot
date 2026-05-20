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
