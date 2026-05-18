use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MusicSource {
    Netease,
    Tencent,
    Kugou,
    Baidu,
    Kuwo,
}

impl MusicSource {
    #[allow(dead_code)]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Netease => "netease",
            Self::Tencent => "tencent",
            Self::Kugou => "kugou",
            Self::Baidu => "baidu",
            Self::Kuwo => "kuwo",
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MusicTrack {
    pub source: MusicSource,
    pub song_id: String,
    pub name: String,
    pub artists: Vec<String>,
    pub album: String,
    pub pic_id: String,
    pub url_id: String,
    pub lyric_id: String,
    pub duration_ms: Option<i64>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchCandidate {
    pub track: MusicTrack,
    pub score: i64,
    pub reason: String,
}
