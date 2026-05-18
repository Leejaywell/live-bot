#![allow(dead_code)]

use anyhow::{Result, bail};
use reqwest::Url;

const SONG_ID_PLACEHOLDER: &str = "{song_id}";

pub fn build_open_url(template: &str, song_id: &str) -> Result<String> {
    if !template.contains(SONG_ID_PLACEHOLDER) {
        bail!("open URL template must contain {SONG_ID_PLACEHOLDER}");
    }

    if !is_valid_song_id(song_id) {
        bail!("invalid song id");
    }

    let url = template.replace(SONG_ID_PLACEHOLDER, song_id);
    if !is_allowed_open_url(&url) {
        bail!("open URL is not allowed");
    }

    Ok(url)
}

pub fn is_allowed_open_url(url: &str) -> bool {
    if has_path_traversal_marker(url) {
        return false;
    }

    let Ok(parsed) = Url::parse(url) else {
        return false;
    };

    match parsed.scheme() {
        "https" => is_allowed_https_url(&parsed),
        "orpheus" => is_allowed_orpheus_url(&parsed),
        "qqmusic" => is_allowed_qqmusic_url(&parsed),
        _ => false,
    }
}

fn is_valid_song_id(song_id: &str) -> bool {
    !song_id.is_empty()
        && song_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn is_allowed_https_url(url: &Url) -> bool {
    matches!(url.host_str(), Some("music.163.com" | "y.qq.com"))
        && matches!(url.port(), None | Some(443))
}

fn is_allowed_orpheus_url(url: &Url) -> bool {
    url.host_str() == Some("song")
        && valid_single_path_song_id(url.path())
        && url.query().is_none()
        && url.fragment().is_none()
}

fn is_allowed_qqmusic_url(url: &Url) -> bool {
    if url.host_str() == Some("song")
        && valid_single_path_song_id(url.path())
        && url.query().is_none()
        && url.fragment().is_none()
    {
        return true;
    }

    url.host_str() == Some("qq.com")
        && url.path() == "/media/playSonglist"
        && url.fragment().is_none()
        && matches!(
            url.query_pairs().collect::<Vec<_>>().as_slice(),
            [(key, value)] if key == "p" && is_valid_song_id(value)
        )
}

fn valid_single_path_song_id(path: &str) -> bool {
    let Some(song_id) = path.strip_prefix('/') else {
        return false;
    };
    !song_id.contains('/') && is_valid_song_id(song_id)
}

fn has_path_traversal_marker(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("/..") || lower.contains("%2e%2e") || lower.contains("%2e.")
        || lower.contains(".%2e")
}

#[cfg(test)]
pub mod tests {
    use super::{build_open_url, is_allowed_open_url};

    #[test]
    fn allows_music_urls() {
        assert!(is_allowed_open_url("orpheus://song/123"));
        assert!(is_allowed_open_url("qqmusic://song/123"));
        assert!(is_allowed_open_url("https://music.163.com/#/song?id=123"));
        assert!(is_allowed_open_url("https://music.163.com:443/#/song?id=123"));
        assert!(is_allowed_open_url("HTTPS://MUSIC.163.com/#/song?id=123"));
        assert!(is_allowed_open_url(
            "https://y.qq.com/n/ryqq/songDetail/123"
        ));
        assert!(is_allowed_open_url(
            "qqmusic://qq.com/media/playSonglist?p=123"
        ));
    }

    #[test]
    fn rejects_dangerous_and_non_whitelisted_urls() {
        assert!(!is_allowed_open_url("file:///Users/lee/.ssh/id_rsa"));
        assert!(!is_allowed_open_url("x-apple.systempreferences://security"));
        assert!(!is_allowed_open_url("javascript:alert(1)"));
        assert!(!is_allowed_open_url("http://music.163.com/#/song?id=123"));
        assert!(!is_allowed_open_url(
            "https://music.163.com.evil/song?id=123"
        ));
        assert!(!is_allowed_open_url("https://y.qq.com.evil/song?id=123"));
        assert!(!is_allowed_open_url("orpheus://settings/privacy"));
        assert!(!is_allowed_open_url("orpheus://song/../123"));
        assert!(!is_allowed_open_url("qqmusic://qq.com/media/playSonglist?p=../123"));
        assert!(!is_allowed_open_url("qqmusic://qq.com/media/delete?p=123"));
    }

    #[test]
    fn builds_open_url_from_song_id_placeholder() {
        let url = build_open_url("https://music.163.com/#/song?id={song_id}", "abc_123-XYZ")
            .expect("valid template and song id should build");

        assert_eq!(url, "https://music.163.com/#/song?id=abc_123-XYZ");
    }

    #[test]
    fn rejects_invalid_song_ids() {
        for song_id in ["", "abc 123", "../123", "abc?x=1", "歌曲123"] {
            assert!(build_open_url("orpheus://song/{song_id}", song_id).is_err());
        }
    }

    #[test]
    fn rejects_templates_without_song_id_placeholder() {
        assert!(build_open_url("orpheus://song/123", "123").is_err());
    }

    #[test]
    fn rejects_templates_that_build_non_whitelisted_urls() {
        assert!(build_open_url("file:///{song_id}", "123").is_err());
        assert!(build_open_url("http://example.com/song/{song_id}", "123").is_err());
        assert!(build_open_url("https://music.163.com.evil/{song_id}", "123").is_err());
    }
}
