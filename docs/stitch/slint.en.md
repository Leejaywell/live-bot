# Live Bot Live Danmaku Robot

## §0 · Project Settings (Send to Stitch for the first time)

```
Product: Live Bot 直播弹幕机器人 — Slint Native Desktop
Platform: Slint 1.16, Design Baseline 1080×700, Minimum Window 920×580
Interface Language: 简体中文. All labels, buttons, tips, and placeholders are in 中文. Monospace font is used only for Room ID / UID / Timestamps / Logs / cron / JSON.
Fonts: PingFang SC / SF Pro (Chinese) + SF Mono (Monospace), base font size 12px.

Visual Language: Liquid Glass after macOS Big Sur —— semi-transparent white cards + floating Gaussian blobs + specular highlights.

[Background] 160deg linear gradient for the entire window:
- 浅色: linear-gradient(160deg, #eaeef5, #dfe3eb)
- 深色: linear-gradient(160deg, #14141b, #0c0c10)

Three 460-520px Gaussian blobs (radial-gradient + Gaussian Blur 80) floating on the background, shared across all pages:
- Top-left: Primary color blob (浅色 opacity 70% / 深色 78%) at position x=-160 y=-180.
- Top-right: #ff2d55 rose pink blob (浅 82% / 深 85%).
- Bottom-right: #34c759 emerald green blob (浅 83% / 深 86%).

[Layout] 2 sections, no right panel:
- Topbar (height 52): Glass strip #ffffff80→#ffffff50 (浅) / #ffffff0e→#ffffff04 (深).
- Sidebar (width 196, collapsible): Glass #ffffff7a→#ffffff48 (浅) / #ffffff10→#ffffff05 (深), with a 1px fine separator on the right.
- Main: Scrollable, padding 14; all cards border-radius 14-18, drop-shadow 22 blur 6 y #0000001c.

7-item single-segment sidebar: 仪表盘 / 登录与房间 / 监听与发送 / 自动回复 / AI 机器人 / 数据统计 / PK 与活动 / 系统与更新

NavItem (height 44, border-radius 12):
- Default: Transparent background, icon 28×28 glass square (white gradient + 1px rim).
- Active: accent semi-transparent gradient (opacity 0.84-0.92) + accent border (opacity 0.7) + icon square changed to accent solid color + white icon.
- Hover: Subtle white highlight #ffffff70-#ffffff40.

Theme: Only 浅色 / 深色 states (no "Follow System", simplified for desktop).
4 primary color presets (switch via theme-choice):
- iOS Blue #007aff (default 0)
- 翠绿 #34c759 (1)
- 橙 #ff9500 (2)
- 玫红 #ff2d55 (3)

Custom Color Picker (compact version, no color wheel to save space):
- Three sliders H/S/L each 36 high, with numeric input on the right.
- HEX input + copy.
- Real-time preview with 3 small 60×30 blocks (Button / Active NavItem / Toggle ON state).
- 8-slot favorites.

[Liquid Glass Component Specifications]
- Btn capsule (height 30, border-radius 15):
  · Primary button primary: linear-gradient(180deg, accent.brighter 10%, accent.darker 4%) + accent.darker 18% border + 10px accent transparent shadow.
  · Default button default: linear-gradient(180deg, #ffffffd6, #ffffff8a) + rim + 4px shadow.
  · Top 1px specular highlight (x:5, w:parent-10, h:1, bg #ffffffe6 / for primary #ffffff60).
  · Hover: Shadow blur increased to 7px / 16px.
- IconBtn circle 30×30: semi-transparent white gradient, accent semi-transparent background when active.
- Toggle (36×20 capsule):
  · OFF: linear-gradient #d4d4d9.darker→#d4d4d9 + rim.
  · ON: linear-gradient accent.brighter 8%→accent + 8px accent shadow.
  · Slider 16×16 circle white gradient + 4px black shadow; position x 2 ↔ 17, 160ms ease-in-out.
- AutoCard (Automation feature card, 14 border-radius):
  · Semi-transparent white card + 1px rim + 14px shadow.
  · Top-left 28×28 rounded square icon (accent tint radial gradient).
  · Top-right Toggle.
  · Title 12/600 + Description 10/wrap.

Font Sizes: Title 17/700 / Section 11/700 letter-spacing 0.6 / Body 12/500 / Sub-text 10/600 letter-spacing 0.4 / Monospace SF Mono 11/500.

Design Language Highlights:
- Cards are always semi-transparent — allowing background blobs to show through.
- Larger border-radius (14-22), smaller font sizes (10-13).
- No dense tables — use card grids + chip lists for everything.
- No right panel — real-time status, logs, and user queries are all contained in cards within the Main section.
- Spacious layout, padding 12-14.

Business Terminology: 弹幕 / 礼物 / 进场 / 关注 / 分享 / 大航海 / 红包 / PK / 天选 / 粉丝牌 / 舰长 (提督 / 总督) / 财富等级 / 房号 / UID / 电池.
Sample Data: Room 8792912, streamer "花花直播姬", users "大老板/小白同学/小迷妹/路人甲", Fan Medal "花花团 21", gifts "辣条/小花花/牌子/嘉年华/总督".
```

---

## S1 · 仪表盘

```
Generate the "仪表盘" page based on the Live Bot Slint framework (1080×700, 浅色 + 深色 versions).
The background must have three floating Gaussian blobs (blue top-left / rose pink top-right / emerald green bottom-right), and all interface text must be in 简体中文.

[Topbar] 52-high glass strip:
- Left: 28×28 primary color rounded square "LB" + "Live Bot" 17/700.
- Center: 7px green pulse dot + monospace "房间 8792912" + "·" + "花花直播姬" + green chip "直播中".
- Right: 30×30 circular IconBtn for theme switching + 30×30 IconBtn for collapsing the sidebar.

[Sidebar] 196-wide glass, padding 14:
- Top: LB icon + "Live Bot" subtitle.
- 7 NavItems (Chinese labels), with "仪表盘" active:
  · 仪表盘 (active)
  · 登录与房间
  · 监听与发送
  · 自动回复
  · AI 机器人
  · 数据统计
  · PK 与活动
  · 系统与更新 (bottom)
- Bottom: Circular IconBtn for "设置".

[Main Area] padding 18, vertical spacing 14:

1. Greeting line 17/700: "晚上好，主播 · 房间 8792912 · 直播中".

2. 6 StatTile semi-transparent glass cards in 2 rows and 3 columns (each ~210×80, border-radius 14):
   Each card: Top 1px specular highlight line + 11/700 gray small text label + 19/700 value + 10 gray sub-text + bottom 2px primary color gradient line + top-right 8×8 primary color glowing dot.
   - "本场弹幕" "12,453" "↑18%"
   - "进场" "2,108" "↑5%"
   - "新增关注" "186" "↑22%"
   - "礼物总值" "38.5K" "电池 · ↑32%"
   - "大航海" "+3" "本场新增"
   - "人气" "8,432" "峰值 9,801"

3. Quick actions row with 4 capsule buttons (height 30):
   - Solid primary color "开始监听" + play icon.
   - Default "停止监听".
   - Default "检测登录".
   - Default "检测房间".

4. Section title "自动化功能" (11/700 letter-spacing 0.6 + followed by a 1px horizontal line).
   AutoCard grid 3×2 (each glass card border-radius 14, padding 12):
   Each card: Top-left 28×28 primary color radial gradient icon block + top-right 36×20 Toggle + title 12/600 + description 10 gray.
   - Speaker icon / "自动欢迎" / "新观众进入直播间时发送欢迎语" / ON
   - Chat icon / "关键词回复" / "弹幕命中关键词自动回复" / ON
   - Gift icon / "礼物答谢" / "收到礼物自动答谢，支持聚合" / ON
   - AI icon / "AI 闲聊" / "由 AI 模型生成回复，需配置 API" / ON
   - Draw icon / "抽签" / "弹幕发起抽签，自动随机结果" / ON
   - Filter icon / "弹幕过滤" / "屏蔽敏感词、刷屏、风险弹幕" / OFF

5. A large log glass card at the bottom (height 160, border-radius 14):
   Title "实时日志" + "清空" small text on the right.
   Monospace 11 font, 6 lines (color-coded by level, Chinese text):
   [21:14:23] INFO  连接成功
   [21:14:25] DEBUG 收到弹幕 来自 小白
   [21:14:27] INFO  自动欢迎已发送
   [21:14:34] INFO  收到礼物 辣条 ×10
   [21:14:42] WARN  发送队列限速 等待 2.1s
   [21:14:50] INFO  关注 来自 小迷妹
```

---

## S2 · 登录与房间

```
"登录与房间" page, output Default / QR Code Modal Waiting / Login Successful screens, 浅色 + 深色, all Chinese text.
Background must have translucent blobs. Left sidebar with "登录与房间" active.

[Default State] Main area with two side-by-side large glass cards, spacing 16:

Account Card (left 480×420, border-radius 18):
- 64 circular avatar + nickname "花花直播姬" 17/700 + monospace "UID: 8792912" 11 gray.
- Information line:
  · Green chip "Cookie 有效" + sub "过期 2026-08-12"
  · "最近登录" monospace "2026-05-03 19:42"
  · "登录方式" 11 gray "二维码"
- Bottom buttons (spacing 8): Primary color "切换账号" + default "退出登录" + default "检测登录".

Room Card (right 480×420):
- Section title "当前直播间".
- "房号" label + glass LineEdit monospace "8792912" + primary color IconBtn 30×30 "保存".
- "主播" "花花直播姬".
- "分区" "虚拟主播 · 虚拟次元计划".
- "状态" green dot + chip "直播中" + monospace "已开播 02:14:08".
- Bottom buttons: default "刷新状态" + default "检测连接".

[QR Code Modal Waiting] Centered glass modal 440×520 (border-radius 22, large shadow + semi-transparent mask):
- Title "扫码登录" 17/700 + top-right ✕.
- 200×200 QR code (white background, border-radius 14, glass border).
- Monospace countdown "02:48".
- Step list (3 lines of small text):
  · 1. 打开手机 B 站 App
  · 2. 点击右上角扫一扫
  · 3. 确认登录
- Status line: gray dot + "等待扫码…" + spinner.
- Bottom ghost button "刷新二维码".

[Login Successful] Overlay a semi-transparent green mask on the QR code + large white checkmark + status line turns green "登录成功，2 秒后自动关闭" + sub-text "欢迎回来，花花直播姬".
```

---

## S3 · 监听与发送

```
"监听与发送" page, output Running / Stopped states, 浅色 + 深色, all Chinese text.
Background blobs must show through. Left sidebar with "监听与发送" active.

[Running] Main area with 3 vertical blocks:

1. Top Status Card (long horizontal glass, height 96):
   - Left: Large primary color capsule button "监听运行中" (green glow, height 30, with play icon).
   - Center: 3 statistical columns (spacing 24):
     · "已连接" monospace 17 "01:23:45"
     · "接收事件" 17/700 "12,453"
     · "发送弹幕" 17/700 "38"
   - Right: 30×30 circular IconBtn "重连".

2. Event Stream Glass Card (height 320, border-radius 18):
   Title "实时事件流" + 4 chip filters on the right ("全部" primary color active / "弹幕" / "礼物" / "进场").
   List of 6 lines (each a semi-transparent white small card, border-radius 8, raises on hover), mixed events:
   - Blue 弹幕 · "小白同学" + chip "花花团 21" · "主播好可爱～" · monospace "21:14:23".
   - Pink 礼物 · "大老板" · "辣条 ×10（10 电池）" · "21:14:25".
   - Gray 进场 · "路人甲" · "进入直播间" · "21:14:27".
   - Yellow 关注 · "小迷妹" · "关注了主播" · "21:14:31".
   - Gold 大航海 · "金主爸爸" · "开通了 总督（388 元）" · "21:14:42".
   - Red 红包 · "系统" · "新红包 奖池 200 电池 倒计时 60s" · "21:14:50".

3. Send Danmaku Glass Card:
   - Title "发送弹幕".
   - Multi-line glass LineEdit (height 80, placeholder "输入要发送的弹幕（最多 30 字）…") + "0/30" on the bottom-right.
   - Rate limit line small text "距上次发送 3.2s · 队列空闲".
   - Large primary color capsule button "发送弹幕".
   - Bottom preset phrases 5 chip capsules (light primary color background):
     "你好呀～" / "晚安" / "谢谢老板" / "求关注" / "[!cmd 抽签]"

[Stopped]
- Status card button turns red destructive "已停止".
- Event stream card empty state: Central gray illustration + "等待开始监听…".
- Send Danmaku card button disabled gray.
```

---

## S4 · 自动回复

```
"自动回复" page, output Default + Add Keyword Modal + Empty states, 浅色 + 深色, all Chinese text.
Left sidebar with "自动回复" active.
Do not use tables — Slint version always uses chips + cards, no dense tables.

[Default State] Main area vertical scrolling page with 4 large glass cards (border-radius 18, padding 16), spacing 14:

Card 1 · 关键词回复:
Title "关键词回复" + ghost button "+ 添加" on the right.
6-line simplified list (each 40 high, semi-transparent white small card, border-radius 10):
- chip "你好" + chip "hi" → text "你好呀～主播看到你啦" → 30 circular IconBtn "删除"
- chip "主播好可爱" → "谢谢小可爱～" → Delete
- chip "几岁" → "永远 18 岁啦" → Delete
- chip "求关注" → "点击主播头像可关注哦" → Delete
- chip "晚安" → "晚安做个好梦～" → Delete
- chip "^抽签 (.+)$" + gray chip "正则" → "{user} 抽到：{1}" → Delete

Card 2 · 欢迎语:
Title "欢迎语 · 分时段" + "+ 添加" on the right.
Chip collection, 4 lines (left label chip + text):
- chip "06:00-12:00" "{user} 早上好呀，新的一天加油！"
- chip "12:00-18:00" "{user} 下午好～"
- chip "18:00-23:00" "{user} 晚上好～终于等到你"
- chip "23:00-06:00" "{user} 这么晚还在呀，注意休息"

Card 3 · 答谢语:
Title "礼物答谢"
Chip collection (each = gift name + ✕): 辣条 / 小花花 / 牌子 / 私人飞机 / 嘉年华 / 总督.
Below: "模板预览" small text + "谢谢 {user} 的 {gift}×{count}！".

Card 4 · 黑名单:
Title "黑名单"
Two columns:
- Left "UID 黑名单" chip collection: 12345 / 67890 / 11223 / 44556 / 78901.
- Right "昵称黑名单" chip collection: 广告号A / 广告号B / 引流小号.

[Add Keyword Modal] 260×200 small glass modal (border-radius 18, large shadow):
- Title "添加关键词".
- Glass LineEdit "触发词…".
- Glass LineEdit "回复内容…".
- Bottom ghost "取消" + primary color "添加".

[Empty State] All 4 cards replaced by a central illustration + "还没有规则，点击右上角'+ 添加'".
```

---

## S5 · AI 机器人

```
"AI 机器人" page, output Configured / Not Configured / Test Drawer Open screens, 浅色 + 深色, all Chinese text.
Left sidebar with "AI 机器人" active.

[Configured] A large glass card in the main area (border-radius 18, padding 20):

Top row of 4 IconBtns to switch providers (30 circle, spacing 8):
- QingYun icon (gray).
- OpenAI icon (solid primary color active).
- DeepSeek icon (gray).
- Custom icon (gray).
Gray chip on the right showing "OpenAI 兼容".

Form fields (each 56 high, left label 96 + right control filling):
- "模型" glass LineEdit monospace "gpt-4o-mini".
- "API URL" glass LineEdit "https://api.openai.com/v1".
- "API Key" password "●●●●●●sk-…3F2a" + right 👁.
- "温度" glass slider (primary color gradient fill + circular thumb) + number "0.7" on the right.
- "系统提示词" glass TextEdit 8 lines high, content "你是花花直播姬的助理，名字叫小花。回答要简短活泼，不超过 20 个字。".
- "触发命令" LineEdit "小助手" + 36×20 Toggle on the right "模糊匹配" ON.

Large primary color capsule at the bottom "保存配置".

30 circular IconBtn "测试" (glass + test bottle icon) floating in the top-right corner.

[Not Configured] API Key empty + yellow warning bar at the top: "⚠ 未配置 API Key，AI 闲聊不可用" + "保存配置" button disabled gray.

[Test Drawer Open] A 320-wide glass drawer slides in from the right:
- Title "测试对话" + ✕ + ghost "清空".
- Chat area with 4 rounds:
  · User (right, solid primary color with white text, border-radius 14): "主播在做什么呀"
  · Assistant (left, semi-transparent white card, border-radius 14): "在陪大家聊天呀～"
  · User: "今天直播多久了"
  · Assistant: "已经播了 2 小时啦！"
- Bottom input box + primary color send IconBtn.
```

---

## S6 · 数据统计

```
"数据统计" page, output Default / Empty states, 浅色 + 深色, all Chinese text.
Left sidebar with "数据统计" active.
Slint version emphasizes visuals over dense data — no tables, no heatmaps.

[Default] Main area vertical layout:

1. Top segmented glass capsule (height 32, border-radius 16):
   本场 / 今日 (active, solid primary color) / 近 7 天

2. 6 StatTile semi-transparent glass cards in 2 rows and 3 columns (same as S1 Dashboard):
   - "弹幕总数" "12,453" "↑18%"
   - "进场" "2,108" "↑5%"
   - "新增关注" "186" "↑22%"
   - "礼物总值" "38.5K" "电池"
   - "大航海" "+3"
   - "平均人气" "8,432"

3. Two large chart glass cards side-by-side below:

Left Card (border-radius 18, padding 18) "弹幕量趋势":
- X-axis 19:00-22:00 every 10 minutes.
- Solid primary color line + primary color gradient fill (top 30%→bottom 0%).
- Glass specular border.
- Annotation "21:03 峰值 542".

Right Card "礼物 TOP 5 圆环":
- Large donut chart 200×200 centered, with 5 colored arcs (based on gift proportions).
- Center total "38.5K 电池" + sub-text "本场".
- Legend with 5 lines on the right: Colored dot + gift name + percentage %.
  · 辣条 32%
  · 小花花 28%
  · 嘉年华 18%
  · 私人飞机 12%
  · 总督 10%

[Empty] 6 KPIs all 0 + central 200 cartoon coffee cup illustration in chart area + "今天还没有互动数据" + sub-text "等待开始监听后再来看看".
```

---

## S7 · PK 与活动

```
"PK 与活动" page, output PK in Progress / PK Ended / No Activity Empty View, 浅色 + 深色, all Chinese text.
Left sidebar with "PK 与活动" active.

[PK in Progress] Main area vertical layout:

1. Current PK large glass card (height 200, border-radius 18, padding 18, dual progress bars across the bottom):
   - Left: 56 circular avatar "花花直播姬" + Room ID 8792912 monospace 11 gray + large score "248".
   - Center: Countdown "03:42" (36 monospace bold) + red chip "PK 中" above.
   - Right: 56 avatar "小蓝直播间" + 12345678 + score "196" + top-right 30 circular IconBtn "前往对面 ↗".
   - Dual progress bars at the bottom (Left primary color 56% + Right rose pink 44% + middle white separator).

2. Two side-by-side glass cards below (spacing 14):

Left Card PK History (border-radius 18, padding 14):
- Title "PK 历史" + "本场 3 胜 2 负" on the right.
- List of 6 rows:
  · 21:08 / 小蓝直播间 / 248:196 / green chip "胜"
  · 20:42 / 小红直播间 / 312:280 / green "胜"
  · 20:12 / 小绿直播间 / 156:220 / red "负"
  · 19:48 / 小紫直播间 / 280:145 / green "胜"
  · 19:20 / 小黄直播间 / 88:132 / red "负"
  · 18:55 / 小橙直播间 / 256:188 / green "胜"

Right Card Current Activities (border-radius 18, padding 14):
- Title "当前活动".
- Sub-card 1 红包 #234 (red glass light background):
  · Countdown ring (60 diameter primary color arc) + center "00:42".
  · "参与 312 人 · 奖池 200 电池".
  · Primary color button "参与".
- Sub-card 2 天选时刻 (gold glass light background):
  · Countdown "02:35".
  · Condition "关注主播 + 弹幕'我要参与'".
  · "已报名 1,204".
  · Primary color button "参与".

[PK Ended] Top PK card collapses into a 56-high banner: small icon + "上一场：花花 248 vs 196 小蓝 · 胜" + "查看详情 ↗" small text. The two cards below remain.

[Empty] PK card replaced by a 96-high glass banner: "暂无 PK" + sub-text "等待主播匹配 PK". Two cards below are empty: Left illustration + "暂无 PK 历史", Right illustration + "暂无活动".
```

---

## S8 · 系统与更新

```
"系统与更新" page, output No Update / New Version / Checking / Update Modal states, 浅色 + 深色, all Chinese text.
Left sidebar with "系统与更新" active.

Main area with 3 large vertically stacked glass cards (border-radius 18, padding 18, spacing 16):

[No Update]

Card 1 · 版本:
- Title "版本".
- Monospace "当前版本 v0.1.0".
- Monospace "最新版本 v0.1.0" + green check chip "已是最新".
- "构建时间 2026-05-01 19:42".
- Bottom primary color capsule button "检查更新".

Card 2 · 配置:
- Title "配置".
- Monospace "路径 etc/bilidanmaku-api.yaml".
- "上次保存 2026-05-03 15:32 · 4.2 KB".
- Row of IconBtns at the bottom: circular folder "打开" / circle up arrow "导出" / circle down arrow "导入".

Card 3 · 数据:
- Title "数据".
- Monospace "DB 路径 db/sqliteDataBase.db".
- "大小 12.4 MB" + sub-items "互动记录 142,308 / 直播场次 23 / 用户 4,512".
- Row of IconBtns at the bottom: circular "备份" / circular "清理" (yellow) / circular "导出".

[New Version Available] Card 1:
- Monospace "最新版本 v0.1.5" + red chip "新版本".
- Primary color button becomes "立即更新".
- Sub-text "已发布 2 天".

[Checking] Card 1 button becomes "检查中…" + spinner + disabled.

[Update Modal] Centered glass modal 380×440 (border-radius 22, large shadow):
- Title "发现新版本 v0.1.5" + ✕.
- Secondary info "发布 2 天前 · 8.4 MB · macOS".
- Scrollable markdown changelog (embedded in semi-transparent white card):
  ## 新功能
  - 增加 PK 历史详情弹窗
  - 支持 DeepSeek 模型
  ## 修复
  - 修复礼物聚合时段错误
  ## 改进
  - 数据库写入提速 30%
- Bottom ghost "稍后" + primary color capsule "立即下载".
```

---

## S9 · 主题面板 (Core: Compact Custom Color Picker)

```
Click Topbar theme IconBtn → Pops up "外观" glass popup (300×440, border-radius 18, large shadow, padding 16), output 浅色 + 深色 versions, all Chinese text.
Popup slides out from below the IconBtn, aligned to the top-right of the window. Background blobs must show through the popup glass.

[Content from Top to Bottom]

1. Title line "外观" 17/700 + ✕ on the right.

2. Mode Switch Segmented glass capsule (height 32, border-radius 16):
   - "浅色" + sun icon.
   - "深色" + moon icon (active, solid primary color background with white text).
   Does not include "跟随系统".

3. Section "主色调" (11/700 letter-spacing 0.6 gray).
   Row of 4 circular presets 28×28 (spacing 14):
   - iOS Blue #007aff (active: 3px white ring + 8px primary color glow).
   - 翠绿 #34c759.
   - 橙 #ff9500.
   - 玫红 #ff2d55.
   Below each circle: 10 gray small text "蓝 / 绿 / 橙 / 红".

4. Collapsible card "自定义" (semi-transparent glass, border-radius 12, padding 12):
   Header: small triangle ▾ + "自定义颜色" + current HEX on the right "#007AFF".
   Expanded content:
   - Three sliders (each 36 high, left 24 text label + glass slider + right 56 LineEdit number):
     · "H" Rainbow gradient 0-360, circular thumb + 4px shadow, current 211.
     · "S" Gray→Saturation 0-100, current 100.
     · "L" Black→White 0-100, current 50.
   - HEX row: glass LineEdit monospace "#007AFF" + 30 circular IconBtn "复制".
   - Real-time preview (row of 3 glass small cards 60×30):
     · "按钮" (solid primary color background with white text).
     · "导航" (light primary color background with primary color text).
     · "Toggle" (small 36×20 ON-state example).

5. Section "我的收藏" (11/700) + "清空" small text on the right.
   8-slot grid 24×24 (4×2): 5 used color blocks + 3 empty "+" icon slots.

6. Bottom row right-aligned:
   - ghost link small text "重置默认".
   - primary color capsule "应用".

[Key Constraints] Since the desktop window is small (1080×700), do not include a full HSL color wheel; use three sliders + HEX for custom colors.
```

---

## Recommendations for Use

- Order: §0 → S1 (Verify Dashboard glass effect) → S9 (Theme Panel) → S2..S8.
- In the first segment, ensure Stitch draws the "Floating Gaussian Blobs" (Blue top-left / Rose Pink top-right / Emerald Green bottom-right). All subsequent pages must reuse the same set of blobs. If the glass effect isn't right, repeatedly adjust the "Blob Opacity" and "Card Translucency" parameters in §0.
- Do not let Stitch draw dense tables in the Slint version — it doesn't fit the visual language. If it generates a table, use the "Change to chip list" command to correct it.
- The Slint version only includes 浅色 / 深色 states; there is no need for a "Follow System" view.
