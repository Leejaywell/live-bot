# Live Bot (Bilibili Danmu Robot RS)

**Live Bot** 是一款基于 Rust 开发的高性能 Bilibili 直播间互动助手。它通过 WebSocket 实时监听直播间事件（弹幕、礼物、关注等），支持自动回复、AI 智能对话、数据统计及持久化存储，旨在提升主播的互动效率与直播间氛围。

## 核心特性

- **高性能后端**：采用 Rust + Tokio 异步框架，极速响应万级弹幕压力。
- **现代化 UI**：基于 Tauri 2.0 框架，提供流畅、美观的桌面操作体验。
- **全事件解析**：深度解析弹幕、礼物、进场、关注、分享、大航海、PK、红包等 B 站直播全类事件。
- **自动化运营**：支持自动欢迎、礼物答谢、关键词回复、Cron 定时弹幕、签到抽签等功能。
- **AI 智能交互**：集成 ChatGPT 兼容接口，实现直播间自动闲聊与答疑。
- **数据持久化**：使用 SQLite 存储直播场次、互动记录及统计数据，支持本场数据概览。
- **协议解耦**：核心协议解析独立为 `bilibili-live-protocol` 包，易于维护与扩展。

## 快速开始

### 准备环境
确保你的电脑已安装 [Rust](https://www.rust-lang.org/) 环境。

### 运行程序
```bash
cargo run
```

*首次启动后，程序会自动创建以下目录及配置文件：*
- `etc/bilidanmaku-api.yaml`：应用配置文件。
- `token/`：存储登录后的 B 站身份凭证。
- `logs/`：程序运行日志。
- `db/`：SQLite 数据库文件。

### 开发与构建
```bash
# 检查代码格式与类型
cargo fmt --check
cargo check --workspace

# 运行测试
cargo test --workspace

# 编译发布版本
cargo build --release
```

## 项目结构

- `src/main.rs`：Tauri 应用入口与指令分发。
- `src-tauri/`：前端 UI 资源（基于 React/TypeScript 的现代化界面）。
- `src/api.rs`：B 站 HTTP API 封装（登录、发送弹幕、房间管理）。
- `src/bot/`：机器人逻辑核心，包括事件监听流、规则引擎与发送队列。
- `src/storage/`：SQLite 数据库 Schema 与数据访问层。
- `src/config.rs`：基于 YAML 的配置管理系统。
- `crates/bilibili-live-protocol`：独立的 B 站直播 WebSocket 协议解析库。

## 路线图 (Roadmap)

我们对项目的未来有着清晰的规划，详细内容请参阅 [Roadmap.md](./docs/roadmap.md)：

1.  **V1: 数据循环与稳定** (当前阶段) - 完善事件保存、场次统计与基础互动。
2.  **V2: 智能交互与深度娱乐** - 引入本地 LLM (Ollama)、上下文感知交互及 OBS 互动悬浮窗。
3.  **V3: 生态建设与扩展性** - 插件系统、Webhook 联动及移动端控制面板。
4.  **V4: 多平台支持** - 构建平台抽象层 (PAL)，支持抖音、虎牙、斗鱼等平台。
5.  **V5: 智能 Agent 进化** - 进化为具备 ASR/TTS 语音交互及限定电脑控制能力的 AI 直播助手。

## 贡献与参考

- 本项目重写并优化了 `xbclub/BilibiliDanmuRobot` 的核心功能。
- 技术方案选型参考请查阅 [Technical Solutions](./docs/technical_solutions.md)。

---
*Live Bot - 让每一场直播都充满智慧与惊喜。*
