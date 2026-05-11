# Streamix (原 Live Bot)

**Streamix** 是一款基于 Rust + Tauri 开发的高性能 Bilibili 直播间智能场控与互动助手。它通过 WebSocket 实时监听直播间全量事件，不仅提供自动欢迎、礼物答谢等基础自动化功能，更在演进为具备“对话逻辑”、“语音感官”与“长期记忆”的 AI 智能场控 Agent。

## ✨ 核心特性

全新的桌面端采用 Tauri 构建，提供美观的 Liquid Glass 玻璃态 UI，功能涵盖 8 大模块：

- 📊 **数据仪表盘**：实时监控直播间核心指标（本场弹幕、进场、关注、礼物价值、大航海、人气峰值），一键启停各项自动化开关，并提供实时日志视图。
- 🔐 **登录与房间**：支持安全的二维码扫码登录与 Cookie 本地持久化，实时查看主播房间状态。
- 📡 **监听与发送**：毫秒级全事件流展示（弹幕、礼物、红包、天选、上舰等），支持带预设快捷语的弹幕发送。
- ⚙️ **自动回复规则**：
  - **关键词回复**：支持正则与模糊匹配。
  - **分时段欢迎语**：早中晚不同时段触发不同欢迎文案。
  - **礼物答谢**：支持礼物聚合与模板自定义。
  - **严格黑名单**：UID 与正则双重拦截，保障直播间安全。
- 🤖 **AI 场控 (AI Agent)**：
  - **对话逻辑**：支持 OpenAI / DeepSeek / 本地 Ollama 接入，自定义 System Prompt 与触发指令。
  - **语音感官**：集成 ASR (如 Faster-Whisper/FunASR) 语音监听与 TTS (如 Bert-VITS2/ChatTTS) 语音播报，实现听写说的闭环交互。
  - **记忆中心**（敬请期待）：构建基于向量数据库的用户画像与长期记忆。
- 📈 **数据统计**：可视化展示本场/今日/近7天的弹幕趋势图表与礼物价值环形图。
- ⚔️ **PK 与活动**：独立面板监控 PK 实时比分、历史战绩战报，以及当前直播间的红包、天选时刻等互动活动。
- 🔧 **系统与更新**：内置在线版本检查与热更新，支持配置/数据库的一键备份与导出，内置浅色/深色及多套主色调的主题引擎。

## 🚀 快速开始

### 1. 准备环境
确保你的电脑已安装 [Rust](https://www.rust-lang.org/) 与 [Node.js](https://nodejs.org/) (推荐使用 pnpm)。

### 2. 初始化与运行
```bash
# 安装前端依赖
cd src-tauri
npm install
cd ..

# 启动开发模式 (包含 Tauri 桌面端)
cargo run --features tauri
```

*首次启动后，程序会自动创建以下目录及配置文件：*
- `etc/bilidanmaku-api.yaml`：应用核心配置文件。
- `token/`：存储登录后的 B 站身份凭证 (Cookie/Refresh Token)。
- `logs/`：程序运行追踪日志。
- `db/`：SQLite 数据库文件，用于持久化互动记录。

### 3. 构建发布版本
```bash
cargo build --release --features tauri
```

## 🏗 项目架构

- `src-tauri/`：Tauri 配置文件与 React/TypeScript 前端界面。
- `src/main.rs`：Tauri 应用入口与指令分发 (Commands)。
- `src/api.rs`：B 站 HTTP API 封装（登录、刷新 Token、发送弹幕、查询信息）。
- `src/bot/`：场控逻辑核心，包括事件调度引擎 (`engine.rs`) 与连接监听 (`monitor.rs`)。
- `src/storage/`：基于 SQLite 的存储层，负责持久化事件事实 (`interaction_records`) 与场次数据。
- `crates/bilibili-live-protocol`：纯 Rust 实现的 B 站直播 WebSocket 协议解析底座。

## 🗺 路线图 (Roadmap)

我们正处于从“自动化工具”向“智能 Agent”跨越的关键阶段。详细规划请参阅 [Roadmap.md](./docs/roadmap.md)。

- [x] **V1: 现代化重构与数据基座** (当前阶段) - 迁移至 Tauri 架构，确立基于宽表 `interaction_records` 的数据循环体系。
- [ ] **V2: AI 场控与感官唤醒** - 在 AI 场控面板中实装云端/本地大模型接入，并打通 ASR+TTS 语音交互链路。
- [ ] **V3: 记忆与自动化运营** - 引入 RAG 技术构建主播百科，AI 根据直播间热度主动建议抽奖、PK 操作。
- [ ] **V4: 跨平台协议抽象** - 剥离特定平台逻辑，支持通过插件接入抖音、虎牙等平台。
- [ ] **V5: 终极智能 Agent** - 实现安全的限定电脑控制 (Computer Use)，AI 自动联动 OBS 场景与音乐播放器。

## 🙏 参考与鸣谢 (Acknowledgements)

本项目的开发深受以下开源项目的影响与启发，在此表示衷心的感谢：

- **[BilibiliDanmuRobot](https://github.com/xbclub/BilibiliDanmuRobot)** (xbclub): 本项目的核心功能逻辑、规则设计以及配置项命名深度参考了该项目，是本项目最重要的灵感来源。
- **[bilibili_live](https://github.com/k-si/bilibili_live)** (k-si): 作为 `BilibiliDanmuRobot` 的底层底座，为 B 站直播协议的理解提供了宝贵参考。
- **[RealtimeAPI](https://github.com/SquadyAI/RealtimeAPI)** (SquadyAI): 其低延迟的 AI 编排（ASR-LLM-TTS）架构思想，指引了本项目 AI 场控模块的演进方向。
- **[BiliBIli-Live-Protocol](https://github.com/Sora-Neko/BiliBIli-Live-Protocol)**: 为本项目协议解析部分的实现提供了重要思路。

---
*Streamix - 让每一场直播都充满智慧与惊喜。*
