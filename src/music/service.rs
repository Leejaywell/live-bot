use anyhow::{Result, anyhow};

use crate::music::command::{SongCommand, parse_song_command};
use crate::music::provider::{MusicProvider, SearchOptions};
use crate::music::search::score_track;
use crate::music::types::SearchCandidate;

#[allow(dead_code)]
#[derive(Debug)]
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
                if candidates.is_empty() {
                    return "没有找到可点歌曲，请换个歌名试试".to_string();
                }

                let mut lines = vec!["找到候选：".to_string()];
                for (idx, candidate) in candidates.iter().take(3).enumerate() {
                    lines.push(format!(
                        "{}. {} - {}",
                        idx + 1,
                        candidate.track.name,
                        artists_text(&candidate.track.artists)
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
    pub fn new(providers: Vec<Box<dyn MusicProvider>>) -> Self {
        Self { providers }
    }

    pub fn new_for_tests(providers: Vec<Box<dyn MusicProvider>>) -> Self {
        Self::new(providers)
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
                let mut searched_any_provider = false;
                let mut provider_errors = Vec::new();
                for provider in &self.providers {
                    match provider.search(&query, SearchOptions::default()).await {
                        Ok(tracks) => {
                            searched_any_provider = true;
                            candidates
                                .extend(tracks.iter().map(|track| score_track(&query, track)));
                        }
                        Err(error) => {
                            provider_errors
                                .push(format!("{}: {error}", provider.source().as_str()));
                        }
                    }
                }
                if candidates.is_empty() && !searched_any_provider && !provider_errors.is_empty() {
                    return Err(anyhow!(
                        "music search failed for all providers: {}",
                        provider_errors.join("; ")
                    ));
                }

                candidates.sort_by(|a, b| {
                    b.score
                        .cmp(&a.score)
                        .then_with(|| a.track.name.cmp(&b.track.name))
                        .then_with(|| a.track.source.as_str().cmp(b.track.source.as_str()))
                        .then_with(|| a.track.song_id.cmp(&b.track.song_id))
                });
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

    pub async fn handle_live_event(
        &self,
        event: &bilibili_live_protocol::LiveEvent,
    ) -> Result<SongServiceReply> {
        match event {
            bilibili_live_protocol::LiveEvent::Danmu {
                user_id,
                user,
                text,
            } => self.handle_danmu(*user_id, user, text).await,
            bilibili_live_protocol::LiveEvent::Gift { .. }
            | bilibili_live_protocol::LiveEvent::SuperChat { .. } => Ok(SongServiceReply::Ignored),
            _ => Ok(SongServiceReply::Ignored),
        }
    }
}

fn artists_text(artists: &[String]) -> String {
    if artists.is_empty() {
        "未知歌手".to_string()
    } else {
        artists.join("/")
    }
}

#[cfg(test)]
mod tests {
    use anyhow::{Result, anyhow};
    use async_trait::async_trait;

    use super::{MusicInteractionService, SongServiceReply};
    use crate::music::provider::{MusicProvider, SearchOptions};
    use crate::music::types::{MusicSource, MusicTrack};

    enum SearchResult {
        Tracks(Vec<MusicTrack>),
        Error(&'static str),
    }

    struct FakeProvider {
        source: MusicSource,
        result: SearchResult,
    }

    impl FakeProvider {
        fn with_tracks(tracks: Vec<MusicTrack>) -> Self {
            Self {
                source: MusicSource::Netease,
                result: SearchResult::Tracks(tracks),
            }
        }

        fn with_error(message: &'static str) -> Self {
            Self {
                source: MusicSource::Tencent,
                result: SearchResult::Error(message),
            }
        }
    }

    fn track(name: &str, artists: &[&str], song_id: &str) -> MusicTrack {
        MusicTrack {
            source: MusicSource::Netease,
            song_id: song_id.to_string(),
            name: name.to_string(),
            artists: artists.iter().map(|artist| artist.to_string()).collect(),
            album: "叶惠美".to_string(),
            pic_id: String::new(),
            url_id: song_id.to_string(),
            lyric_id: song_id.to_string(),
            duration_ms: Some(269000),
        }
    }

    #[async_trait]
    impl MusicProvider for FakeProvider {
        fn source(&self) -> MusicSource {
            self.source.clone()
        }

        async fn search(&self, _keyword: &str, _options: SearchOptions) -> Result<Vec<MusicTrack>> {
            match &self.result {
                SearchResult::Tracks(tracks) => Ok(tracks.clone()),
                SearchResult::Error(message) => Err(anyhow!(*message)),
            }
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
        let service = MusicInteractionService::new_for_tests(vec![Box::new(
            FakeProvider::with_tracks(vec![track("晴天", &["周杰伦"], "186016")]),
        )]);
        let reply = service
            .handle_danmu(42, "alice", "点歌 晴天")
            .await
            .expect("reply");
        assert!(matches!(reply, SongServiceReply::Candidates { .. }));
        assert!(reply.to_danmu_text().contains("点歌 #1"));
    }

    #[tokio::test]
    async fn unrelated_danmu_returns_ignored() {
        let service = MusicInteractionService::new_for_tests(vec![Box::new(
            FakeProvider::with_tracks(vec![track("晴天", &["周杰伦"], "186016")]),
        )]);
        let reply = service
            .handle_danmu(42, "alice", "主播晚上好")
            .await
            .expect("reply");
        assert!(matches!(reply, SongServiceReply::Ignored));
        assert_eq!(reply.to_danmu_text(), "");
    }

    #[test]
    fn empty_candidates_return_no_results_text() {
        let reply = SongServiceReply::Candidates {
            candidates: Vec::new(),
        };

        assert_eq!(reply.to_danmu_text(), "没有找到可点歌曲，请换个歌名试试");
    }

    #[tokio::test]
    async fn candidate_text_uses_unknown_artist_fallback() {
        let service = MusicInteractionService::new_for_tests(vec![Box::new(
            FakeProvider::with_tracks(vec![track("晴天", &[], "186016")]),
        )]);
        let reply = service
            .handle_danmu(42, "alice", "点歌 晴天")
            .await
            .expect("reply");

        assert!(reply.to_danmu_text().contains("晴天 - 未知歌手"));
    }

    #[tokio::test]
    async fn provider_failure_does_not_hide_successful_candidates() {
        let service = MusicInteractionService::new_for_tests(vec![
            Box::new(FakeProvider::with_error("provider unavailable")),
            Box::new(FakeProvider::with_tracks(vec![track(
                "晴天",
                &["周杰伦"],
                "186016",
            )])),
        ]);
        let reply = service
            .handle_danmu(42, "alice", "点歌 晴天")
            .await
            .expect("reply");

        assert!(matches!(reply, SongServiceReply::Candidates { .. }));
        assert!(reply.to_danmu_text().contains("晴天 - 周杰伦"));
    }

    #[tokio::test]
    async fn empty_successful_provider_returns_empty_candidates() {
        let service = MusicInteractionService::new_for_tests(vec![
            Box::new(FakeProvider::with_error("provider unavailable")),
            Box::new(FakeProvider::with_tracks(Vec::new())),
        ]);
        let reply = service
            .handle_danmu(42, "alice", "点歌 不存在的歌")
            .await
            .expect("reply");

        assert!(matches!(reply, SongServiceReply::Candidates { .. }));
        assert_eq!(reply.to_danmu_text(), "没有找到可点歌曲，请换个歌名试试");
    }

    #[tokio::test]
    async fn all_provider_failures_return_contextual_error() {
        let service = MusicInteractionService::new_for_tests(vec![Box::new(
            FakeProvider::with_error("provider unavailable"),
        )]);
        let error = service
            .handle_danmu(42, "alice", "点歌 晴天")
            .await
            .expect_err("error");

        assert!(
            error
                .to_string()
                .contains("music search failed for all providers: tencent: provider unavailable")
        );
    }

    #[tokio::test]
    async fn live_event_danmu_command_returns_candidates() {
        let service = MusicInteractionService::new_for_tests(vec![Box::new(
            FakeProvider::with_tracks(vec![track("晴天", &["周杰伦"], "186016")]),
        )]);
        let event = bilibili_live_protocol::LiveEvent::Danmu {
            user_id: 42,
            user: "alice".to_string(),
            text: "点歌 晴天".to_string(),
        };

        let reply = service.handle_live_event(&event).await.expect("reply");

        assert!(matches!(reply, SongServiceReply::Candidates { .. }));
        assert!(reply.to_danmu_text().contains("晴天 - 周杰伦"));
    }

    #[tokio::test]
    async fn live_event_gift_is_ignored() {
        let service = MusicInteractionService::new_for_tests(vec![Box::new(
            FakeProvider::with_tracks(vec![track("晴天", &["周杰伦"], "186016")]),
        )]);
        let event = bilibili_live_protocol::LiveEvent::Gift {
            user_id: 42,
            user: "alice".to_string(),
            gift: "辣条".to_string(),
            count: 1,
            price: 100,
            original_gift_name: None,
            original_gift_price: 100,
        };

        let reply = service.handle_live_event(&event).await.expect("reply");

        assert!(matches!(reply, SongServiceReply::Ignored));
        assert_eq!(reply.to_danmu_text(), "");
    }

    #[tokio::test]
    async fn live_event_super_chat_is_ignored() {
        let service = MusicInteractionService::new_for_tests(vec![Box::new(
            FakeProvider::with_tracks(vec![track("晴天", &["周杰伦"], "186016")]),
        )]);
        let event = bilibili_live_protocol::LiveEvent::SuperChat {
            user_id: 42,
            user: "alice".to_string(),
            text: "主播加油".to_string(),
            price: 30,
        };

        let reply = service.handle_live_event(&event).await.expect("reply");

        assert!(matches!(reply, SongServiceReply::Ignored));
        assert_eq!(reply.to_danmu_text(), "");
    }
}
