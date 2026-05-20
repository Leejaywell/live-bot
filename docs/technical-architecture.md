# 流光技术架构文档

更新日期：2026-05-20

## 1. 总体架构

```text
Tauri Desktop
  ├─ React UI（src-tauri/src/app）
  ├─ OBS/浏览器源前端（src-tauri/src/danmaku-chat）
  └─ Rust Core（src）
       ├─ Bilibili API / WebSocket
       ├─ BotEngine 规则处理
       ├─ MusicInteractionService
       ├─ AgentRuntime / AI Provider
       ├─ Voice crate（ASR / TTS / VAD / RVC）
       ├─ Plugin HTTP Server
       └─ SQLite Storage
```

流光采用桌面应用内嵌前端的结构。React 负责主工作台和插件配置，Rust 负责协议、事件处理、存储、AI/语音编排、Tauri command 和本地 HTTP 服务。

## 2. 主要模块

### 2.1 Rust 主程序

- `src/main.rs`：Tauri 入口、命令注册、应用生命周期、自动更新、模型下载、插件服务启动。
- `src/api.rs`：Bilibili HTTP API，包括登录、房间、发送弹幕、直播间管理。
- `src/config.rs`：主配置 `streamix.toml`，保存自动化、AI、语音、OBS、过滤、欢迎语等设置。
- `src/token.rs`：登录态和已连接房间持久化。

### 2.2 直播协议与事件

- `crates/bilibili-live-protocol`：Bilibili 直播事件解析。
- `src/bot/monitor.rs`：监听循环、WebSocket 连接、房间状态轮询、事件分发、TTS/OBS/音乐互动接入。
- `src/bot/engine.rs`：规则处理，包括欢迎、答谢、过滤、PK 和活动提示。

协议边界保留规范化事件和原始事件 JSON。规范化事件用于业务规则，原始 JSON 用于统计、插件扩展和后续补充解析。

### 2.3 数据存储

- `src/storage/mod.rs`：SQLite 存储层。
- 主表包括 `interaction_records`、`tracked_users`、用户画像、礼物目录、PK/统计相关数据。
- 音乐互动表由 `src/music/storage.rs` 管理，包括 `song_requests`、`song_request_credits`、`song_search_contexts`、`song_request_stats_daily`、`song_blocklist`。

数据目录由 `config::db_path()` 决定：

- macOS：`~/Library/Application Support/com.streamix.app/streamix.db`
- Windows：`%APPDATA%/com.streamix.app/streamix.db`
- Linux：`~/.local/share/com.streamix.app/streamix.db`

### 2.4 AI 与 Agent

- `src/ai_client.rs`：OpenAI-compatible 请求封装。
- `src/bot/agent/runtime.rs`：AgentRuntime，负责工具调用循环和 Provider 执行。
- `src/bot/agent/tools.rs`：内置工具集合。
- `src/bot/memory.rs`：按 bot 隔离的会话记忆。

直播 AI 回复路径与 AI 页面测试路径不同：直播路径走 AgentRuntime 和会话记忆；AI 页面测试命令主要用于快速验证 Provider 和 Bot 配置。

### 2.5 语音系统

- `crates/voice`：语音能力 crate。
- `tts/`：Edge、Azure、MiniMax、火山、本地 TTS 等实现。
- `asr/`：SenseVoice、Sherpa、WhisperLive 等识别路径。
- `audio/`：输入、输出、混音、降噪和延迟处理。
- `session/`：语音会话路由、中断和播放状态。
- `voice_changer/`：RVC 变声器 worker 和 Python 辅助脚本。

`SpeakerRouter` 是播报中心，按不同来源组织播放优先级。TTS 播放期间会关闭麦克风采集并延迟恢复，避免 TTS 回声被 ASR 当成主播输入。

### 2.6 插件 HTTP 服务

- `src/danmaku_chat_server.rs` 启动本地 HTTP 服务，默认端口来自 `plugin-settings.toml` 的弹幕聊天配置。
- 页面入口包括 `/danmaku-chat`、`/wish-goal`、`/lottery`、`/gift-effect`、`/recent-gifts`、`/gift-rank`、`/song-request`。
- JSON 接口提供插件配置、最近事件、礼物目录、礼物数据、点歌队列、当前播放和排行。
- WebSocket 广播直播事件给浏览器源页面。

### 2.7 前端结构

- `src-tauri/src/app/App.tsx`：主应用、路由、登录弹窗、房间恢复、通知中心。
- `src-tauri/src/app/pages/*`：主工作台页面。
- `src-tauri/src/app/components/*`：通用 UI 组件、侧栏、顶栏、设置和主题。
- `src-tauri/src/danmaku-chat/*`：OBS 浏览器源运行时和插件视图。

## 3. 配置文件

- 主配置：`streamix.toml`
- 插件配置：`plugin-settings.toml`
- 登录态：token/session 文件，由 `token.rs` 管理。

配置路径由系统标准目录决定，开发时不应依赖仓库内的 `etc/`、`db/`、`token/` 作为真实发布数据。

## 4. 运行时流程

1. 启动 Tauri，加载配置和 SQLite。
2. 启动插件 HTTP 服务、自动更新检查、数据库清理和礼物目录刷新循环。
3. 前端检查登录态，必要时打开二维码登录。
4. 用户连接房间并启动监听。
5. 直播事件进入 monitor，依次记录、更新插件状态、规则处理、音乐互动、AI/TTS。
6. 前端通过 Tauri event、command 和本地 HTTP 接口获取状态。

## 5. 技术约束

- Bilibili 登录态、直播 API 和 WebSocket 可能变化，需要在协议层隔离。
- 本地语音模型下载和推理受平台、CPU/GPU、ONNX Runtime、sherpa 版本影响。
- OBS 浏览器源必须保持本地 HTTP 可访问，端口冲突需要在配置层处理。
- 自动更新发布资源位于公开仓库，源码仓库和发布仓库职责分离。
