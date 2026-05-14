# 本地方案技术细节：场景一 & 场景二

> 更新：2026-05-14  
> **原则**：LLM 使用云端 API；VAD / ASR / TTS 全部本地运行，无网络依赖。

---

## 场景一：情感疗愈

### 方案 A — 极简（CPU Only，≥ 6GB RAM）

**目标**：无 GPU，低功耗设备可用，端到端延迟 ≤ 3s。

#### 组件选型

| 层级 | 选型 | 模型大小 | 推理速度 |
|------|------|---------|---------|
| **VAD** | Silero VAD ONNX ✅ 已实现 | 2 MB | < 1ms/帧 |
| **ASR** | SenseVoice（sherpa-onnx）✅ 已实现 | 30 MB | < 200ms/句，含情绪标签 |
| **LLM** | ☁️ DeepSeek / Qwen-Plus API | — | ~500ms 首 token（流式）|
| **TTS** | Kokoro ONNX（本地）| 82 MB | 实时因子 > 10x，CPU 可用 |

**总本地 RAM**：~500 MB（模型常驻）  
**端到端延迟**：VAD 结束 → 出声 ≈ 1.5~2.5s（网络 + LLM 首 token 约 500ms）

#### Rust 集成方案

**VAD + ASR**：已实现，复用 `crates/voice` sherpa-onnx pipeline，SenseVoice 输出情绪标签（`<HAPPY>` / `<SAD>` 等）。

**LLM — 云端 OpenAI-compatible API**

已有 `AiProviders` 机制完全覆盖，直接复用，无需新增代码：

```toml
# streamix.toml 配置示例
[[AiProviders]]
Id = "healing-llm"
ProviderType = "llm"
Name = "DeepSeek"
Model = "deepseek-chat"
APIUrl = "https://api.deepseek.com/v1"
APIKey = "sk-..."
SystemPrompt = """
你是一个温柔的情感陪伴助手。用户情绪：{{emotion}}。
请用简短、温暖的语言回应，不超过 60 字。
"""
```

情绪标签注入方式：SenseVoice 输出 → 填充 `{{emotion}}` 占位符 → 送入 LLM。

**TTS — Kokoro ONNX via `ort`**

```toml
# crates/voice/Cargo.toml
[features]
kokoro = ["dep:ort", "dep:tokenizers"]

[dependencies]
tokenizers = { version = "0.20", optional = true }
# ort 已在 denoiser feature 存在
```

```rust
// crates/voice/src/tts/kokoro/mod.rs
pub struct KokoroTts {
    session:    ort::Session,              // kokoro-v1.0.int8.onnx
    tokenizer:  tokenizers::Tokenizer,
    phonemizer: EspeakPhonemizer,          // 调用系统 espeak-ng
}

impl KokoroTts {
    pub fn load(model_dir: &Path) -> Result<Self> { ... }

    /// 返回 24kHz 单声道 f32 PCM
    pub fn synthesize(&self, text: &str, voice: &str) -> Result<Vec<f32>> {
        let phonemes = self.phonemizer.phonemize(text)?;  // text → IPA
        let token_ids = self.tokenizer.encode(&phonemes)?;
        let output = self.session.run(ort::inputs![
            "tokens"   => token_ids.as_slice(),
            "style"    => self.load_voice(voice)?,        // voices/zf_001.bin
            "speed"    => &[1.0f32],
        ]?)?;
        Ok(output["audio"].try_extract_tensor::<f32>()?.to_vec())
    }
}
```

模型来源（hf-hub）：
```rust
// hexgrad/Kokoro-82M-ONNX
hub.ensure(ModelSpec::hf("hexgrad/Kokoro-82M-ONNX", "kokoro-v1.0.int8.onnx"), tx).await?;
hub.ensure(ModelSpec::hf("hexgrad/Kokoro-82M-ONNX", "voices/zf_001.bin"), tx).await?; // 中文女声
```

**系统依赖**：`espeak-ng`（phonemizer），`brew install espeak-ng` / `apt install espeak-ng`。

#### 数据流

```
麦克风
  → Silero VAD（话段检测，静音阈值 0.5s）
  → SenseVoice ASR → 文字 + 情绪标签 <HAPPY>
  → DeepSeek API（流式，system prompt 注入情绪）
  → 逐句回调 → Kokoro ONNX 合成
  → SpeakerRouter 播放
```

---

### 方案 B — 高质量（≥ 12GB RAM，GPU 可选）

**目标**：ASR 精度更高（方言/口音），TTS 支持音色克隆，LLM 同样云端。

#### 组件选型

| 层级 | 选型 | 模型大小 | 推理速度 |
|------|------|---------|---------|
| **VAD** | Silero VAD ONNX ✅ | 2 MB | < 1ms/帧 |
| **ASR** | whisper.cpp medium（`whisper-rs`）| 1.5 GB | ~300ms（CPU）/ ~80ms（GPU）|
| **LLM** | ☁️ Qwen-Max / Claude API | — | ~500ms 首 token |
| **TTS** | CosyVoice 2（Python FastAPI sidecar）| 2 GB | 流式首包 ~400ms |

**总本地 RAM**：~4 GB（ASR 1.5G + TTS 2G + 系统）  
**端到端延迟**：GPU ≈ 1~1.5s，CPU ≈ 2.5~4s

#### Rust 集成方案

**ASR — whisper-rs（whisper.cpp FFI 绑定）**

```toml
# crates/voice/Cargo.toml
[features]
whisper = ["dep:whisper-rs"]

[dependencies]
whisper-rs = { version = "0.13", optional = true }
```

```rust
// crates/voice/src/asr/whisper_backend.rs
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};

pub struct WhisperBackend { ctx: WhisperContext }

impl WhisperBackend {
    pub fn new(model_path: &Path) -> Result<Self> {
        Ok(Self {
            ctx: WhisperContext::new_with_params(
                &model_path.to_string_lossy(),
                WhisperContextParameters::default(),
            )?,
        })
    }

    /// 输入：16kHz 单声道 f32；输出：识别文字
    pub fn transcribe(&self, pcm: &[f32]) -> Result<String> {
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("zh"));
        params.set_print_progress(false);
        let mut state = self.ctx.create_state()?;
        state.full(params, pcm)?;
        Ok((0..state.full_n_segments()?)
            .filter_map(|i| state.full_get_segment_text(i).ok())
            .collect::<Vec<_>>()
            .join(""))
    }
}
```

模型下载：
```rust
hub.ensure(ModelSpec::hf(
    "ggerganov/whisper.cpp", "ggml-medium.bin",
), Some(tx)).await?;
```

**LLM**：同方案 A，换模型名/APIUrl，`AiProviders` 配置即可，无需改代码。

**TTS — CosyVoice 2 Python sidecar**

CosyVoice 2 暂无稳定 ONNX Rust 路径，通过 subprocess + HTTP 对接：

```rust
// 启动 sidecar
async fn spawn_cosyvoice(model_dir: &Path) -> Result<tokio::process::Child> {
    tokio::process::Command::new("python3")
        .args(["-m", "cosyvoice.server",
               "--port", "8765",
               "--model", &model_dir.join("CosyVoice2-0.5B").to_string_lossy()])
        .kill_on_drop(true)
        .spawn().map_err(Into::into)
}

// 合成调用（返回 16kHz f32 PCM）
async fn synthesize_cosyvoice(text: &str, emotion: &str) -> Result<Vec<f32>> {
    let bytes = reqwest::Client::new()
        .post("http://localhost:8765/synthesize")
        .json(&serde_json::json!({ "text": text, "emotion": emotion }))
        .send().await?
        .bytes().await?;
    Ok(bytes.chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect())
}
```

模型下载：
```rust
for file in ["config.yaml", "cosyvoice.yaml", "campplus.onnx", "speech_tokenizer_v2.onnx"] {
    hub.ensure(ModelSpec::hf("FunAudioLLM/CosyVoice2-0.5B", file), Some(tx.clone())).await?;
}
```

**与方案 A 的差异**：
- Whisper medium 识别口音/方言明显更准
- CosyVoice 2 支持 5s 音色注册，可用主播声线说话
- 情感标签（`<|HAPPY|>` 等）直接控制语气，与 SenseVoice 情绪标签对应
- LLM 换更强模型（Qwen-Max / Claude），情感理解和长文本对话更细腻

---

### 方案 C — 流式音色克隆（≥ 8GB RAM，GPU 可选）

**目标**：在方案 B 的基础上，TTS 换用 Fish Speech 1.5，获得原生流式输出和更低首包延迟，适合对实时性要求更高的疗愈对话。

#### 组件选型

| 层级 | 选型 | 模型大小 | 推理速度 |
|------|------|---------|---------|
| **VAD** | Silero VAD ONNX ✅ | 2 MB | < 1ms/帧 |
| **ASR** | whisper.cpp medium（`whisper-rs`）| 1.5 GB | ~300ms（CPU）/ ~80ms（GPU）|
| **LLM** | ☁️ Qwen-Max / Claude API | — | ~500ms 首 token |
| **TTS** | Fish Speech 1.5（Python sidecar）| 1.5 GB | 流式首包 ~300ms，实时因子 > 1x |

**总本地 RAM**：~4 GB  
**端到端延迟**：GPU ≈ 1s，CPU ≈ 2~2.5s

#### 与方案 B（CosyVoice）的对比

| | 方案 B CosyVoice 2 | 方案 C Fish Speech 1.5 |
|--|------------------|----------------------|
| 模型大小 | 2 GB | 1.5 GB |
| 原生流式 | ⚠️ 有限 | ✅ |
| HTTP API | ⚠️ 需自行封装 | ✅ 标准 REST |
| 首包延迟 | ~400ms | ~300ms |
| 情感标签 | ✅ `<\|HAPPY\|>` | ❌（靠参考音频控制）|
| 音色克隆样本 | 5s | 3~10s |
| 中文质量 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

#### Rust 集成方案

ASR 同方案 B（`whisper-rs`），LLM 同方案 A（`AiProviders` 配置）。

**TTS — Fish Speech 1.5**

Fish Speech 提供标准 REST API，流式返回 WAV chunks：

```rust
// crates/voice/src/tts/fish_speech/mod.rs
pub struct FishSpeechClient {
    base_url:     String,
    reference_id: Option<String>,  // 预注册的音色 ID
    client:       reqwest::Client,
}

impl FishSpeechClient {
    /// 非流式：返回完整 PCM
    pub async fn synthesize(&self, text: &str) -> Result<Vec<f32>> {
        let bytes = self.client
            .post(format!("{}/v1/tts", self.base_url))
            .json(&serde_json::json!({
                "text":         text,
                "reference_id": self.reference_id,
                "format":       "wav",
                "streaming":    false,
            }))
            .send().await?.bytes().await?;
        wav_bytes_to_f32(&bytes)
    }

    /// 流式：逐块回调，配合 LLM 流式输出使用
    pub async fn synthesize_streaming(
        &self,
        text: &str,
        mut on_chunk: impl FnMut(Vec<f32>),
    ) -> Result<()> {
        let mut resp = self.client
            .post(format!("{}/v1/tts", self.base_url))
            .json(&serde_json::json!({
                "text":         text,
                "reference_id": self.reference_id,
                "format":       "wav",
                "streaming":    true,
            }))
            .send().await?;
        while let Some(chunk) = resp.chunk().await? {
            on_chunk(wav_chunk_to_f32(&chunk));
        }
        Ok(())
    }

    /// 注册音色（上传参考音频 → 返回 reference_id，一次性操作）
    pub async fn register_voice(&self, audio_path: &Path, label: &str) -> Result<String> {
        let form = reqwest::multipart::Form::new()
            .text("label", label.to_string())
            .file("audio", audio_path).await?;
        let resp: serde_json::Value = self.client
            .post(format!("{}/v1/voices", self.base_url))
            .multipart(form)
            .send().await?.json().await?;
        Ok(resp["id"].as_str().unwrap_or_default().to_string())
    }
}
```

启动 sidecar：
```rust
async fn spawn_fish_speech(model_dir: &Path) -> Result<tokio::process::Child> {
    tokio::process::Command::new("python3")
        .args(["-m", "tools.api_server",
               "--listen", "0.0.0.0:8765",
               "--checkpoint-path", &model_dir.join("fish-speech-1.5").to_string_lossy()])
        .kill_on_drop(true)
        .spawn().map_err(Into::into)
}
```

模型下载：
```rust
for file in ["model.pth", "firefly-gan-vq-fsq-8x1024-21hz-generator.pth", "config.json"] {
    hub.ensure(ModelSpec::hf("fishaudio/fish-speech-1.5", file), Some(tx.clone())).await?;
}
```

**音色注册（一次性）**：
```
主播录制 10s 干净语音 → WAV
  → FishSpeechClient::register_voice() → reference_id
  → 写入 streamix.toml TtsVoice 字段
  → 后续合成自动使用
```

**LLM 流式 + TTS 流式联动**：
```
LLM 流式 token
  → 按标点积累成句（句号 / 逗号 / 换行）
  → 每句立即送 Fish Speech 流式合成
  → 首句出声 ≈ LLM 首句时间（~800ms）+ TTS 首包（~300ms）≈ 1.1s
  → 后续句子流水线并行，整体体感延迟接近方案 A
```

---

## 场景二：聊天声控

### 方案 A — 极速（CPU Only，≥ 3GB RAM）

**目标**：关键词命中 < 400ms，模糊指令（含 LLM 网络）< 1.2s。

#### 组件选型

| 层级 | 选型 | 模型大小 | 推理速度 |
|------|------|---------|---------|
| **VAD** | Silero VAD，静音阈值缩短至 0.3s | 2 MB | < 1ms/帧 |
| **ASR** | Paraformer-zh-small（sherpa-onnx）| 70 MB | < 100ms/句 |
| **指令解析** | 本地关键词 Trie | 0 MB | < 1ms |
| **LLM（兜底）**| ☁️ DeepSeek-chat（意图分类）| — | ~300ms（仅分类，输出极短）|
| **TTS 反馈** | Kokoro ONNX（本地）| 82 MB | 实时因子 > 10x |

**总本地 RAM**：~400 MB  
**关键词命中延迟**：ASR + Trie ≈ 150~250ms  
**模糊指令延迟**：+ 网络 LLM ≈ 500~900ms

#### Rust 集成方案

**ASR — Paraformer via sherpa-onnx**

Paraformer-small 对短句指令识别率高于 SenseVoice（无情绪标签开销）：

```rust
// crates/voice/src/asr/paraformer.rs
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig,
                  OfflineModelConfig, OfflineParaformerModelConfig};

pub fn build_paraformer(model_dir: &Path) -> Result<OfflineRecognizer> {
    Ok(OfflineRecognizer::new(&OfflineRecognizerConfig {
        model: OfflineModelConfig {
            paraformer: OfflineParaformerModelConfig {
                model: model_dir.join("model.int8.onnx")
                    .to_string_lossy().into(),
            },
            tokens: model_dir.join("tokens.txt").to_string_lossy().into(),
            num_threads: 2,
            ..Default::default()
        },
        ..Default::default()
    })?)
}
```

模型下载：
```rust
hub.ensure(ModelSpec::hf(
    "k2-fsa/sherpa-onnx",
    "sherpa-onnx-paraformer-zh-small-2024-03-09/model.int8.onnx",
), None).await?;
```

**指令解析 — Trie + 云端 LLM 兜底**

```rust
// src/bot/voice_command.rs
pub struct CommandRouter {
    /// 关键词 → 动作，O(1) 查找
    exact:  HashMap<String, CommandAction>,
    /// 包含匹配，顺序重要（长串优先）
    prefix: Vec<(String, CommandAction)>,
    /// 未命中时调云端 LLM 做意图分类
    llm:    Option<Arc<dyn LlmClient>>,
}

impl CommandRouter {
    pub async fn dispatch(&self, text: &str) -> Option<CommandAction> {
        // 1. 精确匹配
        if let Some(a) = self.exact.get(text) { return Some(a.clone()); }
        // 2. 包含匹配
        for (kw, a) in &self.prefix {
            if text.contains(kw.as_str()) { return Some(a.clone()); }
        }
        // 3. 云端 LLM 意图分类（仅在有配置时触发）
        if let Some(llm) = &self.llm {
            let actions: Vec<&str> = self.exact.keys().map(String::as_str).collect();
            return llm.classify_intent(text, &actions).await.ok();
        }
        None
    }
}

// LLM 分类 prompt（输出极短，< 10 token）
const INTENT_PROMPT: &str =
    "从动作列表 [{actions}] 中选出最匹配 '{text}' 的一项，只输出动作名：";
```

**TTS 反馈 — Kokoro ONNX**：同场景一方案 A，短句反馈（"好的"、"已切换"）本地合成，无网络延迟。

---

### 方案 B — 均衡（≥ 6GB RAM，Mac Metal 可加速）

**目标**：更高 ASR 准确率，LLM 意图理解更细腻，发行版打包友好（无外部进程）。

#### 组件选型

| 层级 | 选型 | 模型大小 | 推理速度 |
|------|------|---------|---------|
| **VAD** | Silero VAD ✅ | 2 MB | < 1ms/帧 |
| **ASR** | SenseVoice（sherpa-onnx）✅ | 30 MB | < 200ms/句 |
| **指令解析** | Trie + ☁️ Qwen-Plus 意图分类 | — | ~300ms 网络 |
| **对话状态** | SessionMemory 滑动窗口 ✅ | 0 MB | — |
| **TTS 反馈** | Kokoro ONNX（本地）| 82 MB | 实时因子 > 10x |

**总本地 RAM**：~400 MB（无本地 LLM）  
**关键词命中延迟**：~200ms  
**模糊指令延迟**：~500ms（Qwen-Plus 国内节点快）

#### Rust 集成方案

**ASR**：直接复用已实现的 SenseVoice pipeline。

**LLM — 云端，复用 AiProviders**

意图分类用专用的轻量 provider 配置，和疗愈场景的 LLM 隔离：

```toml
[[AiProviders]]
Id = "voice-cmd-llm"
ProviderType = "llm"
Name = "Qwen-Plus（声控专用）"
Model = "qwen-plus"
APIUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1"
APIKey = "sk-..."
SystemPrompt = """
你是指令分类器。从动作列表中选出最匹配的一项，只输出动作名，不解释。
动作列表：{actions}
"""
```

**连续指令对话**：声控 session 独立维护一条 `SessionMemory`，不与弹幕 AI 混用，避免上下文污染。

**TTS 反馈 — Kokoro ONNX**：同方案 A。

---

## 场景三：整活变声器

> **不需要 LLM**。核心诉求：实时变声 / 音效丰富 / 低延迟（< 50ms）。  
> 每个方案均提供两种集成形态：**嵌入 Streamix 作为服务** 和 **独立 Rust 二进制程序**。

---

### 方案 A — RVC v2 外挂进程（音色克隆级，≥ 4GB RAM，GPU 推荐）

**目标**：接入社区海量声库（猫娘 / 萝莉 / 鬼畜 / 名人），音质接近专业，支持实时 pitch shift。

#### 组件选型

| 层级 | 选型 | 说明 |
|------|------|------|
| **变声核心** | RVC v2（ONNX 模式）via [w-okada voice-changer](https://github.com/w-okada/voice-changer) | GPU ~30ms；CPU ONNX ~80ms |
| **Pitch shift** | RVC 内置 pitch shift（半音级别，-12~+12）| 无需额外库 |
| **音效链** | SoX 命令行 / RVC 内置 noise reduce | 前处理降噪 |
| **虚拟声卡** | BlackHole（macOS）/ VB-Audio（Windows）| 变声输出 → OBS 麦克风 |
| **Rust 侧** | `cpal` 采集 + WebSocket 客户端 | 与 RVC 服务通信 |

#### 数据流

```
麦克风 (cpal)
  ──→ RvcClient (WebSocket, 原始 PCM 16kHz i16)
        ──→ w-okada RVC 服务（Python, :18888）
              ──→ 变声 PCM 回传
  ──→ cpal 播放 → BlackHole 虚拟声卡 → OBS

Streamix 主进程
  ──→ 弹幕触发 / UI 控制  →  RvcClient::switch_model() / set_pitch()
```

---

#### A-1  集成到 Streamix（作为服务）

**模块位置**：`crates/voice/src/voice_changer/`

```
crates/voice/src/voice_changer/
├── mod.rs           # pub use
├── rvc_client.rs    # WebSocket 客户端 + 音频帧收发
└── service.rs       # VoiceChangerService（管理进程 + cpal 音频循环）
```

**`rvc_client.rs`**

```rust
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use anyhow::Result;

pub struct RvcClient {
    ws_url: String,
    config: RvcConfig,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RvcConfig {
    pub server_url: String,   // "ws://127.0.0.1:18888"
    pub model_slot: u32,      // 0..N，对应 w-okada 声库槽位
    pub pitch_shift: i32,     // 半音，-12~+12
    pub index_ratio: f32,     // 0.0~1.0，音色强度
    pub noise_reduce: bool,
}

impl RvcClient {
    pub fn new(config: RvcConfig) -> Self {
        Self { ws_url: config.server_url.clone(), config }
    }

    /// 发送一帧 PCM（16kHz, i16, mono），返回变声后 PCM
    pub async fn convert_frame(
        &self,
        pcm: &[i16],
        ws: &mut impl futures_util::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
        rx: &mut impl futures_util::Stream<Item = Result<Message, _>> + Unpin,
    ) -> Result<Vec<i16>> {
        // w-okada 协议：binary = [4字节 header][PCM bytes]
        let mut payload = Vec::with_capacity(4 + pcm.len() * 2);
        payload.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
        for s in pcm { payload.extend_from_slice(&s.to_le_bytes()); }
        ws.send(Message::Binary(payload)).await?;

        if let Some(Ok(Message::Binary(resp))) = rx.next().await {
            let samples: Vec<i16> = resp.chunks_exact(2)
                .map(|b| i16::from_le_bytes([b[0], b[1]]))
                .collect();
            return Ok(samples);
        }
        anyhow::bail!("RVC 服务无响应")
    }

    /// 切换声库槽位（发送 JSON 控制帧）
    pub async fn switch_model(
        &self,
        ws: &mut (impl futures_util::Sink<Message, Error = _> + Unpin),
        slot: u32,
    ) -> Result<()> {
        let cmd = serde_json::json!({ "cmd": "switchModel", "slot": slot });
        ws.send(Message::Text(cmd.to_string())).await?;
        Ok(())
    }

    /// 设置 pitch shift（半音）
    pub async fn set_pitch(
        &self,
        ws: &mut (impl futures_util::Sink<Message, Error = _> + Unpin),
        semitones: i32,
    ) -> Result<()> {
        let cmd = serde_json::json!({ "cmd": "setPitch", "f0Offset": semitones });
        ws.send(Message::Text(cmd.to_string())).await?;
        Ok(())
    }
}
```

**`service.rs`** — Tauri 后台服务入口

```rust
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::Arc;
use tokio::sync::{Mutex, watch};

pub struct VoiceChangerService {
    config: Arc<Mutex<RvcConfig>>,
    stop_tx: Option<watch::Sender<bool>>,
}

impl VoiceChangerService {
    pub fn new(config: RvcConfig) -> Self {
        Self { config: Arc::new(Mutex::new(config)), stop_tx: None }
    }

    /// 启动音频循环（在 tokio::spawn 的线程内运行）
    pub async fn start(&mut self) -> anyhow::Result<()> {
        let (stop_tx, mut stop_rx) = watch::channel(false);
        self.stop_tx = Some(stop_tx);
        let config = Arc::clone(&self.config);

        tokio::spawn(async move {
            let cfg = config.lock().await.clone();
            let (ws, _) = tokio_tungstenite::connect_async(&cfg.server_url)
                .await.expect("连接 RVC 服务失败");
            let (mut ws_tx, mut ws_rx) = ws.split();

            // cpal 麦克风采集
            let host = cpal::default_host();
            let mic = host.default_input_device().unwrap();
            let stream_config = cpal::StreamConfig {
                channels: 1,
                sample_rate: cpal::SampleRate(16000),
                buffer_size: cpal::BufferSize::Fixed(512),
            };

            let (pcm_tx, mut pcm_rx) = tokio::sync::mpsc::channel::<Vec<i16>>(8);
            let input_stream = mic.build_input_stream(
                &stream_config,
                move |data: &[i16], _| { let _ = pcm_tx.try_send(data.to_vec()); },
                |e| tracing::error!("mic error: {e}"),
                None,
            ).unwrap();
            input_stream.play().unwrap();

            // cpal 播放（虚拟声卡或默认输出）
            let speaker = host.default_output_device().unwrap();
            let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<Vec<i16>>(8);
            let output_stream = speaker.build_output_stream(
                &stream_config,
                move |data: &mut [i16], _| {
                    if let Ok(frame) = out_rx.try_recv() {
                        let len = data.len().min(frame.len());
                        data[..len].copy_from_slice(&frame[..len]);
                    }
                },
                |e| tracing::error!("output error: {e}"),
                None,
            ).unwrap();
            output_stream.play().unwrap();

            loop {
                if *stop_rx.borrow() { break; }
                if let Some(pcm) = pcm_rx.recv().await {
                    // 发送到 RVC，接收变声结果
                    let mut payload = Vec::with_capacity(4 + pcm.len() * 2);
                    payload.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
                    for s in &pcm { payload.extend_from_slice(&s.to_le_bytes()); }
                    ws_tx.send(tokio_tungstenite::tungstenite::Message::Binary(payload))
                        .await.ok();
                    if let Some(Ok(tokio_tungstenite::tungstenite::Message::Binary(resp))) =
                        ws_rx.next().await
                    {
                        let out: Vec<i16> = resp.chunks_exact(2)
                            .map(|b| i16::from_le_bytes([b[0], b[1]]))
                            .collect();
                        out_tx.send(out).await.ok();
                    }
                }
            }
        });
        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() { let _ = tx.send(true); }
    }
}
```

**Tauri 命令**

```rust
// src-tauri/src/commands/voice_changer.rs

#[tauri::command]
pub async fn start_voice_changer(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<VoiceChangerService>>>,
) -> Result<(), String> {
    state.lock().await.start().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_voice_model(
    state: tauri::State<'_, Arc<Mutex<VoiceChangerService>>>,
    slot: u32,
) -> Result<(), String> {
    // 通过 state 内部的 ws 发送切换指令
    Ok(())
}

#[tauri::command]
pub async fn set_voice_pitch(
    state: tauri::State<'_, Arc<Mutex<VoiceChangerService>>>,
    semitones: i32,
) -> Result<(), String> {
    Ok(())
}
```

**Cargo feature**

```toml
# crates/voice/Cargo.toml
[features]
voice-changer-rvc = ["dep:cpal"]   # Plan A 服务集成
```

---

#### A-2  独立 Rust 程序 `streamix-changer`

独立程序不依赖 Tauri，可单独分发或命令行运行。它自己管理 RVC 进程生命周期，并对外暴露 WebSocket 控制 API，Streamix 主程序或其他工具均可接入控制。

**工程结构**

```
crates/streamix-changer/
├── Cargo.toml
└── src/
    ├── main.rs           # CLI 入口 + tokio Runtime
    ├── audio.rs          # cpal 麦克风 / 扬声器抽象
    ├── rvc_process.rs    # spawn & watchdog RVC Python 进程
    ├── rvc_client.rs     # WebSocket 音频帧收发（同上）
    └── control_server.rs # axum WebSocket 控制 API（供 Streamix 调用）
```

**`Cargo.toml`**（独立 crate）

```toml
[package]
name = "streamix-changer"
version = "0.1.0"
edition = "2024"

[dependencies]
tokio      = { version = "1", features = ["full"] }
anyhow     = "1"
tracing    = "0.1"
tracing-subscriber = "0.3"
cpal       = "0.15"
tokio-tungstenite  = { version = "0.27", features = ["rustls-tls-webpki-roots"] }
futures-util = "0.3"
serde        = { version = "1", features = ["derive"] }
serde_json   = "1"
axum         = "0.8"
clap         = { version = "4", features = ["derive"] }
```

**`main.rs`**

```rust
use clap::Parser;

#[derive(Parser)]
struct Args {
    /// RVC 服务地址（w-okada 默认 :18888）
    #[arg(long, default_value = "ws://127.0.0.1:18888")]
    rvc_url: String,

    /// 控制 API 监听端口（Streamix 主程序连此端口）
    #[arg(long, default_value_t = 18889)]
    control_port: u16,

    /// 是否自动启动 RVC Python 服务（需要 python + rvc 已安装）
    #[arg(long)]
    auto_start_rvc: bool,

    /// pitch shift 半音（启动默认值）
    #[arg(long, default_value_t = 0)]
    pitch: i32,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    // 可选：自动拉起 RVC Python 进程
    let _rvc_proc = if args.auto_start_rvc {
        Some(rvc_process::spawn_rvc().await?)
    } else {
        None
    };

    // 启动音频循环
    let audio_handle = audio::start_loop(args.rvc_url.clone(), args.pitch).await?;

    // 启动控制 WebSocket 服务
    control_server::serve(args.control_port, audio_handle).await?;

    Ok(())
}
```

**`rvc_process.rs`** — 进程守护

```rust
use tokio::process::{Child, Command};

pub async fn spawn_rvc() -> anyhow::Result<Child> {
    let child = Command::new("python")
        .args(["-m", "voice_changer.server", "--port", "18888"])
        .spawn()?;
    // 等待服务就绪
    wait_for_port(18888, std::time::Duration::from_secs(30)).await?;
    tracing::info!("RVC 服务已启动");
    Ok(child)
}

async fn wait_for_port(port: u16, timeout: std::time::Duration) -> anyhow::Result<()> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return Ok(());
        }
        if tokio::time::Instant::now() > deadline {
            anyhow::bail!("等待 RVC 服务超时");
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}
```

**`control_server.rs`** — axum WebSocket 控制 API

```rust
use axum::{Router, extract::{WebSocketUpgrade, ws::{WebSocket, Message}}, response::Response};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd")]
enum ControlMsg {
    SwitchModel { slot: u32 },
    SetPitch    { semitones: i32 },
    Stop,
}

pub async fn serve(port: u16, state: Arc<Mutex<audio::AudioHandle>>) -> anyhow::Result<()> {
    let app = Router::new()
        .route("/control", axum::routing::get(move |ws: WebSocketUpgrade| {
            let st = Arc::clone(&state);
            async move { ws.on_upgrade(move |sock| handle_ws(sock, st)) }
        }));

    let addr = format!("127.0.0.1:{port}");
    tracing::info!("控制服务监听 ws://{addr}/control");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn handle_ws(mut socket: WebSocket, state: Arc<Mutex<audio::AudioHandle>>) {
    while let Some(Ok(Message::Text(text))) = socket.recv().await {
        let Ok(msg) = serde_json::from_str::<ControlMsg>(&text) else { continue };
        let mut handle = state.lock().await;
        match msg {
            ControlMsg::SwitchModel { slot } => handle.switch_model(slot).await,
            ControlMsg::SetPitch { semitones } => handle.set_pitch(semitones).await,
            ControlMsg::Stop => { handle.stop(); break; }
        }
    }
}
```

Streamix 主程序连接方式：

```typescript
// src-tauri/src/app/lib/api.ts
const changerWs = new WebSocket('ws://127.0.0.1:18889/control');
changerWs.send(JSON.stringify({ cmd: 'SwitchModel', slot: 2 }));
changerWs.send(JSON.stringify({ cmd: 'SetPitch', semitones: 6 }));
```

---

### 方案 B — 内置 DSP（轻量开箱即用，纯 CPU，< 50MB）

**目标**：零额外安装，纯 Rust 实现 pitch shift + 音效链，开箱即用。无音色克隆，靠音调和音效制造变声效果。

#### 组件选型

| 层级 | 选型 | 说明 |
|------|------|------|
| **Pitch shift** | [`rubberband`](https://crates.io/crates/rubberband) crate（RubberBand FFI）| 高质量相位声码器，实时模式 < 5ms |
| **Ring 调制** | 自实现（正弦波乘积，~20 行）| 机器人 / 金属音效 |
| **Bandpass 滤波** | Biquad IIR（RBJ cookbook）| 电话音（300~3400 Hz）|
| **Reverb** | Schroeder 混响（纯 Rust，~80 行）| 山洞 / 大厅 |
| **音频 I/O** | `cpal` | 跨平台麦克风 + 播放 |
| **系统依赖** | librubberband（`brew install rubberband`）| 仅 rubberband 需要 |

#### 音效链模型

```
麦克风 (cpal) → [降噪 gate] → [Pitch Shift] → [Ring Mod] → [Bandpass] → [Reverb] → 输出
                                    ↑ 可单独启用，互不冲突
```

**内置变声模式**

| 模式 | Pitch shift | Ring Mod | Bandpass | Reverb |
|------|------------|----------|----------|--------|
| 松鼠 | +8 半音，加速 1.4x | — | — | — |
| 萝莉 | +5 半音 | — | — | 小房间 |
| 巨人 | -10 半音 | — | — | 大厅 |
| 机器人 | 0 | 180 Hz | — | 轻 |
| 电话 | 0 | — | 300~3400 Hz | — |
| 恶魔 | -8 半音 | 60 Hz | — | 洞穴 |
| 合唱 | 0 | — | — | 多路延迟 |

---

#### B-1  集成到 Streamix（作为服务）

**模块位置**：`crates/voice/src/voice_changer/`

```
crates/voice/src/voice_changer/
├── mod.rs
├── effects/
│   ├── mod.rs         # AudioEffect trait
│   ├── pitch.rs       # RubberBand pitch shift
│   ├── ring_mod.rs    # 环形调制
│   ├── bandpass.rs    # Biquad IIR 滤波
│   └── reverb.rs      # Schroeder 混响
├── chain.rs           # EffectChain：组合多个 AudioEffect
└── service.rs         # VoiceEffectService：cpal 音频循环
```

**`effects/mod.rs`**

```rust
pub trait AudioEffect: Send {
    fn process(&mut self, frame: &mut [f32], sample_rate: f32);
    fn set_param(&mut self, key: &str, value: f32);
    fn name(&self) -> &str;
}

pub mod pitch;
pub mod ring_mod;
pub mod bandpass;
pub mod reverb;
```

**`effects/pitch.rs`**

```rust
use rubberband::{RubberBandStretcher, RubberBandOption};

pub struct PitchShifter {
    rb: RubberBandStretcher,
    semitones: f32,
}

impl PitchShifter {
    pub fn new(sample_rate: u32, semitones: f32) -> Self {
        let scale = 2f32.powf(semitones / 12.0);
        let rb = RubberBandStretcher::new(
            sample_rate as usize, 1,
            RubberBandOption::PROCESS_REALTIME | RubberBandOption::PITCH_HIGH_CONSISTENCY,
            1.0,   // time ratio（不改变速度）
            scale, // pitch scale
        );
        Self { rb, semitones }
    }
}

impl AudioEffect for PitchShifter {
    fn process(&mut self, frame: &mut [f32], _sr: f32) {
        self.rb.process(&[frame], false);
        if let Some(out) = self.rb.retrieve() {
            let n = frame.len().min(out[0].len());
            frame[..n].copy_from_slice(&out[0][..n]);
        }
    }

    fn set_param(&mut self, key: &str, value: f32) {
        if key == "semitones" {
            self.semitones = value;
            self.rb.set_pitch_scale(2f32.powf(value / 12.0));
        }
    }

    fn name(&self) -> &str { "pitch" }
}
```

**`effects/ring_mod.rs`**

```rust
use std::f32::consts::TAU;
use super::AudioEffect;

pub struct RingModulator {
    carrier_freq: f32,
    phase: f32,
    mix: f32, // 0.0 = 干；1.0 = 全调制
}

impl RingModulator {
    pub fn new(carrier_freq: f32) -> Self {
        Self { carrier_freq, phase: 0.0, mix: 1.0 }
    }
}

impl AudioEffect for RingModulator {
    fn process(&mut self, frame: &mut [f32], sample_rate: f32) {
        let step = self.carrier_freq / sample_rate;
        for s in frame.iter_mut() {
            let mod_signal = (self.phase * TAU).sin();
            *s = *s * (1.0 - self.mix) + *s * mod_signal * self.mix;
            self.phase = (self.phase + step) % 1.0;
        }
    }

    fn set_param(&mut self, key: &str, value: f32) {
        match key {
            "freq" => self.carrier_freq = value,
            "mix"  => self.mix = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    fn name(&self) -> &str { "ring_mod" }
}
```

**`effects/bandpass.rs`** — Biquad IIR（RBJ cookbook）

```rust
use super::AudioEffect;
use std::f32::consts::PI;

pub struct BandpassFilter {
    b: [f32; 3],
    a: [f32; 2],
    x: [f32; 2],
    y: [f32; 2],
}

impl BandpassFilter {
    /// f0：中心频率 Hz；q：Q 值（带宽控制）
    pub fn new(f0: f32, q: f32, sample_rate: f32) -> Self {
        let w0    = 2.0 * PI * f0 / sample_rate;
        let alpha = w0.sin() / (2.0 * q);
        let a0    = 1.0 + alpha;
        Self {
            b: [alpha / a0, 0.0, -alpha / a0],
            a: [-2.0 * w0.cos() / a0, (1.0 - alpha) / a0],
            x: [0.0; 2],
            y: [0.0; 2],
        }
    }
}

impl AudioEffect for BandpassFilter {
    fn process(&mut self, frame: &mut [f32], _sr: f32) {
        for s in frame.iter_mut() {
            let out = self.b[0] * *s + self.b[1] * self.x[0] + self.b[2] * self.x[1]
                    - self.a[0] * self.y[0] - self.a[1] * self.y[1];
            self.x[1] = self.x[0]; self.x[0] = *s;
            self.y[1] = self.y[0]; self.y[0] = out;
            *s = out;
        }
    }

    fn set_param(&mut self, _key: &str, _value: f32) {}
    fn name(&self) -> &str { "bandpass" }
}
```

**`chain.rs`** — 效果链 + 预设

```rust
use super::effects::AudioEffect;

pub struct EffectChain {
    effects: Vec<Box<dyn AudioEffect>>,
    sample_rate: f32,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub enum VoicePreset {
    Squirrel, Loli, Giant, Robot, Phone, Demon, Chorus, Raw,
}

impl EffectChain {
    pub fn new(sample_rate: f32) -> Self {
        Self { effects: vec![], sample_rate }
    }

    pub fn load_preset(&mut self, preset: VoicePreset) {
        use super::effects::{pitch::PitchShifter, ring_mod::RingModulator, bandpass::BandpassFilter};
        self.effects.clear();
        match preset {
            VoicePreset::Squirrel => {
                self.effects.push(Box::new(PitchShifter::new(self.sample_rate as u32, 8.0)));
            }
            VoicePreset::Loli => {
                self.effects.push(Box::new(PitchShifter::new(self.sample_rate as u32, 5.0)));
            }
            VoicePreset::Giant => {
                self.effects.push(Box::new(PitchShifter::new(self.sample_rate as u32, -10.0)));
            }
            VoicePreset::Robot => {
                self.effects.push(Box::new(RingModulator::new(180.0)));
            }
            VoicePreset::Phone => {
                self.effects.push(Box::new(BandpassFilter::new(1850.0, 1.0, self.sample_rate)));
            }
            VoicePreset::Demon => {
                self.effects.push(Box::new(PitchShifter::new(self.sample_rate as u32, -8.0)));
                self.effects.push(Box::new(RingModulator::new(60.0)));
            }
            VoicePreset::Chorus | VoicePreset::Raw => {}
        }
    }

    pub fn process(&mut self, frame: &mut [f32]) {
        for effect in &mut self.effects {
            effect.process(frame, self.sample_rate);
        }
    }
}
```

**`service.rs`** — cpal 音频循环

```rust
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};
use super::chain::{EffectChain, VoicePreset};

pub struct VoiceEffectService {
    chain: Arc<Mutex<EffectChain>>,
}

impl VoiceEffectService {
    pub fn new(sample_rate: u32) -> Self {
        Self { chain: Arc::new(Mutex::new(EffectChain::new(sample_rate as f32))) }
    }

    pub fn set_preset(&self, preset: VoicePreset) {
        self.chain.lock().unwrap().load_preset(preset);
    }

    pub fn start(&self) -> anyhow::Result<(cpal::Stream, cpal::Stream)> {
        let host   = cpal::default_host();
        let input  = host.default_input_device().unwrap();
        let output = host.default_output_device().unwrap();
        let cfg = cpal::StreamConfig {
            channels: 1, sample_rate: cpal::SampleRate(48000),
            buffer_size: cpal::BufferSize::Fixed(256),
        };

        let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(4);
        let chain = Arc::clone(&self.chain);

        let input_stream = input.build_input_stream(
            &cfg,
            move |data: &[f32], _| {
                let mut frame = data.to_vec();
                chain.lock().unwrap().process(&mut frame);
                let _ = tx.try_send(frame);
            },
            |e| tracing::error!("input: {e}"),
            None,
        )?;

        let output_stream = output.build_output_stream(
            &cfg,
            move |data: &mut [f32], _| {
                if let Ok(frame) = rx.try_recv() {
                    let n = data.len().min(frame.len());
                    data[..n].copy_from_slice(&frame[..n]);
                }
            },
            |e| tracing::error!("output: {e}"),
            None,
        )?;

        input_stream.play()?;
        output_stream.play()?;
        Ok((input_stream, output_stream))
    }
}
```

**Tauri 命令**

```rust
#[tauri::command]
pub fn set_voice_preset(
    state: tauri::State<'_, VoiceEffectService>,
    preset: VoicePreset,
) {
    state.set_preset(preset);
}

#[tauri::command]
pub fn set_effect_param(
    state: tauri::State<'_, VoiceEffectService>,
    effect: String,
    key: String,
    value: f32,
) {
    state.chain.lock().unwrap()
        .get_effect_mut(&effect)
        .map(|e| e.set_param(&key, value));
}
```

**Cargo feature**

```toml
[features]
voice-changer-dsp = ["dep:cpal", "dep:rubberband"]

[dependencies]
rubberband = { version = "0.2", optional = true }
```

---

#### B-2  独立 Rust 程序 `streamix-changer-lite`

纯 Rust 二进制，零 Python 依赖，单文件分发。对外暴露与方案 A 独立程序**相同的 WebSocket 控制协议**，Streamix 无需区分用的是哪个变声器。

**工程结构**

```
crates/streamix-changer-lite/
├── Cargo.toml
└── src/
    ├── main.rs           # CLI 入口
    ├── effects/          # 同上（或直接依赖 streamix-voice 的 voice-changer-dsp feature）
    ├── audio.rs          # cpal 实时循环
    └── control_server.rs # axum WebSocket（与 Plan A 控制协议兼容）
```

**兼容控制协议**（与 Plan A 独立程序相同，Streamix 前端无需改动）

```rust
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "cmd")]
enum ControlMsg {
    SwitchModel { slot: u32 },   // lite 版：slot 映射到预设编号
    SetPitch    { semitones: i32 },
    SetPreset   { name: String }, // lite 专属扩展
    Stop,
}
```

**预设映射**（无声库时用预设替代）

```rust
fn slot_to_preset(slot: u32) -> VoicePreset {
    match slot {
        0 => VoicePreset::Raw,
        1 => VoicePreset::Loli,
        2 => VoicePreset::Giant,
        3 => VoicePreset::Robot,
        4 => VoicePreset::Phone,
        5 => VoicePreset::Squirrel,
        6 => VoicePreset::Demon,
        _ => VoicePreset::Raw,
    }
}
```

**分发产物**

```bash
# macOS
cargo build --release -p streamix-changer-lite
# → target/release/streamix-changer-lite（无外部依赖，除 librubberband）
brew install rubberband  # 唯一系统依赖

# 启动
./streamix-changer-lite --control-port 18889 --preset Loli
```

---

### 方案对比

| | A-1 集成服务（RVC）| A-2 独立程序（RVC）| B-1 集成服务（DSP）| B-2 独立程序（DSP）|
|--|-----------|-----------|-----------|-----------|
| **音色克隆** | ✅ | ✅ | ❌ | ❌ |
| **变声质量** | 高（AI 模型）| 高（AI 模型）| 中（DSP）| 中（DSP）|
| **延迟** | ~30-80ms | ~30-80ms | < 10ms | < 10ms |
| **GPU** | 推荐 | 推荐 | 不需要 | 不需要 |
| **RAM** | ~4 GB | ~4 GB | < 100 MB | < 100 MB |
| **Python** | 需要（RVC sidecar）| 需要（RVC sidecar）| 不需要 | 不需要 |
| **Streamix 集成** | Tauri 命令 + 后台服务 | WebSocket 控制（:18889）| Tauri 命令 + 后台服务 | WebSocket 控制（:18889）|
| **独立运行** | ❌（嵌入 Streamix）| ✅ | ❌（嵌入 Streamix）| ✅ |
| **控制协议** | Tauri IPC | WebSocket JSON | Tauri IPC | WebSocket JSON（与 A-2 兼容）|
| **推荐场景** | 要音色克隆且 Streamix 常驻 | 要音色克隆且解耦运行 | 快速整活，零配置 | 轻量分发，与主程序解耦 |

**推荐起步路径**

```
整活变声器  →  方案 B-1（内置 DSP，当天可跑通，无需安装 Python 和声库）
              音质不够 / 需要真实音色克隆  →  叠加方案 A（RVC）
              希望解耦进程  →  改为对应的独立程序变体（A-2 或 B-2）
```

---

## 资源占用对比

| | 场景一 A | 场景一 B | 场景一 C | 场景二 A | 场景二 B |
|--|--------|--------|--------|--------|--------|
| **本地 RAM** | ~500 MB | ~4 GB | ~4 GB | ~400 MB | ~400 MB |
| **GPU（可选）** | 不需要 | 4GB VRAM | 4GB VRAM | 不需要 | 不需要 |
| **本地模型总计** | ~115 MB | ~3.5 GB | ~3 GB | ~155 MB | ~115 MB |
| **LLM** | ☁️ DeepSeek | ☁️ Qwen-Max | ☁️ Qwen-Max | ☁️ DeepSeek | ☁️ Qwen-Plus |
| **TTS** | Kokoro ONNX | CosyVoice 2 | Fish Speech 1.5 | Kokoro ONNX | Kokoro ONNX |
| **TTS 音色克隆** | ❌ | ✅ 5s | ✅ 3~10s | ❌ | ❌ |
| **TTS 流式** | ❌ | ⚠️ 有限 | ✅ 原生 | ❌ | ❌ |
| **情感标签控制** | ❌ | ✅ `<\|HAPPY\|>` | ❌ | ❌ | ❌ |
| **端到端延迟** | ~2s | ~1.5s（GPU）| ~1s（GPU）| ~250ms | ~250ms |
| **外部进程** | 无 | Python sidecar | Python sidecar | 无 | 无 |
| **离线可用** | ❌ | ❌ | ❌ | ✅ 关键词离线 | ✅ 关键词离线 |

---

## 新增 Cargo feature 汇总

```toml
# crates/voice/Cargo.toml
[features]
kokoro              = ["dep:ort", "dep:tokenizers"]   # 场景一 A / 场景二 A B
whisper             = ["dep:whisper-rs"]              # 场景一 B / C ASR
fish-speech         = []                              # 场景一 C TTS（纯 HTTP，无额外依赖）
voice-changer-rvc   = ["dep:cpal"]                    # 场景三 A：集成 RVC 客户端
voice-changer-dsp   = ["dep:cpal", "dep:rubberband"]  # 场景三 B：内置 DSP 链

[dependencies]
whisper-rs  = { version = "0.13", optional = true }
tokenizers  = { version = "0.20", optional = true }
rubberband  = { version = "0.2",  optional = true }
```

独立程序作为单独 workspace crate：

```toml
# Cargo.toml（workspace）
[workspace]
members = [
    "crates/bilibili-live-protocol",
    "crates/voice",
    "crates/streamix-changer",       # 场景三 A 独立程序（RVC）
    "crates/streamix-changer-lite",  # 场景三 B 独立程序（DSP）
]
```

## 系统依赖

```bash
# espeak-ng（Kokoro phonemizer，方案 A / 场景二必须）
brew install espeak-ng          # macOS
sudo apt install espeak-ng      # Linux

# CosyVoice 2 sidecar（场景一 方案 B）
pip install cosyvoice fastapi uvicorn

# Fish Speech sidecar（场景一 方案 C）
pip install fish-speech
# 或源码安装：git clone https://github.com/fishaudio/fish-speech && pip install -e .

# RVC（场景三 方案 A）
# 方式一：w-okada voice-changer（推荐，有 UI 可手动管理声库）
# https://github.com/w-okada/voice-changer
# 方式二：rvc-python
pip install rvc-python

# RubberBand（场景三 方案 B，系统库）
brew install rubberband          # macOS
sudo apt install librubberband-dev  # Linux
```

## 推荐起步路径

```
场景一  →  方案 A 先跑通（Kokoro + SenseVoice + 云端 LLM，无外部进程）
           需要音色克隆且重视情感标签  → 升方案 B（CosyVoice）
           需要音色克隆且重视流式延迟  → 升方案 C（Fish Speech）

场景二  →  方案 A 关键词部分不依赖 LLM，1 天内可跑通
           方案 B 与方案 A 本地资源相同，区别只在 ASR 精度和 LLM 配置

场景三  →  方案 B-1（内置 DSP）当天可跑通，零 Python 依赖
           需要音色克隆  → 叠加方案 A（RVC sidecar）
           想解耦进程    → 改用对应的独立程序变体（A-2 / B-2）
```
