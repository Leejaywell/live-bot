# 功能审计报告

**日期**：2026-05-14  
**范围**：后端功能完整性 + 前后端对接一致性

---

## 一、功能清单与触发逻辑

### 1. 关键词自动回复

**配置字段**：`KeywordReply` / `KeywordReplyList`  
**触发路径**：
```
Danmu 事件 → BotEngine.keyword_reply()
  → config.keyword_reply == true
  → 遍历 keyword_reply_list，text.contains(关键词)
  → 命中第一条 → 回复对应值
```
**已知问题**：用 `.find()` 只取第一条命中，多关键词同时满足时后续规则不执行。

---

### 2. 礼物感谢 + 礼物汇总

**配置字段**：`ThanksGift` / `ThanksMinCost` / `ThanksGiftTimeout` / `GiftSummaryThanks` / `GiftSummaryTemplate` / `GiftAliases` / `GiftThanksTemplates`  
**触发路径**：
```
Gift 事件 → gift_tx.try_send() → run_gift_aggregator（独立 Task）
  → 按 ThanksGiftTimeout（默认3秒）定时 flush
  → 聚合同一用户所有礼物 → ThanksMinCost 过滤
  → 输出感谢弹幕 + （GiftSummaryThanks=true 时）汇总行
```
**盲盒统计**：`BlindBoxProfitLossStat` 开关，收到带 `original_gift_name` 的礼物时写 `blind_box_stat` 表。

**已知问题**：`ThanksMinCost`、`GiftSummaryThanks`、礼物别名、自定义模板等字段在 AutoReply 页「礼物感谢」tab 中标为「开发中」，**配置界面完全缺失**，只能手动编辑 TOML。

---

### 3. 关注/分享答谢

**配置字段**：`ThanksFocus` / `ThanksShare` / `FocusDanmu`  
**触发路径**：
```
Interact(Follow/MutualFollow) → BotEngine.thanks()
  → config.thanks_focus == true
  → "感谢 {user} 的关注!" + 随机抽 FocusDanmu 一条

Interact(Share) → BotEngine.thanks()
  → config.thanks_share == true
  → "感谢 {user} 的分享!" + 随机抽 FocusDanmu 一条
```
**已知问题**：`ThanksShare` 在 Dashboard 没有 Toggle，无法从 UI 控制。`ThanksFocus` 的 Toggle 被放在「AI 机器人」卡片下，归属不准确。

---

### 4. 舰长购买感谢

**配置字段**：`ThanksGift`（与普通礼物共用同一开关）  
**触发路径**：
```
GuardBuy 事件 → BotEngine.thanks()
  → config.thanks_gift == true
  → "感谢 {user} 的 {gift}"
```
**已知问题**：与普通礼物感谢共用同一开关，无法单独控制。

---

### 5. SC（醒目留言）感谢

**配置字段**：无（硬编码，始终触发）  
**触发路径**：
```
SuperChat 事件 → BotEngine.thanks()
  → 无条件输出 "感谢 {user} 的 SC (¥{price})：{text}"
```
**已知问题**：没有任何开关，用户无法关闭。

---

### 6. 红包雨感谢

**配置字段**：`ThanksGift`（复用）  
**触发路径**：
```
RedPocket(New) 事件 → BotEngine.pk_and_activity_notice()
  → config.thanks_gift == true
  → "感谢 {user} {price}电池的 {gift}"
```

---

### 7. PK 提醒

**配置字段**：`PkNotice`  
**触发路径**：
```
Pk(Start) → "PK开始，对手直播间候选: {init_room}/{match_room}"
Pk(End)   → "PK结束"
Pk(Other) → "检测到PK事件: {command}"
```
**已知问题**：Start 时两个房间号均为候选，B站协议在 Start 阶段不确定最终对手，输出信息不够准确。

---

### 8. 禁言提醒

**配置字段**：`ShowBlockMsg`  
**触发路径**：
```
Block 事件 → BotEngine.pk_and_activity_notice()
  → config.show_block_msg == true
  → "{user} 被禁言"
```

---

### 9. 弹幕过滤（黑名单 + 敏感词 + 重复检测）

**配置字段**：`DanmuFilterEnable` / `DanmuFilterWords` / `DanmuFilterRepeatThreshold` / `PermanentBlacklistUsers` / `PermanentBlacklistNames`  
**触发路径**：
```
任何事件进入 BotEngine.handle_event()
  ① is_permanently_blacklisted()
      uid 精确匹配 PermanentBlacklistUsers
      或 name 包含 PermanentBlacklistNames 中任意词
    → 命中 → 丢弃（不受 DanmuFilterEnable 控制）

  ② is_filtered_danmu()（仅弹幕事件，受 DanmuFilterEnable 控制）
      text 包含 DanmuFilterWords 任意词
      或 同 uid + 同 text 出现次数 ≥ DanmuFilterRepeatThreshold
    → 命中 → 丢弃
```

---

### 10. 定时弹幕

**配置字段**：`CronDanmu` / `CronDanmuList`（cron 表达式 + 消息列表 + 是否随机）  
**触发路径**：
```
monitor 启动时，CronDanmu == true
  → 每条 entry：5位 cron → 补0秒前缀变6位，解析 Schedule
  → 独立 tokio 任务 per entry，到期触发
  → Random=true → 随机选；否则 → 按 index 顺序轮换
  → send_tx.send(message)
```
**UI 状态**：功能完整，AutoReply 页「定时任务」tab 配置界面可用。

---

### 11. AI 机器人（直播弹幕触发）

**配置字段**：`AiBots`（列表）+ `AiProviders`  
**触发路径**（优先级从高到低）：
```
Danmu 事件，通过 engine.handle_event() 处理完规则回复后，进入 AI 判断段

优先级1：精确 @昵称 前缀
  text.starts_with("@{bot.nickname}") 且 bot.enabled
  → prompt = text 去掉触发前缀部分

优先级2：昵称模糊包含（未被优先级1命中）
  text.contains(bot.nickname) 且 bot.enabled
  → prompt = 完整 text

优先级3：裸 @ 前缀（未被1、2命中，text.starts_with('@')）
  → 使用第一个 enabled bot
  → prompt = text[1..] 去掉 @

→ call_ai(bot_id, prompt, uid, uname, memory, agent_runtime)
    → AgentRuntime.run_with_provider()（支持 tool-calling，最多3轮）
    → 记录对话历史到 SessionMemory（滑动窗口10轮，按 bot_id 隔离）
    → 回复格式 "[{nickname}]{reply}" → send_tx
    → TtsEnabled → router.speak_ai(reply)
```
**内置工具（AgentRuntime）**：
- `send_danmu`：AI 可主动调用发送弹幕
- `get_session_stats`：AI 可查询当场统计数据

**已知问题**：
- `AiReplyToDanmaku` 字段存在但后端 monitor.rs **完全不读取**，开关无效。
- `TalkRobotCmd` / `FuzzyMatchCmd` 旧版配置字段**从未被新版 monitor 读取**，设置后无任何效果。
- 昵称前缀冲突：若 Bot A 昵称是 Bot B 昵称的前缀（如"二狗"和"二狗Plus"），`starts_with` 会错误触发 A。

---

### 12. AI 页面测试对话

**触发**：AI 页面输入框 → `invoke('send_ai_message')` → `robot_assistant_reply()`  
**路径**：找第一个 enabled bot → `openai_reply()`（单次请求，**不经过 AgentRuntime**，**不记录对话历史**）  
**已知问题**：测试对话与直播实际 AI 回复是两套独立路径，前者无 tool-calling、无历史记忆，测试结果不能代表直播时的真实表现。

---

### 13. TTS 语音播报

**配置字段**：`TtsEnabled` / `TtsVoice` / `ActiveTtsProviderId`  
**触发路径**：
```
monitor 启动，TtsEnabled == true
  → resolve_tts_engine() 按 provider.name 字符串匹配：
      contains("minimax") → MiniMax TTS
      contains("火山"/"volcengine"/"volc") → 火山引擎 TTS
      contains("azure") → Azure TTS
      其他 → Edge TTS（免费）
  → SpeakerRouter::spawn()（优先级队列）

规则回复 → router.speak_bot()   （优先级 1，最高）
AI 回复  → router.speak_ai()    （优先级 5）
OBS 消息 → router.speak_system()（优先级 10，最低）
```
**已知问题**：TTS 引擎识别靠 name 字段字符串匹配，与 provider_type 无关。用户自定义命名不含关键词时静默降级为 Edge TTS，无任何提示。

---

### 14. OBS 场景感知

**配置字段**：`ObsEnabled` / `ObsHost` / `ObsPort` / `ObsPassword`  
**触发路径**：
```
TtsEnabled && ObsEnabled
  → tokio::spawn(run_obs_client)
  → OBS WebSocket 4.x/5.x 连接
  → 场景切换 / 推流状态变化 → router.speak_system() 播报
```
**已知问题**：Voice 页面**没有** OBS 连接参数（host/port/password）的输入控件，只能手动编辑 TOML 配置文件。

---

### 15. VAD + ASR 语音识别（主播端麦克风）

**配置字段**：`VadEnabled` / `ActiveAsrProviderId` / `AiProviders`(type=asr)  
**前提条件**（feature flag `vad` 必须编译）：VAD 模型文件存在 + ASR 模型或外部 URL  
**触发路径**：
```
Voice 页面点击麦克风按钮
  → 校验: VAD模型/ASR模型/ASR配置
  → 保存 VadEnabled=true → stopMonitor() → startMonitor()

新 monitor 实例启动，VadEnabled == true
  → SherpaPipeline::spawn()（VAD + 可选本地 SenseVoice ASR）
  → 有外部 asr_url ?
      → run_asr_loop()（WhisperLive 协议）
  → 否则
      → run_sherpa_asr_event_loop()（本地模型）
  → SpeechEnd 事件携带 text → call_ai_voice()
      → 使用 voice_system_prompt（含 {{gender}} 占位符）
      → 不记录发言者次数，但记录对话历史
  → 回复 → send_tx + router.speak_ai()
```
**已知问题**：Voice 页面「实时字幕」区域有状态数组 `subtitles` 和监听逻辑，但**组件模板只渲染了静态占位图标**，`subtitles.map()` 渲染代码缺失，字幕数据永远不显示在界面上。

---

### 16. 场次统计（Dashboard）

**推送机制**：后端每 2 秒推送 `session-summary` 事件  
**Dashboard 统计**：调用 `getStats(-1)` → `periodic_summary(days=-1)` → 按 `occurred_at >= 今日 00:00` 日期过滤  
**已知问题**：统计口径是"今日日期"而非"当前 session_id"，跨午夜场次（00:00前开播、00:00后结束）的历史数据会被截断。

---

### 17. 弹幕计数（danmu_count 表）

**配置字段**：`DanmuCntEnable`  
**触发路径**：
```
Danmu 事件 → BotEngine.track_danmu()
  → config.danmu_cnt_enable == true
  → Storage.increment_danmu_count(uid, uname)
  → 写 danmu_count 表（upsert）
```
**注意**：这是旧版弹幕计数表（`danmu_count`），与新版 `interaction_records` 并行维护，按 roadmap 说明暂时保留。

---

## 二、前后端对接问题汇总

| 优先级 | 类型 | 问题描述 |
|---|---|---|
| 🔴 高 | 开关无效 | `AiReplyToDanmaku` — UI 有开关（Dashboard + AI 页），后端 monitor.rs 从不读取，设置后零效果 |
| 🔴 高 | 开关无效 | `TalkRobotCmd` / `FuzzyMatchCmd` — 旧版 AI 触发词，新架构下 monitor.rs 完全不读取 |
| 🔴 高 | 渲染缺失 | Voice 页「实时字幕」区域：`subtitles` 数组有数据但无渲染逻辑，字幕永远不显示 |
| 🟡 中 | 配置UI缺失 | 礼物感谢详细配置（ThanksMinCost / 模板 / 别名）— AutoReply 页标"开发中"，无法在 UI 配置 |
| 🟡 中 | 配置UI缺失 | OBS 连接参数（host/port/password）— Voice 页无对应输入控件，只能手动改 TOML |
| 🟡 中 | 功能缺开关 | SC 醒目留言感谢 — 硬编码，无开关，无法关闭 |
| 🟡 中 | 功能缺开关 | `ThanksShare`（分享答谢）— Dashboard 没有 Toggle |
| 🟡 中 | 开关归属混乱 | `ThanksFocus` 放在「AI 机器人」卡片下，实际是粉丝互动功能 |
| 🟡 中 | 路径不一致 | AI 页面测试对话无历史记忆、不走 AgentRuntime，与直播实际 AI 行为不一致 |
| 🟡 中 | 统计口径偏差 | Dashboard 统计按今日日期而非 session_id 过滤，跨日场次数据丢失 |
| 🟢 低 | 字段未实现 | `DrawByLot` / `SignInEnable` / `LotteryEnable` — api.ts 有定义，config.rs 无对应字段，后端完全未实现 |
| 🟢 低 | 引擎识别脆弱 | TTS 引擎按 provider name 字符串匹配，命名不含关键词时静默降级为 Edge TTS |
| 🟢 低 | 触发器冲突 | AI 昵称前缀冲突（"二狗" vs "二狗Plus"），`starts_with` 可能错误触发错误的 bot |

---

## 三、已实现但配置UI未完成的功能

以下功能后端逻辑完整，但前端缺少配置入口，用户须手动编辑 `etc/bilidanmaku-api.toml`：

- 礼物最低金额过滤（`ThanksMinCost`）
- 礼物感谢自定义模板（`GiftThanksTemplates`）
- 礼物别名映射（`GiftAliases`）
- 礼物汇总模板（`GiftSummaryTemplate`）
- OBS WebSocket 连接参数
- 分享答谢开关（`ThanksShare`）
- 特殊昵称映射（`SpecialNicknames`）
- 弹幕长度限制（`DanmuLen`）
- 登场语（`EntryMsg`）

---

## 四、完全未实现的功能（前端字段存在，后端无对应）

| 字段 | api.ts 中类型 | 后端状态 |
|---|---|---|
| `DrawByLot` | boolean | config.rs 无此字段，后端未实现 |
| `DrawLotsList` | string[] | 同上 |
| `SignInEnable` | boolean | config.rs 无此字段，后端未实现 |
| `LotteryEnable` | boolean | config.rs 无此字段，后端未实现 |
| `LotteryUrl` | string | config.rs 无此字段，后端未实现 |
