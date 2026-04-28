use std::collections::BTreeMap;

use anyhow::Result;
use reqwest::header::{HeaderMap, SET_COOKIE};

const TOKEN_TXT: &str = "token/bili_token.txt";
const TOKEN_JSON: &str = "token/bili_token.json";

#[derive(Debug, Clone)]
pub struct CookieJar {
    pub cookie_string: String,
    pub cookie_map: BTreeMap<String, String>,
}

pub fn has_token() -> bool {
    std::path::Path::new(TOKEN_TXT).exists() && std::path::Path::new(TOKEN_JSON).exists()
}

pub fn read_cookie_string() -> Result<String> {
    Ok(std::fs::read_to_string(TOKEN_TXT)?)
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
        cookie_string.push(';');
    }

    CookieJar {
        cookie_string,
        cookie_map,
    }
}
