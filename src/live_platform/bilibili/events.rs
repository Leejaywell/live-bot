use chrono::Local;

use crate::live_platform::types::{
    BattleEvent, ChatMessageEvent, GiftEvent, GuardOrMemberEvent, LikeEvent, LotteryEvent,
    ModerationEvent, PaidMessageEvent, PlatformEvent, PlatformEventEnvelope, PlatformId,
    PlatformRoomRef, PlatformUserRef, PopularityEvent, SystemEvent, UnknownEvent, UserEvent,
};

pub fn map_bilibili_event(
    room: &PlatformRoomRef,
    parsed: bilibili_live_protocol::ParsedLiveEvent,
) -> PlatformEventEnvelope {
    let platform_id = PlatformId::from(PlatformId::BILIBILI);
    let event = match parsed.event {
        bilibili_live_protocol::LiveEvent::Danmu {
            user_id,
            user,
            text,
        } => PlatformEvent::Message(ChatMessageEvent {
            user: PlatformUserRef::bilibili(user_id, user),
            text,
        }),
        bilibili_live_protocol::LiveEvent::Gift {
            user_id,
            user,
            gift,
            count,
            price,
            original_gift_name,
            original_gift_price,
        } => PlatformEvent::Gift(GiftEvent {
            user: PlatformUserRef::bilibili(user_id, user),
            gift,
            count,
            price,
            original_gift_name,
            original_gift_price,
        }),
        bilibili_live_protocol::LiveEvent::Interact {
            kind,
            user_id,
            user,
        } => {
            let user = PlatformUserRef::bilibili(user_id, user);
            match kind {
                bilibili_live_protocol::InteractKind::Entry => {
                    PlatformEvent::Enter(UserEvent { user })
                }
                bilibili_live_protocol::InteractKind::Follow
                | bilibili_live_protocol::InteractKind::MutualFollow => {
                    PlatformEvent::Follow(UserEvent { user })
                }
                bilibili_live_protocol::InteractKind::Share => {
                    PlatformEvent::Share(UserEvent { user })
                }
                bilibili_live_protocol::InteractKind::Unknown(value) => {
                    PlatformEvent::Unknown(UnknownEvent {
                        name: format!("INTERACT_WORD:{value}"),
                    })
                }
            }
        }
        bilibili_live_protocol::LiveEvent::EntryEffect { user_id, user, .. } => {
            PlatformEvent::Enter(UserEvent {
                user: PlatformUserRef::bilibili(user_id, user),
            })
        }
        bilibili_live_protocol::LiveEvent::LikeClick {
            user_id,
            user,
            count,
            text,
        } => PlatformEvent::Like(LikeEvent {
            user: PlatformUserRef::bilibili(user_id, user),
            count,
            text,
        }),
        bilibili_live_protocol::LiveEvent::GuardBuy {
            user_id,
            user,
            gift,
        } => PlatformEvent::GuardOrMember(GuardOrMemberEvent {
            user: PlatformUserRef::bilibili(user_id, user),
            gift,
        }),
        bilibili_live_protocol::LiveEvent::SuperChat {
            user_id,
            user,
            text,
            price,
        } => PlatformEvent::PaidMessage(PaidMessageEvent {
            user: PlatformUserRef::bilibili(user_id, user),
            text,
            price,
        }),
        bilibili_live_protocol::LiveEvent::Block { user } => {
            PlatformEvent::Moderation(ModerationEvent {
                user_name: user,
                action: "block".to_string(),
            })
        }
        bilibili_live_protocol::LiveEvent::System { text } => {
            PlatformEvent::System(SystemEvent { text })
        }
        bilibili_live_protocol::LiveEvent::Popularity { value } => {
            PlatformEvent::Popularity(PopularityEvent { value })
        }
        bilibili_live_protocol::LiveEvent::Pk { kind } => PlatformEvent::Battle(match kind {
            bilibili_live_protocol::PkEventKind::Start {
                init_room_id,
                match_room_id,
            } => BattleEvent::Start {
                init_room_id: Some(init_room_id.to_string()),
                match_room_id: Some(match_room_id.to_string()),
            },
            bilibili_live_protocol::PkEventKind::End => BattleEvent::End,
            bilibili_live_protocol::PkEventKind::Process => BattleEvent::Process,
            bilibili_live_protocol::PkEventKind::Other(name) => BattleEvent::Other(name),
        }),
        bilibili_live_protocol::LiveEvent::RedPocket { kind } => {
            PlatformEvent::Lottery(match kind {
                bilibili_live_protocol::RedPocketKind::New {
                    user_id,
                    user,
                    gift,
                    price,
                } => LotteryEvent::New {
                    user: Some(PlatformUserRef::bilibili(user_id, user)),
                    gift,
                    price,
                },
                bilibili_live_protocol::RedPocketKind::WinnerList => LotteryEvent::WinnerList,
                bilibili_live_protocol::RedPocketKind::Start => LotteryEvent::Start,
                bilibili_live_protocol::RedPocketKind::Other(name) => LotteryEvent::Other(name),
            })
        }
        bilibili_live_protocol::LiveEvent::AnchorLottery { kind } => {
            PlatformEvent::Lottery(match kind {
                bilibili_live_protocol::AnchorLotteryKind::Start => LotteryEvent::Start,
                bilibili_live_protocol::AnchorLotteryKind::Award => LotteryEvent::Award,
                bilibili_live_protocol::AnchorLotteryKind::End => LotteryEvent::End,
                bilibili_live_protocol::AnchorLotteryKind::Other(name) => LotteryEvent::Other(name),
            })
        }
        bilibili_live_protocol::LiveEvent::Command { name } => {
            PlatformEvent::Unknown(UnknownEvent { name })
        }
    };

    PlatformEventEnvelope {
        platform_id,
        room: room.clone(),
        event_id: None,
        occurred_at: Local::now(),
        event,
        raw: parsed.raw,
    }
}
