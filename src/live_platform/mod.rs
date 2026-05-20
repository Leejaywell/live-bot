#![allow(dead_code, unused_imports)]

pub mod adapter;
pub mod auth;
pub mod bilibili;
pub mod error;
pub mod registry;
pub mod types;

pub use adapter::{LivePlatform, PlatformEventSink};
pub use auth::{LoginChallenge, LoginPoll, PlatformSession, SessionStatus};
pub use error::{PlatformError, PlatformErrorKind, PlatformOperation};
pub use registry::PlatformRegistry;
pub use types::*;
