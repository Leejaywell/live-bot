# Reference Project Feature Roadmap Design

Date: 2026-05-21

## Purpose

This design compares five live AI assistant and virtual streamer projects and turns the useful ideas into a phased roadmap for Streamix. The goal is not to copy those projects. The goal is to identify which capabilities fit Streamix's current Rust/Tauri desktop architecture, existing live event pipeline, AI reply flow, voice pipeline, OBS integration, music interaction, and overlay plugins.

## Current Project Context

Streamix already has the foundations needed for a local live assistant:

- A Rust backend with Tauri desktop UI.
- A platform abstraction around `PlatformEvent`, currently centered on Bilibili.
- Event handling for chat, gifts, follows, shares, entry, paid messages, guard/member purchases, popularity, battle, moderation, lottery, and system events.
- A bot engine for welcome, help, thanks, filtering, and activity notices.
- AI reply support with short session memory and a basic Agent runtime.
- TTS, ASR, VAD, local TTS, and model hub support through `streamix-voice`.
- OBS WebSocket integration.
- Music interaction with queue, request credits, ranking, and plugin overlays.
- Web overlay plugins for danmaku chat, wish goals, lottery, gift effects, recent gifts, gift rank, and song requests.

The strongest product fit is to evolve Streamix into a more context-aware live interaction assistant before expanding into avatar performance and creator operations.

## Reference Projects

### live-stream-chat-ai-agent

Repository: https://github.com/bOOOOcG/live-stream-chat-ai-agent/tree/main

Useful ideas:

- Multimodal context: live audio, chat history, and screenshots are combined for LLM responses.
- Per-room persistent memory and a notepad.
- User-facing control panel for start/stop and local capture controls.
- Explicit warnings about automated chat, platform terms, API cost, and output quality.

Fit for Streamix:

- The multimodal context and per-room memory model are directly useful.
- The userscript architecture is not a good fit because Streamix already has a native desktop app, platform adapters, and overlay server.

### AI-YinMei

Repository: https://github.com/worm128/AI-YinMei

Useful ideas:

- Aggregated live chat across multiple platforms.
- Intent analysis and emotion classification.
- Long-term memory, short-term memory, knowledge base, and user points.
- Rich tool set, including search, vision, drawing, singing, video playback, clothing/scenes, and MCP tools.
- Live2D/VTube Studio style avatar actions, expression triggers, and OBS-oriented scenes.

Fit for Streamix:

- Intent routing, user points, long-term memory, expression triggers, and tool registration are useful.
- The full product is intentionally broad. Streamix should not adopt a wide all-in-one scope before the interaction core is reliable.
- Some advertised features are tied to non-open full editions, so they should be treated as product references rather than implementation sources.

### ai_virtual_mate_comm

Repository: https://github.com/MewCo-AI/ai_virtual_mate_comm

Useful ideas:

- Voiceprint recognition to avoid false triggers and self-interruption.
- Live2D desktop pet, MMD, VRM, and web-based character display.
- Active perception from time, screen, and camera context.
- Local and cloud model configuration for LLM, ASR, TTS, and VLM.
- Multiple assistant modes for music, software control, writing, translation, smart home, weather, news, search, and video generation.

Fit for Streamix:

- Voiceprint gating, active perception, model configuration UX, and avatar display modes are useful.
- The Python GUI and Windows-heavy stack should not be copied into Streamix. Integrations should be implemented as Rust/Tauri adapters or external service connectors.

### ZerolanLiveRobot

Repository: https://github.com/AkagawaTsurunaki/ZerolanLiveRobot

Useful ideas:

- AI VTuber control framework with ASR, LLM, TTS, OCR, image captioning, video captioning, tools, short memory, vector memory, OBS subtitles, Live2D, and WebUI.
- Selective chat replies instead of replying to every message.
- Window OCR and image understanding for live context.
- Tool selection based on context.
- OBS streaming subtitles and typewriter-style assistant output.

Fit for Streamix:

- Selective reply scoring, vector memory, OBS subtitles, visual context, and tool-agent structure are strong fits.
- Minecraft, QQ bot, Unity/AR, and unrelated device control are outside the near-term Streamix scope.

### ChopperBot

Repository: https://github.com/Geniusay/ChopperBot/tree/master

Useful ideas:

- Plugin-oriented system architecture.
- Multi-platform live discovery and hot stream monitoring.
- Barrage analysis to score high-interest intervals.
- Automated clipping, title/cover generation, and publishing.
- Account persona and content category targeting.

Fit for Streamix:

- Barrage heat scoring, live session analysis, plugin boundaries, and replay summaries are useful.
- Full automatic clipping and publishing is a separate product line. It should be delayed until Streamix has reliable interaction data and session records.

## Recommended Direction

Use approach A as the main roadmap, with B and C as later extensions:

1. Interaction core first: long-term memory, user profiles, intent routing, and selective replies.
2. Live context second: OBS/screen/window capture, OCR/VLM, and richer session awareness.
3. Avatar performance third: OBS subtitles, VTube Studio actions, Live2D/browser-source display, expression and mouth-sync hooks.
4. Extension ecosystem fourth: tools, plugin permissions, external HTTP tools, MCP-compatible tools, knowledge-base adapters, and general points ledger.
5. Creator operations last: stream summaries, hot intervals, clip candidates, then possible automated clipping and publishing.

This order keeps the product aligned with its current architecture and avoids turning Streamix into a large unrelated automation suite.

## Feature Roadmap

### P0: Interaction Intelligence

Scope:

- Add long-term user profiles and memory summaries.
- Score incoming messages so the assistant responds to important chat first.
- Add intent routing for chat, song requests, lottery, stats queries, thanks, moderation, and tool actions.
- Extend built-in Agent tools to query stats, query/update memory, and send controlled danmaku.

Recommended design:

- Store memory in SQLite first, because Streamix already uses `rusqlite`.
- Add tables for user profiles, memory facts, memory summaries, and memory audit records.
- Keep embedding optional. Start with structured facts and text search, then add embeddings behind a feature flag or external provider.
- Introduce a `MessagePriority` layer before AI reply decisions. Inputs should include event type, gift/SC value, user interaction history, blacklist/filter state, command match, and recent repetition.
- Introduce an `IntentRouter` that returns a typed intent instead of forcing every message through freeform chat.

Candidate libraries and services:

- Existing `rusqlite` for persistent records.
- Existing `serde` and `serde_json` for typed memory metadata.
- Optional external embedding API through the existing OpenAI-compatible client path.
- Optional local embedding later via `fastembed`, `candle`, or a small sidecar service if native dependencies become too heavy.

Feasibility: high.

Practicality: high.

Reasoning:

- This reuses existing event and storage structures.
- It improves live quality immediately: the assistant remembers people, picks better messages, and reduces noisy replies.

### P1: Live Context and Performance

Scope:

- Add OBS subtitle output for user and assistant messages.
- Add optional screenshot or window capture for VLM context.
- Add VTube Studio expression/action triggers.
- Add basic voiceprint or wake-speaker gating only after the current voice path is stable.

Recommended design:

- Implement OBS subtitles first by extending existing OBS integration to update named text sources.
- Implement VTube Studio as an external WebSocket integration. Avoid self-hosting a full Live2D runtime in the first version.
- Implement visual context as a controlled snapshot feature: manual snapshot, timed snapshot, or event-triggered snapshot. Do not stream video frames continuously into the model.
- Add a `LiveContextSnapshot` structure that can include recent chat, recent gifts, current OBS scene, screenshot reference, ASR transcript, and active session stats.

Candidate libraries and services:

- Existing `obs.rs` and OBS WebSocket.
- VTube Studio Public API over WebSocket.
- Rust screenshot libraries such as `screenshots` or `xcap`, if local capture is needed.
- Cloud or local VLM through an OpenAI-compatible vision endpoint.
- Existing `sherpa-onnx` path for future speaker recognition, or an external CAMPPlus/3D-Speaker sidecar.

Feasibility: medium to high.

Practicality: high.

Reasoning:

- OBS subtitles and avatar expressions are visible to viewers and low risk.
- Visual understanding is useful, but must be rate-limited to control cost and avoid latency.

### P2: Extension Ecosystem

Scope:

- Formalize a tool registry.
- Support configured external HTTP tools.
- Add tool permissions.
- Add knowledge-base adapters.
- Expand song request credits into a general points ledger.

Recommended design:

- Keep built-in tools in Rust.
- Define an external tool schema with name, description, JSON parameters, endpoint, timeout, and permissions.
- Add permissions for sending danmaku, reading memory, writing memory, controlling OBS, reading screenshots, and opening files/URLs.
- Add knowledge-base adapters for Dify, AnythingLLM, FastGPT, and generic OpenAI-compatible retrieval APIs.
- Generalize existing music credits into a `points_ledger` that records source, user, delta, reason, session, and event reference.

Candidate libraries and services:

- Existing `reqwest` for external tools and RAG services.
- Existing `serde_json` for tool schemas.
- Dify, AnythingLLM, FastGPT, or custom HTTP retrieval endpoints.
- MCP support later, once local tool permission boundaries are stable.

Feasibility: medium.

Practicality: medium to high.

Reasoning:

- This unlocks breadth without hardcoding dozens of unrelated features.
- Permissions are required before giving AI tools live-stream side effects.

### P3: Session Analytics and Clip Candidates

Scope:

- Add live session summary.
- Detect high-interest intervals from chat/gift/activity spikes.
- Generate a replay report after the stream.
- Export clip candidate timestamps and reasons.

Recommended design:

- Build on the existing session event records.
- Compute rolling windows for message rate, gift value, paid messages, follows, guard/member events, and AI response density.
- Store candidate intervals with start, end, score, dominant signals, and representative messages.
- Do not cut video in P3. Export metadata first.

Candidate libraries and services:

- Existing SQLite storage and event records.
- `chrono` for time windows.
- Optional LLM summarization through current AI providers.

Feasibility: medium.

Practicality: medium.

Reasoning:

- It provides creator value without taking on platform publishing and video processing risk.

### P4: Automated Clipping and Publishing

Scope:

- Cut local recordings by candidate intervals.
- Generate titles, descriptions, tags, and cover suggestions.
- Optionally publish to target platforms.

Recommended design:

- Treat this as a separate module or later product area.
- Require explicit user confirmation before upload.
- Use local recording file paths or OBS replay buffer outputs.
- Avoid account automation until compliance, login, and rate-limit risks are understood.

Candidate libraries and services:

- `ffmpeg` or a Rust wrapper such as `ffmpeg-next`.
- VLM/LLM title and cover analysis.
- Selenium/Playwright or official platform APIs only where allowed.

Feasibility: low to medium.

Practicality: medium, but only for creator-operations users.

Reasoning:

- The feature can be valuable, but it is not necessary for making the live assistant better.
- It adds platform risk and a large maintenance surface.

## Out of Scope for Near Term

- Minecraft control, QQ bot integration, smart home control, and general desktop automation.
- A self-developed Live2D renderer.
- Neo4j or graph-database-based "diffusion thinking" as a default dependency.
- Fully automated video publishing.
- Copying code directly from reference projects with incompatible licenses or architecture.

## Architecture Boundaries

The roadmap should preserve these boundaries:

- Platform adapters emit normalized `PlatformEvent` values.
- Bot and Agent layers decide what to do with events.
- Storage records events, sessions, memory, profiles, points, and analytics.
- Voice pipeline remains in `streamix-voice`.
- OBS and avatar integrations are side-effect adapters with explicit permissions.
- Overlay plugins remain web views served by the local overlay server.
- External tools and knowledge bases are adapters, not core dependencies.

## Testing Strategy

P0 testing should include:

- Unit tests for message priority scoring.
- Unit tests for intent routing.
- Storage tests for memory/profile create, update, summarize, and query.
- Bot integration tests showing that high-priority messages are selected before low-priority chatter.

P1 testing should include:

- OBS adapter tests with mocked WebSocket calls where practical.
- VTube Studio adapter tests for payload construction.
- Snapshot assembly tests that verify recent chat, stats, ASR text, and screenshot metadata are included without leaking disabled data.

P2 testing should include:

- Tool schema validation.
- Permission denial tests.
- External tool timeout and failure handling tests.
- Knowledge-base adapter contract tests with mocked HTTP responses.

P3 testing should include:

- Rolling-window analytics tests.
- High-interest interval scoring tests.
- Replay summary generation tests with deterministic fixtures.

## Success Criteria

The roadmap is successful if Streamix gains capabilities in this order:

1. The assistant remembers recurring users and can use that memory in responses.
2. The assistant selects better messages instead of replying uniformly.
3. Commands and intents route to reliable typed actions before falling back to freeform chat.
4. OBS subtitles and avatar expressions can be driven by assistant output.
5. Live visual context can be added to AI prompts under explicit user control.
6. Tools and knowledge bases can be added without changing core bot code.
7. Session summaries and high-interest intervals can be generated from recorded live events.

## Implementation Plan Handoff

The first implementation plan should focus only on P0:

- Long-term memory and user profile storage.
- Message priority scoring.
- Intent routing.
- Minimal Agent tools for memory and stats.
- Focused tests for the above.

P1 and later phases should not be started until P0 behavior is verified.
