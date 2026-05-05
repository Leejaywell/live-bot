use std::path::Path;

use anyhow::{Result, anyhow};
use reqwest::header::{COOKIE, HeaderMap, HeaderValue, USER_AGENT};
use serde::Deserialize;

use crate::config::AppConfig;
use crate::token;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

#[derive(Clone)]
pub struct BiliApi {
    client: reqwest::Client,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LoginUrl {
    pub url: String,
    pub qrcode_key: String,
}

#[derive(Debug)]
pub enum LoginPoll {
    Pending(String),
    Success(token::CookieJar),
    Expired(String),
}

#[derive(Debug, serde::Serialize)]
pub struct RoomInfo {
    pub room_id: i64,
    pub uid: i64,
    pub live_status: i32,
}

#[derive(Debug, serde::Serialize)]
pub struct DanmuInfo {
    pub token: String,
    pub hosts: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct UserInfo {
    pub uname: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub link: String,
    pub change_log: String,
}

impl BiliApi {
    pub fn new() -> Result<Self> {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(UA));
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()?;
        Ok(Self { client })
    }

    pub async fn login_url(&self) -> Result<LoginUrl> {
        let response: ApiResponse<LoginUrlData> = self
            .client
            .get("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if response.code != 0 {
            return Err(anyhow!(response.message));
        }
        Ok(LoginUrl {
            url: response.data.url,
            qrcode_key: response.data.qrcode_key,
        })
    }

    pub async fn poll_login(&self, key: &str) -> Result<LoginPoll> {
        let response = self
            .client
            .get("https://passport.bilibili.com/x/passport-login/web/qrcode/poll")
            .query(&[("qrcode_key", key)])
            .send()
            .await?
            .error_for_status()?;
        let headers = response.headers().clone();
        let body: ApiResponse<LoginPollData> = response.json().await?;
        if body.code != 0 {
            return Err(anyhow!(body.message));
        }

        match body.data.code {
            0 => Ok(LoginPoll::Success(token::collect_set_cookie(&headers))),
            86038 => Ok(LoginPoll::Expired(body.data.message)),
            _ => Ok(LoginPoll::Pending(body.data.message)),
        }
    }

    pub async fn room_init(&self, room_id: i64) -> Result<RoomInfo> {
        let response: ApiResponse<RoomInitData> = self
            .client
            .get("https://api.live.bilibili.com/room/v1/Room/room_init")
            .query(&[("id", room_id)])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if response.code != 0 {
            return Err(anyhow!(response.message));
        }
        Ok(RoomInfo {
            room_id: response.data.room_id,
            uid: response.data.uid,
            live_status: response.data.live_status,
        })
    }

    pub async fn danmu_info(&self, room_id: i64, cookie: &str) -> Result<DanmuInfo> {
        let response: ApiResponse<DanmuInfoData> = self
            .client
            .get("https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo")
            .query(&[("id", room_id), ("type", 0)])
            .header(COOKIE, cookie)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if response.code != 0 {
            return Err(anyhow!(response.message));
        }
        let hosts = response
            .data
            .host_list
            .into_iter()
            .map(|host| host.host)
            .collect();
        Ok(DanmuInfo {
            token: response.data.token,
            hosts,
        })
    }

    pub async fn user_info(&self, cookie: &str) -> Result<UserInfo> {
        let response: ApiResponse<UserInfoData> = self
            .client
            .get("https://api.bilibili.com/x/web-interface/nav")
            .header(COOKIE, cookie)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if response.code != 0 || !response.data.is_login {
            return Err(anyhow!("Bilibili 登录状态无效"));
        }
        Ok(UserInfo {
            uname: response.data.uname,
        })
    }

    pub async fn send_danmu(&self, room_id: i64, msg: &str, cookie: &str) -> Result<()> {
        if msg.trim().is_empty() {
            return Err(anyhow!("弹幕内容不能为空"));
        }
        let csrf =
            extract_cookie(cookie, "bili_jct").ok_or_else(|| anyhow!("token 中缺少 bili_jct"))?;
        let form = [
            ("bubble", "5".to_string()),
            ("msg", msg.to_string()),
            ("color", "4546550".to_string()),
            ("fontsize", "25".to_string()),
            ("rnd", chrono::Local::now().timestamp().to_string()),
            ("roomid", room_id.to_string()),
            ("csrf", csrf.clone()),
            ("csrf_token", csrf),
        ];
        let response: SendResponse = self
            .client
            .post("https://api.live.bilibili.com/msg/send")
            .header(COOKIE, cookie)
            .form(&form)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if response.code != 0 {
            return Err(anyhow!(
                response.msg.unwrap_or_else(|| "发送失败".to_string())
            ));
        }
        Ok(())
    }

    pub async fn robot_reply(&self, config: &AppConfig, prompt: &str) -> Result<String> {
        if config.robot_mode == "ChatGPT" {
            self.chatgpt_reply(config, prompt).await
        } else {
            self.qingyunke_reply(prompt).await
        }
    }

    pub async fn check_update(&self, current_version: &str) -> Result<Option<UpdateInfo>> {
        let response: UpdateResponse = self
            .client
            .get("https://danmuji.neuedu.work/getUpdate")
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if response.version == current_version {
            return Ok(None);
        }
        Ok(Some(UpdateInfo {
            version: response.version,
            link: response.link,
            change_log: response.change_log,
        }))
    }

    pub async fn download_update(&self, url: &str, destination: impl AsRef<Path>) -> Result<()> {
        if url.trim().is_empty() {
            return Err(anyhow!("没有可下载的更新地址"));
        }
        let destination = destination.as_ref();
        let bytes = self
            .client
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?;
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(destination, bytes)?;
        Ok(())
    }

    pub async fn download_update_upgrader(&self, destination: impl AsRef<Path>) -> Result<()> {
        let response: UpdateResponse = self
            .client
            .get("https://danmuji.neuedu.work/getUpgraderUpdate")
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        self.download_update(&response.link, destination).await
    }

    async fn qingyunke_reply(&self, prompt: &str) -> Result<String> {
        let nonce = chrono::Local::now().timestamp_micros().to_string();
        let response: QingyunkeResponse = self
            .client
            .get("http://api.qingyunke.com/api.php")
            .query(&[
                ("key", "free".to_string()),
                ("appid", "0".to_string()),
                ("msg", prompt.to_string()),
                ("_", nonce),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(clean_robot_reply(&response.content))
    }

    async fn chatgpt_reply(&self, config: &AppConfig, prompt: &str) -> Result<String> {
        if config.chatgpt.api_token.trim().is_empty() {
            return Err(anyhow!("ChatGPT APIToken 不能为空"));
        }
        let base = if config.chatgpt.api_url.trim().is_empty() {
            "https://api.openai.com/v1"
        } else {
            config.chatgpt.api_url.trim().trim_end_matches('/')
        };
        let system_prompt = if config.chatgpt.limit {
            format!(
                "{} 尽可能的在{}个字内回答",
                config.chatgpt.prompt, config.danmu_len
            )
        } else {
            config.chatgpt.prompt.clone()
        };
        let request = ChatCompletionRequest {
            model: config.chatgpt.model.clone(),
            messages: vec![
                ChatMessage {
                    role: "system",
                    content: system_prompt,
                },
                ChatMessage {
                    role: "user",
                    content: prompt.to_string(),
                },
            ],
        };
        let response: ChatCompletionResponse = self
            .client
            .post(format!("{base}/chat/completions"))
            .bearer_auth(config.chatgpt.api_token.trim())
            .json(&request)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let content = response
            .choices
            .into_iter()
            .map(|choice| choice.message.content)
            .collect::<Vec<_>>()
            .join("");
        Ok(clean_robot_reply(&content))
    }
}

fn extract_cookie(cookie: &str, name: &str) -> Option<String> {
    cookie.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        (key == name).then(|| value.to_string())
    })
}

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    code: i32,
    #[serde(default)]
    message: String,
    data: T,
}

#[derive(Debug, Deserialize)]
struct LoginUrlData {
    url: String,
    qrcode_key: String,
}

#[derive(Debug, Deserialize)]
struct LoginPollData {
    code: i32,
    message: String,
}

#[derive(Debug, Deserialize)]
struct RoomInitData {
    room_id: i64,
    uid: i64,
    live_status: i32,
}

#[derive(Debug, Deserialize)]
struct DanmuInfoData {
    token: String,
    host_list: Vec<DanmuHost>,
}

#[derive(Debug, Deserialize)]
struct DanmuHost {
    host: String,
}

#[derive(Debug, Deserialize)]
struct UserInfoData {
    #[serde(default)]
    is_login: bool,
    #[serde(default)]
    uname: String,
}

#[derive(Debug, Deserialize)]
struct SendResponse {
    code: i32,
    #[serde(default)]
    msg: Option<String>,
}

#[derive(Debug, Deserialize)]
struct QingyunkeResponse {
    content: String,
}

#[derive(Debug, serde::Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, serde::Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
}

#[derive(Debug, Deserialize)]
struct ChatChoiceMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateResponse {
    version: String,
    link: String,
    change_log: String,
}

fn clean_robot_reply(content: &str) -> String {
    content
        .replace("菲菲", "花花")
        .replace("{br}", "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
