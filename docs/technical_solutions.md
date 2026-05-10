# 技术解决方案文档 (Technical Solutions)

本文件针对 `Roadmap.md` 中规划的各大功能模块，提供至少两种不同的技术实现方案，以便在开发过程中根据资源、性能和成本进行权衡选择。

---

## 1. 多平台抽象层 (Multi-Platform Abstraction)

### 方案 A：静态 Trait 抽象 (Rust Native)
利用 Rust 的 `Trait` 定义统一的平台行为。
- **技术栈**：Rust Traits, Dynamic Dispatch (`box dyn Provider`).
- **原理**：定义 `LiveProvider` Trait，包含 `connect()`, `send_message()`, `on_event()` 等方法。为每个平台实现该 Trait。
- **优点**：性能极高，类型安全，代码结构清晰。
- **缺点**：新增平台需要重新编译主程序；动态加载较难实现。

### 方案 B：中继事件总线 (Event-Bus Middleware)
基于消息队列或事件总线进行解耦。
- **技术栈**：Tokio mpsc/broadcast, JSON Standard.
- **原理**：将各平台事件统一序列化为标准 JSON 格式的“通用事件”，通过中央调度器（Event Bus）分发。
- **优点**：各平台 Provider 可以作为独立进程运行（甚至可以用不同语言编写），支持热插拔。
- **缺点**：序列化/反序列化开销略大，维护多套协议映射的成本较高。

---

## 2. 智能 AI 场控 (AI Agent & LLM)

### 方案 A：云端集成方案 (Cloud-First Agent)
- **技术栈**：OpenAI/Claude API (LLM) + Azure Speech (ASR/TTS).
- **原理**：大脑与感官均托管于云端。
- **优点**：逻辑极强，配置简单，响应稳定。
- **缺点**：按量计费成本高，依赖网络稳定性。

### 方案 B：本地化 Agent 方案 (Local-First Agent)
- **技术栈**：Ollama/candle (LLM) + Faster-Whisper (ASR) + Bert-VITS2 (TTS).
- **原理**：利用本地显卡（NVIDIA GPU）进行全流程推理，通过统一的 Agent 状态机调度。
- **优点**：零 Token 成本，极致隐私保护，支持深度定制音色（克隆主播声音）。
- **缺点**：对硬件有要求，初次部署复杂度较高。

---

## 3. 语音交互系统 (ASR & TTS)

### 3.1 语音识别 (ASR)
- **方案 A (高性能模式)**：Faster-Whisper (C++ 优化版)。适合实时弹幕监听和主播语音指令识别。
- **方案 B (中文增强模式)**：阿里 FunASR。针对中文口语和直播黑话有更强的识别修正。

### 3.2 语音合成 (TTS)
- **方案 A (情感驱动模式)**：Bert-VITS2。目前虚拟主播主流选型，音色情感极其丰富。
- **方案 B (自然口语模式)**：ChatTTS。适合长文本播报，具备自然的停顿、笑声等口语特征。

---

## 4. 插件与扩展系统 (Extensibility)

### 方案 A：内嵌脚本引擎 (Embedded Scripting)
- **技术栈**：Rhai (Rust Native), Lua (mlua), WASM.
- **原理**：在程序中集成 Rhai 或 Lua 引擎，用户编写 `.rhai` 或 `.lua` 脚本实现自定义回复逻辑。
- **优点**：脚本运行极快，与 Rust 交互方便，安全性好（特别是 WASM）。
- **缺点**：用户需要学习特定的脚本语法。

### 方案 B：Webhook + 微服务 (Micro-kernel)
- **技术栈**：HTTP/gRPC, Webhooks.
- **原理**：当事件发生时，程序向外部配置的 URL 发送 HTTP POST 请求，由外部服务处理并返回响应。
- **优点**：不限制编程语言，用户可以用 Python, Node.js 等快速开发。
- **缺点**：需要用户自行维护服务器/环境，响应延迟略高。

---

## 5. 限定电脑控制 (Computer Use)

### 方案 A：OBS WebSocket 联动 (Specific Protocol)
- **技术栈**：obs-websocket-rs.
- **原理**：通过专门的 WebSocket 协议与 OBS 进行二进制通信。
- **优点**：极其稳定，功能覆盖全面（切场、开关源、特效）。
- **缺点**：仅限于控制直播软件，无法扩展到通用系统操作。

### 方案 B：系统级命令执行 (Shell/API Bridge)
- **技术栈**：`std::process::Command`, Windows API (winapi crate).
- **原理**：通过封装系统 Shell 或调用系统 API 实现通用控制（如模拟按键、启动程序）。
- **优点**：扩展性极强，可以控制任何本地应用。
- **缺点**：安全风险极高，需要设计严密的白名单和沙箱机制。

---

## 6. 远程控制面板 (Remote Control)

### 方案 A：Tauri 内置 Web 服务 (Unified App)
- **技术栈**：axum (Rust Web Framework).
- **原理**：在 Tauri 进程中启动一个微型 HTTP Server，提供控制 API。
- **优点**：逻辑共用，无需额外配置，用户只需在局域网扫码即可访问。
- **缺点**：稍微增加主程序内存开销。

### 方案 B：移动端原生小程序/App (Dedicated Client)
- **技术栈**：Flutter, Uni-app.
- **原理**：开发专门的移动端客户端，通过云端中继或局域网发现连接机器人。
- **优点**：用户体验最好，支持原生推送通知。
- **缺点**：开发和维护两套代码的成本较高。
