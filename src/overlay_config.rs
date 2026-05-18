//! 弹幕浮层独立配置（与 AppConfig 分离）
//!
//! 路径：与 streamix.toml 同目录的 overlay.toml
//! 首次加载时若文件不存在，会从旧 AppConfig.overlay_* 字段做一次性迁移。

use std::path::PathBuf;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::config::AppConfig;

const OVERLAY_FILE: &str = "overlay.toml";
const APP_ID: &str = "com.streamix.app";

pub fn overlay_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("etc"))
        .join(APP_ID)
        .join(OVERLAY_FILE)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct OverlayConfig {
    // ── 服务 / 性能 ────────────────────────────────────────────────────────────
    #[serde(default = "df_port")]
    pub port: u16,
    #[serde(default = "df_max_msgs")]
    pub max_msgs: u32,
    #[serde(default = "df_msg_gap")]
    pub msg_gap: u8,
    #[serde(default = "df_overlay_theme")]
    pub theme: String,
    #[serde(default)]
    pub custom_css: String,

    // ── 全局缩放 ───────────────────────────────────────────────────────────────
    #[serde(default = "df_one")]
    pub global_scale: f32,
    #[serde(default = "df_one")]
    pub font_scale: f32,

    // ── 头像 ───────────────────────────────────────────────────────────────────
    #[serde(default = "df_true")]
    pub show_avatar: bool,
    #[serde(default = "df_avatar_size")]
    pub avatar_size: u8,

    // ── 用户名 ─────────────────────────────────────────────────────────────────
    #[serde(default = "df_true")]
    pub show_username: bool,
    #[serde(default = "df_font_family")]
    pub user_name_font: String,
    #[serde(default = "df_username_size")]
    pub user_name_font_size: u8,
    #[serde(default = "df_weight_normal")]
    pub user_name_weight: u16,
    #[serde(default = "df_username_color")]
    pub user_name_color: String,
    #[serde(default = "df_owner_color")]
    pub owner_user_name_color: String,
    #[serde(default = "df_mod_color")]
    pub moderator_user_name_color: String,
    #[serde(default = "df_member_color")]
    pub member_user_name_color: String,
    #[serde(default = "df_true")]
    pub show_badges: bool,

    // ── 消息文本 ───────────────────────────────────────────────────────────────
    #[serde(default = "df_font_family")]
    pub message_font: String,
    #[serde(default = "df_msg_size")]
    pub message_font_size: u8,
    #[serde(default = "df_weight_normal")]
    pub message_weight: u16,
    #[serde(default = "df_msg_color")]
    pub message_color: String,

    // ── 时间 ───────────────────────────────────────────────────────────────────
    #[serde(default)]
    pub show_time: bool,
    #[serde(default = "df_font_family")]
    pub time_font: String,
    #[serde(default = "df_time_size")]
    pub time_font_size: u8,
    #[serde(default = "df_weight_normal")]
    pub time_weight: u16,
    #[serde(default = "df_time_color")]
    pub time_color: String,

    // ── 背景 ───────────────────────────────────────────────────────────────────
    #[serde(default = "df_bg_color")]
    pub bg_color: String,
    #[serde(default = "df_bg_opacity")]
    pub bg_opacity: f32,
    #[serde(default = "df_msg_bg_color")]
    pub message_bg_color: String,
    #[serde(default = "df_owner_bg_color")]
    pub owner_message_bg_color: String,
    #[serde(default = "df_mod_bg_color")]
    pub moderator_message_bg_color: String,
    #[serde(default = "df_member_bg_color")]
    pub member_message_bg_color: String,

    // ── 礼物 / 舰长 / SC ───────────────────────────────────────────────────────
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

    // SC / 上舰三行
    #[serde(default = "df_sc_line1_size")]
    pub first_line_font_size: u8,
    #[serde(default = "df_weight_bold")]
    pub first_line_weight: u16,
    #[serde(default = "df_msg_size")]
    pub second_line_font_size: u8,
    #[serde(default = "df_weight_bold")]
    pub second_line_weight: u16,
    #[serde(default = "df_msg_size")]
    pub sc_content_font_size: u8,
    #[serde(default = "df_weight_normal")]
    pub sc_content_weight: u16,

    // ── 动画 ───────────────────────────────────────────────────────────────────
    #[serde(default = "df_true")]
    pub animate_in: bool,
    #[serde(default = "df_fade_in")]
    pub fade_in_time: u16,
    #[serde(default)]
    pub animate_out: bool,
    #[serde(default = "df_fade_out")]
    pub fade_out_time: u16,
    #[serde(default = "df_out_wait")]
    pub animate_out_wait_time: u16,
    #[serde(default = "df_true")]
    pub slide: bool,
    #[serde(default)]
    pub reverse_slide: bool,

    // ── 特效层（兼容旧 CSS，默认开启） ─────────────────────────────────────────
    #[serde(default = "df_true")]
    pub effects_enabled: bool,
    #[serde(default = "df_one")]
    pub effect_intensity: f32,

    // ── 描边（Legacy 风格） ────────────────────────────────────────────────────
    #[serde(default)]
    pub show_outlines: bool,
    #[serde(default = "df_outline_size")]
    pub outline_size: u8,
    #[serde(default = "df_outline_color")]
    pub outline_color: String,
    #[serde(default)]
    pub blurry_outline: bool,
}

impl Default for OverlayConfig {
    fn default() -> Self {
        Self {
            port: df_port(),
            max_msgs: df_max_msgs(),
            msg_gap: df_msg_gap(),
            theme: df_overlay_theme(),
            custom_css: String::new(),

            global_scale: df_one(),
            font_scale: df_one(),

            show_avatar: true,
            avatar_size: df_avatar_size(),

            show_username: true,
            user_name_font: df_font_family(),
            user_name_font_size: df_username_size(),
            user_name_weight: df_weight_normal(),
            user_name_color: df_username_color(),
            owner_user_name_color: df_owner_color(),
            moderator_user_name_color: df_mod_color(),
            member_user_name_color: df_member_color(),
            show_badges: true,

            message_font: df_font_family(),
            message_font_size: df_msg_size(),
            message_weight: df_weight_normal(),
            message_color: df_msg_color(),

            show_time: false,
            time_font: df_font_family(),
            time_font_size: df_time_size(),
            time_weight: df_weight_normal(),
            time_color: df_time_color(),

            bg_color: df_bg_color(),
            bg_opacity: df_bg_opacity(),
            message_bg_color: df_msg_bg_color(),
            owner_message_bg_color: df_owner_bg_color(),
            moderator_message_bg_color: df_mod_bg_color(),
            member_message_bg_color: df_member_bg_color(),

            show_gift: true,
            gift_min_cost: 0,
            show_gift_icon: false,
            show_guard: true,
            show_sc: true,
            sc_min_cost: 0,

            first_line_font_size: df_sc_line1_size(),
            first_line_weight: df_weight_bold(),
            second_line_font_size: df_msg_size(),
            second_line_weight: df_weight_bold(),
            sc_content_font_size: df_msg_size(),
            sc_content_weight: df_weight_normal(),

            animate_in: true,
            fade_in_time: df_fade_in(),
            animate_out: false,
            fade_out_time: df_fade_out(),
            animate_out_wait_time: df_out_wait(),
            slide: true,
            reverse_slide: false,

            effects_enabled: true,
            effect_intensity: df_one(),

            show_outlines: false,
            outline_size: df_outline_size(),
            outline_color: df_outline_color(),
            blurry_outline: false,
        }
    }
}

impl OverlayConfig {
    pub fn load_or_default() -> Result<Self> {
        let path = overlay_config_path();
        if path.exists() {
            let text = std::fs::read_to_string(&path)?;
            let cfg: Self = toml::from_str(&text)?;
            return Ok(cfg);
        }
        // 一次性迁移：从 AppConfig.overlay_* 拷贝旧值
        let cfg = Self::migrate_from_app_config().unwrap_or_default();
        let _ = cfg.save();
        Ok(cfg)
    }

    pub fn save(&self) -> Result<()> {
        let path = overlay_config_path();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let text = toml::to_string_pretty(self)?;
        std::fs::write(path, text)?;
        Ok(())
    }

    fn migrate_from_app_config() -> Option<Self> {
        let app = AppConfig::load_or_default().ok()?;
        let mut cfg = Self::default();
        cfg.port = app.overlay_port;
        cfg.max_msgs = app.overlay_max_msgs as u32;
        cfg.msg_gap = app.overlay_msg_gap;
        cfg.custom_css = app.overlay_custom_css;
        cfg.show_avatar = app.overlay_show_avatar;
        cfg.avatar_size = app.overlay_avatar_size;
        cfg.show_username = app.overlay_show_username;
        cfg.message_font_size = app.overlay_font_size;
        cfg.message_weight = app.overlay_font_weight;
        cfg.message_color = app.overlay_danmu_color;
        cfg.bg_opacity = app.overlay_bg_opacity;
        cfg.show_gift = app.overlay_show_gift;
        cfg.gift_min_cost = app.overlay_gift_min_cost;
        cfg.show_guard = app.overlay_show_guard;
        cfg.show_sc = app.overlay_show_sc;
        cfg.sc_min_cost = app.overlay_sc_min_cost;
        cfg.animate_in = app.overlay_animate_in;
        cfg.fade_in_time = app.overlay_animate_in_ms;
        cfg.animate_out = app.overlay_animate_out;
        cfg.fade_out_time = app.overlay_animate_out_ms;
        cfg.animate_out_wait_time = app.overlay_animate_out_wait;
        Some(cfg)
    }
}

// ── Defaults ────────────────────────────────────────────────────────────────

fn df_true() -> bool {
    true
}
fn df_one() -> f32 {
    1.0
}
fn df_port() -> u16 {
    12450
}
fn df_max_msgs() -> u32 {
    50
}
fn df_msg_gap() -> u8 {
    3
}
fn df_overlay_theme() -> String {
    "classic".to_string()
}

fn df_avatar_size() -> u8 {
    24
}

fn df_font_family() -> String {
    "PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif".to_string()
}
fn df_username_size() -> u8 {
    13
}
fn df_msg_size() -> u8 {
    13
}
fn df_time_size() -> u8 {
    12
}
fn df_sc_line1_size() -> u8 {
    15
}

fn df_weight_normal() -> u16 {
    600
}
fn df_weight_bold() -> u16 {
    700
}

fn df_username_color() -> String {
    "#effee3".to_string()
}
fn df_owner_color() -> String {
    "#ff96aa".to_string()
}
fn df_mod_color() -> String {
    "#e7a9ff".to_string()
}
fn df_member_color() -> String {
    "#96deff".to_string()
}
fn df_msg_color() -> String {
    "#ffffff".to_string()
}
fn df_time_color() -> String {
    "#999999".to_string()
}

fn df_bg_color() -> String {
    "rgba(0,0,0,0)".to_string()
}
fn df_bg_opacity() -> f32 {
    0.15
}
fn df_msg_bg_color() -> String {
    "transparent".to_string()
}
fn df_owner_bg_color() -> String {
    "rgba(255,214,0,0.18)".to_string()
}
fn df_mod_bg_color() -> String {
    "rgba(94,132,241,0.18)".to_string()
}
fn df_member_bg_color() -> String {
    "rgba(15,157,88,0.18)".to_string()
}

fn df_fade_in() -> u16 {
    200
}
fn df_fade_out() -> u16 {
    400
}
fn df_out_wait() -> u16 {
    30
}

fn df_outline_size() -> u8 {
    2
}
fn df_outline_color() -> String {
    "#000000".to_string()
}
