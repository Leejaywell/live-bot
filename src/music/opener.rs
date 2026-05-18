#![allow(dead_code)]

use anyhow::{Result, bail};

const CUSTOM_URL_PREFIXES: &[&str] = &["orpheus://", "qqmusic://"];
const HTTPS_HOST_PREFIXES: &[&str] = &["https://music.163.com", "https://y.qq.com"];
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
    CUSTOM_URL_PREFIXES
        .iter()
        .any(|prefix| url.starts_with(prefix))
        || HTTPS_HOST_PREFIXES
            .iter()
            .any(|prefix| has_allowed_https_host_prefix(url, prefix))
}

fn is_valid_song_id(song_id: &str) -> bool {
    !song_id.is_empty()
        && song_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn has_allowed_https_host_prefix(url: &str, prefix: &str) -> bool {
    let Some(rest) = url.strip_prefix(prefix) else {
        return false;
    };

    rest.is_empty() || matches!(rest.as_bytes()[0], b'/' | b'?' | b'#')
}

#[cfg(test)]
pub mod tests {
    use super::{build_open_url, is_allowed_open_url};

    #[test]
    fn allows_music_urls() {
        assert!(is_allowed_open_url("orpheus://song/123"));
        assert!(is_allowed_open_url("qqmusic://song/123"));
        assert!(is_allowed_open_url("https://music.163.com/#/song?id=123"));
        assert!(is_allowed_open_url(
            "https://y.qq.com/n/ryqq/songDetail/123"
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
