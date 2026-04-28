# Bilibili Danmu Robot RS

Rust + Slint rewrite of `xbclub/BilibiliDanmuRobot`.

## Current Scope

Implemented:

- Slint desktop UI.
- YAML config compatible with the original `etc/bilidanmaku-api.yaml` field names.
- Bilibili QR login URL generation and polling.
- Token persistence in `token/bili_token.txt` and `token/bili_token.json`.
- Login status check.
- Room live status polling through `room_init`.
- Live danmu websocket connection and packet parsing for danmu, gift and entry events.
- Manual danmu sending through `msg/send`.
- Start/stop monitor loop and UI log output.
- Runtime cancellation for room polling, websocket and send queue.
- Automatic welcome, keyword reply, focus/share/gift thanks, draw-by-lot and sign-in rules.
- QingYunKe and ChatGPT-compatible AI robot replies.
- Timed barrage cron dispatch.
- Slint text editors for common list configs.
- SQLite-backed sign-in persistence.
- Delayed gift aggregation and blind-box profit/loss persistence/summaries.
- Danmu count tracking and `查询弹幕` response.
- Auto-update metadata check with changelog/link display.

Still in progress:

- Full PK opponent details, red-pocket and anchor-lottery parity.
- Auto-update download/apply flow.
- Rich table-style UI editors; current list editors use multiline text formats.

## Run

```bash
cargo run
```

On first launch the app creates:

- `etc/bilidanmaku-api.yaml`
- `token/`
- `logs/`

## Build

```bash
cargo build --release
```

## Source Mapping

The original repository is mostly a Wails shell around `BilibiliDanmuRobot-Core`.
This rewrite maps the core surfaces into Rust modules:

- `src/config.rs`: original `config.Config` YAML shape.
- `src/api.rs`: original HTTP login, room, user and send-danmu calls.
- `src/token.rs`: original `token/bili_token.*` persistence.
- `ui/main.slint`: replacement for Wails/Vue UI.
- `crates/bilibili-live-protocol`: reusable Bilibili live websocket protocol package.

The rewrite now covers the original core behavior in Rust: websocket packet
parsing, runtime cancellation, send queue, welcome dispatch, thanks dispatch,
AI replies, timed barrage, SQLite statistics, activity notices and update
metadata/download flow.
