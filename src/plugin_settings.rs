use std::path::PathBuf;

use anyhow::Result;
use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config;

const APP_ID: &str = "com.streamix.app";
const PLUGIN_SETTINGS_FILE: &str = "plugin-settings.toml";
const LEGACY_DANMAKU_CHAT_FILE: &str = "overlay.toml";

pub fn plugin_settings_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("etc"))
        .join(APP_ID)
        .join(PLUGIN_SETTINGS_FILE)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct PluginSettings {
    #[serde(default)]
    pub danmaku_chat: DanmakuChatSettings,
    #[serde(default)]
    pub wish_goal: WishGoalSettings,
    #[serde(default)]
    pub lottery_interaction: LotteryInteractionSettings,
    #[serde(default)]
    pub gift_effect: GiftEffectSettings,
    #[serde(default)]
    pub recent_gifts: RecentGiftsSettings,
    #[serde(default)]
    pub gift_rank: GiftRankSettings,
    #[serde(default)]
    pub music_interaction: MusicInteractionSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct DanmakuChatSettings {
    #[serde(default = "dc_port")]
    pub port: u16,
    #[serde(default = "dc_max_msgs")]
    pub max_msgs: u32,
    #[serde(default = "dc_msg_gap")]
    pub msg_gap: u8,
    #[serde(default = "dc_theme")]
    pub theme: String,
    #[serde(default)]
    pub custom_css: String,
    #[serde(default = "dc_one")]
    pub global_scale: f32,
    #[serde(default = "dc_one")]
    pub font_scale: f32,
    #[serde(default = "df_true")]
    pub show_avatar: bool,
    #[serde(default = "dc_avatar_size")]
    pub avatar_size: u8,
    #[serde(default = "df_true")]
    pub show_username: bool,
    #[serde(default = "dc_font_family")]
    pub user_name_font: String,
    #[serde(default = "dc_username_size")]
    pub user_name_font_size: u8,
    #[serde(default = "dc_weight_normal")]
    pub user_name_weight: u16,
    #[serde(default = "dc_username_color")]
    pub user_name_color: String,
    #[serde(default = "dc_owner_color")]
    pub owner_user_name_color: String,
    #[serde(default = "dc_mod_color")]
    pub moderator_user_name_color: String,
    #[serde(default = "dc_member_color")]
    pub member_user_name_color: String,
    #[serde(default = "df_true")]
    pub show_badges: bool,
    #[serde(default = "dc_font_family")]
    pub message_font: String,
    #[serde(default = "dc_msg_size")]
    pub message_font_size: u8,
    #[serde(default = "dc_weight_normal")]
    pub message_weight: u16,
    #[serde(default = "dc_msg_color")]
    pub message_color: String,
    #[serde(default)]
    pub show_time: bool,
    #[serde(default = "dc_font_family")]
    pub time_font: String,
    #[serde(default = "dc_time_size")]
    pub time_font_size: u8,
    #[serde(default = "dc_weight_normal")]
    pub time_weight: u16,
    #[serde(default = "dc_time_color")]
    pub time_color: String,
    #[serde(default = "dc_bg_color")]
    pub bg_color: String,
    #[serde(default = "dc_bg_opacity")]
    pub bg_opacity: f32,
    #[serde(default = "dc_msg_bg_color")]
    pub message_bg_color: String,
    #[serde(default = "dc_owner_bg_color")]
    pub owner_message_bg_color: String,
    #[serde(default = "dc_mod_bg_color")]
    pub moderator_message_bg_color: String,
    #[serde(default = "dc_member_bg_color")]
    pub member_message_bg_color: String,
    #[serde(default = "df_true")]
    pub show_gift: bool,
    #[serde(default)]
    pub gift_min_cost: u32,
    #[serde(default)]
    pub show_gift_icon: bool,
    #[serde(default = "df_true")]
    pub show_guard: bool,
    #[serde(default = "df_true")]
    pub show_sc: bool,
    #[serde(default)]
    pub sc_min_cost: u32,
    #[serde(default = "dc_sc_line1_size")]
    pub first_line_font_size: u8,
    #[serde(default = "dc_weight_bold")]
    pub first_line_weight: u16,
    #[serde(default = "dc_msg_size")]
    pub second_line_font_size: u8,
    #[serde(default = "dc_weight_bold")]
    pub second_line_weight: u16,
    #[serde(default = "dc_msg_size")]
    pub sc_content_font_size: u8,
    #[serde(default = "dc_weight_normal")]
    pub sc_content_weight: u16,
    #[serde(default = "df_true")]
    pub animate_in: bool,
    #[serde(default = "dc_fade_in")]
    pub fade_in_time: u16,
    #[serde(default)]
    pub animate_out: bool,
    #[serde(default = "dc_fade_out")]
    pub fade_out_time: u16,
    #[serde(default = "dc_out_wait")]
    pub animate_out_wait_time: u16,
    #[serde(default = "df_true")]
    pub slide: bool,
    #[serde(default)]
    pub reverse_slide: bool,
    #[serde(default = "df_true")]
    pub effects_enabled: bool,
    #[serde(default = "dc_one")]
    pub effect_intensity: f32,
    #[serde(default)]
    pub show_outlines: bool,
    #[serde(default = "dc_outline_size")]
    pub outline_size: u8,
    #[serde(default = "dc_outline_color")]
    pub outline_color: String,
    #[serde(default)]
    pub blurry_outline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct WishGoalSettings {
    #[serde(default = "df_true")]
    pub enabled: bool,
    #[serde(default = "df_wish_title")]
    pub title: String,
    #[serde(default = "df_wish_goals")]
    pub goals: Vec<WishGoalItem>,
    #[serde(default = "df_number_color")]
    pub number_color: String,
    #[serde(default = "df_background_color")]
    pub background_color: String,
    #[serde(default = "df_accent_color")]
    pub accent_color: String,
    #[serde(default = "df_text_color")]
    pub text_color: String,
    #[serde(default = "df_display_size")]
    pub display_size: String,
    #[serde(default = "df_true")]
    pub show_icons: bool,
    #[serde(default = "df_font_family")]
    pub font_family: String,
    #[serde(default = "df_style_preset")]
    pub style_preset: String,
    #[serde(default)]
    pub custom_css: String,
    #[serde(default = "df_complete_animation")]
    pub complete_animation: String,
    #[serde(default = "df_complete_sound")]
    pub complete_sound: String,
    #[serde(default = "df_sound_volume")]
    pub sound_volume: u8,
    #[serde(default = "df_sound_repeat")]
    pub sound_repeat: String,
    #[serde(default)]
    pub custom_sound_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct WishGoalItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub current: i64,
    #[serde(default = "df_goal_target")]
    pub target: i64,
    #[serde(default = "df_goal_icon")]
    pub icon: String,
    #[serde(default = "df_match_kind")]
    pub match_kind: String,
    #[serde(default)]
    pub gift_name: String,
    #[serde(default = "df_increment")]
    pub increment: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct LotteryInteractionSettings {
    #[serde(default = "df_true")]
    pub enabled: bool,
    #[serde(default = "df_lottery_title")]
    pub title: String,
    #[serde(default)]
    pub gift_name: String,
    #[serde(default = "df_lottery_gift_count")]
    pub gift_count: i64,
    #[serde(default = "df_lottery_stay_seconds")]
    pub stay_seconds: u64,
    #[serde(default = "df_lottery_prizes")]
    pub prizes: Vec<LotteryPrize>,
    #[serde(default)]
    pub last_winner: String,
    #[serde(default)]
    pub last_prize: String,
    #[serde(default)]
    pub draw_nonce: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct LotteryPrize {
    pub id: String,
    pub name: String,
    #[serde(default = "df_lottery_weight")]
    pub weight: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct GiftEffectSettings {
    #[serde(default = "df_true")]
    pub enabled: bool,
    #[serde(default = "df_gift_effect_skin")]
    pub skin: String,
    #[serde(default)]
    pub gift_name: String,
    #[serde(default = "df_gift_effect_sound")]
    pub sound: String,
    #[serde(default = "df_sound_volume")]
    pub sound_volume: u8,
    #[serde(default)]
    pub custom_sound_path: String,
    #[serde(default)]
    pub last_user: String,
    #[serde(default)]
    pub last_gift: String,
    #[serde(default)]
    pub last_count: i64,
    #[serde(default)]
    pub effect_nonce: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct RecentGiftsSettings {
    #[serde(default = "df_true")]
    pub enabled: bool,
    #[serde(default = "df_recent_gifts_title")]
    pub title: String,
    #[serde(default = "df_recent_gifts_max_items")]
    pub max_items: usize,
    #[serde(default = "df_recent_gifts_skin")]
    pub skin: String,
    #[serde(default = "df_recent_gifts_name_color")]
    pub name_color: String,
    #[serde(default = "df_recent_gifts_number_color")]
    pub number_color: String,
    #[serde(default = "df_recent_gifts_gift_color")]
    pub gift_color: String,
    #[serde(default)]
    pub items: Vec<RecentGiftItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct RecentGiftItem {
    pub id: String,
    pub user: String,
    #[serde(default)]
    pub avatar: String,
    pub gift: String,
    #[serde(default = "df_increment")]
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct GiftRankSettings {
    #[serde(default = "df_true")]
    pub enabled: bool,
    #[serde(default = "df_gift_rank_title")]
    pub title: String,
    #[serde(default = "df_gift_rank_max_items")]
    pub max_items: usize,
    #[serde(default = "df_gift_rank_skin")]
    pub skin: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub items: Vec<GiftRankItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct GiftRankItem {
    pub user: String,
    #[serde(default)]
    pub avatar: String,
    #[serde(default)]
    pub value: i64,
    #[serde(default)]
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct MusicInteractionSettings {
    #[serde(default = "df_true")]
    pub enabled: bool,
    #[serde(default = "df_music_skin")]
    pub skin: String,
    #[serde(default = "df_music_stats_range")]
    pub stats_range: String,
    #[serde(default = "df_true")]
    pub transparent: bool,
    #[serde(default = "df_music_width")]
    pub width: u32,
    #[serde(default = "df_music_height")]
    pub height: u32,
    #[serde(default = "df_true")]
    pub show_cover: bool,
    #[serde(default = "df_true")]
    pub show_requester: bool,
    #[serde(default = "df_true")]
    pub show_gift_tier: bool,
    #[serde(default = "df_true")]
    pub show_queue: bool,
    #[serde(default)]
    pub show_today_value: bool,
    #[serde(default = "df_music_primary_color")]
    pub primary_color: String,
    #[serde(default = "df_font_scale")]
    pub font_scale: f32,
}

impl Default for PluginSettings {
    fn default() -> Self {
        Self {
            danmaku_chat: DanmakuChatSettings::default(),
            wish_goal: WishGoalSettings::default(),
            lottery_interaction: LotteryInteractionSettings::default(),
            gift_effect: GiftEffectSettings::default(),
            recent_gifts: RecentGiftsSettings::default(),
            gift_rank: GiftRankSettings::default(),
            music_interaction: MusicInteractionSettings::default(),
        }
    }
}

impl Default for DanmakuChatSettings {
    fn default() -> Self {
        Self {
            port: dc_port(),
            max_msgs: dc_max_msgs(),
            msg_gap: dc_msg_gap(),
            theme: dc_theme(),
            custom_css: String::new(),
            global_scale: dc_one(),
            font_scale: dc_one(),
            show_avatar: true,
            avatar_size: dc_avatar_size(),
            show_username: true,
            user_name_font: dc_font_family(),
            user_name_font_size: dc_username_size(),
            user_name_weight: dc_weight_normal(),
            user_name_color: dc_username_color(),
            owner_user_name_color: dc_owner_color(),
            moderator_user_name_color: dc_mod_color(),
            member_user_name_color: dc_member_color(),
            show_badges: true,
            message_font: dc_font_family(),
            message_font_size: dc_msg_size(),
            message_weight: dc_weight_normal(),
            message_color: dc_msg_color(),
            show_time: false,
            time_font: dc_font_family(),
            time_font_size: dc_time_size(),
            time_weight: dc_weight_normal(),
            time_color: dc_time_color(),
            bg_color: dc_bg_color(),
            bg_opacity: dc_bg_opacity(),
            message_bg_color: dc_msg_bg_color(),
            owner_message_bg_color: dc_owner_bg_color(),
            moderator_message_bg_color: dc_mod_bg_color(),
            member_message_bg_color: dc_member_bg_color(),
            show_gift: true,
            gift_min_cost: 0,
            show_gift_icon: false,
            show_guard: true,
            show_sc: true,
            sc_min_cost: 0,
            first_line_font_size: dc_sc_line1_size(),
            first_line_weight: dc_weight_bold(),
            second_line_font_size: dc_msg_size(),
            second_line_weight: dc_weight_bold(),
            sc_content_font_size: dc_msg_size(),
            sc_content_weight: dc_weight_normal(),
            animate_in: true,
            fade_in_time: dc_fade_in(),
            animate_out: false,
            fade_out_time: dc_fade_out(),
            animate_out_wait_time: dc_out_wait(),
            slide: true,
            reverse_slide: false,
            effects_enabled: true,
            effect_intensity: dc_one(),
            show_outlines: false,
            outline_size: dc_outline_size(),
            outline_color: dc_outline_color(),
            blurry_outline: false,
        }
    }
}

impl Default for WishGoalSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            title: df_wish_title(),
            goals: df_wish_goals(),
            number_color: df_number_color(),
            background_color: df_background_color(),
            accent_color: df_accent_color(),
            text_color: df_text_color(),
            display_size: df_display_size(),
            show_icons: true,
            font_family: df_font_family(),
            style_preset: df_style_preset(),
            custom_css: String::new(),
            complete_animation: df_complete_animation(),
            complete_sound: df_complete_sound(),
            sound_volume: df_sound_volume(),
            sound_repeat: df_sound_repeat(),
            custom_sound_path: String::new(),
        }
    }
}

impl Default for LotteryInteractionSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            title: df_lottery_title(),
            gift_name: String::new(),
            gift_count: df_lottery_gift_count(),
            stay_seconds: df_lottery_stay_seconds(),
            prizes: df_lottery_prizes(),
            last_winner: String::new(),
            last_prize: String::new(),
            draw_nonce: 0,
        }
    }
}

impl Default for GiftEffectSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            skin: df_gift_effect_skin(),
            gift_name: String::new(),
            sound: df_gift_effect_sound(),
            sound_volume: df_sound_volume(),
            custom_sound_path: String::new(),
            last_user: String::new(),
            last_gift: String::new(),
            last_count: 0,
            effect_nonce: 0,
        }
    }
}

impl Default for RecentGiftsSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            title: df_recent_gifts_title(),
            max_items: df_recent_gifts_max_items(),
            skin: df_recent_gifts_skin(),
            name_color: df_recent_gifts_name_color(),
            number_color: df_recent_gifts_number_color(),
            gift_color: df_recent_gifts_gift_color(),
            items: Vec::new(),
        }
    }
}

impl Default for GiftRankSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            title: df_gift_rank_title(),
            max_items: df_gift_rank_max_items(),
            skin: df_gift_rank_skin(),
            date: Local::now().format("%Y-%m-%d").to_string(),
            items: Vec::new(),
        }
    }
}

impl Default for MusicInteractionSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            skin: df_music_skin(),
            stats_range: df_music_stats_range(),
            transparent: true,
            width: df_music_width(),
            height: df_music_height(),
            show_cover: true,
            show_requester: true,
            show_gift_tier: true,
            show_queue: true,
            show_today_value: false,
            primary_color: df_music_primary_color(),
            font_scale: df_font_scale(),
        }
    }
}

impl PluginSettings {
    pub fn load_or_default() -> Result<Self> {
        let path = plugin_settings_path();
        if path.exists() {
            let text = std::fs::read_to_string(&path)?;
            let has_danmaku_chat = text
                .parse::<toml::Value>()
                .ok()
                .and_then(|value| value.as_table().cloned())
                .map(|table| table.contains_key("DanmakuChat"))
                .unwrap_or(false);
            let mut cfg: Self = toml::from_str(&text)?;
            if !has_danmaku_chat {
                cfg.danmaku_chat = DanmakuChatSettings::migrate_from_legacy().unwrap_or_default();
                let _ = cfg.save();
            }
            return Ok(cfg);
        }
        let mut cfg = Self::default();
        cfg.danmaku_chat = DanmakuChatSettings::migrate_from_legacy().unwrap_or_default();
        let _ = cfg.save();
        Ok(cfg)
    }

    pub fn save(&self) -> Result<()> {
        let path = plugin_settings_path();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let text = toml::to_string_pretty(self)?;
        std::fs::write(path, text)?;
        Ok(())
    }

    pub fn apply_wish_goal_event(&mut self, event: &Value) -> bool {
        if !self.wish_goal.enabled {
            return false;
        }

        let Some(event_type) = event.get("type").and_then(Value::as_str) else {
            return false;
        };

        let mut changed = false;
        for goal in &mut self.wish_goal.goals {
            let delta = match goal.match_kind.as_str() {
                "gift" if event_type == "Gift" || event_type == "GuardBuy" => {
                    let gift = event
                        .get("gift")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let original = event
                        .get("original_gift_name")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !goal.gift_name.is_empty()
                        && (goal.gift_name == gift || goal.gift_name == original)
                    {
                        event.get("count").and_then(Value::as_i64).unwrap_or(1)
                            * goal.increment.max(1)
                    } else {
                        0
                    }
                }
                _ => 0,
            };

            if delta > 0 {
                goal.current = goal.current.saturating_add(delta);
                changed = true;
            }
        }

        changed
    }

    pub fn apply_lottery_event(&mut self, event: &Value) -> bool {
        let lottery = &mut self.lottery_interaction;
        if !lottery.enabled || lottery.gift_name.is_empty() {
            return false;
        }
        let Some(event_type) = event.get("type").and_then(Value::as_str) else {
            return false;
        };
        if event_type != "Gift" && event_type != "GuardBuy" {
            return false;
        }
        let gift = event
            .get("gift")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let original = event
            .get("original_gift_name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if lottery.gift_name != gift && lottery.gift_name != original {
            return false;
        }
        let count = event.get("count").and_then(Value::as_i64).unwrap_or(1);
        if count < lottery.gift_count.max(1) {
            return false;
        }
        let winner = event
            .get("uname")
            .or_else(|| event.get("user"))
            .or_else(|| event.get("username"))
            .and_then(Value::as_str)
            .unwrap_or("幸运观众")
            .to_string();
        lottery.draw(winner)
    }

    pub fn apply_gift_effect_event(&mut self, event: &Value) -> bool {
        let effect = &mut self.gift_effect;
        if !effect.enabled {
            return false;
        }
        let Some(event_type) = event.get("type").and_then(Value::as_str) else {
            return false;
        };
        if event_type != "Gift" && event_type != "GuardBuy" {
            return false;
        }
        let gift = event
            .get("gift")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let original = event
            .get("original_gift_name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !effect.gift_name.is_empty() && effect.gift_name != gift && effect.gift_name != original
        {
            return false;
        }
        effect.last_user = event
            .get("uname")
            .or_else(|| event.get("user"))
            .or_else(|| event.get("username"))
            .and_then(Value::as_str)
            .unwrap_or("观众")
            .to_string();
        effect.last_gift = if gift.is_empty() { original } else { gift }.to_string();
        effect.last_count = event
            .get("count")
            .and_then(Value::as_i64)
            .unwrap_or(1)
            .max(1);
        effect.effect_nonce = effect.effect_nonce.saturating_add(1);
        true
    }

    pub fn apply_recent_gifts_event(&mut self, event: &Value) -> bool {
        let recent = &mut self.recent_gifts;
        if !recent.enabled {
            return false;
        }
        let Some(event_type) = event.get("type").and_then(Value::as_str) else {
            return false;
        };
        if event_type != "Gift" && event_type != "GuardBuy" {
            return false;
        }
        let gift = event
            .get("gift")
            .or_else(|| event.get("original_gift_name"))
            .and_then(Value::as_str)
            .unwrap_or("礼物")
            .to_string();
        let user = event
            .get("uname")
            .or_else(|| event.get("user"))
            .or_else(|| event.get("username"))
            .and_then(Value::as_str)
            .unwrap_or("观众")
            .to_string();
        let avatar = event
            .get("face")
            .or_else(|| event.get("avatar"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let count = event
            .get("count")
            .and_then(Value::as_i64)
            .unwrap_or(1)
            .max(1);
        let id = format!("gift-{}", rand::random::<u64>());
        recent.items.insert(
            0,
            RecentGiftItem {
                id,
                user,
                avatar,
                gift,
                count,
            },
        );
        recent.items.truncate(recent.max_items.max(1));
        true
    }

    pub fn apply_gift_rank_event(&mut self, event: &Value) -> bool {
        let rank = &mut self.gift_rank;
        if !rank.enabled {
            return false;
        }
        let Some(event_type) = event.get("type").and_then(Value::as_str) else {
            return false;
        };
        if event_type != "Gift" && event_type != "GuardBuy" {
            return false;
        }
        let today = Local::now().format("%Y-%m-%d").to_string();
        if rank.date != today {
            rank.date = today;
            rank.items.clear();
        }
        let user = event
            .get("uname")
            .or_else(|| event.get("user"))
            .or_else(|| event.get("username"))
            .and_then(Value::as_str)
            .unwrap_or("观众")
            .to_string();
        let avatar = event
            .get("face")
            .or_else(|| event.get("avatar"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let count = event
            .get("count")
            .and_then(Value::as_i64)
            .unwrap_or(1)
            .max(1);
        let price = event
            .get("price")
            .or_else(|| event.get("gift_price"))
            .or_else(|| event.get("original_gift_price"))
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0);
        let value = if price > 0 { price * count } else { count };
        if let Some(item) = rank.items.iter_mut().find(|item| item.user == user) {
            item.value = item.value.saturating_add(value);
            item.count = item.count.saturating_add(count);
            if !avatar.is_empty() {
                item.avatar = avatar;
            }
        } else {
            rank.items.push(GiftRankItem {
                user,
                avatar,
                value,
                count,
            });
        }
        rank.items.sort_by(|a, b| b.value.cmp(&a.value));
        rank.items.truncate(rank.max_items.max(1));
        true
    }

    pub fn reset_wish_goal(&mut self) {
        for goal in &mut self.wish_goal.goals {
            goal.current = 0;
        }
    }

    pub fn simulate_wish_goal(&mut self) {
        if let Some(goal) = self
            .wish_goal
            .goals
            .iter_mut()
            .find(|g| g.current < g.target)
        {
            goal.current = goal.current.saturating_add(goal.increment.max(1));
        } else if let Some(goal) = self.wish_goal.goals.first_mut() {
            goal.current = goal.current.saturating_add(goal.increment.max(1));
        }
    }

    pub fn simulate_lottery(&mut self) {
        let seed = self.lottery_interaction.draw_nonce + 1;
        let winner = format!("模拟观众{seed}");
        let _ = self.lottery_interaction.draw(winner);
    }

    pub fn simulate_gift_effect(&mut self) {
        let effect = &mut self.gift_effect;
        effect.last_user = format!("模拟观众{}", effect.effect_nonce.saturating_add(1));
        effect.last_gift = if effect.gift_name.is_empty() {
            "辣条".to_string()
        } else {
            effect.gift_name.clone()
        };
        effect.last_count = 10;
        effect.effect_nonce = effect.effect_nonce.saturating_add(1);
    }

    pub fn simulate_recent_gift(&mut self) {
        let recent = &mut self.recent_gifts;
        let seed = recent.items.len().saturating_add(1);
        recent.items.insert(
            0,
            RecentGiftItem {
                id: format!("sim-{}", rand::random::<u64>()),
                user: format!("模拟观众{seed}"),
                avatar: String::new(),
                gift: if seed % 2 == 0 {
                    "舰长".to_string()
                } else {
                    "辣条".to_string()
                },
                count: if seed % 2 == 0 { 1 } else { 10 },
            },
        );
        recent.items.truncate(recent.max_items.max(1));
    }

    pub fn simulate_gift_rank(&mut self) {
        let samples = ["团子", "绅士小熊", "深巷与猫", "章鱼小丸子"];
        let idx = rand::random_range(0..samples.len());
        let event = serde_json::json!({
            "type": "Gift",
            "uname": samples[idx],
            "gift": "辣条",
            "count": rand::random_range(1..8),
            "price": rand::random_range(100..900)
        });
        let _ = self.apply_gift_rank_event(&event);
    }
}

impl DanmakuChatSettings {
    fn legacy_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("etc"))
            .join(APP_ID)
            .join(LEGACY_DANMAKU_CHAT_FILE)
    }

    fn migrate_from_legacy() -> Option<Self> {
        let legacy_path = Self::legacy_path();
        if legacy_path.exists() {
            let text = std::fs::read_to_string(legacy_path).ok()?;
            return toml::from_str(&text).ok();
        }
        Self::migrate_from_app_config()
    }

    fn migrate_from_app_config() -> Option<Self> {
        let text = std::fs::read_to_string(config::config_path()).ok()?;
        let value = text.parse::<toml::Value>().ok()?;
        let mut cfg = Self::default();
        cfg.port = legacy_u16(&value, "OverlayPort").unwrap_or(cfg.port);
        cfg.max_msgs = legacy_u32(&value, "OverlayMaxMsgs").unwrap_or(cfg.max_msgs);
        cfg.msg_gap = legacy_u8(&value, "OverlayMsgGap").unwrap_or(cfg.msg_gap);
        cfg.custom_css = legacy_string(&value, "OverlayCustomCss").unwrap_or(cfg.custom_css);
        cfg.show_avatar = legacy_bool(&value, "OverlayShowAvatar").unwrap_or(cfg.show_avatar);
        cfg.avatar_size = legacy_u8(&value, "OverlayAvatarSize").unwrap_or(cfg.avatar_size);
        cfg.show_username = legacy_bool(&value, "OverlayShowUsername").unwrap_or(cfg.show_username);
        cfg.message_font_size =
            legacy_u8(&value, "OverlayFontSize").unwrap_or(cfg.message_font_size);
        cfg.message_weight = legacy_u16(&value, "OverlayFontWeight").unwrap_or(cfg.message_weight);
        cfg.message_color = legacy_string(&value, "OverlayDanmuColor").unwrap_or(cfg.message_color);
        cfg.bg_opacity = legacy_f32(&value, "OverlayBgOpacity").unwrap_or(cfg.bg_opacity);
        cfg.show_gift = legacy_bool(&value, "OverlayShowGift").unwrap_or(cfg.show_gift);
        cfg.gift_min_cost = legacy_u32(&value, "OverlayGiftMinCost").unwrap_or(cfg.gift_min_cost);
        cfg.show_guard = legacy_bool(&value, "OverlayShowGuard").unwrap_or(cfg.show_guard);
        cfg.show_sc = legacy_bool(&value, "OverlayShowSc").unwrap_or(cfg.show_sc);
        cfg.sc_min_cost = legacy_u32(&value, "OverlayScMinCost").unwrap_or(cfg.sc_min_cost);
        cfg.animate_in = legacy_bool(&value, "OverlayAnimateIn").unwrap_or(cfg.animate_in);
        cfg.fade_in_time = legacy_u16(&value, "OverlayAnimateInMs").unwrap_or(cfg.fade_in_time);
        cfg.animate_out = legacy_bool(&value, "OverlayAnimateOut").unwrap_or(cfg.animate_out);
        cfg.fade_out_time = legacy_u16(&value, "OverlayAnimateOutMs").unwrap_or(cfg.fade_out_time);
        cfg.animate_out_wait_time =
            legacy_u16(&value, "OverlayAnimateOutWait").unwrap_or(cfg.animate_out_wait_time);
        Some(cfg)
    }
}

fn legacy_value<'a>(value: &'a toml::Value, key: &str) -> Option<&'a toml::Value> {
    value.as_table()?.get(key)
}

fn legacy_bool(value: &toml::Value, key: &str) -> Option<bool> {
    legacy_value(value, key)?.as_bool()
}

fn legacy_string(value: &toml::Value, key: &str) -> Option<String> {
    legacy_value(value, key)?.as_str().map(ToOwned::to_owned)
}

fn legacy_u8(value: &toml::Value, key: &str) -> Option<u8> {
    legacy_value(value, key)?.as_integer()?.try_into().ok()
}

fn legacy_u16(value: &toml::Value, key: &str) -> Option<u16> {
    legacy_value(value, key)?.as_integer()?.try_into().ok()
}

fn legacy_u32(value: &toml::Value, key: &str) -> Option<u32> {
    legacy_value(value, key)?.as_integer()?.try_into().ok()
}

fn legacy_f32(value: &toml::Value, key: &str) -> Option<f32> {
    legacy_value(value, key)?.as_float().map(|v| v as f32)
}

impl LotteryInteractionSettings {
    fn draw(&mut self, winner: String) -> bool {
        if self.prizes.is_empty() {
            return false;
        }
        let total: i64 = self.prizes.iter().map(|p| p.weight.max(1)).sum();
        let mut pick = rand::random_range(0..total);
        let mut selected = self.prizes[0].name.clone();
        for prize in &self.prizes {
            pick -= prize.weight.max(1);
            if pick < 0 {
                selected = prize.name.clone();
                break;
            }
        }
        self.last_winner = winner;
        self.last_prize = selected;
        self.draw_nonce = self.draw_nonce.saturating_add(1);
        true
    }
}

fn df_true() -> bool {
    true
}
fn df_wish_title() -> String {
    "今日心愿目标".to_string()
}
fn df_lottery_title() -> String {
    "幸运抽奖".to_string()
}
fn df_gift_effect_skin() -> String {
    "cat_cup".to_string()
}
fn df_gift_effect_sound() -> String {
    "pop".to_string()
}
fn df_recent_gifts_title() -> String {
    "最近礼物".to_string()
}
fn df_recent_gifts_max_items() -> usize {
    3
}
fn df_recent_gifts_skin() -> String {
    "compact".to_string()
}
fn df_recent_gifts_name_color() -> String {
    "#ffffff".to_string()
}
fn df_recent_gifts_number_color() -> String {
    "#fcee21".to_string()
}
fn df_recent_gifts_gift_color() -> String {
    "rgba(255,255,255,0.72)".to_string()
}
fn df_gift_rank_title() -> String {
    "今日礼物排行".to_string()
}
fn df_gift_rank_max_items() -> usize {
    3
}
fn df_gift_rank_skin() -> String {
    "podium".to_string()
}
fn df_music_skin() -> String {
    "neon".to_string()
}
fn df_music_stats_range() -> String {
    "session".to_string()
}
fn df_music_width() -> u32 {
    720
}
fn df_music_height() -> u32 {
    120
}
fn df_music_primary_color() -> String {
    "#8b5cf6".to_string()
}
fn df_font_scale() -> f32 {
    1.0
}
fn dc_one() -> f32 {
    1.0
}
fn dc_port() -> u16 {
    12450
}
fn dc_max_msgs() -> u32 {
    50
}
fn dc_msg_gap() -> u8 {
    3
}
fn dc_theme() -> String {
    "classic".to_string()
}
fn dc_avatar_size() -> u8 {
    24
}
fn dc_font_family() -> String {
    "PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif".to_string()
}
fn dc_username_size() -> u8 {
    13
}
fn dc_msg_size() -> u8 {
    13
}
fn dc_time_size() -> u8 {
    12
}
fn dc_sc_line1_size() -> u8 {
    15
}
fn dc_weight_normal() -> u16 {
    600
}
fn dc_weight_bold() -> u16 {
    700
}
fn dc_username_color() -> String {
    "#effee3".to_string()
}
fn dc_owner_color() -> String {
    "#ff96aa".to_string()
}
fn dc_mod_color() -> String {
    "#e7a9ff".to_string()
}
fn dc_member_color() -> String {
    "#96deff".to_string()
}
fn dc_msg_color() -> String {
    "#ffffff".to_string()
}
fn dc_time_color() -> String {
    "#999999".to_string()
}
fn dc_bg_color() -> String {
    "rgba(0,0,0,0)".to_string()
}
fn dc_bg_opacity() -> f32 {
    0.15
}
fn dc_msg_bg_color() -> String {
    "transparent".to_string()
}
fn dc_owner_bg_color() -> String {
    "rgba(255,214,0,0.18)".to_string()
}
fn dc_mod_bg_color() -> String {
    "rgba(94,132,241,0.18)".to_string()
}
fn dc_member_bg_color() -> String {
    "rgba(15,157,88,0.18)".to_string()
}
fn dc_fade_in() -> u16 {
    200
}
fn dc_fade_out() -> u16 {
    400
}
fn dc_out_wait() -> u16 {
    30
}
fn dc_outline_size() -> u8 {
    2
}
fn dc_outline_color() -> String {
    "#000000".to_string()
}
fn df_lottery_gift_count() -> i64 {
    1
}
fn df_lottery_stay_seconds() -> u64 {
    8
}
fn df_lottery_weight() -> i64 {
    1
}
fn df_lottery_prizes() -> Vec<LotteryPrize> {
    vec![
        LotteryPrize {
            id: "prize-1".to_string(),
            name: "1元红包".to_string(),
            weight: 1,
        },
        LotteryPrize {
            id: "prize-2".to_string(),
            name: "20元红包".to_string(),
            weight: 1,
        },
        LotteryPrize {
            id: "prize-3".to_string(),
            name: "谢谢参与".to_string(),
            weight: 5,
        },
        LotteryPrize {
            id: "prize-4".to_string(),
            name: "神秘礼物".to_string(),
            weight: 1,
        },
    ]
}
fn df_number_color() -> String {
    "#ffffff".to_string()
}
fn df_background_color() -> String {
    "rgba(30, 34, 40, 0.72)".to_string()
}
fn df_accent_color() -> String {
    "#22d3ee".to_string()
}
fn df_text_color() -> String {
    "#111827".to_string()
}
fn df_display_size() -> String {
    "normal".to_string()
}
fn df_font_family() -> String {
    "PingFang SC".to_string()
}
fn df_style_preset() -> String {
    "classic".to_string()
}
fn df_complete_animation() -> String {
    "spark".to_string()
}
fn df_complete_sound() -> String {
    "mute".to_string()
}
fn df_sound_volume() -> u8 {
    60
}
fn df_sound_repeat() -> String {
    "once".to_string()
}
fn df_goal_target() -> i64 {
    1
}
fn df_goal_icon() -> String {
    "目".to_string()
}
fn df_match_kind() -> String {
    "gift".to_string()
}
fn df_increment() -> i64 {
    1
}

fn df_wish_goals() -> Vec<WishGoalItem> {
    vec![
        WishGoalItem {
            id: "captain".to_string(),
            name: "舰长".to_string(),
            current: 0,
            target: 5,
            icon: "舰".to_string(),
            match_kind: "gift".to_string(),
            gift_name: "舰长".to_string(),
            increment: 1,
        },
        WishGoalItem {
            id: "tv-ship".to_string(),
            name: "小电视飞船".to_string(),
            current: 0,
            target: 1,
            icon: "船".to_string(),
            match_kind: "gift".to_string(),
            gift_name: "小电视飞船".to_string(),
            increment: 1,
        },
        WishGoalItem {
            id: "latiao".to_string(),
            name: "辣条".to_string(),
            current: 0,
            target: 12500,
            icon: "辣".to_string(),
            match_kind: "gift".to_string(),
            gift_name: "辣条".to_string(),
            increment: 1,
        },
    ]
}

#[cfg(test)]
mod music_interaction_tests {
    use super::PluginSettings;

    #[test]
    fn music_interaction_defaults_are_enabled_and_neon() {
        let settings = PluginSettings::default();
        assert!(settings.music_interaction.enabled);
        assert_eq!(settings.music_interaction.skin, "neon");
        assert_eq!(settings.music_interaction.stats_range, "session");
    }
}
