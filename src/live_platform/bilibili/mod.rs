pub mod adapter;
pub mod api;
pub mod events;

#[cfg(test)]
mod events_tests;

pub use adapter::BilibiliPlatform;
pub use api::{BiliApi, DanmuInfo, LoginPoll as BiliLoginPoll, LoginUrl, RoomInfo, UserInfo};
