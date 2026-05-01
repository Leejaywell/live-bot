use std::collections::BTreeMap;
use std::path::Path;

use anyhow::Result;
use serde::{Deserialize, Serialize};

const CONFIG_PATH: &str = "etc/bilidanmaku-api.yaml";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AppConfig {
    pub room_id: i64,
    pub ws_server_url: String,
    pub danmu_len: i32,
    pub entry_msg: String,
    pub pk_notice: bool,
    pub show_block_msg: bool,
    pub goodbye_info: String,
    pub keyword_reply: bool,
    pub keyword_reply_list: BTreeMap<String, String>,
    pub talk_robot_cmd: String,
    pub fuzzy_match_cmd: bool,
    pub robot_name: String,
    pub robot_mode: String,
    #[serde(rename = "ChatGPT")]
    pub chatgpt: ChatGptConfig,
    pub interact_word: bool,
    pub welcome_use_at: bool,
    pub welcome_danmu: Vec<String>,
    pub interact_word_by_time: bool,
    pub welcome_danmu_by_time: Vec<TimeWelcome>,
    pub entry_effect: bool,
    pub welcome_high_wealthy: bool,
    pub welcome_high_wealthy_level: i32,
    pub thanks_focus: bool,
    pub thanks_share: bool,
    pub interact_self: bool,
    pub interact_anchor: bool,
    pub focus_danmu: Vec<String>,
    pub welcome_switch: bool,
    pub welcome_string: BTreeMap<String, String>,
    pub welcome_blacklist_wide: Vec<String>,
    pub welcome_blacklist: Vec<String>,
    pub thanks_gift: bool,
    pub thanks_gift_timeout: i32,
    pub thanks_blind_box_timeout: i32,
    pub thanks_min_cost: i32,
    pub blind_box_profit_loss_stat: bool,
    pub thanks_gift_use_at: bool,
    #[serde(default)]
    pub gift_aliases: BTreeMap<String, String>,
    #[serde(default)]
    pub gift_thanks_templates: BTreeMap<String, String>,
    pub cron_danmu: bool,
    pub cron_danmu_list: Vec<CronDanmu>,
    pub draw_by_lot: bool,
    pub draw_lots_list: Vec<String>,
    pub sign_in_enable: bool,
    pub danmu_cnt_enable: bool,
    pub blind_box_stat: bool,
    #[serde(rename = "DBPath")]
    pub db_path: String,
    #[serde(rename = "DBName")]
    pub db_name: String,
    pub customize_bullet: bool,
    pub lottery_enable: bool,
    pub lottery_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ChatGptConfig {
    #[serde(rename = "APIUrl")]
    pub api_url: String,
    #[serde(rename = "APIToken")]
    pub api_token: String,
    pub prompt: String,
    pub limit: bool,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct TimeWelcome {
    pub enabled: bool,
    pub key: String,
    pub random: bool,
    pub danmu: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct CronDanmu {
    pub cron: String,
    pub random: bool,
    pub danmu: Vec<String>,
}

impl AppConfig {
    pub fn load_or_default() -> Result<Self> {
        if !Path::new(CONFIG_PATH).exists() {
            let config = Self::default();
            config.save()?;
            return Ok(config);
        }

        let text = std::fs::read_to_string(CONFIG_PATH)?;
        Ok(serde_yaml::from_str(&text)?)
    }

    pub fn save(&self) -> Result<()> {
        std::fs::create_dir_all("etc")?;
        let yaml = serde_yaml::to_string(self)?;
        std::fs::write(CONFIG_PATH, yaml)?;
        Ok(())
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            room_id: 3,
            ws_server_url: "wss://broadcastlv.chat.bilibili.com:2245/sub".to_string(),
            danmu_len: 20,
            entry_msg: "花花机器人进入直播间".to_string(),
            pk_notice: true,
            show_block_msg: true,
            goodbye_info: "下播啦~ 感谢大家的陪伴~ 下次见哦~".to_string(),
            keyword_reply: false,
            keyword_reply_list: BTreeMap::from([
                ("回复关键词1".to_string(), "回复内容1".to_string()),
                ("回复关键词2".to_string(), "回复内容2".to_string()),
            ]),
            talk_robot_cmd: "花花".to_string(),
            fuzzy_match_cmd: false,
            robot_name: "花花".to_string(),
            robot_mode: "QingYunKe".to_string(),
            chatgpt: ChatGptConfig::default(),
            interact_word: true,
            welcome_use_at: false,
            welcome_danmu: vec![
                "欢迎 {user}, 你来啦~".to_string(),
                "欢迎 {user}, 等你好久了~".to_string(),
                "欢迎 {user}, 你好呀~".to_string(),
            ],
            interact_word_by_time: false,
            welcome_danmu_by_time: default_time_welcome(),
            entry_effect: true,
            welcome_high_wealthy: false,
            welcome_high_wealthy_level: 20,
            thanks_focus: true,
            thanks_share: true,
            interact_self: true,
            interact_anchor: true,
            focus_danmu: vec![
                "啾咪~".to_string(),
                "喜欢可以领牌牌哦~".to_string(),
                "贴贴~".to_string(),
            ],
            welcome_switch: true,
            welcome_string: BTreeMap::from([(
                "123456".to_string(),
                "欢迎宇宙无敌最帅的xxx进入直播间".to_string(),
            )]),
            welcome_blacklist_wide: vec!["小妖网".to_string(), "朲芞".to_string()],
            welcome_blacklist: vec!["小妖网玩".to_string(), "独家朲芞".to_string()],
            thanks_gift: true,
            thanks_gift_timeout: 3,
            thanks_blind_box_timeout: 6,
            thanks_min_cost: 0,
            blind_box_profit_loss_stat: true,
            thanks_gift_use_at: false,
            gift_aliases: BTreeMap::new(),
            gift_thanks_templates: BTreeMap::new(),
            cron_danmu: false,
            cron_danmu_list: vec![CronDanmu {
                cron: "*/2 * * * *".to_string(),
                random: true,
                danmu: vec![
                    "喜欢主播请关注, 主播带你去致富~".to_string(),
                    "喜欢主播的小伙伴可以动动小手点个关注~".to_string(),
                ],
            }],
            draw_by_lot: true,
            draw_lots_list: vec![
                "恭喜您抽到吉签，好运常伴，心想事成！".to_string(),
                "遗憾，下签，请保持警惕。".to_string(),
                "我是签，抽我抽我".to_string(),
            ],
            sign_in_enable: true,
            danmu_cnt_enable: false,
            blind_box_stat: true,
            db_path: "./db".to_string(),
            db_name: "sqliteDataBase.db".to_string(),
            customize_bullet: false,
            lottery_enable: true,
            lottery_url: String::new(),
        }
    }
}

impl Default for ChatGptConfig {
    fn default() -> Self {
        Self {
            api_url: String::new(),
            api_token: String::new(),
            prompt: "你是一个非常幽默的机器人助理，可以使用emoji表情，可以使用颜文字".to_string(),
            limit: true,
            model: "gpt-3.5-turbo".to_string(),
        }
    }
}

fn default_time_welcome() -> Vec<TimeWelcome> {
    [
        ("earlymorning", "欢迎 {user}, 凌晨的问候~"),
        ("morning", "欢迎 {user}, 早安，美好开始"),
        ("latemorning", "欢迎 {user}, 上午好，奋斗有力"),
        ("noon", "欢迎 {user}, 中午好，午餐愉快"),
        ("afternoon", "欢迎 {user}, 下午好，动力十足"),
        ("night", "欢迎 {user}, 晚上好，祝福相伴"),
        ("midnight", "欢迎 {user}, 午夜好，还没休息?"),
    ]
    .into_iter()
    .map(|(key, msg)| TimeWelcome {
        enabled: true,
        key: key.to_string(),
        random: true,
        danmu: vec![msg.to_string()],
    })
    .collect()
}
