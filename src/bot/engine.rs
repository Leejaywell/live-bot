use std::collections::BTreeMap;
use std::sync::Mutex;

use bilibili_live_protocol::{
    AnchorLotteryKind, InteractKind, LiveEvent, PkEventKind, RedPocketKind,
};

use crate::config::AppConfig;
use crate::storage::Storage;

#[derive(Debug)]
pub struct BotEngine {
    pub(crate) config: AppConfig,
    repeat_counts: Mutex<BTreeMap<(i64, String), i32>>,
}

impl BotEngine {
    pub fn new(config: AppConfig) -> Self {
        Self {
            config,
            repeat_counts: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn handle_event(&self, event: &LiveEvent, storage: Option<&Storage>) -> Vec<String> {
        if self.is_permanently_blacklisted(event) {
            return Vec::new();
        }
        if self.is_filtered_danmu(event) {
            return Vec::new();
        }

        let mut out = Vec::new();
        self.track_danmu(event, storage);
        out.extend(self.newcomer_notice(event, storage));
        out.extend(self.help(event));
        out.extend(self.welcome(event));
        out.extend(self.thanks(event));
        out.extend(self.pk_and_activity_notice(event));
        out
    }

    fn is_permanently_blacklisted(&self, event: &LiveEvent) -> bool {
        let (user_id, user) = match event {
            LiveEvent::Danmu { user_id, user, .. } => (*user_id, user.as_str()),
            LiveEvent::Interact { user_id, user, .. } => (*user_id, user.as_str()),
            LiveEvent::EntryEffect { user_id, user, .. } => (*user_id, user.as_str()),
            LiveEvent::Gift { user_id, user, .. } => (*user_id, user.as_str()),
            LiveEvent::GuardBuy { user_id, user, .. } => (*user_id, user.as_str()),
            LiveEvent::Block { user } => (0, user.as_str()),
            _ => return false,
        };

        if user_id != 0 && self.config.permanent_blacklist_users.contains(&user_id) {
            return true;
        }

        self.config
            .permanent_blacklist_names
            .iter()
            .any(|name| !name.is_empty() && user.contains(name))
    }

    fn is_filtered_danmu(&self, event: &LiveEvent) -> bool {
        if !self.config.danmu_filter_enable {
            return false;
        }
        let LiveEvent::Danmu { user_id, text, .. } = event else {
            return false;
        };

        self.config
            .danmu_filter_words
            .iter()
            .any(|word| !word.is_empty() && text.contains(word))
            || self.is_repeated_danmu(*user_id, text)
    }

    fn is_repeated_danmu(&self, user_id: i64, text: &str) -> bool {
        if self.config.danmu_filter_repeat_threshold <= 1 {
            return false;
        }
        let Ok(mut counts) = self.repeat_counts.lock() else {
            return false;
        };
        let count = counts.entry((user_id, text.to_string())).or_insert(0);
        *count += 1;
        *count >= self.config.danmu_filter_repeat_threshold
    }

    fn track_danmu(&self, event: &LiveEvent, storage: Option<&Storage>) {
        if !self.config.danmu_cnt_enable {
            return;
        }
        let LiveEvent::Danmu { user_id, user, .. } = event else {
            return;
        };
        if let Some(storage) = storage {
            let _ = storage.increment_danmu_count(*user_id, user);
        }
    }

    fn newcomer_notice(&self, event: &LiveEvent, storage: Option<&Storage>) -> Vec<String> {
        if !self.config.newcomer_danmu_enable {
            return Vec::new();
        }
        let LiveEvent::Danmu { user_id, user, .. } = event else {
            return Vec::new();
        };
        let Some(storage) = storage else {
            return Vec::new();
        };
        match storage.user_interaction_danmu_count(*user_id) {
            Ok(1) => vec![
                self.config
                    .newcomer_danmu_template
                    .replace("{user}", &self.display_name(*user_id, user)),
            ],
            _ => Vec::new(),
        }
    }

    pub fn ai_prompt(&self, event: &LiveEvent) -> Option<String> {
        if self.is_permanently_blacklisted(event) {
            return None;
        }
        let LiveEvent::Danmu { text, .. } = event else {
            return None;
        };
        let cmd = self.config.talk_robot_cmd.trim();
        if cmd.is_empty() || text == &self.config.entry_msg {
            return None;
        }

        let prompt = if self.config.fuzzy_match_cmd && text.contains(cmd) {
            text.replace(cmd, "")
        } else if let Some(rest) = text.strip_prefix(cmd) {
            rest.to_string()
        } else {
            return None;
        };
        let prompt = prompt.trim();
        (!prompt.is_empty()).then(|| prompt.to_string())
    }

    fn help(&self, event: &LiveEvent) -> Vec<String> {
        let LiveEvent::Danmu { text, .. } = event else {
            return Vec::new();
        };
        match text.as_str() {
            "@帮助" => {
                let mut out = Vec::new();
                if self.config.talk_robot_cmd.is_empty() {
                    out.push("互动聊天已禁用...".to_string());
                } else {
                    out.push(format!(
                        "发送带有 {} 的弹幕和我互动",
                        self.config.talk_robot_cmd
                    ));
                    out.push("请尽情调戏我吧!".to_string());
                }
                out.push("本软件为永久免费软件".to_string());
                out
            }
            "@我是谁" => vec!["本程序作者为@超凶一只花酱酱".to_string()],
            _ => Vec::new(),
        }
    }

    fn welcome(&self, event: &LiveEvent) -> Vec<String> {
        match event {
            LiveEvent::Interact {
                kind: InteractKind::Entry,
                user_id,
                user,
            } => self.welcome_user(*user_id, user),
            LiveEvent::EntryEffect {
                user_id,
                user,
                guard_level,
                wealth_level,
            } => {
                if !self.config.entry_effect {
                    return Vec::new();
                }
                if let Some(msg) = self.specified_welcome(*user_id) {
                    return vec![msg];
                }
                let decorated_user = guard_label(*guard_level)
                    .map(|label| format!("{label} {user}"))
                    .or_else(|| {
                        (self.config.welcome_high_wealthy
                            && *wealth_level >= self.config.welcome_high_wealthy_level as i64)
                            .then(|| user.clone())
                    });
                decorated_user
                    .and_then(|name| self.render_welcome(&name))
                    .into_iter()
                    .collect()
            }
            _ => Vec::new(),
        }
    }

    fn thanks(&self, event: &LiveEvent) -> Vec<String> {
        match event {
            LiveEvent::Interact {
                kind: InteractKind::Follow | InteractKind::MutualFollow,
                user,
                ..
            } if self.config.thanks_focus => {
                let mut out = vec![format!(
                    "感谢 {} 的关注!",
                    short_name(user, 8, self.config.danmu_len)
                )];
                if let Some(extra) = choose(&self.config.focus_danmu) {
                    out.push(extra);
                }
                out
            }
            LiveEvent::Interact {
                kind: InteractKind::Share,
                user,
                ..
            } if self.config.thanks_share => {
                let mut out = vec![format!(
                    "感谢 {} 的分享!",
                    short_name(user, 8, self.config.danmu_len)
                )];
                if let Some(extra) = choose(&self.config.focus_danmu) {
                    out.push(extra);
                }
                out
            }
            LiveEvent::GuardBuy { user, gift, .. } if self.config.thanks_gift => {
                vec![format!("感谢 {user} 的 {gift}")]
            }
            _ => Vec::new(),
        }
    }

    fn pk_and_activity_notice(&self, event: &LiveEvent) -> Vec<String> {
        match event {
            LiveEvent::Pk {
                kind:
                    PkEventKind::Start {
                        init_room_id,
                        match_room_id,
                    },
            } if self.config.pk_notice => {
                vec![format!(
                    "PK开始，对手直播间候选: {init_room_id}/{match_room_id}"
                )]
            }
            LiveEvent::Pk {
                kind: PkEventKind::End,
            } if self.config.pk_notice => {
                vec!["PK结束".to_string()]
            }
            LiveEvent::Pk {
                kind: PkEventKind::Other(command),
            } if self.config.pk_notice => {
                vec![format!("检测到PK事件: {command}")]
            }
            LiveEvent::RedPocket {
                kind:
                    RedPocketKind::New {
                        user, gift, price, ..
                    },
            } => {
                let mut out = vec!["识别到红包，欢迎弹幕已临时关闭".to_string()];
                if self.config.thanks_gift {
                    out.insert(0, format!("感谢 {user} {price}电池的 {gift}"));
                }
                out
            }
            LiveEvent::RedPocket {
                kind: RedPocketKind::WinnerList,
            } => {
                vec!["红包结束，欢迎弹幕已恢复默认".to_string()]
            }
            LiveEvent::RedPocket { .. } => Vec::new(),
            LiveEvent::AnchorLottery {
                kind: AnchorLotteryKind::Start,
            } => {
                vec!["识别到天选，欢迎弹幕已临时关闭".to_string()]
            }
            LiveEvent::AnchorLottery {
                kind: AnchorLotteryKind::Award | AnchorLotteryKind::End,
            } => {
                vec!["天选结束，欢迎弹幕已恢复默认".to_string()]
            }
            LiveEvent::AnchorLottery {
                kind: AnchorLotteryKind::Other(command),
            } => {
                vec![format!("检测到天选事件: {command}")]
            }
            LiveEvent::Block { user } if self.config.show_block_msg => {
                vec![format!("{user} 被禁言")]
            }
            _ => Vec::new(),
        }
    }

    fn welcome_user(&self, user_id: i64, user: &str) -> Vec<String> {
        if let Some(msg) = self.specified_welcome(user_id) {
            return vec![msg];
        }
        if !self.config.interact_word || self.is_welcome_blacklisted(user) {
            return Vec::new();
        }
        self.render_welcome(&self.display_name(user_id, user))
            .into_iter()
            .collect()
    }

    fn specified_welcome(&self, user_id: i64) -> Option<String> {
        self.config
            .welcome_switch
            .then(|| {
                self.config
                    .welcome_string
                    .get(&user_id.to_string())
                    .cloned()
            })
            .flatten()
    }

    fn render_welcome(&self, user: &str) -> Option<String> {
        let template = if self.config.interact_word_by_time {
            self.time_welcome_template()
                .or_else(|| choose(&self.config.welcome_danmu))
        } else {
            choose(&self.config.welcome_danmu)
        }?;
        Some(template.replace("{user}", &short_name(user, 3, self.config.danmu_len)))
    }

    fn time_welcome_template(&self) -> Option<String> {
        let key = time_key(chrono::Local::now().hour() as u32);
        self.config
            .welcome_danmu_by_time
            .iter()
            .find(|entry| entry.enabled && entry.key == key && !entry.danmu.is_empty())
            .and_then(|entry| choose(&entry.danmu))
    }

    fn is_welcome_blacklisted(&self, user: &str) -> bool {
        self.config
            .welcome_blacklist
            .iter()
            .any(|item| item == user)
            || self
                .config
                .welcome_blacklist_wide
                .iter()
                .any(|item| user.contains(item))
    }

    fn display_name(&self, user_id: i64, user: &str) -> String {
        self.config
            .special_nicknames
            .get(&user_id.to_string())
            .cloned()
            .unwrap_or_else(|| user.to_string())
    }
}

fn choose(items: &[String]) -> Option<String> {
    match items.len() {
        0 => None,
        1 => Some(items[0].clone()),
        len => Some(items[rand::random_range(0..len)].clone()),
    }
}

fn short_name(value: &str, reserve: usize, danmu_len: i32) -> String {
    let max = (danmu_len.max(1) as usize).saturating_sub(reserve).max(1);
    let mut chars = value.chars();
    let short = chars.by_ref().take(max).collect::<String>();
    if chars.next().is_some() {
        format!("{short}…")
    } else {
        short
    }
}

fn guard_label(level: i64) -> Option<&'static str> {
    match level {
        1 => Some("总督"),
        2 => Some("提督"),
        3 => Some("舰长"),
        _ => None,
    }
}

fn time_key(hour: u32) -> &'static str {
    match hour {
        0 | 1 => "midnight",
        2..=4 => "earlymorning",
        5..=8 => "morning",
        9 | 10 => "latemorning",
        11..=13 => "noon",
        14..=19 => "afternoon",
        _ => "night",
    }
}

trait TimeExt {
    fn hour(&self) -> u32;
}

impl TimeExt for chrono::DateTime<chrono::Local> {
    fn hour(&self) -> u32 {
        use chrono::Timelike;
        Timelike::hour(self)
    }
}

#[cfg(test)]
mod tests {
    use bilibili_live_protocol::{InteractKind, LiveEvent};

    use super::{BotEngine, short_name, time_key};
    use crate::bot::testsupport::test_config;

    #[test]
    fn permanent_blacklist_blocks_danmu_automation() {
        let mut config = test_config();
        config.permanent_blacklist_users = vec![42];
        let engine = BotEngine::new(config);

        let replies = engine.handle_event(
            &LiveEvent::Danmu {
                user_id: 42,
                user: "u".to_string(),
                text: "@帮助".to_string(),
            },
            None,
        );

        assert!(replies.is_empty());
    }

    #[test]
    fn welcome_uses_special_nickname() {
        let mut config = test_config();
        config.welcome_string.clear();
        config.welcome_danmu = vec!["欢迎 {user}".to_string()];
        config
            .special_nicknames
            .insert("42".to_string(), "榜一".to_string());
        let engine = BotEngine::new(config);

        let replies = engine.handle_event(
            &LiveEvent::Interact {
                kind: InteractKind::Entry,
                user_id: 42,
                user: "alice".to_string(),
            },
            None,
        );

        assert_eq!(replies, vec!["欢迎 榜一"]);
    }

    #[test]
    fn sensitive_danmu_does_not_trigger_automation() {
        let mut config = test_config();
        config.danmu_filter_enable = true;
        config.danmu_filter_words = vec!["广告".to_string()];
        let engine = BotEngine::new(config);

        let replies = engine.handle_event(
            &LiveEvent::Danmu {
                user_id: 1,
                user: "u".to_string(),
                text: "广告@帮助".to_string(),
            },
            None,
        );

        assert!(replies.is_empty());
    }

    #[test]
    fn repeated_danmu_stops_triggering_automation_at_threshold() {
        let mut config = test_config();
        config.danmu_filter_enable = true;
        config.danmu_filter_repeat_threshold = 2;
        let engine = BotEngine::new(config);
        let event = LiveEvent::Danmu {
            user_id: 1,
            user: "u".to_string(),
            text: "@帮助".to_string(),
        };

        assert!(!engine.handle_event(&event, None).is_empty());
        assert!(engine.handle_event(&event, None).is_empty());
    }

    #[test]
    fn welcome_uses_specified_user_first() {
        let mut config = test_config();
        config
            .welcome_string
            .insert("42".to_string(), "专属欢迎".to_string());
        let engine = BotEngine::new(config);

        let replies = engine.handle_event(
            &LiveEvent::Interact {
                kind: InteractKind::Entry,
                user_id: 42,
                user: "alice".to_string(),
            },
            None,
        );

        assert_eq!(replies, vec!["专属欢迎"]);
    }

    #[test]
    fn welcome_respects_wide_blacklist() {
        let mut config = test_config();
        config.welcome_string.clear();
        config.welcome_blacklist_wide = vec!["广告".to_string()];
        let engine = BotEngine::new(config);

        let replies = engine.handle_event(
            &LiveEvent::Interact {
                kind: InteractKind::Entry,
                user_id: 7,
                user: "广告号".to_string(),
            },
            None,
        );

        assert!(replies.is_empty());
    }

    #[test]
    fn thanks_follow_emits_base_and_extra_message() {
        let mut config = test_config();
        config.focus_danmu = vec!["贴贴~".to_string()];
        let engine = BotEngine::new(config);

        let replies = engine.handle_event(
            &LiveEvent::Interact {
                kind: InteractKind::Follow,
                user_id: 1,
                user: "alice".to_string(),
            },
            None,
        );

        assert_eq!(replies, vec!["感谢 alice 的关注!", "贴贴~"]);
    }

    #[test]
    fn short_name_truncates_with_ellipsis() {
        assert_eq!(short_name("abcdef", 1, 4), "abc…");
    }

    #[test]
    fn time_keys_match_original_ranges() {
        assert_eq!(time_key(0), "midnight");
        assert_eq!(time_key(4), "earlymorning");
        assert_eq!(time_key(8), "morning");
        assert_eq!(time_key(10), "latemorning");
        assert_eq!(time_key(13), "noon");
        assert_eq!(time_key(19), "afternoon");
        assert_eq!(time_key(23), "night");
    }

    #[test]
    fn ai_prompt_matches_prefix_command() {
        let mut config = test_config();
        config.talk_robot_cmd = "花花".to_string();
        let engine = BotEngine::new(config);

        let prompt = engine.ai_prompt(&LiveEvent::Danmu {
            user_id: 1,
            user: "u".to_string(),
            text: "花花今天吃什么".to_string(),
        });

        assert_eq!(prompt.as_deref(), Some("今天吃什么"));
    }

    #[test]
    fn help_command_returns_expected_messages() {
        let config = test_config();
        let engine = BotEngine::new(config);

        let replies = engine.handle_event(
            &LiveEvent::Danmu {
                user_id: 1,
                user: "u".to_string(),
                text: "@帮助".to_string(),
            },
            None,
        );

        assert!(!replies.is_empty());
        assert!(replies.iter().any(|line| line.contains("互动")));
    }
}
