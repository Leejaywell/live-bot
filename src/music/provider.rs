use anyhow::Result;
use async_trait::async_trait;

use crate::music::types::{MusicSource, MusicTrack};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SearchOptions {
    pub page: u32,
    pub limit: u32,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self { page: 1, limit: 10 }
    }
}

#[async_trait]
#[allow(dead_code)]
pub trait MusicProvider: Send + Sync {
    fn source(&self) -> MusicSource;
    async fn search(&self, keyword: &str, options: SearchOptions) -> Result<Vec<MusicTrack>>;
    async fn song(&self, id: &str) -> Result<Option<MusicTrack>>;
    async fn url(&self, id: &str, bitrate: u32) -> Result<Option<String>>;
    async fn lyric(&self, id: &str) -> Result<Option<String>>;
    async fn pic(&self, id: &str, size: u32) -> Result<Option<String>>;
}
