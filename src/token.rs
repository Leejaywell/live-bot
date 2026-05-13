use std::collections::BTreeMap;

use anyhow::Result;
use reqwest::header::{HeaderMap, SET_COOKIE};

const TOKEN_TXT: &str = "token/bili_token.txt";
const TOKEN_JSON: &str = "token/bili_token.json";
const REFRESH_TOKEN: &str = "token/bili_refresh_token.txt";

#[derive(Debug, Clone)]
pub struct CookieJar {
    pub cookie_string: String,
    pub cookie_map: BTreeMap<String, String>,
}

pub fn read_cookie_string() -> Result<String> {
    Ok(std::fs::read_to_string(TOKEN_TXT)?)
}

pub fn cookie_file_modified_secs() -> Option<i64> {
    std::fs::metadata(TOKEN_TXT)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs()
        .try_into()
        .ok()
}

pub fn write_cookie(cookie: &CookieJar) -> Result<()> {
    std::fs::create_dir_all("token")?;
    std::fs::write(TOKEN_TXT, &cookie.cookie_string)?;
    std::fs::write(
        TOKEN_JSON,
        serde_json::to_string_pretty(&cookie.cookie_map)?,
    )?;
    Ok(())
}

pub fn write_refresh_token(refresh_token: &str) -> Result<()> {
    std::fs::create_dir_all("token")?;
    std::fs::write(REFRESH_TOKEN, refresh_token)?;
    Ok(())
}

pub fn read_refresh_token() -> Option<String> {
    std::fs::read_to_string(REFRESH_TOKEN)
        .ok()
        .filter(|s| !s.trim().is_empty())
}

pub fn delete_cookie() -> Result<()> {
    let _ = std::fs::remove_file(TOKEN_TXT);
    let _ = std::fs::remove_file(TOKEN_JSON);
    let _ = std::fs::remove_file(REFRESH_TOKEN);
    Ok(())
}

pub fn collect_set_cookie(headers: &HeaderMap) -> CookieJar {
    let mut cookie_map = BTreeMap::new();
    let mut cookie_string = String::new();

    for value in headers.get_all(SET_COOKIE) {
        let Ok(raw) = value.to_str() else {
            continue;
        };
        let Some(pair) = raw.split(';').next() else {
            continue;
        };
        let Some((key, val)) = pair.split_once('=') else {
            continue;
        };
        cookie_map
            .entry(key.to_string())
            .or_insert_with(|| val.to_string());
    }

    for (key, value) in &cookie_map {
        cookie_string.push_str(key);
        cookie_string.push('=');
        cookie_string.push_str(value);
        cookie_string.push_str("; ");
    }

    CookieJar {
        cookie_string,
        cookie_map,
    }
}
