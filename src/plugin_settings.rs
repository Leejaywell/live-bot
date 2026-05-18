use std::path::PathBuf;

use anyhow::Result;
use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const APP_ID: &str = "com.streamix.app";
const PLUGIN_SETTINGS_FILE: &str = "plugin-settings.toml";

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
    pub wish_goal: WishGoalSettings,
    #[serde(default)]
    pub lottery_interaction: LotteryInteractionSettings,
    #[serde(default)]
    pub gift_effect: GiftEffectSettings,
    #[serde(default)]
    pub recent_gifts: RecentGiftsSettings,
    #[serde(default)]
    pub gift_rank: GiftRankSettings,
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

impl Default for PluginSettings {
    fn default() -> Self {
        Self {
            wish_goal: WishGoalSettings::default(),
            lottery_interaction: LotteryInteractionSettings::default(),
            gift_effect: GiftEffectSettings::default(),
            recent_gifts: RecentGiftsSettings::default(),
            gift_rank: GiftRankSettings::default(),
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

impl PluginSettings {
    pub fn load_or_default() -> Result<Self> {
        let path = plugin_settings_path();
        if path.exists() {
            let text = std::fs::read_to_string(path)?;
            let cfg: Self = toml::from_str(&text)?;
            return Ok(cfg);
        }
        let cfg = Self::default();
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
        if !effect.gift_name.is_empty() && effect.gift_name != gift && effect.gift_name != original {
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
        effect.last_count = event.get("count").and_then(Value::as_i64).unwrap_or(1).max(1);
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
        let count = event.get("count").and_then(Value::as_i64).unwrap_or(1).max(1);
        let id = format!("gift-{}", rand::random::<u64>());
        recent.items.insert(0, RecentGiftItem { id, user, avatar, gift, count });
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
        let count = event.get("count").and_then(Value::as_i64).unwrap_or(1).max(1);
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
            rank.items.push(GiftRankItem { user, avatar, value, count });
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
        recent.items.insert(0, RecentGiftItem {
            id: format!("sim-{}", rand::random::<u64>()),
            user: format!("模拟观众{seed}"),
            avatar: String::new(),
            gift: if seed % 2 == 0 { "舰长".to_string() } else { "辣条".to_string() },
            count: if seed % 2 == 0 { 1 } else { 10 },
        });
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
        LotteryPrize { id: "prize-1".to_string(), name: "1元红包".to_string(), weight: 1 },
        LotteryPrize { id: "prize-2".to_string(), name: "20元红包".to_string(), weight: 1 },
        LotteryPrize { id: "prize-3".to_string(), name: "谢谢参与".to_string(), weight: 5 },
        LotteryPrize { id: "prize-4".to_string(), name: "神秘礼物".to_string(), weight: 1 },
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
