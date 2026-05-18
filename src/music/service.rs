use anyhow::{Result, anyhow};
use chrono::{Duration, Local};
use std::sync::{Arc, Mutex};

use crate::music::command::{SongCommand, parse_song_command};
use crate::music::credits::tier_for_credit;
use crate::music::provider::{MusicProvider, SearchOptions};
use crate::music::queue::priority_score;
use crate::music::search::score_track;
use crate::music::storage::NewSongRequest;
use crate::music::types::SearchCandidate;
use crate::storage::Storage;

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
    storage: Option<Arc<Storage>>,
    room_id: i64,
    session_id: Option<Arc<Mutex<Option<String>>>>,
}

#[allow(dead_code)]
impl MusicInteractionService {
    pub fn new(providers: Vec<Box<dyn MusicProvider>>) -> Self {
        Self {
            providers,
            storage: None,
            room_id: 0,
            session_id: None,
        }
    }

    pub fn new_with_storage(
        providers: Vec<Box<dyn MusicProvider>>,
        storage: Arc<Storage>,
        room_id: i64,
        session_id: Arc<Mutex<Option<String>>>,
    ) -> Self {
        Self {
            providers,
            storage: Some(storage),
            room_id,
            session_id: Some(session_id),
        }
    }

    pub fn new_for_tests(providers: Vec<Box<dyn MusicProvider>>) -> Self {
        Self::new(providers)
    }

    pub fn new_for_tests_with_storage(
        providers: Vec<Box<dyn MusicProvider>>,
        storage: Arc<Storage>,
        room_id: i64,
        session_id: Arc<Mutex<Option<String>>>,
    ) -> Self {
        Self::new_with_storage(providers, storage, room_id, session_id)
    }

    pub async fn handle_danmu(
        &self,
        uid: i64,
        uname: &str,
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
                if !candidates.is_empty() {
                    self.save_search_context(uid, &query, &candidates)?;
                }
                Ok(SongServiceReply::Candidates { candidates })
            }
            SongCommand::Confirm { index } => self.confirm_candidate(uid, uname, index),
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
            bilibili_live_protocol::LiveEvent::Gift {
                user_id,
                user,
                gift,
                count,
                price,
                ..
            } => {
                let storage_ready = self.storage.is_some() && self.current_session_id().is_some();
                let recorded = self.record_credit(
                    *user_id,
                    user,
                    price.saturating_mul(*count as i64),
                    "gift",
                    None,
                )?;
                if recorded {
                    Ok(SongServiceReply::Message(format!(
                        "感谢 {user} 赠送 {gift} x{count}，点歌权益已记录"
                    )))
                } else if storage_ready {
                    Ok(SongServiceReply::Message(format!(
                        "感谢 {user} 赠送 {gift} x{count}"
                    )))
                } else {
                    Ok(SongServiceReply::Message(format!(
                        "感谢 {user} 赠送 {gift} x{count}，点歌积分将在接入存储后生效"
                    )))
                }
            }
            bilibili_live_protocol::LiveEvent::SuperChat {
                user_id,
                user,
                price,
                ..
            } => {
                let storage_ready = self.storage.is_some() && self.current_session_id().is_some();
                let recorded = self.record_credit(*user_id, user, *price, "super_chat", None)?;
                if recorded {
                    Ok(SongServiceReply::Message(format!(
                        "感谢 {user} 的醒目留言，点歌权益已记录（{price}元）"
                    )))
                } else if storage_ready {
                    Ok(SongServiceReply::Message(format!(
                        "感谢 {user} 的醒目留言（{price}元）"
                    )))
                } else {
                    Ok(SongServiceReply::Message(format!(
                        "感谢 {user} 的醒目留言，点歌积分将在接入存储后生效（{price}元）"
                    )))
                }
            }
            _ => Ok(SongServiceReply::Ignored),
        }
    }

    fn current_session_id(&self) -> Option<String> {
        self.session_id
            .as_ref()
            .and_then(|value| value.lock().ok().and_then(|guard| guard.clone()))
    }

    fn context_expires_at() -> String {
        (Local::now() + Duration::seconds(60)).to_rfc3339()
    }

    fn credit_expires_at() -> String {
        (Local::now() + Duration::hours(24)).to_rfc3339()
    }

    fn save_search_context(
        &self,
        uid: i64,
        query: &str,
        candidates: &[SearchCandidate],
    ) -> Result<()> {
        let (Some(storage), Some(session_id)) = (&self.storage, self.current_session_id()) else {
            return Ok(());
        };
        storage.with_connection(|conn| {
            crate::music::storage::save_search_context(
                conn,
                &session_id,
                uid,
                query,
                candidates,
                &Self::context_expires_at(),
            )
        })?;
        Ok(())
    }

    fn confirm_candidate(&self, uid: i64, uname: &str, index: usize) -> Result<SongServiceReply> {
        let Some(storage) = &self.storage else {
            return Ok(SongServiceReply::Message(
                "候选确认将在接入存储后生效".to_string(),
            ));
        };
        let Some(session_id) = self.current_session_id() else {
            return Ok(SongServiceReply::Message(
                "当前没有直播场次，暂不能确认点歌".to_string(),
            ));
        };

        let request_id = storage.with_connection_mut(|conn| {
            let Some(context) =
                crate::music::storage::latest_search_context(conn, &session_id, uid)?
            else {
                return Ok(Err("没有可确认的候选，请先发送 点歌 歌名".to_string()));
            };
            let Some(candidate) = context.candidates.get(index.saturating_sub(1)) else {
                return Ok(Err("候选编号不存在".to_string()));
            };
            let Some((credit_id, credit_value, tier)) =
                crate::music::storage::oldest_pending_credit(conn, &session_id, uid)?
            else {
                return Ok(Err("还没有可用点歌权益，请先送礼解锁".to_string()));
            };
            let tier_enum = tier_for_credit(credit_value)
                .ok_or_else(|| anyhow!("stored credit is below minimum tier: {credit_value}"))?;
            let score = priority_score(tier_enum, credit_value, 0, 0);
            let request_id = crate::music::storage::insert_song_request_and_consume_credit(
                conn,
                credit_id,
                &NewSongRequest {
                    session_id: session_id.clone(),
                    room_id: self.room_id,
                    uid,
                    uname: uname.to_string(),
                    source: candidate.track.source.as_str().to_string(),
                    song_id: candidate.track.song_id.clone(),
                    song_name: candidate.track.name.clone(),
                    artist_names: artists_text(&candidate.track.artists),
                    album_name: Some(candidate.track.album.clone()),
                    pic_url: None,
                    lyric_id: candidate.track.lyric_id.clone(),
                    url_id: candidate.track.url_id.clone(),
                    duration_ms: candidate.track.duration_ms,
                    requested_text: format!("确认 #{index}"),
                    tier,
                    credit_value,
                    priority_score: score,
                    source_event_id: None,
                },
            )?;
            Ok(Ok(request_id))
        })?;

        match request_id {
            Ok(request_id) => Ok(SongServiceReply::Message(format!(
                "已加入点歌队列 #{request_id}"
            ))),
            Err(message) => Ok(SongServiceReply::Message(message)),
        }
    }

    fn record_credit(
        &self,
        uid: i64,
        uname: &str,
        credit_value: i64,
        source_type: &str,
        source_event_id: Option<i64>,
    ) -> Result<bool> {
        let Some(storage) = &self.storage else {
            return Ok(false);
        };
        let Some(session_id) = self.current_session_id() else {
            return Ok(false);
        };
        let Some(tier) = tier_for_credit(credit_value) else {
            return Ok(false);
        };
        storage.with_connection(|conn| {
            crate::music::storage::insert_credit(
                conn,
                &crate::music::storage::NewSongCredit {
                    session_id,
                    room_id: self.room_id,
                    uid,
                    uname: uname.to_string(),
                    credit_value,
                    tier: tier.as_str().to_string(),
                    source_type: source_type.to_string(),
                    source_event_id,
                    expires_at: Self::credit_expires_at(),
                },
            )
        })?;
        Ok(true)
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
    use std::sync::{Arc, Mutex};

    use super::{MusicInteractionService, SongServiceReply};
    use crate::music::provider::{MusicProvider, SearchOptions};
    use crate::music::types::{MusicSource, MusicTrack};
    use crate::storage::Storage;

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
    async fn search_returns_error_when_context_persistence_fails() {
        let storage = Arc::new(Storage::open_in_memory().expect("storage"));
        storage
            .with_connection(|conn| {
                conn.execute("drop table song_search_contexts", [])?;
                Ok(())
            })
            .expect("drop context table");
        let service = MusicInteractionService::new_for_tests_with_storage(
            vec![Box::new(FakeProvider::with_tracks(vec![track(
                "晴天",
                &["周杰伦"],
                "186016",
            )]))],
            storage,
            100,
            Arc::new(Mutex::new(Some("session-1".to_string()))),
        );

        let error = service
            .handle_danmu(42, "alice", "点歌 晴天")
            .await
            .expect_err("persistence error");

        assert!(error.to_string().contains("song_search_contexts"));
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
    async fn live_event_gift_returns_credit_status_message() {
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

        assert!(matches!(reply, SongServiceReply::Message(_)));
        let text = reply.to_danmu_text();
        assert!(!text.is_empty());
        assert!(text.contains("点歌积分将在接入存储后生效"));
        assert!(text.contains("辣条 x1"));
    }

    #[tokio::test]
    async fn live_event_super_chat_returns_credit_status_message() {
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

        assert!(matches!(reply, SongServiceReply::Message(_)));
        let text = reply.to_danmu_text();
        assert!(!text.is_empty());
        assert!(text.contains("点歌积分将在接入存储后生效"));
        assert!(text.contains("30元"));
    }

    #[tokio::test]
    async fn gift_event_records_credit_when_storage_is_available() {
        let storage = Arc::new(Storage::open_in_memory().expect("storage"));
        let service = MusicInteractionService::new_for_tests_with_storage(
            vec![Box::new(FakeProvider::with_tracks(vec![track(
                "晴天",
                &["周杰伦"],
                "186016",
            )]))],
            storage.clone(),
            100,
            Arc::new(Mutex::new(Some("session-1".to_string()))),
        );
        let event = bilibili_live_protocol::LiveEvent::Gift {
            user_id: 42,
            user: "alice".to_string(),
            gift: "辣条".to_string(),
            count: 1,
            price: 100,
            original_gift_name: None,
            original_gift_price: 100,
        };

        service
            .handle_live_event(&event)
            .await
            .expect("gift handled");

        let pending = storage
            .with_connection(|conn| {
                crate::music::storage::pending_credit_value(conn, "session-1", 42)
            })
            .expect("pending");
        assert_eq!(pending, 100);
    }

    #[tokio::test]
    async fn gift_event_records_null_source_event_id_when_upstream_id_is_absent() {
        let storage = Arc::new(Storage::open_in_memory().expect("storage"));
        let service = MusicInteractionService::new_for_tests_with_storage(
            vec![Box::new(FakeProvider::with_tracks(vec![track(
                "晴天",
                &["周杰伦"],
                "186016",
            )]))],
            storage.clone(),
            100,
            Arc::new(Mutex::new(Some("session-1".to_string()))),
        );
        let event = bilibili_live_protocol::LiveEvent::Gift {
            user_id: 42,
            user: "alice".to_string(),
            gift: "辣条".to_string(),
            count: 1,
            price: 100,
            original_gift_name: None,
            original_gift_price: 100,
        };

        service
            .handle_live_event(&event)
            .await
            .expect("gift handled");

        let source_event_id = storage
            .with_connection(|conn| {
                conn.query_row(
                    "select source_event_id
                     from song_request_credits
                     where session_id = 'session-1' and uid = 42",
                    [],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .map_err(anyhow::Error::from)
            })
            .expect("source event id");

        assert_eq!(source_event_id, None);
    }

    #[tokio::test]
    async fn confirm_uses_latest_context_and_consumes_credit() {
        let storage = Arc::new(Storage::open_in_memory().expect("storage"));
        let session = Arc::new(Mutex::new(Some("session-1".to_string())));
        let service = MusicInteractionService::new_for_tests_with_storage(
            vec![Box::new(FakeProvider::with_tracks(vec![track(
                "晴天",
                &["周杰伦"],
                "186016",
            )]))],
            storage.clone(),
            100,
            session,
        );
        service
            .handle_danmu(42, "alice", "点歌 晴天")
            .await
            .expect("search");
        service
            .handle_live_event(&bilibili_live_protocol::LiveEvent::Gift {
                user_id: 42,
                user: "alice".to_string(),
                gift: "小花花".to_string(),
                count: 1,
                price: 66,
                original_gift_name: None,
                original_gift_price: 66,
            })
            .await
            .expect("credit");

        let reply = service
            .handle_danmu(42, "alice", "确认 #1")
            .await
            .expect("confirm");

        assert!(reply.to_danmu_text().contains("已加入点歌队列"));
        let queue = storage
            .with_connection(|conn| crate::music::storage::list_queue(conn, "session-1", 100))
            .expect("queue");
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].song_name, "晴天");
        let pending = storage
            .with_connection(|conn| {
                crate::music::storage::pending_credit_value(conn, "session-1", 42)
            })
            .expect("pending");
        assert_eq!(pending, 0);
    }
}
