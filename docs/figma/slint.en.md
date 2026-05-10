# Live Bot Live Danmaku Robot — Figma Prompts (Slint Desktop)

Each segment is a **complete and self-contained** prompt. Append the §F0 shared settings to the end of each F1–F9 prompt when pasting into Figma "Make Designs". All interface text is in 简体中文.

Design highlights:
- Desktop baseline 1080×700, minimum 920×580.
- Visual language: Liquid Glass + floating Gaussian blobs + semi-transparent white cards.
- Streamlined navigation: Single segment with 7 items, no right panel.
- Automation uses a grid of 6 AutoCards.
- Two theme states: 浅色 / 深色.
- 4 primary color presets.
- Custom color picker: HSL three sliders + HEX (no color wheel, to save vertical space).

---

## §F0 · Shared Settings (Append to the end of each prompt)

```
Interface language: 简体中文. All labels, buttons, tips, and placeholders must be in 中文.
Baseline canvas: 1080 × 700 desktop.
Fonts: PingFang SC / SF Pro (Chinese body) + SF Mono (Room ID, UID, timestamps, JSON).
Base font size: 12px, title 17/700, small text 10/600 letter-spacing 0.4.

Visual language: Liquid Glass after macOS Big Sur — semi-transparent white cards + floating Gaussian blobs + specular highlights.

[Background] 160deg linear gradient for the entire window:
- 浅色: from #eaeef5 to #dfe3eb
- 深色: from #14141b to #0c0c10
Three 460–520px Gaussian blobs (radial-gradient + Gaussian Blur 80) floating on the background, shared across all Frames:
- Top-left: Primary color blob (浅色 opacity 70% / 深色 78%) at x=-160 y=-180.
- Top-right: #ff2d55 rose pink blob (浅 82% / 深 85%) at the top-right corner extending outwards -120.
- Bottom-right: #34c759 emerald green blob (浅 83% / 深 86%) at the bottom-right corner extending outwards.
It is recommended to first create a BackgroundBlobs component in Figma and place an instance as the first layer of each Screen Frame.

[Layout] 2 sections, no right panel:
- Top bar (height 52): Glass strip, linear-gradient #ffffff80→#ffffff50 (浅色) / #ffffff0e→#ffffff04 (深色).
- Left sidebar (width 196, collapsible): Glass #ffffff7a→#ffffff48 (浅) / #ffffff10→#ffffff05 (深), with a 1px fine right border.
- Main area: Scrollable, padding 14.

[7-item single-segment navigation]: 仪表盘 / 登录与房间 / 监听与发送 / 自动回复 / AI 场控 / 数据统计 / PK 与活动 / 系统与更新
NavItem height 44, border-radius 12: default transparent / active primary color semi-transparent gradient (opacity 0.84-0.92) + primary color border (opacity 0.7) + 28×28 primary color solid background icon block on the left with white icon.

[Theme] Only 浅色 / 深色 states, named with suffixes " · 浅色" and " · 深色" side-by-side.
[4 primary color presets] iOS Blue #007aff (default) / 翠绿 #34c759 / 橙 #ff9500 / 玫红 #ff2d55.

[Liquid Glass Component Specifications]
- Glass card: semi-transparent white gradient fill (浅 #ffffffd8→#ffffffaa / 深 #ffffff14→#ffffff09), border-radius 18, 1px border (浅 #00000014 / 深 #ffffff1c), shadow 0 6px 22px #0000001c, top 1px specular highlight line (浅 #ffffffe6 / 深 #ffffff30) from x:6 to x:parent-12.
- Btn capsule height 30 border-radius 15:
  · Primary button: linear-gradient(180deg, accent.brighter 10%, accent.darker 4%) + accent.darker 18% border + 10px accent transparent shadow.
  · Default button: linear-gradient #ffffffd6→#ffffff8a + 1px rim + 4px shadow.
  · Top 1px specular highlight (x:5, w:parent-10, h:1).
- IconBtn circle 30×30: semi-transparent white gradient, primary color semi-transparent background when active.
- Toggle 36×20 capsule: ON state linear-gradient accent.brighter 8%→accent + 8px primary color shadow; OFF state linear-gradient #d4d4d9.darker→#d4d4d9. Circle thumb 16×16 white gradient + 4px black shadow.

[Font Sizes]
- Title: 17/700 letter-spacing 0.
- Section title: 11/700 letter-spacing 0.6.
- Body: 12/500.
- Sub-text: 10/600 letter-spacing 0.4.
- Monospace: SF Mono 11/500.

[Key Constraints]
- Cards must always be semi-transparent, allowing the background blobs to show through — do not fill cards with solid colors.
- Avoid dense tables; use card grids + chip lists instead.
- No right panel: real-time status, logs, and user queries should be contained within cards in the main area.
- Spacious layout, padding 12-14, ensuring elements have "room to breathe".
```

---

## F1 · 仪表盘

```
Design the "仪表盘" page for the Live Bot Slint desktop version, with 浅色 + 深色 Frames side-by-side at 1080×700.

Place a BackgroundBlobs instance as the first layer (top-left blue blob + top-right rose pink blob + bottom-right emerald green blob).

[Top Bar] 52-high glass strip:
- Left: 28×28 primary color rounded square "LB" icon + "Live Bot" (17/700).
- Center: Status dot (7px green with 2s pulse) + monospace "房间 8792912" + "·" + "花花直播姬" + green chip "直播中".
- Right: 30×30 circular IconBtn for theme switching + 30×30 IconBtn for collapsing the sidebar.

[Left Sidebar] 196-wide glass, 14 padding:
- Top: LB icon + "Live Bot" subtitle.
- 7 NavItems (height 44, border-radius 12), with "仪表盘" active:
  · 仪表盘 (active, primary color semi-transparent background)
  · 登录与房间
  · 监听与发送
  · 自动回复
  · AI 场控
  · 数据统计
  · PK 与活动
  · 系统与更新 (at the bottom)
- Bottom: Circular IconBtn for "设置".

[Main Area Content] padding 18, vertical spacing 14:

1. Greeting line: 17/700 large text "晚上好，主播 · 房间 8792912 · 直播中".

2. 6 StatTile semi-transparent glass cards in 2 rows and 3 columns (each ~210×80, border-radius 14):
   Each card: Top 1px specular highlight line + 11/700 gray small text label + 19/700 value + 10 gray sub-text + bottom 2px primary color gradient line + top-right 8×8 primary color glowing dot.
   - "本场弹幕" "12,453" "↑18%"
   - "进场" "2,108" "↑5%"
   - "新增关注" "186" "↑22%"
   - "礼物总值" "38.5K" "电池 · ↑32%"
   - "大航海" "+3" "本场新增"
   - "人气" "8,432" "峰值 9,801"

3. Quick actions row with 4 capsule buttons (height 30 each):
   - Primary button with solid primary color "开始监听" + play icon.
   - Default button "停止监听".
   - Default button "检测登录".
   - Default button "检测房间".

4. Section title "自动化功能" 11/700 gray letter-spacing 0.6 + followed by a 1px horizontal line.
   AutoCard grid 3×2 (each glass card border-radius 14, padding 12):
   Each card: Top-left 28×28 primary color radial gradient icon block + top-right 36×20 Toggle + title 12/600 + description 10 gray.
   - Speaker icon / "自动欢迎" / "新观众进入直播间时发送欢迎语" / ON
   - Chat icon / "关键词回复" / "弹幕命中关键词自动回复" / ON
   - Gift icon / "礼物答谢" / "收到礼物自动答谢，支持聚合" / ON
   - AI icon / "AI 场控" / "由 AI Agent 调度回复与语音交互" / ON
   - Draw icon / "抽签" / "弹幕发起抽签，自动随机结果" / ON
   - Filter icon / "弹幕过滤" / "屏蔽敏感词、刷屏、风险弹幕" / OFF

5. A large log glass card at the bottom (height 160, border-radius 14):
   Title "实时日志" + "清空" small text on the right.
   Monospace 11 font, 6 lines (color-coded by level):
   - [21:14:23] INFO  连接成功
   - [21:14:25] DEBUG 收到弹幕 来自小白
   - [21:14:27] INFO  自动欢迎已发送
   - [21:14:34] INFO  收到礼物 辣条 ×10
   - [21:14:42] WARN  发送队列限速 等待 2.1s
   - [21:14:50] INFO  关注 来自小迷妹

[Append §F0 Shared Settings]
```

---

## F2 · 登录与房间

```
Design the "登录与房间" page for the Live Bot Slint desktop version, with 浅色 + 深色 Frames, each having 3 states: Default / QR Code Modal / Login Successful.

First layer: BackgroundBlobs instance.
Left sidebar: "登录与房间" active.

[Default View] Two large side-by-side glass cards in the main area, spacing 16:

Account Card (left 480×420, border-radius 18):
- 64×64 circular avatar + nickname "花花直播姬" (17/700) on the right + monospace "UID: 8792912" (11 gray).
- 3 information lines:
  · Green chip "Cookie 有效" + sub-text "过期 2026-08-12"
  · "最近登录" 11 monospace "2026-05-03 19:42"
  · "登录方式" 11 gray "二维码"
- Bottom button row (spacing 8): Primary color "切换账号" + default "退出登录" + default "检测登录"

Room Card (right 480×420):
- Section title "当前直播间"
- "房号" label + glass LineEdit monospace "8792912" + primary color IconBtn 30×30 "保存"
- "主播" text "花花直播姬"
- "分区" text "虚拟主播 · 虚拟次元计划"
- "状态" green status dot + chip "直播中" + monospace "已开播 02:14:08"
- Bottom button row: default "刷新状态" + default "检测连接"

[QR Code Modal View] Overlay a centered 440×520 modal on the default view (white glass card, border-radius 22, large shadow + semi-transparent mask):
- Title "扫码登录" (17/700) + ✕ on the top-right.
- 200×200 QR code (white background, border-radius 14, glass border).
- Monospace countdown "02:48".
- Step list (3 lines of small text):
  · "1. 打开手机 B 站 App"
  · "2. 点击右上角扫一扫"
  · "3. 确认登录"
- Status line: gray status dot + "等待扫码…" + spinner.
- Bottom ghost button "刷新二维码".

[Login Successful View] Overlay a semi-transparent green mask on the QR code + large white checkmark + status line turns green "登录成功，2 秒后自动关闭".

[Append §F0 Shared Settings]
```

---

## F3 · 监听与发送

```
Design the "监听与发送" page for the Live Bot Slint desktop version, with 浅色 + 深色 Frames, each having 2 states: Running / Stopped.

First layer: BackgroundBlobs. Left sidebar: "监听与发送" active.

[Running View] 3 vertical blocks in the main area:

1. Top Status Card (long horizontal glass, height 96):
   - Left: Large primary color capsule button "监听运行中" (green glow, height 30, with play icon).
   - Center: 3 statistical columns (spacing 24):
     · "已连接" monospace 17 "01:23:45"
     · "接收事件" 17/700 "12,453"
     · "发送弹幕" 17/700 "38"
   - Right: 30×30 circular IconBtn "重连".

2. Event Stream Glass Card (height 320, border-radius 18):
   Title "实时事件流" + 4 chip filters on the right (All Primary Color / 弹幕 / 礼物 / 进场).
   List of 6 lines (each a semi-transparent white small card, border-radius 8, raises on hover), mixed events:
   - Blue: 弹幕 · "小白同学" + chip "花花团 21" · "主播好可爱～" · monospace "21:14:23"
   - Pink: 礼物 · "大老板" · "辣条 ×10（10 电池）" · "21:14:25"
   - Gray: 进场 · "路人甲" · "进入直播间" · "21:14:27"
   - Yellow: 关注 · "小迷妹" · "关注了主播" · "21:14:31"
   - Gold: 大航海 · "金主爸爸" · "开通了 总督（388 元）" · "21:14:42"
   - Red: 红包 · "系统" · "新红包 奖池 200 电池 倒计时 60 秒" · "21:14:50"

3. Send Danmaku Glass Card:
   - Title "发送弹幕"
   - Multi-line glass LineEdit (height 80) + placeholder "输入要发送的弹幕（最多 30 字）…" + "0/30" on the bottom-right.
   - Rate limit line small text "距上次发送 3.2s · 队列空闲".
   - Large primary color capsule button "发送弹幕".
   - Bottom preset phrases 5 chip capsules (light primary color background):
     "你好呀～" / "晚安" / "谢谢老板" / "求关注" / "[!cmd 抽签]"

[Stopped View]
- Status card button turns red destructive "已停止".
- Event stream card empty state: Central gray illustration + "等待开始监听…".
- Send Danmaku card button disabled gray.

[Append §F0 Shared Settings]
```

---

## F4 · 自动回复

```
Design the "自动回复" page for the Live Bot Slint desktop version, with 浅色 + 深色 Frames, each having 2 states: Default / Add Keyword Modal.

First layer: BackgroundBlobs. Left sidebar: "自动回复" active.

[Default View] Vertical scrolling page in the main area with 4 large glass cards (border-radius 18, padding 16), spacing 14:

Card 1 · 关键词回复:
Title "关键词回复" + ghost button "+ 添加" on the right.
6-line simplified list (each 40 high, semi-transparent white small card, border-radius 10):
- chip "你好" + chip "hi" → text "你好呀～主播看到你啦" → 30×30 circular IconBtn "删除"
- chip "主播好可爱" → "谢谢小可爱～" → Delete
- chip "几岁" → "永远 18 岁啦" → Delete
- chip "求关注" → "点击主播头像可关注哦" → Delete
- chip "晚安" → "晚安做个好梦～" → Delete
- chip "^抽签 (.+)$" gray chip "正则" → "{user} 抽到：{1}" → Delete

Card 2 · 欢迎语:
Title "欢迎语 · 分时段" + "+ 添加" on the right.
Chip collection, 4 lines (left label + text):
- chip "06:00-12:00" "{user} 早上好呀，新的一天加油！"
- chip "12:00-18:00" "{user} 下午好～"
- chip "18:00-23:00" "{user} 晚上好～终于等到你"
- chip "23:00-06:00" "{user} 这么晚还在呀，注意休息"

Card 3 · 答谢语:
Title "礼物答谢"
Chip collection (each showing gift name + ✕):
辣条 / 小花花 / 牌子 / 私人飞机 / 嘉年华 / 总督
Below: "模板预览" small text + template text "谢谢 {user} 的 {gift}×{count}！"

Card 4 · 黑名单:
Title "黑名单"
Two columns:
- Left "UID 黑名单" chip collection: 12345 / 67890 / 11223 / 44556 / 78901
- Right "昵称黑名单" chip collection: 广告号A / 广告号B / 引流小号

[Add Keyword Modal] 260×200 small glass modal (border-radius 18, large shadow):
- Title "添加关键词"
- Glass LineEdit "触发词…"
- Glass LineEdit "回复内容…"
- Bottom ghost "取消" + primary color "添加"

[Append §F0 Shared Settings]
```

---

## F5 · AI 场控 (AI Agent)

```
Design the "AI Agent" page for the Live Bot Slint desktop version, with Light + Dark Frames, supporting Tab switching:

First layer: BackgroundBlobs. Left sidebar: "AI 场控" active.

[Common Layout]
Top Navigation Tabs (Glass-style button group): 对话逻辑 (Logic) / 语音感官 (Voice) / 记忆中心 (Memory - Locked)

[Logic Tab]
- Switch model source: OpenAI / DeepSeek / Local Ollama.
- Configure API Key, API URL, Model Name, System Prompt.
- Glass LineEdit with monospace font for parameters.
- Large primary color capsule button "保存配置" + "连接测试" button.

[Voice Tab]
- **Input (ASR)**: Dropdown to switch models (Faster-Whisper / FunASR), microphone volume visualizer bar.
- **Output (TTS)**: Dropdown to switch models (Bert-VITS2 / ChatTTS / Azure), voice preview play button, speed/pitch sliders.
- **Real-time Controls**: Two large Toggle switches —— "开启语音监听", "开启语音播报".

[Memory Tab]
Empty state with a central lock icon + text "记忆模块将在 V5 阶段开启" + "了解更多" link.

[Append §F0 Shared Settings]
```

---

## F6 · 数据统计

```
Design the "数据统计" page for the Live Bot Slint desktop version, with 浅色 + 深色 Frames, each having 2 states: Default / Empty.

First layer: BackgroundBlobs. Left sidebar: "数据统计" active.

[Default View] Main area vertical layout:

1. Top segmented glass capsule (height 32, border-radius 16):
   本场 / 今日 (active, solid primary color background) / 近 7 天

2. 6 StatTile semi-transparent glass cards in 2 rows and 3 columns (same specs as F1 Dashboard):
   - "弹幕总数" "12,453" "↑18%"
   - "进场" "2,108" "↑5%"
   - "新增关注" "186" "↑22%"
   - "礼物总值" "38.5K" "电池"
   - "大航海" "+3"
   - "平均人气" "8,432"

3. 2 large chart glass cards side-by-side below:

Left Card (border-radius 18, padding 18) "弹幕量趋势":
- X-axis 19:00–22:00 every 10 minutes.
- Solid primary color line + primary color gradient fill (top 30%→bottom 0%).
- Glass specular border.
- Annotation "21:03 峰值 542".

Right Card "礼物 TOP 5 圆环":
- Large donut chart 200×200 centered, with 6 colored arc segments (based on gift proportions).
- Center total "38.5K 电池" + sub-text "本场".
- Legend with 5 lines on the right: Colored dot + gift name + percentage %.
  · 辣条 32%
  · 小花花 28%
  · 嘉年华 18%
  · 私人飞机 12%
  · 总督 10%

[Empty View]
6 KPIs all 0 + central 200×200 cartoon illustration (coffee cup) in the chart area + text "今天还没有互动数据" + sub-text "等待开始监听后再来看看".

[Append §F0 Shared Settings]
```

---

## F7 · PK 与活动

```
Design the "PK 与活动" page for the Live Bot Slint desktop version, with 浅色 + 深色 Frames, each having 3 states: PK in Progress / PK Ended / No Activity Empty View.

First layer: BackgroundBlobs. Left sidebar: "PK 与活动" active.

[PK in Progress View] Main area vertical layout:

1. Current PK Large Glass Card (height 200, border-radius 18, padding 18, with dual progress bars spanning the bottom):
   - Left: 56 circular avatar "花花直播姬" + Room ID 8792912 (monospace 11 gray) + large score "248".
   - Center: Countdown mm:ss "03:42" (36 monospace bold) + red chip "PK 中" above.
   - Right: 56 avatar "小蓝直播间" + 12345678 + score "196" + top-right 30×30 IconBtn "前往对面 ↗".
   - Dual progress bars at the bottom: Left primary color 56% + Right rose pink 44% + white separator line in the middle.

2. Two side-by-side glass cards below (spacing 14):

Left Card PK History (border-radius 18, padding 14):
- Title "PK 历史" + "本场 3 胜 2 负" on the right.
- List of 6 lines:
  · 21:08 / 小蓝直播间 / 248:196 / green chip "胜"
  · 20:42 / 小红直播间 / 312:280 / green "胜"
  · 20:12 / 小绿直播间 / 156:220 / red "负"
  · 19:48 / 小紫直播间 / 280:145 / green "胜"
  · 19:20 / 小黄直播间 / 88:132 / red "负"
  · 18:55 / 小橙直播间 / 256:188 / green "胜"

Right Card Current Activities (border-radius 18, padding 14):
- Title "当前活动"
- Sub-card 1: 红包 #234 (red glass light background):
  · Countdown ring (60 diameter primary color arc) + center "00:42".
  · "参与 312 人 · 奖池 200 电池".
  · Primary color button "参与".
- Sub-card 2: 天选时刻 (gold glass light background):
  · Countdown "02:35".
  · Conditions "关注主播 + 弹幕'我要参与'".
  · "已报名 1,204".
  · Primary color button "参与".

[PK Ended View] Top PK card collapses into a 56-high banner:
- Single-line layout: small icon on the left + "上一场：花花 248 vs 196 小蓝 · 胜" + small text "查看详情 ↗" on the right.
- Main area contains only the PK History and Current Activities cards.

[Empty View] PK card replaced by a 96-high glass banner (No PK): "暂无 PK" + sub-text "等待主播匹配 PK". Two cards below are empty: Left illustration + "暂无 PK 历史", Right illustration + "暂无活动".

[Append §F0 Shared Settings]
```

---

## F8 · 系统与更新

```
Design the "系统与更新" page for the Live Bot Slint desktop version, with 浅色 + 深色 Frames, each having 4 states: No Update / New Version Available / Checking / Update Modal.

First layer: BackgroundBlobs. Left sidebar: "系统与更新" active.

[No Update View] Main area with 3 vertically stacked large glass cards (border-radius 18, padding 18, spacing 16):

Card 1 · 版本:
- Title "版本"
- "当前版本" monospace "v0.1.0"
- "最新版本" monospace "v0.1.0" + green check chip "已是最新"
- "构建时间" "2026-05-01 19:42"
- Large primary color capsule button "检查更新".

Card 2 · 配置:
- Title "配置"
- "路径" monospace "etc/bilidanmaku-api.yaml"
- "上次保存" "2026-05-03 15:32 · 4.2 KB"
- Row of IconBtns at the bottom: 30×30 circular folder "打开" / circle up arrow "导出" / circle down arrow "导入" (each with a small label on the bottom-right).

Card 3 · 数据:
- Title "数据"
- "DB 路径" monospace "db/sqliteDataBase.db"
- "大小" "12.4 MB" + sub-items "互动记录 142,308 / 直播场次 23 / 用户 4,512"
- Row of IconBtns at the bottom: circle "备份" / circle "清理" (yellow) / circle "导出".

[New Version Available View] Card 1 changes:
- "最新版本" monospace "v0.1.5" + red chip "新版本".
- Primary color button becomes "立即更新".
- Sub-text "已发布 2 天".

[Checking View] Card 1 button becomes "检查中…" + spinner + disabled.

[Update Modal] Centered 380×440 glass modal (border-radius 22, large shadow):
- Title "发现新版本 v0.1.5" + ✕.
- Secondary info "发布 2 天前 · 8.4 MB · macOS".
- Scrollable markdown changelog (embedded in a semi-transparent white card):
  ## 新功能
  - 增加 PK 历史详情弹窗
  - 支持 DeepSeek 模型
  ## 修复
  - 修复礼物聚合时段错误
  ## 改进
  - 数据库写入提速 30%
- Bottom ghost "稍后" + primary color capsule "立即下载".

[Append §F0 Shared Settings]
```

---

## F9 · 主题面板 (Core: Compact Custom Color Picker)

```
Design the "外观" glass popup for the Live Bot Slint desktop version, with 浅色 + 深色 Frames side-by-side.

Form: Slides out from below the theme IconBtn on the right side of the top bar. White glass card 300×440, border-radius 18, large shadow, padding 16.
(Recommended: place BackgroundBlobs in the Frame first so the popup is transparent, then place the popup card in the corresponding top-right position)

[Content from Top to Bottom]

1. Title line "外观" (17/700) + ✕ on the right.

2. Mode Switch Segmented glass capsule (height 32, border-radius 16):
   - "浅色" + sun icon
   - "深色" + moon icon (active, solid primary color background with white text)
   Does not include "跟随系统".

3. Section title "主色调" (11/700 letter-spacing 0.6 gray)
   Row of 4 circular presets 28×28 (spacing 14):
   - iOS Blue #007aff (active: 3px white ring + 8px primary color glow)
   - 翠绿 #34c759
   - 橙 #ff9500
   - 玫红 #ff2d55
   Below each circle: 10 gray small text "蓝 / 绿 / 橙 / 红"

4. Collapsible Card "自定义" (semi-transparent glass, border-radius 12, padding 12):
   Header: small triangle on the left ▾ + "自定义颜色" + current HEX on the right "#007AFF".
   Expanded content:
   - Three sliders (each 36 high, left 24 text label + glass slider + right 56 LineEdit number):
     · "H" Slider background with rainbow gradient 0-360, circular thumb + 4px shadow, current 211.
     · "S" Gray→Saturation gradient, 0-100, current 100.
     · "L" Black→White gradient, 0-100, current 50.
   - HEX row: Glass LineEdit monospace "#007AFF" + 30×30 circular IconBtn "复制" on the right.
   - Real-time preview (row of three 60×30 glass small cards):
     · "按钮" (solid primary color background with white text)
     · "导航" (light primary color background with primary color text)
     · "Toggle" (small 36×20 ON-state toy example)

5. Section title "我的收藏" (11/700) + "清空" small text on the right.
   8-slot grid 24×24 (4 columns × 2 rows): 5 used color blocks + 3 empty slots with "+" icon.

6. Bottom row right-aligned:
   - ghost link small text "重置默认"
   - primary color capsule button "应用"

[Key Constraints] Do not include a full HSL color wheel — the desktop window is small, and vertical space is valuable. Use the three sliders + HEX for custom colors.

[Append §F0 Shared Settings]
```

---

## Recommendations for Use

1. **First create a BackgroundBlobs component in the Foundations Page**: 3 large circles 460-520 + radial-gradient + Gaussian Blur 80. Embed it as the first layer of each subsequent Screen Frame; otherwise, the glass effect will be lost.
2. Append the §F0 Shared Settings **to the end of each F1–F9 prompt** when pasting into Figma "Make Designs".
3. Order: F1 Dashboard (to verify the glass effect) → F9 Theme Popup (to define colors) → F2..F8.
4. If Make Designs renders cards as a solid color dashboard style, immediately use an additional instruction: "Change all cards to semi-transparent white gradient fill to let the background blobs show through" to correct it.
5. The Slint version only includes 浅色 / 深色 states; there is no need for a "Follow System" view.
