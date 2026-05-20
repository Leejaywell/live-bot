use std::collections::BTreeMap;
use std::sync::Mutex;

use bilibili_live_protocol::{
    AnchorLotteryKind, InteractKind, LiveEvent, PkEventKind, RedPocketKind,
};
use rand::prelude::IndexedRandom;

use crate::config::AppConfig;
use crate::live_platform::types::{
    BattleEvent, ChatMessageEvent, GiftEvent, GuardOrMemberEvent, LotteryEvent, ModerationEvent,
    PaidMessageEvent, PlatformEvent, PlatformUserRef, PopularityEvent, SystemEvent, UnknownEvent,
    UserEvent,
};
use crate::storage::Storage;

#[derive(Debug)]
pub struct BotEngine {
    config: Mutex<AppConfig>,
    repeat_counts: Mutex<BTreeMap<(String, String), i32>>,
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

    pub fn handle_event(&self, event: &LiveEvent, storage: Option<&Storage>) -> Vec<String> {
        let platform_event = bilibili_event_to_platform(event);
        self.handle_platform_event(&platform_event, storage)
    }

    pub fn handle_platform_event(
        &self,
        event: &PlatformEvent,
        _storage: Option<&Storage>,
    ) -> Vec<String> {
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

    fn welcome_inner(&self, event: &PlatformEvent, config: &AppConfig) -> Vec<String> {
        let PlatformEvent::Enter(entry) = event else {
            return Vec::new();
        };

        // Special welcome (UID exact match) takes priority
        let uid_str = entry.user.platform_user_id.as_str();
        let user = entry.user.display_name.as_str();
        if entry.user.platform_id.as_str() == "bilibili" {
            for sw in &config.special_welcome_list {
                if !sw.uid.is_empty() && sw.uid == uid_str {
                    return vec![sw.msg.replace("{user}", user)];
                }
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

    fn is_permanently_blacklisted_inner(&self, event: &PlatformEvent, config: &AppConfig) -> bool {
        let Some(user_ref) = Self::event_user(event) else {
            return false;
        };
        let user_id = user_ref.numeric_id().unwrap_or(0);
        let user = user_ref.display_name.as_str();

        if user_id != 0 && config.permanent_blacklist_users.contains(&user_id) {
            return true;
        }

        config
            .permanent_blacklist_names
            .iter()
            .any(|name| !name.is_empty() && user.contains(name))
    }

    fn is_filtered_danmu_inner(&self, event: &PlatformEvent, config: &AppConfig) -> bool {
        if !config.danmu_filter_enable {
            return false;
        }
        let PlatformEvent::Message(message) = event else {
            return false;
        };
        let user_key = message.user.platform_user_id.as_str();
        let text = message.text.as_str();

        config
            .danmu_filter_words
            .iter()
            .any(|word| !word.is_empty() && text.contains(word))
            || self.is_repeated_danmu(user_key, text, config)
    }

    fn is_repeated_danmu(&self, user_id: &str, text: &str, config: &AppConfig) -> bool {
        if config.danmu_filter_repeat_threshold <= 1 {
            return false;
        }
        let Ok(mut counts) = self.repeat_counts.lock() else {
            return false;
        };
        let count = counts
            .entry((user_id.to_string(), text.to_string()))
            .or_insert(0);
        *count += 1;
        *count >= config.danmu_filter_repeat_threshold
    }

    fn help_inner(&self, event: &PlatformEvent, config: &AppConfig) -> Vec<String> {
        let PlatformEvent::Message(message) = event else {
            return Vec::new();
        };
        let text = message.text.as_str();

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

    fn thanks_inner(&self, event: &PlatformEvent, config: &AppConfig) -> Vec<String> {
        match event {
            PlatformEvent::Follow(value) if config.thanks_focus => {
                let user = value.user.display_name.as_str();
                let mut out = vec![format!(
                    "感谢 {} 的关注!",
                    short_name(user, 8, config.danmu_len)
                )];
                if let Some(extra) = choose(&config.focus_danmu) {
                    out.push(extra);
                }
                out
            }
            PlatformEvent::Share(value) if config.thanks_share => {
                let user = value.user.display_name.as_str();
                let mut out = vec![format!(
                    "感谢 {} 的分享!",
                    short_name(user, 8, config.danmu_len)
                )];
                if let Some(extra) = choose(&config.focus_danmu) {
                    out.push(extra);
                }
                out
            }
            PlatformEvent::GuardOrMember(value) if config.thanks_gift => {
                vec![format!(
                    "感谢 {} 的 {}",
                    value.user.display_name, value.gift
                )]
            }
            PlatformEvent::PaidMessage(value) if config.thanks_super_chat => {
                vec![format!(
                    "感谢 {} 的 SC (¥{})：{}",
                    value.user.display_name, value.price, value.text
                )]
            }
            _ => Vec::new(),
        }
    }

    fn pk_and_activity_notice_inner(
        &self,
        event: &PlatformEvent,
        config: &AppConfig,
    ) -> Vec<String> {
        match event {
            PlatformEvent::Battle(BattleEvent::Start {
                init_room_id,
                match_room_id,
            }) if config.pk_notice => {
                vec![format!(
                    "PK开始，对手直播间候选: {}/{}",
                    init_room_id.as_deref().unwrap_or("-"),
                    match_room_id.as_deref().unwrap_or("-")
                )]
            }
            PlatformEvent::Battle(BattleEvent::End) if config.pk_notice => {
                vec!["PK结束".to_string()]
            }
            PlatformEvent::Battle(BattleEvent::Other(command)) if config.pk_notice => {
                vec![format!("检测到PK事件: {command}")]
            }
            PlatformEvent::Lottery(LotteryEvent::New {
                user: Some(user),
                gift,
                price,
            }) if config.thanks_gift => {
                vec![format!("感谢 {} {price}电池的 {gift}", user.display_name)]
            }
            PlatformEvent::Lottery(LotteryEvent::Other(command)) => {
                vec![format!("检测到天选事件: {command}")]
            }
            PlatformEvent::Moderation(value) if config.show_block_msg => {
                vec![format!("{} 被禁言", value.user_name)]
            }
            _ => Vec::new(),
        }
    }

    fn event_user(event: &PlatformEvent) -> Option<&PlatformUserRef> {
        match event {
            PlatformEvent::Message(value) => Some(&value.user),
            PlatformEvent::Gift(value) => Some(&value.user),
            PlatformEvent::Follow(value)
            | PlatformEvent::Share(value)
            | PlatformEvent::Enter(value) => Some(&value.user),
            PlatformEvent::Like(value) => Some(&value.user),
            PlatformEvent::GuardOrMember(value) => Some(&value.user),
            PlatformEvent::PaidMessage(value) => Some(&value.user),
            _ => None,
        }
    }

    #[allow(dead_code)]
    pub fn ai_prompt(&self, event: &PlatformEvent) -> Option<String> {
        let config = self.config.lock().expect("config mutex poisoned");
        let PlatformEvent::Message(message) = event else {
            return None;
        };
        let text = message.text.as_str();

        if config.talk_robot_cmd.is_empty() {
            return None;
        }

        if config.fuzzy_match_cmd {
            if text.contains(&config.talk_robot_cmd) {
                Some(text.replace(&config.talk_robot_cmd, "").trim().to_string())
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

fn bilibili_event_to_platform(event: &LiveEvent) -> PlatformEvent {
    match event {
        LiveEvent::Danmu {
            user_id,
            user,
            text,
        } => PlatformEvent::Message(ChatMessageEvent {
            user: PlatformUserRef::bilibili(*user_id, user.clone()),
            text: text.clone(),
        }),
        LiveEvent::Gift {
            user_id,
            user,
            gift,
            count,
            price,
            original_gift_name,
            original_gift_price,
        } => PlatformEvent::Gift(GiftEvent {
            user: PlatformUserRef::bilibili(*user_id, user.clone()),
            gift: gift.clone(),
            count: *count,
            price: *price,
            original_gift_name: original_gift_name.clone(),
            original_gift_price: *original_gift_price,
        }),
        LiveEvent::Interact {
            kind,
            user_id,
            user,
        } => {
            let user = PlatformUserRef::bilibili(*user_id, user.clone());
            match kind {
                InteractKind::Entry => PlatformEvent::Enter(UserEvent { user }),
                InteractKind::Follow | InteractKind::MutualFollow => {
                    PlatformEvent::Follow(UserEvent { user })
                }
                InteractKind::Share => PlatformEvent::Share(UserEvent { user }),
                InteractKind::Unknown(value) => PlatformEvent::Unknown(UnknownEvent {
                    name: format!("INTERACT_WORD:{value}"),
                }),
            }
        }
        LiveEvent::EntryEffect { user_id, user, .. } => PlatformEvent::Enter(UserEvent {
            user: PlatformUserRef::bilibili(*user_id, user.clone()),
        }),
        LiveEvent::LikeClick {
            user_id,
            user,
            count,
            text,
        } => PlatformEvent::Like(crate::live_platform::types::LikeEvent {
            user: PlatformUserRef::bilibili(*user_id, user.clone()),
            count: *count,
            text: text.clone(),
        }),
        LiveEvent::GuardBuy {
            user_id,
            user,
            gift,
        } => PlatformEvent::GuardOrMember(GuardOrMemberEvent {
            user: PlatformUserRef::bilibili(*user_id, user.clone()),
            gift: gift.clone(),
        }),
        LiveEvent::SuperChat {
            user_id,
            user,
            text,
            price,
        } => PlatformEvent::PaidMessage(PaidMessageEvent {
            user: PlatformUserRef::bilibili(*user_id, user.clone()),
            text: text.clone(),
            price: *price,
        }),
        LiveEvent::Block { user } => PlatformEvent::Moderation(ModerationEvent {
            user_name: user.clone(),
            action: "block".to_string(),
        }),
        LiveEvent::System { text } => PlatformEvent::System(SystemEvent { text: text.clone() }),
        LiveEvent::Popularity { value } => {
            PlatformEvent::Popularity(PopularityEvent { value: *value })
        }
        LiveEvent::Pk { kind } => PlatformEvent::Battle(match kind {
            PkEventKind::Start {
                init_room_id,
                match_room_id,
            } => BattleEvent::Start {
                init_room_id: Some(init_room_id.to_string()),
                match_room_id: Some(match_room_id.to_string()),
            },
            PkEventKind::End => BattleEvent::End,
            PkEventKind::Process => BattleEvent::Process,
            PkEventKind::Other(command) => BattleEvent::Other(command.clone()),
        }),
        LiveEvent::RedPocket { kind } => PlatformEvent::Lottery(match kind {
            RedPocketKind::New {
                user_id,
                user,
                gift,
                price,
            } => LotteryEvent::New {
                user: Some(PlatformUserRef::bilibili(*user_id, user.clone())),
                gift: gift.clone(),
                price: *price,
            },
            RedPocketKind::WinnerList => LotteryEvent::WinnerList,
            RedPocketKind::Start => LotteryEvent::Start,
            RedPocketKind::Other(command) => LotteryEvent::Other(command.clone()),
        }),
        LiveEvent::AnchorLottery { kind } => PlatformEvent::Lottery(match kind {
            AnchorLotteryKind::Start => LotteryEvent::Start,
            AnchorLotteryKind::Award => LotteryEvent::Award,
            AnchorLotteryKind::End => LotteryEvent::End,
            AnchorLotteryKind::Other(command) => LotteryEvent::Other(command.clone()),
        }),
        LiveEvent::Command { name } => PlatformEvent::Unknown(UnknownEvent { name: name.clone() }),
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
    use super::{BotEngine, short_name, time_key};
    use crate::bot::testsupport::test_config;
    use crate::config::SpecialWelcomeEntry;
    use crate::live_platform::types::{
        BattleEvent, ChatMessageEvent, GuardOrMemberEvent, ModerationEvent, PaidMessageEvent,
        PlatformEvent, PlatformId, PlatformUserRef, UserEvent,
    };

    fn user(uid: i64, name: &str) -> PlatformUserRef {
        PlatformUserRef::bilibili(uid, name)
    }

    fn message(uid: i64, name: &str, text: &str) -> PlatformEvent {
        PlatformEvent::Message(ChatMessageEvent {
            user: user(uid, name),
            text: text.to_string(),
        })
    }

    fn follow(uid: i64, name: &str) -> PlatformEvent {
        PlatformEvent::Follow(UserEvent {
            user: user(uid, name),
        })
    }

    fn share(uid: i64, name: &str) -> PlatformEvent {
        PlatformEvent::Share(UserEvent {
            user: user(uid, name),
        })
    }

    fn guard(uid: i64, name: &str, gift: &str) -> PlatformEvent {
        PlatformEvent::GuardOrMember(GuardOrMemberEvent {
            user: user(uid, name),
            gift: gift.to_string(),
        })
    }

    fn paid(uid: i64, name: &str, text: &str, price: i64) -> PlatformEvent {
        PlatformEvent::PaidMessage(PaidMessageEvent {
            user: user(uid, name),
            text: text.to_string(),
            price,
        })
    }

    fn block(name: &str) -> PlatformEvent {
        PlatformEvent::Moderation(ModerationEvent {
            user_name: name.to_string(),
            action: "block".to_string(),
        })
    }

    fn battle_start(init_room_id: &str, match_room_id: &str) -> PlatformEvent {
        PlatformEvent::Battle(BattleEvent::Start {
            init_room_id: Some(init_room_id.to_string()),
            match_room_id: Some(match_room_id.to_string()),
        })
    }

    #[test]
    fn special_welcome_uid_match_is_bilibili_only() {
        let mut config = test_config();
        config.special_welcome_list = vec![SpecialWelcomeEntry {
            uid: "42".to_string(),
            msg: "欢迎 {user}".to_string(),
        }];
        let engine = BotEngine::new(config);
        let bili_event = PlatformEvent::Enter(UserEvent {
            user: PlatformUserRef::bilibili(42, "alice"),
        });
        let douyin_event = PlatformEvent::Enter(UserEvent {
            user: PlatformUserRef {
                platform_id: PlatformId::from("douyin"),
                platform_user_id: "42".to_string(),
                display_name: "mallory".to_string(),
            },
        });

        assert_eq!(
            engine.handle_platform_event(&bili_event, None),
            vec!["欢迎 alice".to_string()]
        );
        assert!(engine.handle_platform_event(&douyin_event, None).is_empty());
    }

    #[test]
    fn permanent_blacklist_blocks_danmu_automation() {
        let mut config = test_config();
        config.permanent_blacklist_users = vec![42];
        let engine = BotEngine::new(config);

        let replies = engine.handle_platform_event(&message(42, "u", "帮助"), None);

        assert!(replies.is_empty());
    }

    #[test]
    fn sensitive_danmu_does_not_trigger_automation() {
        let mut config = test_config();
        config.danmu_filter_enable = true;
        config.danmu_filter_words = vec!["广告".to_string()];
        let engine = BotEngine::new(config);

        let replies = engine.handle_platform_event(&message(1, "u", "广告帮助"), None);

        assert!(replies.is_empty());
    }

    #[test]
    fn repeated_danmu_stops_triggering_automation_at_threshold() {
        let mut config = test_config();
        config.danmu_filter_enable = true;
        config.danmu_filter_repeat_threshold = 2;
        let engine = BotEngine::new(config);
        let event = message(1, "u", "帮助");

        assert!(!engine.handle_platform_event(&event, None).is_empty());
        assert!(engine.handle_platform_event(&event, None).is_empty());
    }

    #[test]
    fn thanks_follow_emits_base_and_extra_message() {
        let mut config = test_config();
        config.thanks_focus = true; // MUST ENABLE
        config.focus_danmu = vec!["贴贴~".to_string()];
        let engine = BotEngine::new(config);

        let replies = engine.handle_platform_event(&follow(1, "alice"), None);

        assert_eq!(replies, vec!["感谢 alice 的关注!", "贴贴~"]);
    }

    #[test]
    fn thanks_superchat_emits_message() {
        let config = test_config();
        let engine = BotEngine::new(config);

        let replies = engine.handle_platform_event(&paid(1, "alice", "你好", 100), None);

        assert_eq!(replies, vec!["感谢 alice 的 SC (¥100)：你好"]);
    }

    #[test]
    fn thanks_share_emits_message() {
        let mut config = test_config();
        config.thanks_share = true;
        config.focus_danmu.clear(); // Clear to avoid random extra message
        let engine = BotEngine::new(config);

        let replies = engine.handle_platform_event(&share(1, "alice"), None);

        assert_eq!(replies, vec!["感谢 alice 的分享!"]);
    }

    #[test]
    fn thanks_guardbuy_emits_message() {
        let mut config = test_config();
        config.thanks_gift = true;
        let engine = BotEngine::new(config);

        let replies = engine.handle_platform_event(&guard(1, "alice", "舰长"), None);

        assert_eq!(replies, vec!["感谢 alice 的 舰长"]);
    }

    #[test]
    fn block_msg_emits_message_when_enabled() {
        let mut config = test_config();
        config.show_block_msg = true;
        let engine = BotEngine::new(config);

        let replies = engine.handle_platform_event(&block("bad_user"), None);

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

        let prompt = engine.ai_prompt(&message(1, "u", "花花今天吃什么"));

        assert_eq!(prompt.as_deref(), Some("今天吃什么"));
    }

    #[test]
    fn help_command_returns_expected_messages() {
        let config = test_config();
        let engine = BotEngine::new(config);

        let replies = engine.handle_platform_event(&message(1, "u", "帮助"), None);

        assert!(!replies.is_empty());
        assert!(replies.iter().any(|line| line.contains("AI 助手")));
    }

    #[test]
    fn comprehensive_switch_coverage() {
        let mut config = test_config();

        // 1. Thanks Focus Switch
        config.thanks_focus = false;
        let engine = BotEngine::new(config.clone());
        let event = follow(1, "u");
        assert!(
            engine.handle_platform_event(&event, None).is_empty(),
            "Thanks focus should be disabled"
        );

        config.thanks_focus = true;
        let engine = BotEngine::new(config.clone());
        assert!(
            !engine.handle_platform_event(&event, None).is_empty(),
            "Thanks focus should be enabled"
        );

        // 3. Thanks Share Switch
        config.thanks_share = false;
        let engine = BotEngine::new(config.clone());
        let event = share(1, "u");
        assert!(
            engine.handle_platform_event(&event, None).is_empty(),
            "Thanks share should be disabled"
        );

        config.thanks_share = true;
        let engine = BotEngine::new(config.clone());
        assert!(
            !engine.handle_platform_event(&event, None).is_empty(),
            "Thanks share should be enabled"
        );

        // 4. PK Notice Switch
        config.pk_notice = false;
        let engine = BotEngine::new(config.clone());
        let event = battle_start("1", "2");
        assert!(
            engine.handle_platform_event(&event, None).is_empty(),
            "PK notice should be disabled"
        );

        config.pk_notice = true;
        let engine = BotEngine::new(config.clone());
        assert!(
            !engine.handle_platform_event(&event, None).is_empty(),
            "PK notice should be enabled"
        );

        // 5. Block Msg Switch
        config.show_block_msg = false;
        let engine = BotEngine::new(config.clone());
        let event = block("u");
        assert!(
            engine.handle_platform_event(&event, None).is_empty(),
            "Block msg should be disabled"
        );

        config.show_block_msg = true;
        let engine = BotEngine::new(config.clone());
        assert!(
            !engine.handle_platform_event(&event, None).is_empty(),
            "Block msg should be enabled"
        );

        // 6. Thanks Gift Switch (GuardBuy)
        config.thanks_gift = false;
        let engine = BotEngine::new(config.clone());
        let event = guard(1, "u", "舰长");
        assert!(
            engine.handle_platform_event(&event, None).is_empty(),
            "Thanks gift should be disabled for GuardBuy"
        );

        config.thanks_gift = true;
        engine.update_config(config.clone());
        assert!(
            !engine.handle_platform_event(&event, None).is_empty(),
            "Thanks gift should be enabled for GuardBuy"
        );
    }
}
