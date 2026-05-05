# Roadmap

This project is a Bilibili-focused live-room interaction assistant. The next stage prioritizes a reliable event and data loop before adding broader UI, AI, room-management, or multi-platform capabilities.

## Current Direction

The product is not being planned as a multi-platform live-operations platform in the next stage. It should first become a dependable single-room Bilibili assistant that can observe live events, respond with configured danmu behavior, and persist enough local facts to support session summaries and user lookup.

## Confirmed Decisions

- The next stage focuses on event and data loop work before UI expansion.
- A live session is one continuous period from a Bilibili room going live until that room goes offline.
- App restart, monitor stop, or websocket reconnect does not create a new live session if the room is still live.
- Interaction records keep both stable normalized fields and the original Bilibili event payload.
- The protocol crate should expose a wrapper such as `ParsedLiveEvent { event, raw }` so existing rules can keep using normalized `LiveEvent` values.
- Notification-style live events should be persisted, including unknown commands.
- Protocol heartbeats, connection logs, and handshake traffic are not interaction records.
- The first storage shape uses one `interaction_records` table rather than one table per event type.
- `live_sessions` stores session metadata such as room ID, start/end time, and whether the times were official or observed.
- The first implementation keeps synchronous SQLite writes through explicit `Storage` entry points.
- Interaction record write failure is logged but does not stop existing interaction rules.
- The existing danmu count table remains in parallel until interaction records are proven stable.

## Next Milestone: Event And Data Loop

### Goal

Persist live-room interaction facts in a way that can support session summaries, user detail views, later analysis, and future reprocessing when Bilibili fields change.

### Scope

1. Add `ParsedLiveEvent`.
   - The protocol crate should preserve raw notification JSON alongside the existing normalized event.
   - Existing rule handling should continue to use `LiveEvent`.

2. Add live session storage.
   - Create or resume a live session when a room is observed as live.
   - End the session when the room is observed as offline.
   - First version may use observed start time when an official Bilibili start time is unavailable.

3. Add interaction record storage.
   - Store `session_id`, `room_id`, `event_type`, optional command name, optional user fields, event timestamp, common type-specific fields, and raw JSON.
   - Persist unknown notification commands as records with raw JSON.

4. Add minimal query coverage.
   - Danmu count for a live session.
   - Gift value for a live session.
   - User cumulative danmu count from interaction records.
   - Unknown command persistence.

5. Wire recording into the monitor loop.
   - Record events before or alongside rule handling.
   - Log record failures and continue rule handling.
   - Keep startup failing if SQLite cannot open.

### Out Of Scope

- Replacing the existing danmu count command with interaction-record aggregation.
- Full dashboard UI for session summaries.
- AI user profiles and natural-language SQLite queries.
- Multi-platform abstractions for Douyin, Huya, Douyu, or other platforms.
- Recording, screenshots, OBS sources, point-song tools, or plugin systems.
- Broad room-management operations such as changing title, category, cover, or moderators.

## Later Milestones

### Session And User Views

Use interaction records to show a live session summary and user detail lookup. This should come after the write path and query tests are stable.

### Configuration UI Cleanup

Replace multiline text editing for repeated config lists with table-style editors, but only after the data loop is stable enough that UI work has a clear model to display.

### Advanced Analysis

Add AI classification, fan profiles, natural-language queries, and stream advice only after interaction records have enough history to make those features meaningful.

### Expansion Decisions

Room management, point-song, OBS pages, recording, and multi-platform support are separate product expansions. Each should be planned as its own milestone instead of being mixed into the event data loop.

## V2: 智能交互与深度娱乐 (Advanced Interaction & Intelligence)

当底层数据循环稳定后，我们将引入更高级的交互功能，使机器人从“自动回复工具”进化为“直播间虚拟助手”。

### 1. 智能 AI 增强
- **本地 LLM 支持**：集成 Ollama/LocalAI，支持本地运行大模型，保护隐私且零调用成本。
- **上下文感知交互**：AI 机器人将感知直播间实时状态（如：在线人数波动、当前游戏进度、PK 胜负）进行主动发言。
- **情感分析系统**：分析弹幕整体情绪，动态调整回复策略。
- **会后 AI 总结**：每场直播结束后，自动生成“直播高光报告”，总结最活跃用户、最热门话题和情感趋势。

### 2. 趣味互动娱乐
- **弹幕互动小游戏**：内置猜谜、文字 RPG 或弹幕抽奖小游戏，提升观众参与度。
- **OBS 互动悬浮窗**：通过 Web 层，将实时排行榜、欢迎特效或即时事件直接显示在直播画面上。
- **积分与成就系统**：基于互动记录，为观众建立“亲密度”积分，解锁特殊头衔或自动欢迎语。

## V3: 生态建设与扩展性 (Ecosystem & Extensibility)

使机器人具备更强的开放性，能够与更多工具和平台联动。

### 1. 开放性与插件化
- **插件系统**：支持通过 Lua 或 JavaScript 编写自定义插件，定制复杂的互动逻辑。
- **Webhook 联动**：将直播间事件（如：大额打赏、首位关注）实时推送到 Discord、飞书或钉钉群。

### 2. 多端与多账号运营
- **多账号并行**：支持同时登录多个机器人账号，在不同的频道分担职责。
- **移动端控制面板**：开发轻量级的 Web 页面，让主播在手机上也能远程控制机器人的开关和设置。

### 3. 直播间自动化运营
- **定时广播增强**：支持更复杂的定时任务，如在固定时间点自动发起抽奖。
- **智能场控助手**：自动识别并禁言刷屏、引战等违规言论，支持更强大的正则过滤和 AI 识别。

## V4: 多平台支持与架构重构 (Multi-Platform Support & Refactoring)

为了使机器人能够服务于更多直播平台（如：抖音、虎牙、斗鱼），我们需要从“Bilibili 专用”转向“通用直播机器人架构”。这涉及到后端与界面的深度重构。

### 1. 后端架构：平台抽象层 (Protocol Abstraction Layer)
- **事件标准化**：定义一套通用的 `GenericLiveEvent` 类型（弹幕、礼物、关注、进入），将各平台私有的协议数据映射到此标准格式。
- **Provider 模式**：引入插件式 Provider 机制，每个平台作为一个独立的 Provider 实现（例如 `BilibiliProvider`, `DouyinProvider`）。
- **统一 API 接口**：重构 `src/api.rs`，提供通用的发送弹幕、获取房间信息、用户管理等抽象方法，解除业务逻辑与特定平台 API 的耦合。

### 2. UI 重构：多房间与多模型
- **平合感知的 UI 渲染**：界面需要根据当前连接的平台动态调整显示内容（如：不同平台的礼物等级图标、牌子名称）。
- **多房间并发管理**：重构仪表盘，支持同时监控和管理多个不同平台的直播间。
- **通用设置模型**：将自动回复、关键词等设置抽象为“平台无关”的规则引擎，一套配置可复用到多个平台。

### 3. 数据层：多平台索引
- **统一存储模型**：在 `interaction_records` 中增加 `platform` 字段，支持跨平台的全局数据统计与用户画像分析。

## V5: 智能 Agent 进化 (AI Agent Evolution)

在此阶段，机器人将从“消息处理器”进化为具备感知、思考和行动能力的“虚拟直播助手 (AI Agent)”，能够通过语音与主播实时交流，并根据指令执行限定的电脑操作。

### 1. 实时语音交互系统 (Voice Interaction)
- **多模态感知 (ASR)**：
    *   集成高精度、低延迟的语音识别（如：OpenAI Whisper 实时流、FunASR）。
    *   **主播语音监听**：机器人能够实时监听主播的麦克风输入，识别主播对机器人的指令或谈话内容。
- **情感表达 (TTS)**：
    *   集成个性化语音合成（如：VITS, GPT-SoVITS, Bert-VITS2），支持多种情感音色切换。
    *   **低延迟对话流**：通过流式传输技术，实现 AI 思考与语音合成的并行，降低对话响应感。

### 2. 限定电脑控制 (Restricted Computer Use)
- **操作抽象层**：定义一套安全、可控的指令集（Function Calling），AI Agent 仅能执行被显式授权的操作。
- **场景化控制**：
    *   **直播软件控制**：与 OBS 联动，通过 AI 指令实现切换场景、开启/关闭录制、调整音量、显示/隐藏特定图层。
    *   **多媒体协作**：控制网易云音乐/QQ音乐等播放器进行切歌、音量调节。
    *   **应用启动与管理**：在白名单范围内启动特定游戏或辅助工具。
- **安全沙箱**：
    *   所有系统级操作（如 shell 执行）必须经过严格的白名单过滤和权限校验，防止 AI 误操作或被恶意指令利用。

### 3. Agent 决策与自主意识
- **长期记忆 (Long-term Memory)**：利用向量数据库（如：Qdrant, Milvus）存储主播的喜好、往期直播的重要事件，使 Agent 具备持续成长的“个性”。
- **任务规划 (Reasoning & Planning)**：当主播下达复杂指令（如：“帮我准备下场游戏的抽奖，然后切换到战斗场景”）时，Agent 能自动拆解步骤并分步执行。
- **主动触发逻辑**：不限于被动响应，Agent 可根据直播间热度、弹幕节奏主动向主播提议操作（如：“现在人气很高，要不要来一波抽奖？”）。

## Verification

Required checks for implementation work:

```bash
cargo fmt --check
cargo check --workspace
cargo test --workspace
```

Narrow tests should be added for protocol parsing, storage migrations, interaction record writes, session lifecycle behavior, and the minimal query functions before relying on manual smoke tests.
