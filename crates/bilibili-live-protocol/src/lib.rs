use std::fmt;
use std::io::Read;

use anyhow::{Result, anyhow};
use flate2::read::ZlibDecoder;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::time::{Duration, interval};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const DEFAULT_HOST: &str = "broadcastlv.chat.bilibili.com";
const PROTOCOL_PLAIN: u16 = 0;
const PROTOCOL_ZLIB: u16 = 2;
const PROTOCOL_BROTLI: u16 = 3;
const OP_HEARTBEAT: u32 = 2;
const OP_HEARTBEAT_REPLY: u32 = 3;
const OP_NOTIFICATION: u32 = 5;
const OP_ROOM_ENTER: u32 = 7;

#[derive(Debug, Clone)]
pub struct ConnectConfig {
    pub room_id: i64,
    pub token: String,
    pub hosts: Vec<String>,
}

impl ConnectConfig {
    pub fn first_ws_url(&self) -> String {
        let host = self
            .hosts
            .first()
            .map(String::as_str)
            .unwrap_or(DEFAULT_HOST);
        format!("wss://{host}/sub")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum LiveEvent {
    Danmu {
        user_id: i64,
        user: String,
        text: String,
    },
    Gift {
        user_id: i64,
        user: String,
        gift: String,
        count: i64,
        price: i64,
        original_gift_name: Option<String>,
        original_gift_price: i64,
    },
    Interact {
        kind: InteractKind,
        user_id: i64,
        user: String,
    },
    EntryEffect {
        user_id: i64,
        user: String,
        guard_level: i64,
        wealth_level: i64,
    },
    GuardBuy {
        user_id: i64,
        user: String,
        gift: String,
    },
    Block {
        user: String,
    },
    Popularity {
        value: i64,
    },
    Pk {
        kind: PkEventKind,
    },
    RedPocket {
        kind: RedPocketKind,
    },
    AnchorLottery {
        kind: AnchorLotteryKind,
    },
    Command {
        name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ParsedLiveEvent {
    pub event: LiveEvent,
    pub raw: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum InteractKind {
    Entry,
    Follow,
    Share,
    MutualFollow,
    Unknown(i64),
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum PkEventKind {
    Start {
        init_room_id: i64,
        match_room_id: i64,
    },
    End,
    Process,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum RedPocketKind {
    New {
        user_id: i64,
        user: String,
        gift: String,
        price: i64,
    },
    WinnerList,
    Start,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum AnchorLotteryKind {
    Start,
    Award,
    End,
    Other(String),
}

impl fmt::Display for LiveEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Danmu { user, text, .. } => write!(f, "弹幕 {user}: {text}"),
            Self::Gift {
                user, gift, count, ..
            } => write!(f, "礼物 {user}: {gift} x{count}"),
            Self::Interact { kind, user, .. } => match kind {
                InteractKind::Entry => write!(f, "进场 {user}"),
                InteractKind::Follow | InteractKind::MutualFollow => write!(f, "关注 {user}"),
                InteractKind::Share => write!(f, "分享 {user}"),
                InteractKind::Unknown(value) => write!(f, "互动 {user}: {value}"),
            },
            Self::EntryEffect { user, .. } => write!(f, "进场特效 {user}"),
            Self::GuardBuy { user, gift, .. } => write!(f, "大航海 {user}: {gift}"),
            Self::Block { user } => write!(f, "禁言 {user}"),
            Self::Popularity { value } => write!(f, "人气 {value}"),
            Self::Pk { kind } => write!(f, "PK {kind:?}"),
            Self::RedPocket { kind } => write!(f, "红包 {kind:?}"),
            Self::AnchorLottery { kind } => write!(f, "天选 {kind:?}"),
            Self::Command { name } => write!(f, "事件 {name}"),
        }
    }
}

#[derive(Debug)]
struct Packet<'a> {
    protocol: u16,
    operation: u32,
    body: &'a [u8],
}

pub async fn run_client<F>(config: ConnectConfig, mut on_event: F) -> Result<()>
where
    F: FnMut(LiveEvent) + Send + 'static,
{
    run_parsed_client(config, move |parsed| on_event(parsed.event)).await
}

pub async fn run_parsed_client<F>(config: ConnectConfig, mut on_event: F) -> Result<()>
where
    F: FnMut(ParsedLiveEvent) + Send + 'static,
{
    let url = config.first_ws_url();
    let (mut socket, _) = connect_async(&url).await?;
    socket
        .send(Message::Binary(
            build_enter_packet(config.room_id, &config.token).into(),
        ))
        .await?;

    let mut heartbeat = interval(Duration::from_secs(30));
    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                socket.send(Message::Binary(build_heartbeat_packet().into())).await?;
            }
            message = socket.next() => {
                match message {
                    Some(Ok(Message::Binary(data))) => {
                        for event in parse_parsed_events(&data)? {
                            on_event(event);
                        }
                    }
                    Some(Ok(Message::Close(_))) => return Err(anyhow!("websocket closed")),
                    Some(Ok(_)) => {}
                    Some(Err(err)) => return Err(err.into()),
                    None => return Err(anyhow!("websocket ended")),
                }
            }
        }
    }
}

pub fn build_enter_packet(room_id: i64, token: &str) -> Vec<u8> {
    let body = serde_json::json!({
        "uid": 0,
        "roomid": room_id,
        "protover": 3,
        "platform": "danmuji",
        "type": 2,
        "key": token,
    });
    build_packet(1, OP_ROOM_ENTER, body.to_string().as_bytes())
}

pub fn build_heartbeat_packet() -> Vec<u8> {
    build_packet(1, OP_HEARTBEAT, &[])
}

pub fn parse_events(data: &[u8]) -> Result<Vec<LiveEvent>> {
    Ok(parse_parsed_events(data)?
        .into_iter()
        .map(|event| event.event)
        .collect())
}

pub fn parse_parsed_events(data: &[u8]) -> Result<Vec<ParsedLiveEvent>> {
    let mut events = Vec::new();
    for packet in split_packets(data)? {
        if packet.operation == OP_HEARTBEAT_REPLY {
            collect_popularity(packet, &mut events);
            continue;
        }
        match packet.protocol {
            PROTOCOL_PLAIN => collect_notification(packet, &mut events)?,
            PROTOCOL_ZLIB => {
                let mut decoder = ZlibDecoder::new(packet.body);
                let mut decoded = Vec::new();
                decoder.read_to_end(&mut decoded)?;
                events.extend(parse_parsed_events(&decoded)?);
            }
            PROTOCOL_BROTLI => {
                let mut decoded = Vec::new();
                let mut decompressor = brotli::Decompressor::new(packet.body, 4096);
                decompressor.read_to_end(&mut decoded)?;
                events.extend(parse_parsed_events(&decoded)?);
            }
            _ => {}
        }
    }
    Ok(events)
}

fn collect_popularity(packet: Packet<'_>, events: &mut Vec<ParsedLiveEvent>) {
    if packet.body.len() < 4 {
        return;
    }
    let value = i32::from_be_bytes(packet.body[0..4].try_into().unwrap()) as i64;
    events.push(ParsedLiveEvent {
        event: LiveEvent::Popularity { value },
        raw: serde_json::json!({ "operation": OP_HEARTBEAT_REPLY, "popularity": value }),
    });
}

fn build_packet(protocol: u16, operation: u32, body: &[u8]) -> Vec<u8> {
    let length = 16 + body.len();
    let mut out = vec![0_u8; 16];
    out[0..4].copy_from_slice(&(length as u32).to_be_bytes());
    out[4..6].copy_from_slice(&16_u16.to_be_bytes());
    out[6..8].copy_from_slice(&protocol.to_be_bytes());
    out[8..12].copy_from_slice(&operation.to_be_bytes());
    out[12..16].copy_from_slice(&1_u32.to_be_bytes());
    out.extend_from_slice(body);
    out
}

fn split_packets(data: &[u8]) -> Result<Vec<Packet<'_>>> {
    let mut packets = Vec::new();
    let mut cursor = 0;
    while cursor + 16 <= data.len() {
        let packet_len = u32::from_be_bytes(data[cursor..cursor + 4].try_into()?) as usize;
        if packet_len < 16 || cursor + packet_len > data.len() {
            return Err(anyhow!("invalid websocket packet length"));
        }
        let header_len = u16::from_be_bytes(data[cursor + 4..cursor + 6].try_into()?) as usize;
        let protocol = u16::from_be_bytes(data[cursor + 6..cursor + 8].try_into()?);
        let operation = u32::from_be_bytes(data[cursor + 8..cursor + 12].try_into()?);
        let body_start = cursor + header_len;
        packets.push(Packet {
            protocol,
            operation,
            body: &data[body_start..cursor + packet_len],
        });
        cursor += packet_len;
    }
    Ok(packets)
}

fn collect_notification(packet: Packet<'_>, events: &mut Vec<ParsedLiveEvent>) -> Result<()> {
    if packet.operation != OP_NOTIFICATION || packet.body.is_empty() {
        return Ok(());
    }

    let json: Value = serde_json::from_slice(packet.body)?;
    let Some(cmd) = json.get("cmd").and_then(Value::as_str) else {
        return Ok(());
    };

    match cmd.split(':').next().unwrap_or(cmd) {
        "DANMU_MSG" => {
            let user_id = json
                .pointer("/info/2/0")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let user = json
                .pointer("/info/2/1")
                .and_then(Value::as_str)
                .unwrap_or("匿名用户");
            let text = json
                .pointer("/info/1")
                .and_then(Value::as_str)
                .unwrap_or("");
            events.push(parsed(
                LiveEvent::Danmu {
                    user_id,
                    user: user.to_string(),
                    text: text.to_string(),
                },
                &json,
            ));
        }
        "SEND_GIFT" => {
            let user_id = json
                .pointer("/data/uid")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let user = json
                .pointer("/data/uname")
                .and_then(Value::as_str)
                .unwrap_or("用户");
            let gift = json
                .pointer("/data/giftName")
                .and_then(Value::as_str)
                .unwrap_or("礼物");
            let count = json
                .pointer("/data/num")
                .and_then(Value::as_i64)
                .unwrap_or(1);
            let price = json
                .pointer("/data/price")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let original_gift_name = json
                .pointer("/data/blind_gift/original_gift_name")
                .or_else(|| json.pointer("/data/original_gift_name"))
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let original_gift_price = json
                .pointer("/data/blind_gift/original_gift_price")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            events.push(parsed(
                LiveEvent::Gift {
                    user_id,
                    user: user.to_string(),
                    gift: gift.to_string(),
                    count,
                    price,
                    original_gift_name,
                    original_gift_price,
                },
                &json,
            ));
        }
        "INTERACT_WORD" => {
            let msg_type = json
                .pointer("/data/msg_type")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let user_id = json
                .pointer("/data/uid")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let user = json
                .pointer("/data/uname")
                .and_then(Value::as_str)
                .unwrap_or("用户");
            events.push(parsed(
                LiveEvent::Interact {
                    kind: match msg_type {
                        1 => InteractKind::Entry,
                        2 => InteractKind::Follow,
                        3 => InteractKind::Share,
                        5 => InteractKind::MutualFollow,
                        other => InteractKind::Unknown(other),
                    },
                    user_id,
                    user: user.to_string(),
                },
                &json,
            ));
        }
        "ENTRY_EFFECT" | "ENTRY_EFFECT_MUST_RECEIVE" => {
            let user_id = json
                .pointer("/data/uid")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let user = json
                .pointer("/data/uinfo/base/name")
                .or_else(|| json.pointer("/data/copy_writing"))
                .and_then(Value::as_str)
                .unwrap_or("用户");
            let guard_level = json
                .pointer("/data/uinfo/guard/level")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let wealth_level = json
                .pointer("/data/uinfo/wealth/level")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            events.push(parsed(
                LiveEvent::EntryEffect {
                    user_id,
                    user: user.to_string(),
                    guard_level,
                    wealth_level,
                },
                &json,
            ));
        }
        "GUARD_BUY" => {
            let user_id = json
                .pointer("/data/uid")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let user = json
                .pointer("/data/username")
                .and_then(Value::as_str)
                .unwrap_or("用户");
            let gift = json
                .pointer("/data/gift_name")
                .and_then(Value::as_str)
                .unwrap_or("大航海");
            events.push(parsed(
                LiveEvent::GuardBuy {
                    user_id,
                    user: user.to_string(),
                    gift: gift.to_string(),
                },
                &json,
            ));
        }
        "ROOM_BLOCK_MSG" => {
            let user = json
                .pointer("/data/uname")
                .and_then(Value::as_str)
                .unwrap_or("用户");
            events.push(parsed(
                LiveEvent::Block {
                    user: user.to_string(),
                },
                &json,
            ));
        }
        "PK_BATTLE_START" | "PK_BATTLE_START_NEW" => {
            events.push(parsed(
                LiveEvent::Pk {
                    kind: PkEventKind::Start {
                        init_room_id: json
                            .pointer("/data/init_info/room_id")
                            .and_then(Value::as_i64)
                            .unwrap_or(0),
                        match_room_id: json
                            .pointer("/data/match_info/room_id")
                            .and_then(Value::as_i64)
                            .unwrap_or(0),
                    },
                },
                &json,
            ));
        }
        "PK_BATTLE_END" | "PK_BATTLE_SETTLE" | "PK_BATTLE_SETTLE_NEW" => {
            events.push(parsed(
                LiveEvent::Pk {
                    kind: PkEventKind::End,
                },
                &json,
            ));
        }
        "PK_BATTLE_PROCESS" | "PK_BATTLE_PROCESS_NEW" => {
            events.push(parsed(
                LiveEvent::Pk {
                    kind: PkEventKind::Process,
                },
                &json,
            ));
        }
        other if other.starts_with("PK_BATTLE_") => {
            events.push(parsed(
                LiveEvent::Pk {
                    kind: PkEventKind::Other(other.to_string()),
                },
                &json,
            ));
        }
        "POPULARITY_RED_POCKET_NEW" => {
            let user_id = json
                .pointer("/data/uid")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let user = json
                .pointer("/data/uname")
                .or_else(|| json.pointer("/data/user_name"))
                .and_then(Value::as_str)
                .unwrap_or("用户");
            let gift = json
                .pointer("/data/giftName")
                .or_else(|| json.pointer("/data/gift_name"))
                .and_then(Value::as_str)
                .unwrap_or("礼物");
            let price = json
                .pointer("/data/price")
                .or_else(|| json.pointer("/data/gift_price"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            events.push(parsed(
                LiveEvent::RedPocket {
                    kind: RedPocketKind::New {
                        user_id,
                        user: user.to_string(),
                        gift: gift.to_string(),
                        price,
                    },
                },
                &json,
            ));
        }
        "POPULARITY_RED_POCKET_WINNER_LIST" => {
            events.push(parsed(
                LiveEvent::RedPocket {
                    kind: RedPocketKind::WinnerList,
                },
                &json,
            ));
        }
        "RED_POCKET_START" | "POPULARITY_RED_POCKET_START" => {
            events.push(parsed(
                LiveEvent::RedPocket {
                    kind: RedPocketKind::Start,
                },
                &json,
            ));
        }
        other if other.contains("RED_POCKET") => {
            events.push(parsed(
                LiveEvent::RedPocket {
                    kind: RedPocketKind::Other(other.to_string()),
                },
                &json,
            ));
        }
        "ANCHOR_LOT_START" => {
            events.push(parsed(
                LiveEvent::AnchorLottery {
                    kind: AnchorLotteryKind::Start,
                },
                &json,
            ));
        }
        "ANCHOR_LOT_AWARD" => {
            events.push(parsed(
                LiveEvent::AnchorLottery {
                    kind: AnchorLotteryKind::Award,
                },
                &json,
            ));
        }
        "ANCHOR_LOT_END" => {
            events.push(parsed(
                LiveEvent::AnchorLottery {
                    kind: AnchorLotteryKind::End,
                },
                &json,
            ));
        }
        other if other.starts_with("ANCHOR_LOT_") => {
            events.push(parsed(
                LiveEvent::AnchorLottery {
                    kind: AnchorLotteryKind::Other(other.to_string()),
                },
                &json,
            ));
        }
        "WATCHED_CHANGE" => {}
        other => events.push(parsed(
            LiveEvent::Command {
                name: other.to_string(),
            },
            &json,
        )),
    }
    Ok(())
}

fn parsed(event: LiveEvent, raw: &Value) -> ParsedLiveEvent {
    ParsedLiveEvent {
        event,
        raw: raw.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_heartbeat_packet() {
        let packet = build_heartbeat_packet();
        assert_eq!(packet.len(), 16);
        assert_eq!(u32::from_be_bytes(packet[0..4].try_into().unwrap()), 16);
        assert_eq!(
            u32::from_be_bytes(packet[8..12].try_into().unwrap()),
            OP_HEARTBEAT
        );
    }

    #[test]
    fn parses_plain_danmu_event() {
        let body = serde_json::json!({
            "cmd": "DANMU_MSG",
            "info": [[], "hello", [42, "alice"]]
        });
        let raw = build_packet(0, OP_NOTIFICATION, body.to_string().as_bytes());
        let events = parse_events(&raw).unwrap();
        assert_eq!(
            events,
            vec![LiveEvent::Danmu {
                user_id: 42,
                user: "alice".to_string(),
                text: "hello".to_string(),
            }]
        );
    }

    #[test]
    fn parses_danmu_with_raw_payload() {
        let body = serde_json::json!({
            "cmd": "DANMU_MSG",
            "info": [[], "hello", [42, "alice"]]
        });
        let raw = build_packet(0, OP_NOTIFICATION, body.to_string().as_bytes());

        let events = parse_parsed_events(&raw).unwrap();

        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event,
            LiveEvent::Danmu {
                user_id: 42,
                user: "alice".to_string(),
                text: "hello".to_string(),
            }
        );
        assert_eq!(
            events[0].raw.pointer("/cmd").and_then(Value::as_str),
            Some("DANMU_MSG")
        );
        assert_eq!(
            events[0].raw.pointer("/info/1").and_then(Value::as_str),
            Some("hello")
        );
    }

    #[test]
    fn preserves_unknown_command_raw_payload() {
        let body = serde_json::json!({
            "cmd": "NEW_ACTIVITY_EVENT",
            "data": {
                "activity_id": 99
            }
        });
        let raw = build_packet(0, OP_NOTIFICATION, body.to_string().as_bytes());

        let events = parse_parsed_events(&raw).unwrap();

        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event,
            LiveEvent::Command {
                name: "NEW_ACTIVITY_EVENT".to_string(),
            }
        );
        assert_eq!(
            events[0]
                .raw
                .pointer("/data/activity_id")
                .and_then(Value::as_i64),
            Some(99)
        );
    }

    #[test]
    fn exposes_parsed_client_callback_api() {
        let _ = run_parsed_client::<fn(ParsedLiveEvent)>;
    }

    #[test]
    fn parses_pk_start_room_ids() {
        let body = serde_json::json!({
            "cmd": "PK_BATTLE_START_NEW",
            "data": {
                "init_info": { "room_id": 11 },
                "match_info": { "room_id": 22 }
            }
        });
        let raw = build_packet(0, OP_NOTIFICATION, body.to_string().as_bytes());
        let events = parse_events(&raw).unwrap();
        assert_eq!(
            events,
            vec![LiveEvent::Pk {
                kind: PkEventKind::Start {
                    init_room_id: 11,
                    match_room_id: 22,
                },
            }]
        );
    }

    #[test]
    fn parses_heartbeat_popularity() {
        let raw = build_packet(1, OP_HEARTBEAT_REPLY, &1234_i32.to_be_bytes());

        let events = parse_events(&raw).unwrap();

        assert_eq!(events, vec![LiveEvent::Popularity { value: 1234 }]);
    }

    #[test]
    fn parses_red_pocket_new() {
        let body = serde_json::json!({
            "cmd": "POPULARITY_RED_POCKET_NEW",
            "data": {
                "uid": 42,
                "uname": "alice",
                "giftName": "红包",
                "price": 1000
            }
        });
        let raw = build_packet(0, OP_NOTIFICATION, body.to_string().as_bytes());
        let events = parse_events(&raw).unwrap();
        assert_eq!(
            events,
            vec![LiveEvent::RedPocket {
                kind: RedPocketKind::New {
                    user_id: 42,
                    user: "alice".to_string(),
                    gift: "红包".to_string(),
                    price: 1000,
                },
            }]
        );
    }

    #[test]
    fn parses_anchor_lottery_start() {
        let body = serde_json::json!({
            "cmd": "ANCHOR_LOT_START",
            "data": {}
        });
        let raw = build_packet(0, OP_NOTIFICATION, body.to_string().as_bytes());
        let events = parse_events(&raw).unwrap();
        assert_eq!(
            events,
            vec![LiveEvent::AnchorLottery {
                kind: AnchorLotteryKind::Start,
            }]
        );
    }
}
