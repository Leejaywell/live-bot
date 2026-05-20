use std::collections::BTreeMap;
use std::sync::Mutex;

use bilibili_live_protocol::{
    AnchorLotteryKind, InteractKind, LiveEvent, PkEventKind, RedPocketKind,
};
use rand::prelude::IndexedRandom;

use crate::config::AppConfig;
use crate::storage::Storage;

#[derive(Debug)]
pub struct BotEngine {
    config: Mutex<AppConfig>,
    repeat_counts: Mutex<BTreeMap<(i64, String), i32>>,
}

impl BotEngine {
    pub fn new(config: AppConfig) -> Self {
        Self {
            config: Mutex::new(config),
            repeat_counts: Mutex::new(BTreeMap::new()),
        }
    }

    #[cfg(test)]
    pub fn update_config(&self, next: AppConfig) {
        if let Ok(mut config) = self.config.lock() {
            *config = next;
        }
    }

    pub fn handle_event(&self, event: &LiveEvent, _storage: Option<&Storage>) -> Vec<String> {
        let config = self.config.lock().expect("config mutex poisoned");
        if self.is_permanently_blacklisted_inner(event, &config) {
            return Vec::new();
        }
        if self.is_filtered_danmu_inner(event, &config) {
            return Vec::new();
        }

        let mut out = Vec::new();
        out.extend(self.welcome_inner(event, &config));
        out.extend(self.help_inner(event, &config));
        out.extend(self.thanks_inner(event, &config));
        out.extend(self.pk_and_activity_notice_inner(event, &config));
        out
    }

    fn welcome_inner(&self, event: &LiveEvent, config: &AppConfig) -> Vec<String> {
        let LiveEvent::Interact {
            kind: InteractKind::Entry,
            user_id,
            user,
            ..
        } = event
        else {
            return Vec::new();
        };

        // Special welcome (UID exact match) takes priority
        let uid_str = user_id.to_string();
        for sw in &config.special_welcome_list {
            if !sw.uid.is_empty() && sw.uid == uid_str {
                return vec![sw.msg.replace("{user}", user)];
            }
        }

        // General welcome — random pick from template list
        if config.general_welcome_enabled {
            let msgs = &config.general_welcome_msgs;
            if !msgs.is_empty() {
                let mut rng = rand::rng();
                let tmpl = msgs.choose(&mut rng).unwrap();
                return vec![tmpl.replace("{user}", user)];
            }
        }

        Vec::new()
    }

    fn is_permanently_blacklisted_inner(&self, event: &LiveEvent, config: &AppConfig) -> bool {
        let (user_id, user) = match event {
            LiveEvent::Danmu { user_id, user, .. } => (*user_id, user.as_str()),
            LiveEvent::Interact { user_id, user, .. } => (*user_id, user.as_str()),
            LiveEvent::EntryEffect { user_id, user, .. } => (*user_id, user.as_str()),
            LiveEvent::Gift { user_id, user, .. } => (*user_id, user.as_str()),
            LiveEvent::GuardBuy { user_id, user, .. } => (*user_id, user.as_str()),
            LiveEvent::Block { user } => (0, user.as_str()),
            _ => return false,
        };

        if user_id != 0 && config.permanent_blacklist_users.contains(&user_id) {
            return true;
        }

        config
            .permanent_blacklist_names
            .iter()
            .any(|name| !name.is_empty() && user.contains(name))
    }

    fn is_filtered_danmu_inner(&self, event: &LiveEvent, config: &AppConfig) -> bool {
        if !config.danmu_filter_enable {
            return false;
        }
        let LiveEvent::Danmu { user_id, text, .. } = event else {
            return false;
        };

        config
            .danmu_filter_words
            .iter()
            .any(|word| !word.is_empty() && text.contains(word))
            || self.is_repeated_danmu(*user_id, text, config)
    }

    fn is_repeated_danmu(&self, user_id: i64, text: &str, config: &AppConfig) -> bool {
        if config.danmu_filter_repeat_threshold <= 1 {
            return false;
        }
        let Ok(mut counts) = self.repeat_counts.lock() else {
            return false;
        };
        let count = counts.entry((user_id, text.to_string())).or_insert(0);
        *count += 1;
        *count >= config.danmu_filter_repeat_threshold
    }

    fn help_inner(&self, event: &LiveEvent, config: &AppConfig) -> Vec<String> {
        let LiveEvent::Danmu { text, .. } = event else {
            return Vec::new();
        };

        if text == "帮助" || text == "功能" || text == "help" {
            let mut out = vec![format!(
                "我是 {}，您的 AI 助手!",
                if config.robot_name.is_empty() {
                    "Streamix"
                } else {
                    &config.robot_name
                }
            )];
            if !config.talk_robot_cmd.is_empty() {
                out.push(format!("输入「{}」即可与我对话", config.talk_robot_cmd));
            }
            return out;
        }

        Vec::new()
    }

    fn thanks_inner(&self, event: &LiveEvent, config: &AppConfig) -> Vec<String> {
        match event {
            LiveEvent::Interact {
                kind: InteractKind::Follow | InteractKind::MutualFollow,
                user,
                ..
            } if config.thanks_focus => {
                let mut out = vec![format!(
                    "感谢 {} 的关注!",
                    short_name(user, 8, config.danmu_len)
                )];
                if let Some(extra) = choose(&config.focus_danmu) {
                    out.push(extra);
                }
                out
            }
            LiveEvent::Interact {
                kind: InteractKind::Share,
                user,
                ..
            } if config.thanks_share => {
                let mut out = vec![format!(
                    "感谢 {} 的分享!",
                    short_name(user, 8, config.danmu_len)
                )];
                if let Some(extra) = choose(&config.focus_danmu) {
                    out.push(extra);
                }
                out
            }
            LiveEvent::GuardBuy { user, gift, .. } if config.thanks_gift => {
                vec![format!("感谢 {user} 的 {gift}")]
            }
            LiveEvent::SuperChat {
                user, text, price, ..
            } if config.thanks_super_chat => {
                vec![format!("感谢 {user} 的 SC (¥{price})：{text}")]
            }
            _ => Vec::new(),
        }
    }

    fn pk_and_activity_notice_inner(&self, event: &LiveEvent, config: &AppConfig) -> Vec<String> {
        match event {
            LiveEvent::Pk {
                kind:
                    PkEventKind::Start {
                        init_room_id,
                        match_room_id,
                    },
            } if config.pk_notice => {
                vec![format!(
                    "PK开始，对手直播间候选: {init_room_id}/{match_room_id}"
                )]
            }
            LiveEvent::Pk {
                kind: PkEventKind::End,
            } if config.pk_notice => {
                vec!["PK结束".to_string()]
            }
            LiveEvent::Pk {
                kind: PkEventKind::Other(command),
            } if config.pk_notice => {
                vec![format!("检测到PK事件: {command}")]
            }
            LiveEvent::RedPocket {
                kind:
                    RedPocketKind::New {
                        user, gift, price, ..
                    },
            } => {
                if config.thanks_gift {
                    vec![format!("感谢 {user} {price}电池的 {gift}")]
                } else {
                    Vec::new()
                }
            }
            LiveEvent::RedPocket { .. } => Vec::new(),
            LiveEvent::AnchorLottery {
                kind: AnchorLotteryKind::Start,
            } => Vec::new(),
            LiveEvent::AnchorLottery {
                kind: AnchorLotteryKind::Award | AnchorLotteryKind::End,
            } => Vec::new(),
            LiveEvent::AnchorLottery {
                kind: AnchorLotteryKind::Other(command),
            } => {
                vec![format!("检测到天选事件: {command}")]
            }
            LiveEvent::Block { user } if config.show_block_msg => {
                vec![format!("{user} 被禁言")]
            }
            _ => Vec::new(),
        }
    }

    #[allow(dead_code)]
    pub fn ai_prompt(&self, event: &LiveEvent) -> Option<String> {
        let config = self.config.lock().expect("config mutex poisoned");
        let LiveEvent::Danmu { text, .. } = event else {
            return None;
        };

        if config.talk_robot_cmd.is_empty() {
            return None;
        }

        if config.fuzzy_match_cmd {
            if text.contains(&config.talk_robot_cmd) {
                Some(
                    text.replace(&config.talk_robot_cmd, "")
                        .trim()
                        .to_string(),
                )
            } else {
                None
            }
        } else if text.starts_with(&config.talk_robot_cmd) {
            Some(text[config.talk_robot_cmd.len()..].trim().to_string())
        } else {
            None
        }
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

#[cfg(test)]
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

#[cfg(test)]
mod tests {
    use bilibili_live_protocol::{InteractKind, LiveEvent, PkEventKind};

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
    fn thanks_follow_emits_base_and_extra_message() {
        let mut config = test_config();
        config.thanks_focus = true; // MUST ENABLE
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
    fn thanks_superchat_emits_message() {
        let config = test_config();
        let engine = BotEngine::new(config);

        let replies = engine.handle_event(
            &LiveEvent::SuperChat {
                user_id: 1,
                user: "alice".to_string(),
                text: "你好".to_string(),
                price: 100,
            },
            None,
        );

        assert_eq!(replies, vec!["感谢 alice 的 SC (¥100)：你好"]);
    }

    #[test]
    fn thanks_share_emits_message() {
        let mut config = test_config();
        config.thanks_share = true;
        config.focus_danmu.clear(); // Clear to avoid random extra message
        let engine = BotEngine::new(config);

        let replies = engine.handle_event(
            &LiveEvent::Interact {
                kind: InteractKind::Share,
                user_id: 1,
                user: "alice".to_string(),
            },
            None,
        );

        assert_eq!(replies, vec!["感谢 alice 的分享!"]);
    }

    #[test]
    fn thanks_guardbuy_emits_message() {
        let mut config = test_config();
        config.thanks_gift = true;
        let engine = BotEngine::new(config);

        let replies = engine.handle_event(
            &LiveEvent::GuardBuy {
                user_id: 1,
                user: "alice".to_string(),
                gift: "舰长".to_string(),
            },
            None,
        );

        assert_eq!(replies, vec!["感谢 alice 的 舰长"]);
    }

    #[test]
    fn block_msg_emits_message_when_enabled() {
        let mut config = test_config();
        config.show_block_msg = true;
        let engine = BotEngine::new(config);

        let replies = engine.handle_event(
            &LiveEvent::Block {
                user: "bad_user".to_string(),
            },
            None,
        );

        assert_eq!(replies, vec!["bad_user 被禁言"]);
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

    #[test]
    fn comprehensive_switch_coverage() {
        let mut config = test_config();

        // 1. Thanks Focus Switch
        config.thanks_focus = false;
        let engine = BotEngine::new(config.clone());
        let event = LiveEvent::Interact {
            kind: InteractKind::Follow,
            user_id: 1,
            user: "u".to_string(),
        };
        assert!(
            engine.handle_event(&event, None).is_empty(),
            "Thanks focus should be disabled"
        );

        config.thanks_focus = true;
        let engine = BotEngine::new(config.clone());
        assert!(
            !engine.handle_event(&event, None).is_empty(),
            "Thanks focus should be enabled"
        );

        // 3. Thanks Share Switch
        config.thanks_share = false;
        let engine = BotEngine::new(config.clone());
        let event = LiveEvent::Interact {
            kind: InteractKind::Share,
            user_id: 1,
            user: "u".to_string(),
        };
        assert!(
            engine.handle_event(&event, None).is_empty(),
            "Thanks share should be disabled"
        );

        config.thanks_share = true;
        let engine = BotEngine::new(config.clone());
        assert!(
            !engine.handle_event(&event, None).is_empty(),
            "Thanks share should be enabled"
        );

        // 4. PK Notice Switch
        config.pk_notice = false;
        let engine = BotEngine::new(config.clone());
        let event = LiveEvent::Pk {
            kind: PkEventKind::Start {
                init_room_id: 1,
                match_room_id: 2,
            },
        };
        assert!(
            engine.handle_event(&event, None).is_empty(),
            "PK notice should be disabled"
        );

        config.pk_notice = true;
        let engine = BotEngine::new(config.clone());
        assert!(
            !engine.handle_event(&event, None).is_empty(),
            "PK notice should be enabled"
        );

        // 5. Block Msg Switch
        config.show_block_msg = false;
        let engine = BotEngine::new(config.clone());
        let event = LiveEvent::Block {
            user: "u".to_string(),
        };
        assert!(
            engine.handle_event(&event, None).is_empty(),
            "Block msg should be disabled"
        );

        config.show_block_msg = true;
        let engine = BotEngine::new(config.clone());
        assert!(
            !engine.handle_event(&event, None).is_empty(),
            "Block msg should be enabled"
        );

        // 6. Thanks Gift Switch (GuardBuy)
        config.thanks_gift = false;
        let engine = BotEngine::new(config.clone());
        let event = LiveEvent::GuardBuy {
            user_id: 1,
            user: "u".to_string(),
            gift: "舰长".to_string(),
        };
        assert!(
            engine.handle_event(&event, None).is_empty(),
            "Thanks gift should be disabled for GuardBuy"
        );

        config.thanks_gift = true;
        engine.update_config(config.clone());
        assert!(
            !engine.handle_event(&event, None).is_empty(),
            "Thanks gift should be enabled for GuardBuy"
        );
    }
}
