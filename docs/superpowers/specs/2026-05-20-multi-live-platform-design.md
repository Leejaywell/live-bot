# 2026-05-20 多直播平台核心重构设计

## 1. 背景

Streamix 当前主链路面向 Bilibili 直播间构建。Bilibili 登录、房间解析、直播 WebSocket、事件模型、发送弹幕、存储字段和部分前端命令已经贯穿核心代码。

本次设计目标是把 Streamix 重构为“平台无关直播场控核心 + 平台适配器”。第一期不新增抖音、快手、Twitch 或 YouTube 适配器，而是先完成核心平台化，并把现有 Bilibili 能力迁移为第一个平台适配器。

## 2. 目标

- 核心业务不再直接依赖 `BiliApi`、`bilibili_live_protocol::LiveEvent` 或 Bilibili 房间语义。
- 完整抽象登录、房间管理、事件监听和发送弹幕。
- Bilibili 作为 `LivePlatform` 的第一个实现，现有行为保持可用。
- 存储层支持平台组合键，为后续新增直播平台打基础。
- 前端命令和运行状态带 `platform_id`，但第一期 UI 默认仍使用 Bilibili。

## 3. 非目标

- 不新增具体第二直播平台。
- 不支持同时监听多个平台或多个房间。
- 不重做 OBS 插件 UI。
- 不把所有平台特有事件都提升为通用一等字段。
- 不改动语音、AI、音乐互动的业务策略，除非平台化事件输入要求必要适配。

## 4. 总体架构

新增 `src/live_platform/` 作为直播平台边界：

```text
src/live_platform/
  mod.rs
  types.rs
  auth.rs
  adapter.rs
  registry.rs
  bilibili/
    mod.rs
    api.rs
    protocol.rs
    adapter.rs
```

职责划分：

- `types.rs`：平台 ID、房间引用、用户引用、房间信息、通用事件。
- `auth.rs`：登录挑战、登录轮询、平台 session、凭证状态。
- `adapter.rs`：`LivePlatform` trait。
- `registry.rs`：平台注册表，按 `platform_id` 获取适配器。
- `bilibili/`：封装现有 Bilibili HTTP API、协议 crate 和事件映射。

`crates/bilibili-live-protocol` 继续存在，但只允许 Bilibili 适配器直接依赖。核心业务模块不得直接引用该 crate。

## 5. 平台接口

`LivePlatform` 覆盖完整主链路：

```rust
#[async_trait]
pub trait LivePlatform: Send + Sync {
    fn id(&self) -> PlatformId;

    async fn login_url(&self) -> Result<LoginChallenge, PlatformError>;
    async fn poll_login(&self, challenge_id: &str) -> Result<LoginPoll, PlatformError>;
    async fn validate_session(
        &self,
        session: &PlatformSession,
    ) -> Result<SessionStatus, PlatformError>;

    async fn resolve_room(
        &self,
        input: RoomInput,
        session: Option<&PlatformSession>,
    ) -> Result<LiveRoomInfo, PlatformError>;

    async fn room_info(
        &self,
        room: &PlatformRoomRef,
        session: Option<&PlatformSession>,
    ) -> Result<LiveRoomInfo, PlatformError>;

    async fn connect_events(
        &self,
        room: PlatformRoomRef,
        session: PlatformSession,
        sink: PlatformEventSink,
    ) -> Result<(), PlatformError>;

    async fn send_message(
        &self,
        room: &PlatformRoomRef,
        session: &PlatformSession,
        text: &str,
    ) -> Result<(), PlatformError>;
}
```

平台 session 对核心保持 opaque：

```rust
pub struct PlatformSession {
    pub platform_id: PlatformId,
    pub payload: serde_json::Value,
}
```

核心只负责保存、读取和传递 session。cookie、token、refresh token 等细节由平台适配器解释。

## 6. 通用事件模型

通用事件使用 envelope 承载平台上下文、通用事件和原始载荷：

```rust
pub struct PlatformEventEnvelope {
    pub platform_id: PlatformId,
    pub room: PlatformRoomRef,
    pub event_id: Option<String>,
    pub occurred_at: DateTime<Local>,
    pub event: PlatformEvent,
    pub raw: serde_json::Value,
}
```

事件枚举：

```rust
pub enum PlatformEvent {
    Message(ChatMessageEvent),
    Gift(GiftEvent),
    Follow(FollowEvent),
    Share(ShareEvent),
    Enter(EnterEvent),
    Like(LikeEvent),
    GuardOrMember(GuardOrMemberEvent),
    PaidMessage(PaidMessageEvent),
    Moderation(ModerationEvent),
    Popularity(PopularityEvent),
    Battle(BattleEvent),
    Lottery(LotteryEvent),
    System(SystemEvent),
    Unknown(UnknownEvent),
}
```

用户和房间引用统一使用字符串平台键：

```rust
pub struct PlatformUserRef {
    pub platform_id: PlatformId,
    pub platform_user_id: String,
    pub display_name: String,
}

pub struct PlatformRoomRef {
    pub platform_id: PlatformId,
    pub platform_room_id: String,
    pub display_id: Option<String>,
}
```

事件语义以核心业务需要为准。平台特有字段先放入 `raw` 或 `metadata`，只有多个平台都稳定需要时再提升为一等字段。

## 7. Bilibili 事件映射

现有 Bilibili 事件迁移到通用事件：

- `Danmu` -> `Message`
- `Gift` -> `Gift`
- `Interact::Entry` -> `Enter`
- `Interact::Follow` / `Interact::MutualFollow` -> `Follow`
- `Interact::Share` -> `Share`
- `LikeClick` -> `Like`
- `GuardBuy` -> `GuardOrMember`
- `SuperChat` -> `PaidMessage`
- `Block` -> `Moderation`
- `Popularity` -> `Popularity`
- `Pk` -> `Battle`
- `RedPocket` / `AnchorLottery` -> `Lottery`
- `Command` 和不能识别的命令 -> `Unknown` 或 `System`

Bilibili 数字 `room_id` 和 `uid` 转为字符串平台键：

- `platform_id = "bilibili"`
- `platform_room_id = room_id.to_string()`
- `platform_user_id = uid.to_string()`

## 8. 核心模块改造

### 8.1 Monitor

`monitor.rs` 不再接收 `BiliApi + room_id`，改为接收：

- `PlatformRegistry`
- `PlatformId`
- `PlatformRoomRef`
- `PlatformSession`

监听循环调用 `LivePlatform::connect_events`，接收 `PlatformEventEnvelope` 后继续分发给存储、规则引擎、音乐互动、插件广播、AI/TTS。

监听日志必须包含平台和房间，例如：

```text
[bilibili:123456] websocket closed
```

### 8.2 BotEngine

`BotEngine` 改为处理 `PlatformEvent`。欢迎、关注、分享、礼物答谢、SC、PK 等规则读取通用事件字段。Bilibili 特有规则如确实需要平台字段，只能通过 `platform_id` 分支和 `raw` 访问。

### 8.3 Storage

存储层平台化字段：

- `live_sessions` 增加 `platform_id text not null default 'bilibili'`、`platform_room_id text`。
- `interaction_records` 增加 `platform_id`、`platform_room_id`、`platform_user_id`、`event_kind`、`event_action`。
- `tracked_users` 和 `user_profiles` 业务唯一键改为 `(platform_id, platform_user_id)`。

旧字段保留一版：

- `room_id`
- `uid`

新代码写入新字段和 Bilibili 兼容字段。读路径优先使用新字段，必要时 fallback 到旧字段。旧库升级时，Bilibili 数据补齐：

- `platform_id = 'bilibili'`
- `platform_room_id = room_id`
- `platform_user_id = uid`

### 8.4 插件 HTTP 服务

插件查询增加平台过滤，默认使用当前连接的平台和房间。第一期 OBS 页面不暴露平台选择，也不重做 UI。

插件广播事件从 `PlatformEventEnvelope` 派生。现有浏览器源需要的字段继续保持兼容，新增平台字段可作为附加字段输出。

### 8.5 前端命令

Tauri command 改为平台化：

```text
list_live_platforms()
get_platform_session_status(platform_id)
create_platform_login_challenge(platform_id)
poll_platform_login(platform_id, challenge_id)
resolve_platform_room(platform_id, room_input)
connect_platform_room(platform_id, room_ref)
disconnect_platform_room()
send_platform_message(platform_id, room_ref, text)
```

前端主状态增加 `platform_id`。第一期默认平台为 Bilibili。文案可以继续使用“直播间”，但只有平台特定登录提示和错误提示才写“Bilibili”。

## 9. 错误模型

统一平台错误类型：

```rust
pub enum PlatformErrorKind {
    UnsupportedFeature,
    AuthRequired,
    AuthExpired,
    RoomNotFound,
    RoomNotLive,
    RateLimited,
    Network,
    ProtocolChanged,
    InvalidInput,
    Internal,
}
```

错误对象包含：

- `platform_id`
- `operation`
- `kind`
- `message`
- `source_detail`

策略：

- 单条事件解析失败不终止监听，记录 raw 和错误。
- 连接级失败才触发重连或停止监听。
- 平台不支持发送消息时返回 `UnsupportedFeature`，UI 禁用入口或展示明确提示。
- 登录过期返回 `AuthExpired`，由 UI 引导重新登录。

## 10. 运行流程

```text
前端选择 platform_id
  -> 查询平台登录状态
  -> 未登录则创建 LoginChallenge
  -> poll_login 保存 PlatformSession
  -> resolve_room(platform_id, room_input)
  -> connect_platform_room(platform_id, room_ref)
  -> PlatformRuntime.connect_events()
  -> PlatformEventEnvelope
  -> Storage / BotEngine / MusicInteraction / Plugin Broadcast / TTS
```

第一期仍保持全局单房间单平台监听。

## 11. 验证计划

### 11.1 类型边界

核心模块不再直接引用：

- `BiliApi`
- `bilibili_live_protocol::LiveEvent`

允许 Bilibili 适配器内部引用。

### 11.2 Bilibili 映射测试

补充单元测试覆盖：

- 弹幕
- 礼物
- 进场
- 关注
- 分享
- 点赞
- 上舰
- SC
- PK
- 红包
- 天选
- 未知事件

### 11.3 存储迁移测试

验证：

- 新库能创建平台化字段。
- 旧库升级后自动补齐 Bilibili 平台字段。
- 统计、用户画像、最近礼物、礼物排行、点歌查询仍能读到旧 Bilibili 数据。

### 11.4 链路回归

保留现有 Bilibili 路径：

```text
登录 -> 解析房间 -> 开始监听 -> 收事件 -> 写存储 -> 规则处理 -> 插件广播 -> 发送弹幕
```

该路径必须在新平台接口下通过。

### 11.5 检查命令

至少运行：

```bash
cargo test
cargo check --features tauri
cd src-tauri && npm run build
```

如果语音依赖或本机环境导致命令失败，需要记录具体原因，并说明是否与平台重构相关。

## 12. 完成标准

- `LivePlatform`、平台注册表和通用事件模型落地。
- Bilibili 能力迁移到 `BilibiliPlatform`。
- 核心业务依赖平台抽象，不直接依赖 Bilibili API 或协议事件。
- Bilibili 现有登录、房间连接、监听、发送弹幕、规则、存储和插件展示保持可用。
- 数据库新旧字段兼容，旧 Bilibili 数据可继续读取。
- 前端命令和状态平台化，默认平台为 Bilibili。
- 验证计划中的测试和构建命令完成，或明确记录环境性失败。
