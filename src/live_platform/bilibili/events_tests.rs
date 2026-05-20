use serde_json::json;

use crate::live_platform::bilibili::events::map_bilibili_event;
use crate::live_platform::types::{BattleEvent, PlatformEvent, PlatformRoomRef};

fn room() -> PlatformRoomRef {
    PlatformRoomRef::bilibili(1000)
}

#[test]
fn maps_danmu_to_message() {
    let event = map_bilibili_event(
        &room(),
        bilibili_live_protocol::ParsedLiveEvent {
            event: bilibili_live_protocol::LiveEvent::Danmu {
                user_id: 42,
                user: "alice".to_string(),
                text: "hello".to_string(),
            },
            raw: json!({"cmd": "DANMU_MSG"}),
        },
    );
    match event.event {
        PlatformEvent::Message(message) => {
            assert_eq!(message.user.platform_user_id, "42");
            assert_eq!(message.user.display_name, "alice");
            assert_eq!(message.text, "hello");
        }
        other => panic!("expected message, got {other:?}"),
    }
}

#[test]
fn maps_gift_to_gift() {
    let event = map_bilibili_event(
        &room(),
        bilibili_live_protocol::ParsedLiveEvent {
            event: bilibili_live_protocol::LiveEvent::Gift {
                user_id: 7,
                user: "bob".to_string(),
                gift: "辣条".to_string(),
                count: 2,
                price: 100,
                original_gift_name: Some("盲盒".to_string()),
                original_gift_price: 50,
            },
            raw: json!({"cmd": "SEND_GIFT"}),
        },
    );
    match event.event {
        PlatformEvent::Gift(gift) => {
            assert_eq!(gift.user.platform_user_id, "7");
            assert_eq!(gift.gift, "辣条");
            assert_eq!(gift.count, 2);
            assert_eq!(gift.price, 100);
        }
        other => panic!("expected gift, got {other:?}"),
    }
}

#[test]
fn maps_follow_to_follow() {
    let event = map_bilibili_event(
        &room(),
        bilibili_live_protocol::ParsedLiveEvent {
            event: bilibili_live_protocol::LiveEvent::Interact {
                kind: bilibili_live_protocol::InteractKind::Follow,
                user_id: 9,
                user: "cat".to_string(),
            },
            raw: json!({"cmd": "INTERACT_WORD"}),
        },
    );
    assert!(matches!(event.event, PlatformEvent::Follow(_)));
}

#[test]
fn maps_pk_start_to_battle_start() {
    let event = map_bilibili_event(
        &room(),
        bilibili_live_protocol::ParsedLiveEvent {
            event: bilibili_live_protocol::LiveEvent::Pk {
                kind: bilibili_live_protocol::PkEventKind::Start {
                    init_room_id: 1,
                    match_room_id: 2,
                },
            },
            raw: json!({"cmd": "PK_BATTLE_START"}),
        },
    );
    match event.event {
        PlatformEvent::Battle(BattleEvent::Start {
            init_room_id,
            match_room_id,
        }) => {
            assert_eq!(init_room_id.as_deref(), Some("1"));
            assert_eq!(match_room_id.as_deref(), Some("2"));
        }
        other => panic!("expected battle start, got {other:?}"),
    }
}

#[test]
fn maps_command_to_unknown() {
    let event = map_bilibili_event(
        &room(),
        bilibili_live_protocol::ParsedLiveEvent {
            event: bilibili_live_protocol::LiveEvent::Command {
                name: "NEW_CMD".to_string(),
            },
            raw: json!({"cmd": "NEW_CMD"}),
        },
    );
    match event.event {
        PlatformEvent::Unknown(unknown) => assert_eq!(unknown.name, "NEW_CMD"),
        other => panic!("expected unknown, got {other:?}"),
    }
}
