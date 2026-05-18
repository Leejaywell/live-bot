use anyhow::Result;

use crate::music::command::{SongCommand, parse_song_command};
use crate::music::provider::{MusicProvider, SearchOptions};
use crate::music::search::score_track;
use crate::music::types::SearchCandidate;

#[allow(dead_code)]
pub enum SongServiceReply {
    Candidates { candidates: Vec<SearchCandidate> },
    Message(String),
    Ignored,
}

#[allow(dead_code)]
impl SongServiceReply {
    pub fn to_danmu_text(&self) -> String {
        match self {
            Self::Candidates { candidates } => {
                let mut lines = vec!["找到候选：".to_string()];
                for (idx, candidate) in candidates.iter().take(3).enumerate() {
                    lines.push(format!(
                        "{}. {} - {}",
                        idx + 1,
                        candidate.track.name,
                        candidate.track.artists.join("/")
                    ));
                }
                lines.push("60秒内回复 点歌 #1 确认".to_string());
                lines.join(" ")
            }
            Self::Message(value) => value.clone(),
            Self::Ignored => String::new(),
        }
    }
}

#[allow(dead_code)]
pub struct MusicInteractionService {
    providers: Vec<Box<dyn MusicProvider>>,
}

#[allow(dead_code)]
impl MusicInteractionService {
    pub fn new_for_tests(providers: Vec<Box<dyn MusicProvider>>) -> Self {
        Self { providers }
    }

    pub async fn handle_danmu(
        &self,
        _uid: i64,
        _uname: &str,
        text: &str,
    ) -> Result<SongServiceReply> {
        let Some(command) = parse_song_command(text) else {
            return Ok(SongServiceReply::Ignored);
        };

        match command {
            SongCommand::Search { query } => {
                let mut candidates = Vec::new();
                for provider in &self.providers {
                    let tracks = provider.search(&query, SearchOptions::default()).await?;
                    candidates.extend(tracks.iter().map(|track| score_track(&query, track)));
                }
                candidates.sort_by(|a, b| b.score.cmp(&a.score));
                candidates.truncate(3);
                Ok(SongServiceReply::Candidates { candidates })
            }
            SongCommand::Confirm { .. } => Ok(SongServiceReply::Message(
                "候选确认将在接入存储后生效".to_string(),
            )),
            SongCommand::MoreCandidates => Ok(SongServiceReply::Message(
                "换一批将在接入分页搜索后生效".to_string(),
            )),
            SongCommand::MyRequest => Ok(SongServiceReply::Message(
                "你当前没有排队中的点歌".to_string(),
            )),
            SongCommand::CancelMine => Ok(SongServiceReply::Message(
                "你当前没有可取消的点歌".to_string(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use async_trait::async_trait;

    use super::{MusicInteractionService, SongServiceReply};
    use crate::music::provider::{MusicProvider, SearchOptions};
    use crate::music::types::{MusicSource, MusicTrack};

    struct FakeProvider;

    #[async_trait]
    impl MusicProvider for FakeProvider {
        fn source(&self) -> MusicSource {
            MusicSource::Netease
        }

        async fn search(&self, _keyword: &str, _options: SearchOptions) -> Result<Vec<MusicTrack>> {
            Ok(vec![MusicTrack {
                source: MusicSource::Netease,
                song_id: "186016".to_string(),
                name: "晴天".to_string(),
                artists: vec!["周杰伦".to_string()],
                album: "叶惠美".to_string(),
                pic_id: String::new(),
                url_id: "186016".to_string(),
                lyric_id: "186016".to_string(),
                duration_ms: Some(269000),
            }])
        }

        async fn song(&self, _song_id: &str) -> Result<Option<MusicTrack>> {
            Ok(None)
        }

        async fn url(&self, song_id: &str, _bitrate: u32) -> Result<Option<String>> {
            Ok(Some(format!("https://music.163.com/#/song?id={song_id}")))
        }

        async fn lyric(&self, _song_id: &str) -> Result<Option<String>> {
            Ok(None)
        }

        async fn pic(&self, _pic_id: &str, _size: u32) -> Result<Option<String>> {
            Ok(None)
        }
    }

    #[tokio::test]
    async fn search_without_credit_returns_candidates_and_gift_prompt() {
        let service = MusicInteractionService::new_for_tests(vec![Box::new(FakeProvider)]);
        let reply = service
            .handle_danmu(42, "alice", "点歌 晴天")
            .await
            .expect("reply");
        assert!(matches!(reply, SongServiceReply::Candidates { .. }));
        assert!(reply.to_danmu_text().contains("点歌 #1"));
    }

    #[tokio::test]
    async fn unrelated_danmu_returns_ignored() {
        let service = MusicInteractionService::new_for_tests(vec![Box::new(FakeProvider)]);
        let reply = service
            .handle_danmu(42, "alice", "主播晚上好")
            .await
            .expect("reply");
        assert!(matches!(reply, SongServiceReply::Ignored));
        assert_eq!(reply.to_danmu_text(), "");
    }
}
