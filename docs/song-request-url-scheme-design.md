# 点歌功能设计：Meting 搜索 + 系统 URL Scheme 播放控制

## 背景

直播间点歌的核心目标不是“让观众随便发歌名”，而是让观众用最短路径点到准确歌曲，并用礼物金额控制点歌权益、排队优先级和主播可获得的收益空间。

本设计面向 Streamix 当前 Bilibili 直播助手架构：

- 弹幕、礼物、SC、舰长等事件已通过 `LiveEvent` 进入统一事件流。
- `interaction_records` 已记录 `uid`、`uname`、`text`、`gift_name`、`gift_count`、`gift_price` 和原始 JSON。
- 礼物目录 `live_gift_catalog` 已能保存礼物价格与图片。
- 发送弹幕、TTS 播报、OBS/浮层展示已具备基础能力。

音乐检索采用 [metowolf/Meting](https://github.com/metowolf/Meting) 的 Node.js 版本。Meting 支持网易云、腾讯音乐、酷狗、百度音乐、酷我等平台，并提供统一的搜索、歌曲信息、播放 URL、歌词、封面接口。系统播放控制采用本机 URL Scheme，优先调起用户已安装的音乐客户端或浏览器播放器。

## 产品目标

### 点歌方便

观众只需要记住一条主指令：

```text
点歌 歌名 歌手
```

允许自然变体：

```text
点歌 晴天
点歌 周杰伦 晴天
点歌 #3
送礼后点歌 稻香
```

机器人负责搜索、纠错、给候选编号、确认和入队。

### 点歌精准

精准度不依赖观众一次写完整信息，而通过“三段式”完成：

1. 弹幕解析：提取歌名、歌手、平台偏好、候选编号。
2. Meting 搜索：跨平台返回标准化候选，按匹配分排序。
3. 确认入队：低置信度时给 3 个候选，高置信度或使用 `#编号` 时直接入队。

### 礼物分层

礼物不是简单“给钱就播”，而是控制权益：

- 是否允许点歌。
- 每次点歌可占用的歌曲时长。
- 排队优先级。
- 是否允许插队。
- 是否允许指定版本、指定平台或重播。
- 是否触发主播口播、TTS、浮层高亮。

这能把低价礼物转化为参与入口，把中价礼物转化为稳定排队，把高价礼物转化为强展示和插队权益。

## 非目标

- 不在第一版内实现完整音乐版权托管或自建曲库。
- 不绕过音乐平台会员、地区、版权限制。
- 不把外部音乐 URL 直接暴露为公开下载能力。
- 不让观众直接控制系统任意 URL Scheme，只允许配置白名单内的音乐 Scheme。

## 用户路径

### 免费查询路径

```text
观众：点歌 晴天
机器人：找到 3 首，回复：1. 晴天 - 周杰伦；2. 晴天 - 汪苏泷；3. 晴天 - 周杰伦 Live。回复“点歌 #编号”确认，送指定礼物可入队。
观众：点歌 #1
机器人：当前需要至少 10 电池礼物才能入队，送“小花花 x10”或更高礼物后 5 分钟内自动绑定这首歌。
```

免费查询的作用是降低决策成本，让用户先看到候选，再被礼物门槛转化。

### 礼物后点歌路径

```text
观众：赠送 小花花 x10
机器人：感谢，获得普通点歌资格，5 分钟内发送“点歌 歌名 歌手”即可入队。
观众：点歌 晴天 周杰伦
机器人：已入队 #8，预计 12 分钟后播放。
```

### 高价插队路径

```text
观众：赠送 能量电池 x66
观众：点歌 稻香
机器人：已插入优先队列 #2，本首歌最多播放 90 秒。
```

### 主播控制路径

主播或房管在 Streamix 点歌面板中可以：

- 播放下一首。
- 跳过当前歌曲。
- 锁定/解锁点歌。
- 禁用某个用户点歌。
- 禁用某首歌或某个歌手。
- 手动调整队列顺序。
- 将当前歌曲加入主播收藏。

## 弹幕指令设计

### 观众指令

| 指令 | 示例 | 说明 |
| --- | --- | --- |
| `点歌 <关键词>` | `点歌 晴天 周杰伦` | 搜索并在高置信度时入队 |
| `点歌 #<编号>` | `点歌 #2` | 从最近一次候选中确认 |
| `取消点歌` | `取消点歌` | 取消自己的未播放点歌，不退礼物权益 |
| `我的点歌` | `我的点歌` | 查询自己的队列位置 |
| `换歌 <关键词>` | `换歌 夜曲` | 仅中高档权益可用，替换未播放歌曲 |

### 主播/房管指令

| 指令 | 示例 | 说明 |
| --- | --- | --- |
| `切歌` | `切歌` | 跳过当前歌曲 |
| `下一首` | `下一首` | 播放队列下一首 |
| `禁歌 <关键词>` | `禁歌 孤勇者` | 加入禁歌规则 |
| `禁点 @用户` | `禁点 @张三` | 禁止用户点歌 |
| `锁点歌` | `锁点歌` | 暂停观众新增点歌 |
| `开点歌` | `开点歌` | 恢复点歌 |

## 礼物金额分层机制

金额统一使用 Bilibili 事件中的 `gift_price * gift_count` 或 SC `price` 转换为内部权益积分 `request_credit`。配置里只存阈值，不硬编码具体礼物名，避免平台礼物价格变化后失效。

| 档位 | 建议门槛 | 权益 | 运营话术 |
| --- | ---: | --- | --- |
| 免费查询 | 0 | 只能搜索候选，不能入队 | “先搜歌，选准了再送礼点” |
| 普通点歌 | 10 电池 | 入普通队列，最多 60 秒，不可插队 | “小礼物就能点，排队播放” |
| 优先点歌 | 66 电池 | 入优先队列，最多 90 秒，可换歌 1 次 | “优先播放，想听更快一点” |
| 插队点歌 | 233 电池 | 插到当前歌曲后第 1-2 位，最多 120 秒 | “马上安排，下一轮高亮播放” |
| 专属点歌 | 520 电池 | 指定版本/平台，浮层大字展示，TTS 口播 | “老板专属 BGM，上屏感谢” |
| 包场歌单 | 1999 电池 | 连续 3 首或 10 分钟歌单时段，主播确认后执行 | “本段歌单由老板冠名” |

### 权益绑定规则

收到礼物后创建一条 `song_request_credit`：

- `uid`
- `uname`
- `credit_value`
- `tier`
- `source_event_id`
- `expires_at`，默认 5 分钟
- `used_at`

观众点歌时优先消耗未使用、未过期的最高档权益。没有权益时只返回候选和引导话术。

### 连击与累计

同一用户在 `ThanksGiftTimeout` 类似的聚合窗口内连续送礼，应合并计算档位：

```text
小花花 x3 + 小花花 x7 = 10 电池，获得普通点歌
```

同场直播也可以配置累计策略：

```text
SongRequest.AccumulateWindow = "session" | "5m" | "off"
```

建议默认 `5m`，让用户容易凑档，又避免整场无限累计导致队列失控。

### 金额统计口径

点歌礼物金额需要同时支持“本场”和“当天”两个口径，分别服务直播控制和运营复盘：

| 口径 | 时间范围 | 用途 | 展示位置 |
| --- | --- | --- | --- |
| 本场点歌收益 | 当前 `live_session` 开播到下播 | 控制当前队列、判断本场转化效果、展示本场榜单 | 点歌面板、OBS 歌单页、当前播放浮层 |
| 当天点歌收益 | 主播本地时区自然日 `00:00-23:59:59` | 日报、结算、复盘哪档礼物最有效 | 数据统计页、点歌面板顶部、日榜皮肤 |

统计字段建议拆为：

- `song_request_session_value`：本场已消耗点歌权益金额。
- `song_request_session_pending_value`：本场已收礼但未消耗的点歌权益金额。
- `song_request_today_value`：当天已消耗点歌权益金额。
- `song_request_today_pending_value`：当天已收礼但未消耗的点歌权益金额。
- `song_request_refunded_value`：因不可播或主播手动补偿而退回/保留的权益金额。

默认运营展示使用“已消耗 + 待消耗”总值，避免用户送礼后还没点歌时收益不显示；财务复盘使用“已消耗”值，避免重复计算。

### 本场榜与当天榜

榜单也拆成两套：

- 本场点歌榜：按当前直播场次排序，强调实时刺激和插队竞争。
- 当天点歌榜：按自然日排序，适合做日冠、冠名、次日复盘。

OBS 网页皮肤中可以配置显示：

```text
SongRequest.DisplayStats = "session" | "today" | "both" | "off"
```

当显示 `both` 时，文案要避免混淆：

```text
本场点歌 2330 电池 · 今日点歌 8800 电池
```

### 排队排序

队列排序分两层：

1. 队列类型：插队队列 > 优先队列 > 普通队列。
2. 同队列内：礼物金额高者优先；金额相同按入队时间。

计算字段：

```text
priority_score = tier_base + min(credit_value, tier_cap) + fan_bonus - penalty
```

- `tier_base`：普通 1000，优先 3000，插队 6000，专属 9000。
- `tier_cap`：避免一个超大礼物永久压制后续用户。
- `fan_bonus`：舰长、提督、总督可加权，但低于直接礼物金额。
- `penalty`：同一用户连续点歌递增，防止刷屏霸队。

## 精准搜索与确认

### Meting 搜索策略

默认搜索顺序：

1. 主播配置的首选平台。
2. 上一次成功播放的平台。
3. 其他平台并发兜底。

Meting 返回标准字段后归一化为：

```text
source
song_id
name
artist[]
album
pic_id
url_id
lyric_id
duration_ms?
```

### 匹配分

候选排序使用可解释的分数：

```text
score =
  song_name_exact * 50
  + artist_exact * 30
  + keyword_order * 10
  + platform_preference * 5
  + historical_success * 5
  - live_version_penalty
  - cover_version_penalty
```

默认规则：

- 歌名和歌手都命中，且第一候选分数高于第二候选 20 分以上，直接入队。
- 只有歌名命中或候选接近，回复 3 个候选。
- 观众 60 秒内发送 `点歌 #编号`，绑定最近一次候选上下文。

### 歧义处理

常见歧义需要显式确认：

- 同名歌曲。
- 翻唱、Live、伴奏、DJ 版。
- 平台搜索结果缺少歌手。
- 搜索结果没有可播放 URL。
- 歌曲时长超过当前档位上限。

## URL Scheme 播放设计

### 原则

系统 URL Scheme 只用于“调起已安装音乐客户端或网页播放页”，不用于执行任意系统命令。

第一版采用可配置 Scheme 模板：

```text
SongRequest.UrlSchemes.netease = [
  "orpheus://song/{song_id}",
  "https://music.163.com/#/song?id={song_id}"
]

SongRequest.UrlSchemes.tencent = [
  "qqmusic://qq.com/media/playSonglist?p={song_id}",
  "https://y.qq.com/n/ryqq/songDetail/{song_id}"
]
```

注意：不同音乐客户端的 Scheme 可能随版本变化。实现时必须允许用户在 UI 中覆盖模板，并提供“测试打开”按钮。

### 调起流程

```text
队列选择下一首
  → 根据 source 选择 scheme 模板
  → 替换 song_id / url_id / name / artist
  → 校验 scheme host 白名单
  → 调用系统 open_url
  → 记录 play_attempt
  → 5 秒内未收到人工确认时，提示主播检查播放器
```

Tauri 侧建议封装一个后端命令：

```text
open_song_url(song_request_id) -> Result<OpenSongResult>
```

命令内部只接受数据库中的 `song_request_id`，不接受前端传入任意 URL。这样可以避免前端或弹幕注入任意 Scheme。

### 播放 URL 兜底

如果系统 Scheme 不可用：

1. 尝试 Meting `url(url_id, bitrate)` 获取播放 URL。
2. 如果获取失败或版权受限，切换到网页歌曲详情页。
3. 仍失败则标记 `failed`，自动播放下一首，并用弹幕说明“该歌曲暂不可播，权益保留一次换歌”。

## 数据模型

### song_requests

```sql
create table song_requests (
  id integer primary key autoincrement,
  session_id text not null,
  room_id integer not null,
  uid integer not null,
  uname text not null,
  source text not null,
  song_id text not null,
  song_name text not null,
  artist_names text not null,
  album_name text,
  pic_url text,
  lyric_id text,
  url_id text,
  duration_ms integer,
  requested_text text not null,
  tier text not null,
  credit_value integer not null,
  priority_score integer not null,
  status text not null,
  position_snapshot integer,
  source_event_id integer,
  created_at text not null,
  updated_at text not null,
  played_at text,
  finished_at text
);
```

`status` 可选：

- `pending`
- `playing`
- `played`
- `skipped`
- `cancelled`
- `failed`

### song_request_stats_daily

当天统计可以从 `song_requests` 和 `song_request_credits` 动态聚合，但 UI 高频刷新时建议维护日统计表：

```sql
create table song_request_stats_daily (
  stat_date text not null,
  room_id integer not null,
  request_count integer not null default 0,
  played_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  consumed_value integer not null default 0,
  pending_value integer not null default 0,
  refunded_value integer not null default 0,
  top_uid integer,
  top_uname text,
  updated_at text not null,
  primary key (stat_date, room_id)
);
```

本场统计优先按 `session_id` 动态聚合，避免场次结束、补偿、换歌时出现缓存不一致。

### song_request_credits

```sql
create table song_request_credits (
  id integer primary key autoincrement,
  session_id text not null,
  room_id integer not null,
  uid integer not null,
  uname text not null,
  credit_value integer not null,
  tier text not null,
  source_type text not null,
  source_event_id integer not null,
  expires_at text not null,
  used_request_id integer,
  created_at text not null,
  used_at text
);
```

### song_search_contexts

```sql
create table song_search_contexts (
  id integer primary key autoincrement,
  session_id text not null,
  uid integer not null,
  query text not null,
  candidates_json text not null,
  expires_at text not null,
  created_at text not null
);
```

用于支持 `点歌 #2`。

### song_blocklist

```sql
create table song_blocklist (
  id integer primary key autoincrement,
  kind text not null,
  value text not null,
  reason text,
  created_at text not null
);
```

`kind` 可选：`song_id`、`song_name`、`artist`、`keyword`、`uid`。

## 后端模块拆分

建议新增：

```text
src/song_request/
  mod.rs
  command.rs       # 弹幕命令解析
  credit.rs        # 礼物权益计算
  meting.rs        # Node/Meting 适配层或 HTTP sidecar client
  queue.rs         # 队列排序与状态流转
  opener.rs        # URL Scheme 白名单与系统打开
  storage.rs       # song_requests 相关 SQL
```

### 事件接入

```text
LiveEvent::Gift / SuperChat / GuardBuy
  → SongRequestCreditService::grant()

LiveEvent::Danmu
  → SongCommandParser::parse()
  → SongSearchService::search_or_confirm()
  → SongQueueService::enqueue()
```

### Meting 集成方式

推荐第一版使用 Node sidecar：

```text
Rust BotEngine
  → local HTTP / stdio sidecar
  → @meting/core
  → normalized JSON
```

原因：

- Meting 当前是 Node.js 包，直接由 Node 运行最简单。
- Rust 主进程不需要引入 JS runtime。
- 后续可替换为远程音乐检索服务。

## 前端面板

新增「点歌」面板，包含 7 个区块：

- 当前播放：封面、歌名、歌手、点歌用户、剩余时间、跳过按钮。
- 队列：按普通/优先/插队分组，支持拖拽调整。
- 收益概览：本场金额、当天金额、待消耗权益、失败补偿金额。
- 收益配置：档位阈值、时长、插队位置、累计窗口。
- 搜索测试：输入关键词，查看 Meting 候选和 Scheme 打开结果。
- 网页投放：复制 OBS Browser Source URL，选择皮肤、尺寸、透明背景、展示字段。
- 黑名单：禁歌、禁歌手、禁用户。

### 点歌面板 UI

顶部固定状态栏：

| 指标 | 含义 |
| --- | --- |
| 点歌开关 | 开启、锁定、仅舰长、仅礼物 |
| 本场金额 | 当前场次点歌相关礼物总值 |
| 今日金额 | 当天点歌相关礼物总值 |
| 队列人数 | 普通、优先、插队分别显示 |
| 当前皮肤 | OBS 网页当前使用的皮肤 |

主区域建议三栏：

- 左栏：当前播放和下一首，给主播快速控制。
- 中栏：实时队列，支持拖拽、跳过、置顶、标记失败。
- 右栏：收益配置、搜索测试、皮肤投放和黑名单。

### 网页歌单投放

点歌队列本身也是一个独立网页，供 OBS、直播伴侣、浏览器、投屏软件或其他采集软件打开。

建议路由：

```text
GET /song-request
GET /song-request/overlay
GET /song-request/playlist
GET /song-request/now-playing
GET /song-request/rank
```

页面参数：

```text
/song-request/playlist?skin=compact&stats=session&transparent=1&limit=8
/song-request/now-playing?skin=vinyl&showNext=1
/song-request/rank?range=today&skin=neon
```

投放页必须满足：

- 可透明背景，适合 OBS Browser Source。
- 固定宽高下不跳动，长歌名和长昵称自动省略。
- 支持横版、竖版、窄条三种尺寸。
- 自动轮询或 WebSocket 更新，不需要刷新 OBS。
- 不暴露后台控制按钮，避免被观众看到管理操作。
- URL 中只允许展示配置，不允许传入可执行 Scheme 或管理命令。

### 网页皮肤

第一版至少提供 6 款皮肤：

| 皮肤 | 适用场景 | 视觉重点 | 默认尺寸 |
| --- | --- | --- | --- |
| `compact` 紧凑条 | 游戏直播底部/侧边 | 当前歌 + 下一首 + 本场金额 | 720x120 |
| `chat-card` 弹幕卡片 | 聊天区旁边 | 点歌用户、礼物档位、队列位置 | 420x640 |
| `vinyl` 唱片机 | 音乐/电台直播 | 封面旋转、进度环、歌词一行 | 520x520 |
| `neon` 霓虹榜单 | 高能互动/PK | 插队、高价礼物、今日榜 | 520x720 |
| `minimal` 极简透明 | 画面干净的主播 | 小字号、低遮挡、只显示当前歌 | 640x72 |
| `idol-stage` 舞台应援 | 虚拟主播/才艺 | 高饱和渐变、粉丝名高亮、专属点歌动画 | 960x180 |

皮肤配置项：

```text
SongRequestOverlay.Skin = "compact"
SongRequestOverlay.Transparent = true
SongRequestOverlay.Width = 720
SongRequestOverlay.Height = 120
SongRequestOverlay.StatsRange = "session"
SongRequestOverlay.ShowCover = true
SongRequestOverlay.ShowRequester = true
SongRequestOverlay.ShowGiftTier = true
SongRequestOverlay.ShowQueue = true
SongRequestOverlay.ShowTodayValue = false
SongRequestOverlay.PrimaryColor = "#8b5cf6"
SongRequestOverlay.FontScale = 1.0
```

不同皮肤只改变展示，不改变点歌规则。规则统一由后端队列和权益服务控制。

### 浮层与歌单页面组件

可复用组件：

- 当前播放条：封面、歌名、歌手、点歌用户、播放状态。
- 下一首预告：显示 1-3 首，强调插队和优先队列。
- 高价点歌全屏感谢：专属点歌、包场歌单触发短动画。
- 点歌榜：本场榜/当天榜切换。
- 收益角标：本场点歌金额、今日点歌金额。
- 队列滚动列表：普通队列、优先队列、插队队列分色。

OBS 皮肤默认只展示“本场金额”，当天金额需要主播显式开启，避免画面信息过多。

## 风控与合规

- 必须明示点歌规则：礼物门槛、排队逻辑、是否可退、不可播时如何补偿。
- 默认不允许未确认的高风险 Scheme，所有 Scheme 模板走白名单。
- 对低俗、侵权、政治敏感、超长噪音、辱骂类关键词做禁歌规则。
- 遇到不可播放、版权受限、客户端未安装，应保留一次换歌权益，而不是直接吞掉权益。
- 支持主播一键暂停点歌，避免直播节奏被队列绑架。

## MVP 实施顺序

1. 实现弹幕指令解析和候选上下文，不接播放器，先能搜索和确认。
2. 实现礼物权益 `song_request_credits`，完成普通点歌入队。
3. 实现队列排序和主播面板，支持手动标记播放/跳过。
4. 实现 URL Scheme 白名单打开，先支持可配置模板和网页兜底。
5. 接入本场/当天收益统计。
6. 实现 `/song-request/playlist` 网页歌单和 `compact`、`minimal` 两款基础皮肤。
7. 接入浮层、TTS 和高价点歌动画。
8. 增加插队、专属点歌、包场歌单等高价档位。

## 验证清单

- `点歌 晴天` 返回候选，`点歌 #1` 能绑定同一用户最近搜索结果。
- 无礼物权益时不能入队，只给送礼引导。
- 礼物金额达到门槛后，5 分钟内点歌自动消耗权益。
- 多用户同档位按时间排序，高档位能排在低档位前。
- 同一用户连续点歌有惩罚，不能霸占整个队列。
- 禁歌、禁用户、锁点歌生效。
- URL Scheme 只允许白名单模板，不能从弹幕拼出任意系统 URL。
- 播放失败时状态为 `failed`，权益允许换歌一次。
- 本场金额只统计当前 `live_session`，当天金额按主播本地自然日统计。
- OBS 网页歌单可用透明背景打开，切换皮肤不影响后端队列。
- 网页投放 URL 只能改变展示参数，不能执行管理操作。

## 参考

- [metowolf/Meting](https://github.com/metowolf/Meting)：多平台音乐 API，支持搜索、歌曲信息、播放 URL、歌词、封面和统一格式化输出。
