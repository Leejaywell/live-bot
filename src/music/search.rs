use crate::music::types::{MusicTrack, SearchCandidate};

#[allow(dead_code)]
pub fn score_track(query: &str, track: &MusicTrack) -> SearchCandidate {
    let normalized_query = normalize(query);
    let song_name = normalize(&track.name);
    let artists = track
        .artists
        .iter()
        .map(|artist| normalize(artist))
        .collect::<Vec<_>>();
    let query_tokens = normalized_query.split_whitespace().collect::<Vec<_>>();

    let mut score = 0;
    let mut reasons = Vec::new();

    if normalized_query.is_empty() {
        return SearchCandidate {
            track: track.clone(),
            score,
            reason: "弱匹配".to_string(),
        };
    }

    if normalized_query.contains(&song_name)
        || song_name.contains(&normalized_query)
        || query_tokens.iter().any(|part| *part == song_name)
    {
        score += 50;
        reasons.push("歌名匹配");
    }
    if artists
        .iter()
        .any(|artist| normalized_query.contains(artist))
    {
        score += 30;
        reasons.push("歌手匹配");
    }
    if query_tokens.iter().all(|part| {
        song_name.contains(*part) || artists.iter().any(|artist| artist.contains(*part))
    }) {
        score += 10;
        reasons.push("关键词完整");
    }
    for marker in ["live", "dj", "伴奏", "翻唱", "cover"] {
        if has_version_marker(&song_name, marker) && !has_version_marker(&normalized_query, marker)
        {
            score -= 12;
        }
    }

    SearchCandidate {
        track: track.clone(),
        score,
        reason: if reasons.is_empty() {
            "弱匹配".to_string()
        } else {
            reasons.join("+")
        },
    }
}

#[allow(dead_code)]
fn normalize(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .replace('　', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[allow(dead_code)]
fn has_version_marker(value: &str, marker: &str) -> bool {
    match marker {
        "live" | "dj" | "cover" => value
            .split(|character: char| !character.is_ascii_alphanumeric())
            .any(|part| part == marker),
        _ => value.contains(marker),
    }
}

#[cfg(test)]
mod tests {
    use super::score_track;
    use crate::music::types::{MusicSource, MusicTrack};

    fn track(name: &str, artists: &[&str]) -> MusicTrack {
        MusicTrack {
            source: MusicSource::Netease,
            song_id: "1".to_string(),
            name: name.to_string(),
            artists: artists.iter().map(|value| value.to_string()).collect(),
            album: "album".to_string(),
            pic_id: String::new(),
            url_id: "1".to_string(),
            lyric_id: "1".to_string(),
            duration_ms: Some(240000),
        }
    }

    #[test]
    fn exact_song_and_artist_scores_highest() {
        let exact = score_track("晴天 周杰伦", &track("晴天", &["周杰伦"]));
        let cover = score_track("晴天 周杰伦", &track("晴天", &["其他歌手"]));
        assert!(exact.score > cover.score);
        assert!(exact.score >= 80);
    }

    #[test]
    fn live_and_dj_versions_are_penalized() {
        let normal = score_track("晴天", &track("晴天", &["周杰伦"]));
        let live = score_track("晴天", &track("晴天 Live", &["周杰伦"]));
        let dj = score_track("晴天", &track("晴天 DJ版", &["周杰伦"]));
        assert!(normal.score > live.score);
        assert!(normal.score > dj.score);
    }

    #[test]
    fn empty_query_is_weak_match() {
        let candidate = score_track("  　 ", &track("晴天", &["周杰伦"]));
        assert_eq!(candidate.score, 0);
        assert_eq!(candidate.reason, "弱匹配");
    }

    #[test]
    fn english_title_and_artist_tokens_score_highly() {
        let candidate = score_track(
            "Shape of You Ed Sheeran",
            &track("Shape of You", &["Ed Sheeran"]),
        );
        assert!(candidate.score >= 80);
        assert!(candidate.reason.contains("歌名匹配"));
        assert!(candidate.reason.contains("歌手匹配"));
    }
}
