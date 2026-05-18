use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use crate::music::provider::{MusicProvider, SearchOptions};
use crate::music::types::{MusicSource, MusicTrack};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct NeteaseProvider {
    client: Client,
    base_url: String,
}

#[allow(dead_code)]
impl NeteaseProvider {
    pub fn new(client: Client) -> Self {
        Self {
            client,
            base_url: "https://music.163.com".to_string(),
        }
    }

    pub fn with_base_url(client: Client, base_url: impl Into<String>) -> Self {
        Self {
            client,
            base_url: base_url.into(),
        }
    }
}

#[async_trait]
impl MusicProvider for NeteaseProvider {
    fn source(&self) -> MusicSource {
        MusicSource::Netease
    }

    async fn search(&self, keyword: &str, options: SearchOptions) -> Result<Vec<MusicTrack>> {
        let offset = options.page.saturating_sub(1) * options.limit;
        let raw = self
            .client
            .post(format!("{}/api/search/get/web", self.base_url))
            .form(&[
                ("s", keyword.to_string()),
                ("type", "1".to_string()),
                ("offset", offset.to_string()),
                ("limit", options.limit.to_string()),
            ])
            .send()
            .await
            .context("failed to send netease search request")?
            .error_for_status()
            .context("netease search request failed")?
            .text()
            .await
            .context("failed to read netease search response")?;

        map_search_response(&raw)
    }

    async fn song(&self, id: &str) -> Result<Option<MusicTrack>> {
        let tracks = self.search(id, SearchOptions { page: 1, limit: 1 }).await?;

        Ok(tracks.into_iter().find(|track| track.song_id == id))
    }

    async fn url(&self, id: &str, _bitrate: u32) -> Result<Option<String>> {
        Ok(Some(format!("https://music.163.com/#/song?id={id}")))
    }

    async fn lyric(&self, id: &str) -> Result<Option<String>> {
        Ok(Some(format!(
            "https://music.163.com/api/song/lyric?id={id}&lv=1&kv=1&tv=-1"
        )))
    }

    async fn pic(&self, id: &str, size: u32) -> Result<Option<String>> {
        Ok(Some(format!(
            "https://p1.music.126.net/{id}.jpg?param={size}y{size}"
        )))
    }
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    result: Option<SearchResult>,
}

#[derive(Debug, Deserialize)]
struct SearchResult {
    #[serde(default)]
    songs: Vec<NeteaseSong>,
}

#[derive(Debug, Deserialize)]
struct NeteaseSong {
    id: serde_json::Value,
    name: String,
    #[serde(default)]
    duration: Option<i64>,
    #[serde(default)]
    artists: Vec<NeteaseArtist>,
    album: Option<NeteaseAlbum>,
}

#[derive(Debug, Deserialize)]
struct NeteaseArtist {
    name: String,
}

#[derive(Debug, Deserialize)]
struct NeteaseAlbum {
    name: String,
    #[serde(rename = "picId")]
    pic_id: Option<serde_json::Value>,
}

pub fn map_search_response(raw: &str) -> Result<Vec<MusicTrack>> {
    let response: SearchResponse =
        serde_json::from_str(raw).context("failed to parse netease search response")?;

    let tracks = response
        .result
        .map(|result| result.songs)
        .unwrap_or_default()
        .into_iter()
        .map(map_song)
        .collect();

    Ok(tracks)
}

fn map_song(song: NeteaseSong) -> MusicTrack {
    let song_id = json_value_to_string(&song.id);
    let album = song.album;
    let pic_id = album
        .as_ref()
        .and_then(|album| album.pic_id.as_ref())
        .map(json_value_to_string)
        .unwrap_or_default();

    MusicTrack {
        source: MusicSource::Netease,
        song_id: song_id.clone(),
        name: song.name,
        artists: song.artists.into_iter().map(|artist| artist.name).collect(),
        album: album.map(|album| album.name).unwrap_or_default(),
        pic_id,
        url_id: song_id.clone(),
        lyric_id: song_id,
        duration_ms: song.duration,
    }
}

fn json_value_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(value) => value.clone(),
        serde_json::Value::Number(value) => value.to_string(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::map_search_response;
    use crate::music::types::MusicSource;

    #[test]
    fn maps_netease_search_response_to_standard_tracks() {
        let raw = include_str!("../tests/fixtures/netease_search.json");
        let tracks = map_search_response(raw).expect("fixture maps");
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].source, MusicSource::Netease);
        assert_eq!(tracks[0].song_id, "186016");
        assert_eq!(tracks[0].name, "晴天");
        assert_eq!(tracks[0].artists, vec!["周杰伦"]);
        assert_eq!(tracks[0].album, "叶惠美");
        assert_eq!(tracks[0].url_id, "186016");
        assert_eq!(tracks[0].lyric_id, "186016");
        assert_eq!(tracks[0].duration_ms, Some(269000));
    }
}
