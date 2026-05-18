use std::path::PathBuf;

use anyhow::Result;
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
    #[serde(default = "df_font_mode")]
    pub font_mode: String,
    #[serde(default = "df_font_family")]
    pub font_family: String,
    #[serde(default = "df_complete_animation")]
    pub complete_animation: String,
    #[serde(default = "df_complete_sound")]
    pub complete_sound: String,
    #[serde(default = "df_sound_volume")]
    pub sound_volume: u8,
    #[serde(default = "df_sound_repeat")]
    pub sound_repeat: String,
    #[serde(default)]
    pub custom_font_path: String,
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

impl Default for PluginSettings {
    fn default() -> Self {
        Self {
            wish_goal: WishGoalSettings::default(),
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
            font_mode: df_font_mode(),
            font_family: df_font_family(),
            complete_animation: df_complete_animation(),
            complete_sound: df_complete_sound(),
            sound_volume: df_sound_volume(),
            sound_repeat: df_sound_repeat(),
            custom_font_path: String::new(),
            custom_sound_path: String::new(),
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
}

fn df_true() -> bool {
    true
}
fn df_wish_title() -> String {
    "今日心愿目标".to_string()
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
fn df_font_mode() -> String {
    "free".to_string()
}
fn df_font_family() -> String {
    "default".to_string()
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
