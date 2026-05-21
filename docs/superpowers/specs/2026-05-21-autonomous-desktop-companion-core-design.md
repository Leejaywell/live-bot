# Autonomous Desktop Companion Core Design

Date: 2026-05-21

## Purpose

This design defines a long-term architecture for a 24-hour autonomous desktop companion: a general work agent with a virtual-life presence. Streamix remains the first scenario adapter because it already has live-stream I/O, danmaku events, TTS/ASR/VAD, OBS integration, music interaction, and overlay plugins. The new system should not be limited to live streaming. It should eventually help humans do work, manage tasks, learn from approved sources, operate a controlled computer workspace, and express itself through rich configurable avatar actions.

## Product Positioning

The target product combines two directions:

- **General desktop agent first:** It can receive tasks, plan work, use approved tools, report progress, learn from documents and outcomes, and ask for approval when risk is high.
- **Virtual life form second:** It has an embodied presence through an avatar, can move and react on the desktop, can use continuous actions and expressions, and can be customized by the user.

Live streaming is the first visible scenario, not the whole product. Streamix provides the first runtime channel where the companion can talk, listen, react, control OBS, play media, and interact with viewers.

## Reference Influences

The design takes product and architecture ideas from the previously reviewed projects:

- `live-stream-chat-ai-agent`: multimodal live context, per-room memory, and controlled live interaction.
- `AI-YinMei`: broad agent tools, intent analysis, memory, points, avatar actions, and livestream-oriented automation.
- `ai_virtual_mate_comm`: desktop companion, voiceprint, Live2D/MMD/VRM display, local/cloud model configuration, and active perception.
- `ZerolanLiveRobot`: AI VTuber control framework, tools, vector memory, OCR/vision, OBS subtitles, Live2D, and WebUI.
- `ChopperBot`: plugin-oriented architecture, live analytics, hot intervals, clipping, and creator operations.

These are references, not implementation dependencies. Streamix should keep its Rust/Tauri architecture and integrate external services through explicit adapters.

## Current Streamix Context

Streamix already provides:

- Rust/Tauri desktop app.
- Normalized live platform events through `PlatformEvent`.
- Bilibili-centered live connection and a plan for listener-only Douyu, Huya, and Douyin.
- Bot rules for welcome, thanks, filtering, and activity notices.
- AI reply support with short session memory and Agent tools.
- TTS, ASR, VAD, and local model support through `streamix-voice`.
- OBS integration.
- Music request queue, credits, and ranking.
- Local overlay server and plugin pages for danmaku, wish goals, lottery, gift effects, recent gifts, gift rank, and song requests.

The new companion core should not absorb Streamix internals. Streamix should expose controlled APIs and remain usable as a normal live assistant if the companion core is stopped.

## System Architecture

The system is split into five runtimes.

### Agent Core

Agent Core is the independent decision and memory service. It owns:

- World model.
- Task management.
- Planning.
- Decision making.
- Tool routing.
- Learning and memory.
- Safety supervision.
- Approval queue.
- Watchdog and health management.
- Audit logs.

Agent Core communicates with the other runtimes over local HTTP/WebSocket APIs. It should be designed so it can run as a standalone service.

### Workspace Runtime

Workspace Runtime owns computer work execution. It provides:

- Sandboxed browser.
- Approved application control.
- File access through allowed folders.
- Future main-desktop control behind permissions.
- Screenshots or observations from approved scopes.
- Tool adapters for documents, spreadsheets, web search, local scripts, and other work skills.

Workspace Runtime must not grant unrestricted host access by default.

### Streamix Runtime

Streamix Runtime is the live-stream adapter. It provides:

- Live room state.
- Live events.
- Danmaku sending.
- TTS speaking.
- OBS scene and text control.
- Music/media control.
- Overlay plugin control.
- Stream session stats and interaction summaries.

Streamix does second-pass permission checks before executing side effects.

### Avatar Runtime

Avatar Runtime owns embodiment. It provides:

- Expression library.
- Action timeline.
- Gesture composition.
- Avatar adapters for VTube Studio, Live2D browser sources, VRM/Unity, or later custom renderers.
- Desktop presence behavior such as idle, movement, pointing, thinking, reacting, and following context.
- User-defined actions and expression triggers.

Agent Core sends semantic avatar actions. Avatar Runtime maps them to concrete implementation details.

Example semantic action:

```json
{
  "emotion": "happy",
  "intensity": 0.7,
  "gesture": "wave",
  "duration_ms": 2000,
  "followup": "idle_smile"
}
```

### Human Control Plane

Human Control Plane owns human oversight:

- Task inbox and task status.
- Approval queue.
- Permission configuration.
- Budget settings.
- Memory review and promotion.
- Skill registry management.
- Avatar action editor.
- Pause, resume, and emergency takeover.

The human control plane can be implemented in Streamix UI initially, but it should be conceptually separate from the live runtime.

## Agent Core Modules

### World Model

Maintains the current state of the companion's world:

- Current task list and active task.
- Current live stream state.
- Recent chat, gift, paid message, follow, and system events.
- Current OBS scene and media state.
- Current avatar state.
- Current work session state.
- Cost and budget usage.
- Recent tool calls and failures.
- Current operating mode.

### Task Manager

Turns the companion into a general work agent:

- Receives tasks from the user.
- Stores status: inbox, planned, running, blocked, waiting approval, done, failed, archived.
- Tracks priority, due dates, dependencies, and required permissions.
- Links tasks to audit records and tool calls.
- Supports recurring tasks later.

### Planner

Breaks work into steps:

- Creates an initial task plan.
- Selects required tools.
- Marks high-risk steps before execution.
- Updates plans when tools fail or the user changes direction.
- Produces progress summaries.

### Program Director

Runs long-lived autonomous behavior, especially during livestreaming:

- Chooses the current program mode: chat, music, topic talk, learning, recap, idle, rest, interactive game, or work showcase.
- Prevents excessive LLM calls by scheduling decisions at a controlled cadence.
- Coordinates with Task Manager when the stream includes work sessions.

### Decision Engine

Makes short-term decisions:

- Selects which chat message to answer.
- Chooses whether to speak, send danmaku, search, learn, change scene, or idle.
- Produces candidate actions with reasons.
- Passes all actions through Safety Supervisor before tool execution.

### Tool Gateway

Controls tool execution:

- Only calls registered tools.
- Checks permission level, scope, timeout, frequency, and budget.
- Requires action IDs for idempotency and audit.
- Routes live actions to Streamix Runtime.
- Routes work actions to Workspace Runtime.
- Routes avatar actions to Avatar Runtime.

### Learning and Memory

Maintains multiple memory layers:

- Short-term context for the current task or stream.
- Long-term user profile and preferences.
- Work memory for task outcomes and process knowledge.
- Live memory for audience interactions and stream patterns.
- Low-trust learned notes from webpages and tool outputs.
- High-trust memory promoted by user confirmation or stable repeated evidence.

Learning sources are also graded:

- S0: live stream observations.
- S1: approved user documents and project files.
- S2: sandboxed browser search.
- S3: external tool results.
- S4: human-confirmed knowledge.

Low-trust memory cannot directly authorize high-risk actions.

### Safety Supervisor

Applies safety and operational constraints:

- Permission level checks.
- Content policy and platform compliance checks.
- Frequency limits for chat, TTS, OBS changes, and browser actions.
- Budget limits for model calls, TTS, VLM, search, media, purchases, and publishing.
- Loop detection and repetitive behavior suppression.
- Privacy and secret handling.
- Risk summaries for L4-L6 actions.
- Automatic downgrade to read-only mode when abnormal behavior is detected.

### Watchdog

Keeps the system alive for 24-hour operation:

- Heartbeats for Agent Core, Streamix Runtime, Workspace Runtime, and Avatar Runtime.
- Restart strategy for failed non-critical tools.
- Network and API failure monitoring.
- Live room disconnect detection.
- Log rotation.
- Budget alerts.
- Stuck-task detection.
- Emergency stop support.

## Permission Model

Permissions are organized from L0 to L6.

- **L0 Observe:** Read state, events, documents, and approved context. No side effects.
- **L1 Speak and chat:** TTS and controlled danmaku.
- **L2 Live controls:** OBS text, approved scene changes, music/media, and overlay plugins.
- **L3 Sandbox work:** Sandboxed browser, approved knowledge base, low-trust memory writes.
- **L4 Approved app control:** White-listed desktop applications and approved folders.
- **L5 Account and publishing:** Content publishing, real account operations, important file writes, and creator operations.
- **L6 High-risk operations:** Payment, purchase, system settings, software installation, deletion of important files, account security changes, and other irreversible or costly actions.

L6 is allowed in the long-term design only with the combined boundary confirmed by the user:

- Human approval before real high-risk execution.
- Sandbox or test account execution for autonomous drills.
- Explicit limits such as daily budget, platform whitelist, file/folder whitelist, merchant whitelist, posting frequency, and amount caps.

Default L6 behavior:

- No whitelist or budget means no execution.
- Every L6 action requires a `risk_summary`.
- Every L6 action requires an audit record.
- Real payment, real account publishing, important file deletion, system setting changes, and software installation require human confirmation unless the user has explicitly configured a narrow autonomous sandbox rule.

## API Boundaries

### Streamix Runtime Read APIs

Initial Streamix APIs for Agent Core:

- `GET /agent/state`
- `GET /agent/events/recent`
- `GET /agent/session/stats`
- `GET /agent/music/queue`
- `GET /agent/memory/context`
- `WS /agent/events`

### Streamix Runtime Action APIs

Initial Streamix action APIs:

- `POST /agent/actions/send-danmu`
- `POST /agent/actions/speak`
- `POST /agent/actions/obs-scene`
- `POST /agent/actions/obs-text`
- `POST /agent/actions/music`
- `POST /agent/actions/plugin`
- `POST /agent/actions/mode`

Every action request includes:

- `agent_action_id`
- `requested_by`
- `permission_level`
- `reason`
- `payload`
- `expires_at`

Streamix validates action shape, rate limit, permission, and current platform capability before executing.

### Workspace Runtime APIs

Initial Workspace APIs:

- `GET /workspace/state`
- `POST /workspace/browser/search`
- `POST /workspace/browser/open`
- `POST /workspace/browser/screenshot`
- `POST /workspace/files/read`
- `POST /workspace/files/write-draft`
- `POST /workspace/apps/invoke`

File writes are drafts by default. Real writes outside approved folders require higher permission.

### Avatar Runtime APIs

Initial Avatar APIs:

- `GET /avatar/state`
- `GET /avatar/actions`
- `POST /avatar/actions/perform`
- `POST /avatar/timeline/play`
- `POST /avatar/library/reload`

Actions are semantic at the Agent Core boundary and concrete inside Avatar Runtime.

## Operating Modes

The companion has explicit operating modes:

- **Observe:** Reads and learns only.
- **Assist:** Can speak, chat, and produce suggestions.
- **Autonomous Live:** Can run live programming, OBS/media/plugin actions, sandbox search, and low-trust learning.
- **Work Agent:** Can execute user tasks through approved workspace tools.
- **Operator:** Can request or execute L4-L6 actions according to approval, sandbox, whitelist, and budget rules.
- **Paused:** No autonomous actions. State and logs remain available.

Mode changes are audited and can be controlled by the user.

## Avatar and Action Design

The avatar system should support unlimited future richness without making Agent Core depend on any one renderer.

Core abstractions:

- **Expression Library:** Named expressions and actions with metadata.
- **Action Timeline:** Ordered sequences with duration, easing, overlap, and follow-up states.
- **Gesture Composer:** Converts emotion, speech content, audience events, and task state into action sequences.
- **Avatar Adapter:** Maps semantic actions to VTube Studio, Live2D, VRM, Unity, or browser-source commands.
- **User Custom Actions:** User-created triggers and action timelines.
- **Desktop Presence:** Movement, idle behavior, pointing, focus, and contextual reactions inside the computer workspace.

Examples:

- Gift received -> surprised -> happy -> thank-you gesture -> idle smile.
- Thinking during work -> look down -> typing gesture -> glance at user -> continue idle.
- Task completed -> proud expression -> short celebration -> report summary.
- User scolds it -> embarrassed -> apologize -> lower movement intensity.

First implementation should only define the abstraction and a minimal adapter. The full action editor can come later.

## 24-Hour Autonomous Live Behavior

During livestreaming, Program Director coordinates:

- Chat interaction.
- Gift thanks.
- Topic selection.
- Cold-start and cold-room recovery.
- Music and media segments.
- Work showcase segments.
- Learning/reading segments.
- Rest/idle segments.
- Stream recap.

The system should optimize for stable long-running behavior before intelligence. A boring but stable 24-hour stream is a better first milestone than a clever stream that loops, spams, or fails after one hour.

## MVP Scope

The first implementation should build the autonomous system skeleton, not the full long-term product.

MVP includes:

- Independent Agent Core service.
- Streamix Runtime API boundary.
- World Model.
- Task Manager base model.
- Program Director base loop.
- Decision Engine base loop.
- Tool Gateway.
- Safety Supervisor.
- Watchdog.
- Audit log.
- Permission levels L0-L6.
- Approval queue and L6 risk summaries.
- Sandboxed browser tool.
- Low-trust learning memory.
- Runtime modes: Observe, Assist, Autonomous Live, Work Agent, Operator, Paused.
- Avatar semantic action model.
- Minimal avatar action adapter.

MVP can autonomously:

- Read live events.
- Choose live program state.
- Reply to selected messages.
- Speak through TTS.
- Control whitelisted OBS scenes and text sources.
- Control whitelisted music/media actions.
- Use sandbox browser search.
- Write low-trust memory.
- Manage a task inbox and simple task plans.
- Generate L6 action requests.

MVP cannot autonomously:

- Make real payments.
- Publish through real accounts without approval.
- Delete or move important files.
- Modify system settings.
- Install software on the host.
- Operate the unrestricted host desktop.
- Execute L6 without configured approval, sandbox, whitelist, and budget limits.

## Phased Roadmap

### Phase 0: Protocol and Safety Foundation

Define APIs, action schemas, permission levels, audit records, operating modes, approval queue, and emergency stop.

### Phase 1: Agent Core Skeleton

Implement World Model, Task Manager, Program Director, Decision Engine, Tool Gateway, Safety Supervisor, Watchdog, and audit logs.

### Phase 2: Streamix Live Scenario

Connect Streamix live events, TTS, danmaku, OBS subtitles/scenes, music/media, and overlay plugin actions.

### Phase 3: Learning and Memory

Add approved documents, sandbox search summaries, live recap learning, low-trust memory, high-trust promotion, and memory review UI.

### Phase 4: Workspace Agent

Add task execution through sandbox browser, file draft operations, approved folders, and white-listed applications.

### Phase 5: Avatar Runtime

Add expression library, action timelines, user custom actions, VTube Studio or Live2D adapter, and basic desktop presence.

### Phase 6: L6 Controlled Operations

Add high-risk approval workflows, test account drills, budget caps, whitelists, risk summaries, rollback instructions, and real execution only after explicit configuration.

### Phase 7: Creator Operations

Add stream summaries, hot interval detection, clip candidates, title/cover suggestions, and publishing requests. Any real publishing uses L5/L6 controls.

## Verification Strategy

Testing proceeds in escalating runtime windows:

- 30-minute dry run in Observe mode.
- 2-hour Assist mode run.
- 8-hour Autonomous Live run.
- 24-hour Autonomous Live run.
- Work Agent task drills in sandbox.
- L6 drills in test accounts or sandbox only.

Checks:

- No uncontrolled spam.
- No budget overrun.
- No stuck loops.
- No unauthorized tool use.
- No high-risk action without required approval or sandbox rule.
- Logs are complete enough to replay decisions.
- Emergency pause works.
- Runtime can recover from Streamix disconnect, browser failure, model failure, and TTS failure.

## Success Criteria

The first version is successful if:

- Agent Core can run separately from Streamix.
- Streamix remains usable when Agent Core is stopped.
- The companion can run a safe autonomous live loop.
- It can manage simple tasks and report progress.
- It can learn low-trust notes without polluting high-trust memory.
- It can express semantic avatar actions through at least one minimal adapter.
- It can request L6 actions without executing them outside approval, sandbox, whitelist, and budget rules.
- All meaningful decisions and actions are auditable.

## Open Implementation Boundary

The first implementation plan should not attempt the full long-term product. It should focus on Phase 0 and Phase 1, with a thin Streamix integration from Phase 2 only where needed to verify the loop.

The implementation plan should explicitly avoid:

- Full main-desktop automation.
- Real account publishing.
- Real payments or purchases.
- Full avatar action editor.
- Full creator clipping and publishing.
- Large refactors of existing Streamix internals.

