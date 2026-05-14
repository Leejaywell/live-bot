use std::time::{SystemTime, UNIX_EPOCH};

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
    Success(String, String), // cookie_string + refresh_token
    Expired(String),
}

#[derive(Debug, serde::Serialize)]
pub struct RoomInfo {
    pub room_id: i64,
    pub short_id: i64,
    pub uid: i64,
    pub live_status: i32,
    pub live_time: String,
    pub title: String,
    pub uname: String,
    pub area_name: String,
    pub parent_area_name: String,
    pub online: i64,
    pub keyframe: String,
    pub cover: String,
}

#[derive(Debug, serde::Serialize)]
pub struct DanmuInfo {
    pub token: String,
    pub hosts: Vec<bilibili_live_protocol::DanmuHost>,
}

#[derive(Debug, serde::Serialize)]
pub struct UserInfo {
    pub uid: i64,
    pub uname: String,
    pub face: String,
    pub level: i32,
    pub vip_status: i32,
    pub vip_type: i32,
    pub coins: f64,
    pub vip_nickname_color: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AnchorInfo {
    pub uid: i64,
    pub uname: String,
    pub face: String,
    pub follower_num: i64,
    pub medal_name: String,
    pub sign: String,
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
            0 => {
                let cookie = token::parse_set_cookie(&headers);
                // After success, visit a main page to get more security cookies (like sec_ck)
                let _ = self.client.get("https://live.bilibili.com/").header(reqwest::header::COOKIE, &cookie).send().await;
                Ok(LoginPoll::Success(cookie, body.data.refresh_token))
            }
            86038 => Ok(LoginPoll::Expired(body.data.message)),
            _ => Ok(LoginPoll::Pending(body.data.message)),
        }
    }

    pub async fn check_cookie_refresh_needed(&self, cookie: &str) -> Result<bool> {
        #[derive(Deserialize)]
        struct CookieInfoData {
            #[serde(default)]
            refresh: bool,
        }

        let body: ApiResponse<CookieInfoData> = self
            .client
            .get("https://passport.bilibili.com/x/passport-login/web/cookie/info")
            .header(COOKIE, cookie)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        if body.code != 0 {
            return Err(anyhow!("查询 cookie 状态失败: {}", body.message));
        }
        Ok(body.data.refresh)
    }

    pub async fn refresh_cookie(
        &self,
        refresh_token: &str,
        cookie: &str,
    ) -> Result<(String, String)> {
        let csrf = extract_cookie(cookie, "bili_jct").unwrap_or_default();
        let response = self
            .client
            .post("https://passport.bilibili.com/x/passport-login/web/token/refresh")
            .header(COOKIE, cookie)
            .form(&[
                ("csrf", &csrf),
                ("refresh_token", &refresh_token.to_string()),
            ])
            .send()
            .await?
            .error_for_status()?;
        let headers = response.headers().clone();
        let body: ApiResponse<RefreshTokenData> = response.json().await?;
        if body.code != 0 {
            return Err(anyhow!("刷新 cookie 失败: {}", body.message));
        }
        Ok((token::parse_set_cookie(&headers), body.data.refresh_token))
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
            short_id: 0,
            uid: response.data.uid,
            live_status: response.data.live_status,
            live_time: String::new(),
            title: String::new(),
            uname: String::new(),
            area_name: String::new(),
            parent_area_name: String::new(),
            online: 0,
            keyframe: String::new(),
            cover: String::new(),
        })
    }

    pub async fn room_info(&self, room_id: i64) -> Result<RoomInfo> {
        let response: ApiResponse<RoomInfoGetData> = self
            .client
            .get("https://api.live.bilibili.com/room/v1/Room/get_info")
            .query(&[("room_id", room_id)])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if response.code != 0 {
            return Err(anyhow!(response.message));
        }
        let d = response.data;
        Ok(RoomInfo {
            room_id: d.room_id,
            short_id: d.short_id,
            uid: d.uid,
            live_status: d.live_status,
            live_time: d.live_time,
            title: d.title,
            uname: d.uname,
            area_name: d.area_name,
            parent_area_name: d.parent_area_name,
            online: d.online,
            keyframe: d.keyframe,
            cover: d.user_cover,
        })
    }

    pub async fn fetch_buvid(&self) -> Result<String> {
        #[derive(Deserialize)]
        struct SpiData {
            b_3: String,
        }
        let response: ApiResponse<SpiData> = self
            .client
            .get("https://api.bilibili.com/x/frontend/finger/spi")
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if response.code != 0 {
            return Err(anyhow!(response.message));
        }
        Ok(response.data.b_3)
    }

    async fn fetch_wbi_keys(&self, cookie: &str) -> Result<(String, String)> {
        #[derive(Deserialize)]
        struct WbiImg { img_url: String, sub_url: String }
        #[derive(Deserialize)]
        struct NavData { wbi_img: WbiImg }
        let response: ApiResponse<NavData> = self
            .client
            .get("https://api.bilibili.com/x/web-interface/nav")
            .header(COOKIE, cookie)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let img = &response.data.wbi_img;
        let img_key = img.img_url
            .rsplit('/').next().unwrap_or("").trim_end_matches(".png");
        let sub_key = img.sub_url
            .rsplit('/').next().unwrap_or("").trim_end_matches(".png");
        Ok((img_key.to_string(), sub_key.to_string()))
    }

    fn wbi_sign(params: &str, img_key: &str, sub_key: &str) -> String {
        const MIXIN_KEY_ENC_TAB: &[usize] = &[
            46, 47, 18,  2, 53,  8, 23, 32, 15, 50, 10, 31, 58,  3, 45, 35,
            27, 43,  5, 49, 33,  9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
            37, 48,  7, 16, 24, 55, 40, 61, 26, 17,  0,  1, 60, 51, 30,  4,
            22, 25, 54, 21, 56, 59,  6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
        ];
        let raw: Vec<char> = format!("{img_key}{sub_key}").chars().collect();
        let mixin_key: String = MIXIN_KEY_ENC_TAB.iter()
            .filter_map(|&i| raw.get(i).copied())
            .take(32)
            .collect();

        let wts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut parts: Vec<&str> = params.split('&').collect();
        let wts_str = format!("wts={wts}");
        parts.push(&wts_str);
        parts.sort();
        let sorted = parts.join("&");

        let digest = md5::compute(format!("{sorted}{mixin_key}"));
        let w_rid = format!("{:x}", digest);
        format!("{params}&wts={wts}&w_rid={w_rid}")
    }

    pub async fn danmu_info(&self, room_id: i64, cookie: &str) -> Result<DanmuInfo> {
        let (img_key, sub_key) = self.fetch_wbi_keys(cookie).await
            .unwrap_or_default();
        let base_params = format!("id={room_id}&type=0");
        let signed = if img_key.is_empty() {
            base_params
        } else {
            Self::wbi_sign(&base_params, &img_key, &sub_key)
        };
        let url = format!(
            "https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?{signed}"
        );
        let response: ApiResponse<DanmuInfoData> = self
            .client
            .get(&url)
            .header(COOKIE, cookie)
            .header("Referer", format!("https://live.bilibili.com/{room_id}"))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if response.code != 0 {
            return Err(anyhow!("getDanmuInfo 失败 (code={}): {}", response.code, response.message));
        }
        let hosts = response.data.host_list.into_iter()
            .map(|h| bilibili_live_protocol::DanmuHost {
                host: h.host,
                wss_port: h.wss_port,
            })
            .collect();
        Ok(DanmuInfo { token: response.data.token, hosts })
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
        let d = response.data;
        Ok(UserInfo {
            uid: d.mid,
            uname: d.uname,
            face: d.face,
            level: d.level_info.current_level,
            vip_status: d.vip_status,
            vip_type: d.vip_type,
            coins: d.money,
            vip_nickname_color: d.vip.nickname_color,
        })
    }

    pub async fn room_id_by_uid(&self, uid: i64) -> Result<RoomInfo> {
        let response: ApiResponse<RoomIdByUidData> = self
            .client
            .get("https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld")
            .query(&[("mid", uid)])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if response.code != 0 {
            return Err(anyhow!("获取用户直播间失败: {}", response.message));
        }
        if response.data.room_id == 0 {
            return Err(anyhow!("该用户没有直播间"));
        }
        self.room_info(response.data.room_id).await
    }

    pub async fn send_danmu(&self, room_id: i64, msg: &str, cookie: &str) -> Result<()> {
        if msg.trim().is_empty() {
            return Err(anyhow!("弹幕内容不能为空"));
        }
        let csrf =
            extract_cookie(cookie, "bili_jct").ok_or_else(|| anyhow!("token 中缺少 bili_jct"))?;
        let response: SendResponse = self
            .client
            .post("https://api.live.bilibili.com/msg/send")
            .header(COOKIE, cookie)
            .form(&[
                ("color", "16777215"),
                ("fontsize", "25"),
                ("mode", "1"),
                ("msg", msg),
                ("rnd", &chrono::Local::now().timestamp().to_string()),
                ("roomid", &room_id.to_string()),
                ("csrf", &csrf),
                ("csrf_token", &csrf),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if response.code != 0 {
            return Err(anyhow!(
                response.msg.unwrap_or_else(|| "发送弹幕失败".to_string())
            ));
        }
        Ok(())
    }

    pub async fn robot_assistant_reply(&self, config: &AppConfig, prompt: &str) -> Result<String> {
        // 优先找 ai_bots 中第一个启用的 bot
        if let Some(bot) = config.ai_bots.iter().find(|b| b.enabled) {
            if let Some(provider) = config.ai_providers.iter().find(|p| p.id == bot.provider_id) {
                let system_prompt = bot.system_prompt.replace("{{name}}", &bot.nickname);
                return self.openai_reply(provider, &system_prompt, &[], prompt).await;
            }
        }
        // fallback: 旧版 active_provider_id 路径
        let provider = config
            .ai_providers
            .iter()
            .find(|p| p.id == config.active_provider_id)
            .ok_or_else(|| anyhow!("未找到活跃的 AI 供应商"))?;
        let system_prompt = provider.system_prompt.replace("{{name}}", &provider.nickname);
        self.openai_reply(provider, &system_prompt, &[], prompt).await
    }

    pub async fn check_update(&self, current_version: &str) -> Result<Option<UpdateInfo>> {
        let response: UpdateResponse = self
            .client
            .get("https://api.github.com/repos/Leejaywell/live-bot/releases/latest")
            .header(USER_AGENT, UA)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        // normalize: strip leading 'v' from both sides for comparison
        let strip_v = |s: &str| s.trim_start_matches('v').to_string();
        if strip_v(&response.tag_name) != strip_v(current_version) {
            Ok(Some(UpdateInfo {
                version: response.tag_name,
                link: response.html_url,
                change_log: response.body,
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn anchor_info(&self, uid: i64) -> Result<AnchorInfo> {
        #[derive(Deserialize)]
        struct AnchorInfoData {
            info: AnchorBasicInfo,
            follower_num: i64,
            #[serde(default)]
            medal_name: String,
        }
        #[derive(Deserialize)]
        struct AnchorBasicInfo {
            uid: i64,
            uname: String,
            face: String,
        }
        #[derive(Deserialize)]
        struct SpaceData {
            #[serde(default)]
            sign: String,
        }

        let resp: ApiResponse<AnchorInfoData> = self
            .client
            .get("https://api.live.bilibili.com/live_user/v1/Master/info")
            .query(&[("uid", uid)])
            .send()
            .await?
            .json()
            .await?;
        if resp.code != 0 {
            return Err(anyhow!(resp.message));
        }

        let sign = match self
            .client
            .get("https://api.bilibili.com/x/space/acc/info")
            .query(&[("mid", uid)])
            .send()
            .await
        {
            Ok(r) => r
                .json::<ApiResponse<SpaceData>>()
                .await
                .map(|r| if r.code == 0 { r.data.sign } else { String::new() })
                .unwrap_or_default(),
            Err(_) => String::new(),
        };

        Ok(AnchorInfo {
            uid: resp.data.info.uid,
            uname: resp.data.info.uname,
            face: resp.data.info.face,
            follower_num: resp.data.follower_num,
            medal_name: resp.data.medal_name,
            sign,
        })
    }

    pub async fn fetch_image(&self, url: &str) -> Result<Vec<u8>> {
        let bytes = self
            .client
            .get(url)
            .header("Referer", "https://www.bilibili.com")
            .header(USER_AGENT, UA)
            .send()
            .await?
            .bytes()
            .await?;
        Ok(bytes.to_vec())
    }

    /// 低级 chat completions 接口（供 AgentRuntime 使用，支持 tool_calls）
    pub async fn chat_completions_raw(
        &self,
        provider: &crate::config::AiProvider,
        messages: &[serde_json::Value],
        tools: Option<&[serde_json::Value]>,
    ) -> anyhow::Result<serde_json::Value> {
        let url = if provider.api_url.ends_with("/chat/completions") {
            provider.api_url.clone()
        } else {
            format!("{}/chat/completions", provider.api_url.trim_end_matches('/'))
        };
        let mut body = serde_json::json!({
            "model": provider.model,
            "messages": messages,
        });
        if let Some(tools) = tools {
            body["tools"] = serde_json::json!(tools);
            body["tool_choice"] = serde_json::json!("auto");
        }
        let response: serde_json::Value = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", provider.api_key))
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(response)
    }

    async fn openai_reply(
        &self,
        provider: &crate::config::AiProvider,
        system_prompt: &str,
        history: &[(String, String)],
        prompt: &str,
    ) -> Result<String> {
        let url = if provider.api_url.ends_with("/chat/completions") {
            provider.api_url.clone()
        } else {
            format!(
                "{}/chat/completions",
                provider.api_url.trim_end_matches('/')
            )
        };

        let mut messages = vec![ChatMessage {
            role: "system".to_string(),
            content: system_prompt.to_string(),
        }];
        for (role, content) in history {
            messages.push(ChatMessage { role: role.clone(), content: content.clone() });
        }
        messages.push(ChatMessage { role: "user".to_string(), content: prompt.to_string() });

        let request = ChatCompletionRequest {
            model: provider.model.clone(),
            messages,
        };
        let response: ChatCompletionResponse = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", provider.api_key))
            .json(&request)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(response.choices[0].message.content.clone())
    }
}

fn extract_cookie(cookie: &str, name: &str) -> Option<String> {
    cookie.split(';').find_map(|s| {
        let s = s.trim();
        let prefix = format!("{}=", name);
        if s.starts_with(&prefix) {
            Some(s[prefix.len()..].to_string())
        } else {
            None
        }
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
    #[serde(default)]
    refresh_token: String,
}

#[derive(Debug, Deserialize)]
struct RefreshTokenData {
    #[serde(default)]
    refresh_token: String,
}

#[derive(Debug, Deserialize)]
struct RoomInitData {
    room_id: i64,
    uid: i64,
    live_status: i32,
}

#[derive(Debug, Deserialize)]
struct RoomInfoGetData {
    #[serde(default)]
    uid: i64,
    #[serde(default)]
    room_id: i64,
    #[serde(default)]
    short_id: i64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    uname: String,
    #[serde(default)]
    live_status: i32,
    #[serde(default)]
    live_time: String,
    #[serde(default)]
    area_name: String,
    #[serde(default)]
    parent_area_name: String,
    #[serde(default)]
    online: i64,
    #[serde(default)]
    keyframe: String,
    #[serde(default)]
    user_cover: String,
}

#[derive(Debug, Deserialize)]
struct DanmuInfoData {
    token: String,
    host_list: Vec<DanmuHost>,
}

#[derive(Debug, Deserialize)]
struct DanmuHost {
    host: String,
    #[serde(default)]
    wss_port: u16,
}

#[derive(Debug, Deserialize, Default)]
struct LevelInfo {
    #[serde(default)]
    current_level: i32,
}

#[derive(Debug, Deserialize, Default)]
struct VipInfo {
    #[serde(default)]
    nickname_color: String,
}

#[derive(Debug, Deserialize)]
struct UserInfoData {
    #[serde(rename = "isLogin", default)]
    is_login: bool,
    #[serde(default)]
    mid: i64,
    #[serde(default)]
    uname: String,
    #[serde(default)]
    face: String,
    #[serde(default)]
    money: f64,
    #[serde(default)]
    level_info: LevelInfo,
    #[serde(rename = "vipStatus", default)]
    vip_status: i32,
    #[serde(rename = "vipType", default)]
    vip_type: i32,
    #[serde(default)]
    vip: VipInfo,
}

#[derive(Debug, Deserialize)]
struct RoomIdByUidData {
    #[serde(rename = "roomid", default)]
    room_id: i64,
}

#[derive(Debug, Deserialize)]
struct SendResponse {
    code: i32,
    #[serde(default)]
    msg: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, serde::Serialize)]
struct ChatMessage {
    role: String,
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
struct UpdateResponse {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: String,
}
