# React OBS Overlay Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every existing OBS overlay page to a shared React runtime while making music interaction the first full multi-theme animated overlay.

**Architecture:** Keep Rust/Axum responsible for OBS HTTP routes, WebSocket, JSON APIs, storage, and safety. Add a separate React overlay app under `src-tauri/src/overlay/` that renders display-only plugin components based on `location.pathname`, with runtime query parsing for `skin`, `transparent`, `scale`, `motion`, and `primaryColor`. Preserve all legacy OBS URLs and keep old standalone HTML files as fallback during the migration.

**Tech Stack:** Rust 2024, Axum, Vite 6, React, TypeScript, CSS modules/global CSS, existing `/plugin-settings`, `/cfg`, `/ws`, `/proxy`, `/local-resource`, and `/song-request/api/*` endpoints.

---

## Current State

Existing overlay routes in `src/overlay_server.rs` serve hand-written static HTML:

- `/` -> `src/overlay.html`
- `/wish-goal` -> `src/wish_goal.html`
- `/lottery` -> `src/lottery.html`
- `/gift-effect` -> `src/gift_effect.html`
- `/recent-gifts` -> `src/recent_gifts.html`
- `/gift-rank` -> `src/gift_rank.html`
- `/song-request`, `/song-request/playlist`, `/song-request/now-playing`, `/song-request/rank` -> `src/music_interaction.html`

Music interaction already has working backend data:

- `/song-request/api/queue`
- `/song-request/api/now-playing`
- `/song-request/api/rank`

The React settings app currently builds from `src-tauri/index.html` and `src-tauri/src/main.tsx`. This plan adds a second Vite entry for the overlay runtime without importing plugin-center page components.

## File Map

Create:

- `src/overlay_react.html` — small Axum-served shell that loads built overlay JS/CSS.
- `src-tauri/src/overlay/main.tsx` — React mount for OBS overlays.
- `src-tauri/src/overlay/OverlayRouter.tsx` — path-to-plugin router.
- `src-tauri/src/overlay/styles.css` — OBS-safe global styles and theme CSS variables.
- `src-tauri/src/overlay/runtime/types.ts` — shared overlay config and plugin setting types.
- `src-tauri/src/overlay/runtime/query.ts` — query parameter parsing.
- `src-tauri/src/overlay/runtime/motion.ts` — motion mode resolution.
- `src-tauri/src/overlay/runtime/fetch.ts` — JSON fetch helper.
- `src-tauri/src/overlay/runtime/usePluginSettings.ts` — `/plugin-settings` loader and `/ws` refresh hook.
- `src-tauri/src/overlay/components/OverlayFrame.tsx` — transparent/scaled frame.
- `src-tauri/src/overlay/components/EmptyState.tsx` — safe empty state.
- `src-tauri/src/overlay/components/MarqueeText.tsx` — long-text guard.
- `src-tauri/src/overlay/plugins/song-request/types.ts` — music queue JSON types.
- `src-tauri/src/overlay/plugins/song-request/useSongRequestData.ts` — music polling and diff flags.
- `src-tauri/src/overlay/plugins/song-request/SongRequestOverlay.tsx` — music overlay router.
- `src-tauri/src/overlay/plugins/song-request/SongRequestThemes.tsx` — `neon`, `idol-stage`, `vinyl`.
- `src-tauri/src/overlay/plugins/wish-goal/WishGoalOverlay.tsx`
- `src-tauri/src/overlay/plugins/lottery/LotteryOverlay.tsx`
- `src-tauri/src/overlay/plugins/gift-effect/GiftEffectOverlay.tsx`
- `src-tauri/src/overlay/plugins/recent-gifts/RecentGiftsOverlay.tsx`
- `src-tauri/src/overlay/plugins/gift-rank/GiftRankOverlay.tsx`
- `src-tauri/src/overlay/plugins/danmaku/DanmakuOverlay.tsx`

Modify:

- `src-tauri/vite.config.ts` — add stable overlay build entry.
- `src/overlay_server.rs` — serve React shell on overlay routes and serve built overlay assets, while retaining legacy HTML constants for fallback.

No planned changes:

- `src/music/*` — music backend is already functional for this UI migration.
- `src/plugin_settings.rs` — use current settings schema.
- `src-tauri/src/app/*` — plugin-center UI stays separate unless verification finds a URL generation issue.

---

## Task 1: Vite Overlay Entry And Runtime Skeleton

**Files:**

- Modify: `src-tauri/vite.config.ts`
- Create: `src-tauri/src/overlay/main.tsx`
- Create: `src-tauri/src/overlay/OverlayRouter.tsx`
- Create: `src-tauri/src/overlay/styles.css`
- Create: `src-tauri/src/overlay/runtime/types.ts`
- Create: `src-tauri/src/overlay/runtime/query.ts`
- Create: `src-tauri/src/overlay/runtime/motion.ts`
- Create: `src-tauri/src/overlay/runtime/fetch.ts`
- Create: `src-tauri/src/overlay/components/OverlayFrame.tsx`
- Create: `src-tauri/src/overlay/components/EmptyState.tsx`
- Create: `src-tauri/src/overlay/components/MarqueeText.tsx`

- [ ] **Step 1: Add the overlay Vite entry**

Modify `src-tauri/vite.config.ts` so Vite emits a stable `assets/overlay.js` entry while keeping the existing app build.

Replace the `build` block with:

```ts
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        overlay: path.resolve(__dirname, 'src/overlay/main.tsx'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: assetInfo => {
          const name = assetInfo.name || '';
          if (name.endsWith('.css')) return 'assets/[name][extname]';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
```

This creates:

```text
src-tauri/dist/assets/overlay.js
src-tauri/dist/assets/overlay.css
```

when overlay CSS is imported from `main.tsx`.

- [ ] **Step 2: Create overlay shared types**

Create `src-tauri/src/overlay/runtime/types.ts`:

```ts
export type OverlayMotion = 'full' | 'reduced' | 'off';

export interface OverlayRuntimeConfig {
  skin: string;
  transparent: boolean;
  scale: number;
  motion: OverlayMotion;
  primaryColor: string | null;
}

export interface OverlayRoute {
  plugin: 'danmaku' | 'wish-goal' | 'lottery' | 'gift-effect' | 'recent-gifts' | 'gift-rank' | 'song-request';
  view: 'default' | 'playlist' | 'now-playing' | 'rank';
}

export interface PluginSettings {
  WishGoal?: WishGoalSettings;
  LotteryInteraction?: LotteryInteractionSettings;
  GiftEffect?: GiftEffectSettings;
  RecentGifts?: RecentGiftsSettings;
  GiftRank?: GiftRankSettings;
}

export interface WishGoalSettings {
  Enabled?: boolean;
  Title?: string;
  Goals?: Array<{ Id?: string; Name?: string; Current?: number; Target?: number; Icon?: string }>;
  StylePreset?: string;
  AccentColor?: string;
  BackgroundColor?: string;
  TextColor?: string;
  NumberColor?: string;
  ShowIcons?: boolean;
}

export interface LotteryInteractionSettings {
  Enabled?: boolean;
  Title?: string;
  LastWinner?: string;
  LastPrize?: string;
  DrawNonce?: number;
  StaySeconds?: number;
}

export interface GiftEffectSettings {
  Enabled?: boolean;
  Skin?: string;
  LastUser?: string;
  LastGift?: string;
  LastCount?: number;
  EffectNonce?: number;
}

export interface RecentGiftsSettings {
  Enabled?: boolean;
  Title?: string;
  MaxItems?: number;
  Skin?: string;
  NameColor?: string;
  NumberColor?: string;
  GiftColor?: string;
  Items?: Array<{ User?: string; Gift?: string; Count?: number; Avatar?: string }>;
}

export interface GiftRankSettings {
  Enabled?: boolean;
  Title?: string;
  MaxItems?: number;
  Skin?: string;
  Items?: Array<{ User?: string; Value?: number; Avatar?: string }>;
}
```

- [ ] **Step 3: Create query parser**

Create `src-tauri/src/overlay/runtime/query.ts`:

```ts
import { OverlayRuntimeConfig, OverlayRoute } from './types';
import { resolveMotion } from './motion';

const HEX = /^#[0-9a-fA-F]{6}$/;

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function parseScale(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(2, Math.max(0.5, parsed));
}

export function parseOverlayConfig(search = window.location.search): OverlayRuntimeConfig {
  const params = new URLSearchParams(search);
  const primaryColor = params.get('primaryColor');
  return {
    skin: params.get('skin') || 'default',
    transparent: parseBoolean(params.get('transparent'), true),
    scale: parseScale(params.get('scale')),
    motion: resolveMotion(params.get('motion')),
    primaryColor: primaryColor && HEX.test(primaryColor) ? primaryColor : null,
  };
}

export function resolveOverlayRoute(pathname = window.location.pathname): OverlayRoute {
  if (pathname === '/' || pathname === '/overlay/danmaku') {
    return { plugin: 'danmaku', view: 'default' };
  }
  if (pathname === '/wish-goal' || pathname === '/overlay/wish-goal') {
    return { plugin: 'wish-goal', view: 'default' };
  }
  if (pathname === '/lottery' || pathname === '/overlay/lottery') {
    return { plugin: 'lottery', view: 'default' };
  }
  if (pathname === '/gift-effect' || pathname === '/overlay/gift-effect') {
    return { plugin: 'gift-effect', view: 'default' };
  }
  if (pathname === '/recent-gifts' || pathname === '/overlay/recent-gifts') {
    return { plugin: 'recent-gifts', view: 'default' };
  }
  if (pathname === '/gift-rank' || pathname === '/overlay/gift-rank') {
    return { plugin: 'gift-rank', view: 'default' };
  }
  if (pathname.endsWith('/song-request/now-playing')) {
    return { plugin: 'song-request', view: 'now-playing' };
  }
  if (pathname.endsWith('/song-request/rank')) {
    return { plugin: 'song-request', view: 'rank' };
  }
  if (pathname === '/song-request' || pathname.endsWith('/song-request/playlist')) {
    return { plugin: 'song-request', view: 'playlist' };
  }
  return { plugin: 'danmaku', view: 'default' };
}
```

- [ ] **Step 4: Create motion resolver**

Create `src-tauri/src/overlay/runtime/motion.ts`:

```ts
import { OverlayMotion } from './types';

export function resolveMotion(value: string | null): OverlayMotion {
  const requested: OverlayMotion =
    value === 'reduced' || value === 'off' || value === 'full' ? value : 'full';
  if (requested === 'off') return 'off';
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return 'reduced';
  }
  return requested;
}

export function motionClass(motion: OverlayMotion): string {
  return `motion-${motion}`;
}
```

- [ ] **Step 5: Create fetch helper**

Create `src-tauri/src/overlay/runtime/fetch.ts`:

```ts
export async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) return fallback;
    return await response.json() as T;
  } catch {
    return fallback;
  }
}

export function proxyImage(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.includes('hdslb.com') ? `/proxy?url=${encodeURIComponent(url)}` : url;
}

export function localResource(path: string | undefined): string {
  return `/local-resource?url=${encodeURIComponent(path || '')}`;
}
```

- [ ] **Step 6: Create shared display components**

Create `src-tauri/src/overlay/components/OverlayFrame.tsx`:

```tsx
import { ReactNode } from 'react';
import { motionClass } from '../runtime/motion';
import { OverlayRuntimeConfig } from '../runtime/types';

interface OverlayFrameProps {
  config: OverlayRuntimeConfig;
  plugin: string;
  view: string;
  children: ReactNode;
}

export function OverlayFrame({ config, plugin, view, children }: OverlayFrameProps) {
  const style = {
    '--overlay-scale': String(config.scale),
    '--overlay-primary': config.primaryColor || '#8b5cf6',
  } as React.CSSProperties;

  return (
    <main
      className={[
        'overlay-frame',
        `plugin-${plugin}`,
        `view-${view}`,
        `skin-${config.skin}`,
        config.transparent ? 'is-transparent' : 'has-background',
        motionClass(config.motion),
      ].join(' ')}
      style={style}
    >
      {children}
    </main>
  );
}
```

Create `src-tauri/src/overlay/components/EmptyState.tsx`:

```tsx
interface EmptyStateProps {
  title: string;
  subtitle?: string;
}

export function EmptyState({ title, subtitle }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      {subtitle ? <div className="empty-subtitle">{subtitle}</div> : null}
    </div>
  );
}
```

Create `src-tauri/src/overlay/components/MarqueeText.tsx`:

```tsx
interface MarqueeTextProps {
  children: string | number | null | undefined;
  className?: string;
}

export function MarqueeText({ children, className }: MarqueeTextProps) {
  return <span className={['marquee-text', className || ''].join(' ')}>{children || ''}</span>;
}
```

- [ ] **Step 7: Create global overlay CSS**

Create `src-tauri/src/overlay/styles.css`:

```css
*, *::before, *::after {
  box-sizing: border-box;
}

html, body, #overlay-root {
  width: 100%;
  height: 100%;
  margin: 0;
}

html, body {
  overflow: hidden;
  background: transparent;
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
}

body {
  color: #fff;
}

.overlay-frame {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  transform-origin: top left;
  transform: scale(var(--overlay-scale, 1));
  color: #fff;
}

.overlay-frame.has-background {
  background: rgba(15, 23, 42, 0.72);
}

.empty-state {
  display: flex;
  min-width: 180px;
  min-height: 56px;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.36);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

.empty-title {
  font-size: 14px;
  font-weight: 900;
}

.empty-subtitle {
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  font-weight: 700;
}

.marquee-text {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.motion-off *,
.motion-reduced * {
  animation-duration: 1ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 1ms !important;
}
```

- [ ] **Step 8: Create temporary router and mount**

Create `src-tauri/src/overlay/OverlayRouter.tsx`:

```tsx
import { EmptyState } from './components/EmptyState';
import { OverlayFrame } from './components/OverlayFrame';
import { parseOverlayConfig, resolveOverlayRoute } from './runtime/query';

export function OverlayRouter() {
  const config = parseOverlayConfig();
  const route = resolveOverlayRoute();
  return (
    <OverlayFrame config={config} plugin={route.plugin} view={route.view}>
      <EmptyState title="React OBS Overlay" subtitle={`${route.plugin} / ${route.view}`} />
    </OverlayFrame>
  );
}
```

Create `src-tauri/src/overlay/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { OverlayRouter } from './OverlayRouter';
import './styles.css';

createRoot(document.getElementById('overlay-root')!).render(<OverlayRouter />);
```

- [ ] **Step 9: Run frontend build**

Run:

```bash
npm run build --prefix src-tauri
```

Expected: build succeeds and `src-tauri/dist/assets/overlay.js` exists.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/vite.config.ts src-tauri/src/overlay
git commit -m "feat: add react overlay runtime entry"
```

---

## Task 2: Axum Shell And Overlay Asset Serving

**Files:**

- Create: `src/overlay_react.html`
- Modify: `src/overlay_server.rs`

- [ ] **Step 1: Add React overlay shell**

Create `src/overlay_react.html`:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Streamix OBS Overlay</title>
  <link rel="stylesheet" href="/overlay-assets/overlay.css" />
</head>
<body>
  <div id="overlay-root"></div>
  <script type="module" src="/overlay-assets/overlay.js"></script>
</body>
</html>
```

- [ ] **Step 2: Add constants and asset response helper**

Modify the constants near the top of `src/overlay_server.rs`:

```rust
const HTML: &str = include_str!("overlay.html");
const WISH_GOAL_HTML: &str = include_str!("wish_goal.html");
const LOTTERY_HTML: &str = include_str!("lottery.html");
const GIFT_EFFECT_HTML: &str = include_str!("gift_effect.html");
const RECENT_GIFTS_HTML: &str = include_str!("recent_gifts.html");
const GIFT_RANK_HTML: &str = include_str!("gift_rank.html");
const MUSIC_INTERACTION_HTML: &str = include_str!("music_interaction.html");
const REACT_OVERLAY_HTML: &str = include_str!("overlay_react.html");
```

Add this helper below `music_interaction_handler`:

```rust
fn overlay_react_enabled() -> bool {
    std::env::var("STREAMIX_LEGACY_OVERLAYS")
        .map(|value| value != "1")
        .unwrap_or(true)
}

fn overlay_shell_or_legacy(legacy: &'static str) -> Html<&'static str> {
    if overlay_react_enabled() {
        Html(REACT_OVERLAY_HTML)
    } else {
        Html(legacy)
    }
}

async fn overlay_asset_handler(axum::extract::Path(path): axum::extract::Path<String>) -> Response<Body> {
    let safe_path = path.trim_start_matches('/');
    if safe_path.contains("..") || safe_path.contains('\\') {
        return empty_response(StatusCode::FORBIDDEN);
    }
    let full_path = std::path::PathBuf::from("src-tauri/dist/assets").join(safe_path);
    let bytes = match std::fs::read(&full_path) {
        Ok(bytes) => bytes,
        Err(_) => return empty_response(StatusCode::NOT_FOUND),
    };
    let content_type = match full_path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}
```

- [ ] **Step 3: Route overlay assets**

Add this route in `start` before `.with_state(tx)`:

```rust
.route("/overlay-assets/{*path}", get(overlay_asset_handler))
```

- [ ] **Step 4: Switch legacy route handlers to shell with fallback**

Change the existing handlers:

```rust
async fn index_handler() -> Html<&'static str> {
    overlay_shell_or_legacy(HTML)
}

async fn wish_goal_handler() -> Html<&'static str> {
    overlay_shell_or_legacy(WISH_GOAL_HTML)
}

async fn lottery_handler() -> Html<&'static str> {
    overlay_shell_or_legacy(LOTTERY_HTML)
}

async fn gift_effect_handler() -> Html<&'static str> {
    overlay_shell_or_legacy(GIFT_EFFECT_HTML)
}

async fn recent_gifts_handler() -> Html<&'static str> {
    overlay_shell_or_legacy(RECENT_GIFTS_HTML)
}

async fn gift_rank_handler() -> Html<&'static str> {
    overlay_shell_or_legacy(GIFT_RANK_HTML)
}

async fn music_interaction_handler() -> Html<&'static str> {
    overlay_shell_or_legacy(MUSIC_INTERACTION_HTML)
}
```

- [ ] **Step 5: Run checks**

Run:

```bash
npm run build --prefix src-tauri
cargo fmt
cargo check -q
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/overlay_react.html src/overlay_server.rs
git commit -m "feat: serve react obs overlay shell"
```

---

## Task 3: Runtime Settings And Router Components

**Files:**

- Create: `src-tauri/src/overlay/runtime/usePluginSettings.ts`
- Modify: `src-tauri/src/overlay/OverlayRouter.tsx`
- Create: `src-tauri/src/overlay/plugins/danmaku/DanmakuOverlay.tsx`
- Create: `src-tauri/src/overlay/plugins/wish-goal/WishGoalOverlay.tsx`
- Create: `src-tauri/src/overlay/plugins/lottery/LotteryOverlay.tsx`
- Create: `src-tauri/src/overlay/plugins/gift-effect/GiftEffectOverlay.tsx`
- Create: `src-tauri/src/overlay/plugins/recent-gifts/RecentGiftsOverlay.tsx`
- Create: `src-tauri/src/overlay/plugins/gift-rank/GiftRankOverlay.tsx`
- Create: `src-tauri/src/overlay/plugins/song-request/SongRequestOverlay.tsx`

- [ ] **Step 1: Add plugin settings hook**

Create `src-tauri/src/overlay/runtime/usePluginSettings.ts`:

```tsx
import { useEffect, useState } from 'react';
import { fetchJson } from './fetch';
import { PluginSettings } from './types';

const EMPTY_SETTINGS: PluginSettings = {};

export function usePluginSettings() {
  const [settings, setSettings] = useState<PluginSettings>(EMPTY_SETTINGS);

  useEffect(() => {
    let disposed = false;

    async function load() {
      const next = await fetchJson<PluginSettings>('/plugin-settings', EMPTY_SETTINGS);
      if (!disposed) setSettings(next || EMPTY_SETTINGS);
    }

    load();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data._plugin_settings_update || data._overlay_cfg_update) {
          void load();
        }
      } catch {
        // OBS overlays must stay quiet on malformed messages.
      }
    };
    socket.onclose = () => {
      if (!disposed) window.setTimeout(load, 1000);
    };

    return () => {
      disposed = true;
      socket.close();
    };
  }, []);

  return settings;
}
```

- [ ] **Step 2: Create temporary plugin components**

Create `src-tauri/src/overlay/plugins/danmaku/DanmakuOverlay.tsx`:

```tsx
import { EmptyState } from '../../components/EmptyState';

export function DanmakuOverlay() {
  return <EmptyState title="弹幕浮层" subtitle="React overlay 已加载" />;
}
```

Create `src-tauri/src/overlay/plugins/wish-goal/WishGoalOverlay.tsx`:

```tsx
import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

export function WishGoalOverlay({ settings }: { settings: PluginSettings }) {
  const title = settings.WishGoal?.Title || '今日心愿目标';
  return <EmptyState title={title} subtitle="心愿目标浮层" />;
}
```

Create `src-tauri/src/overlay/plugins/lottery/LotteryOverlay.tsx`:

```tsx
import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

export function LotteryOverlay({ settings }: { settings: PluginSettings }) {
  const title = settings.LotteryInteraction?.Title || '幸运抽奖';
  return <EmptyState title={title} subtitle="等待抽奖触发" />;
}
```

Create `src-tauri/src/overlay/plugins/gift-effect/GiftEffectOverlay.tsx`:

```tsx
import { EmptyState } from '../../components/EmptyState';

export function GiftEffectOverlay() {
  return <EmptyState title="礼物特效" subtitle="等待礼物触发" />;
}
```

Create `src-tauri/src/overlay/plugins/recent-gifts/RecentGiftsOverlay.tsx`:

```tsx
import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

export function RecentGiftsOverlay({ settings }: { settings: PluginSettings }) {
  const title = settings.RecentGifts?.Title || '最近礼物';
  return <EmptyState title={title} subtitle="等待礼物数据" />;
}
```

Create `src-tauri/src/overlay/plugins/gift-rank/GiftRankOverlay.tsx`:

```tsx
import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

export function GiftRankOverlay({ settings }: { settings: PluginSettings }) {
  const title = settings.GiftRank?.Title || '礼物排行';
  return <EmptyState title={title} subtitle="等待排行数据" />;
}
```

Create `src-tauri/src/overlay/plugins/song-request/SongRequestOverlay.tsx`:

```tsx
import { EmptyState } from '../../components/EmptyState';
import { OverlayRoute } from '../../runtime/types';

export function SongRequestOverlay({ route }: { route: OverlayRoute }) {
  const title = route.view === 'rank' ? '点歌排行' : route.view === 'now-playing' ? '当前播放' : '点歌歌单';
  return <EmptyState title={title} subtitle="音乐互动浮层" />;
}
```

- [ ] **Step 3: Wire router to plugin components**

Replace `src-tauri/src/overlay/OverlayRouter.tsx` with:

```tsx
import { OverlayFrame } from './components/OverlayFrame';
import { parseOverlayConfig, resolveOverlayRoute } from './runtime/query';
import { usePluginSettings } from './runtime/usePluginSettings';
import { DanmakuOverlay } from './plugins/danmaku/DanmakuOverlay';
import { WishGoalOverlay } from './plugins/wish-goal/WishGoalOverlay';
import { LotteryOverlay } from './plugins/lottery/LotteryOverlay';
import { GiftEffectOverlay } from './plugins/gift-effect/GiftEffectOverlay';
import { RecentGiftsOverlay } from './plugins/recent-gifts/RecentGiftsOverlay';
import { GiftRankOverlay } from './plugins/gift-rank/GiftRankOverlay';
import { SongRequestOverlay } from './plugins/song-request/SongRequestOverlay';

export function OverlayRouter() {
  const config = parseOverlayConfig();
  const route = resolveOverlayRoute();
  const settings = usePluginSettings();

  let content: JSX.Element;
  switch (route.plugin) {
    case 'wish-goal':
      content = <WishGoalOverlay settings={settings} />;
      break;
    case 'lottery':
      content = <LotteryOverlay settings={settings} />;
      break;
    case 'gift-effect':
      content = <GiftEffectOverlay />;
      break;
    case 'recent-gifts':
      content = <RecentGiftsOverlay settings={settings} />;
      break;
    case 'gift-rank':
      content = <GiftRankOverlay settings={settings} />;
      break;
    case 'song-request':
      content = <SongRequestOverlay route={route} />;
      break;
    case 'danmaku':
    default:
      content = <DanmakuOverlay />;
      break;
  }

  return (
    <OverlayFrame config={config} plugin={route.plugin} view={route.view}>
      {content}
    </OverlayFrame>
  );
}
```

- [ ] **Step 4: Run build**

Run:

```bash
npm run build --prefix src-tauri
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/overlay
git commit -m "feat: route react obs overlay plugins"
```

---

## Task 4: Music Overlay Data Hook And Basic Layout

**Files:**

- Create: `src-tauri/src/overlay/plugins/song-request/types.ts`
- Create: `src-tauri/src/overlay/plugins/song-request/useSongRequestData.ts`
- Modify: `src-tauri/src/overlay/plugins/song-request/SongRequestOverlay.tsx`
- Modify: `src-tauri/src/overlay/styles.css`

- [ ] **Step 1: Add music data types**

Create `src-tauri/src/overlay/plugins/song-request/types.ts`:

```ts
export interface SongQueueItem {
  requestId: number;
  uid: number;
  uname: string;
  songName: string;
  artistNames: string;
  tier: string;
  creditValue: number;
  priorityScore: number;
  status: string;
  requestedAt: string;
}

export interface SongQueueResponse {
  items: SongQueueItem[];
}

export interface NowPlayingResponse {
  item: SongQueueItem | null;
}

export interface RankResponse {
  items: Array<{ uname?: string; value?: number; count?: number; tier?: string }>;
}

export interface SongRequestVisualState {
  newRequestIds: Set<number>;
  playingChanged: boolean;
  highTierRequestId: number | null;
}
```

- [ ] **Step 2: Add music data hook**

Create `src-tauri/src/overlay/plugins/song-request/useSongRequestData.ts`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '../../runtime/fetch';
import { NowPlayingResponse, RankResponse, SongQueueItem, SongQueueResponse, SongRequestVisualState } from './types';

const EMPTY_VISUAL: SongRequestVisualState = {
  newRequestIds: new Set<number>(),
  playingChanged: false,
  highTierRequestId: null,
};

function highTier(item: SongQueueItem | null | undefined) {
  return item?.tier === 'jump_queue' || item?.tier === 'exclusive' || item?.tier === 'playlist_takeover';
}

export function useSongRequestData(view: 'playlist' | 'now-playing' | 'rank') {
  const [queue, setQueue] = useState<SongQueueItem[]>([]);
  const [nowPlaying, setNowPlaying] = useState<SongQueueItem | null>(null);
  const [rank, setRank] = useState<RankResponse['items']>([]);
  const [visual, setVisual] = useState<SongRequestVisualState>(EMPTY_VISUAL);
  const previousIds = useRef<Set<number>>(new Set());
  const previousPlaying = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;

    async function load() {
      if (view === 'now-playing') {
        const data = await fetchJson<NowPlayingResponse>('/song-request/api/now-playing', { item: null });
        if (disposed) return;
        const nextPlayingId = data.item?.requestId ?? null;
        setVisual({
          newRequestIds: new Set<number>(),
          playingChanged: previousPlaying.current !== null && previousPlaying.current !== nextPlayingId,
          highTierRequestId: highTier(data.item) ? data.item!.requestId : null,
        });
        previousPlaying.current = nextPlayingId;
        setNowPlaying(data.item || null);
        return;
      }

      if (view === 'rank') {
        const data = await fetchJson<RankResponse>('/song-request/api/rank', { items: [] });
        if (!disposed) setRank(Array.isArray(data.items) ? data.items : []);
        return;
      }

      const data = await fetchJson<SongQueueResponse>('/song-request/api/queue', { items: [] });
      if (disposed) return;
      const items = Array.isArray(data.items) ? data.items : [];
      const nextIds = new Set(items.map(item => item.requestId));
      const newRequestIds = new Set(items.filter(item => !previousIds.current.has(item.requestId)).map(item => item.requestId));
      const playing = items.find(item => item.status === 'playing') || null;
      setVisual({
        newRequestIds,
        playingChanged: previousPlaying.current !== null && previousPlaying.current !== (playing?.requestId ?? null),
        highTierRequestId: items.find(highTier)?.requestId ?? null,
      });
      previousIds.current = nextIds;
      previousPlaying.current = playing?.requestId ?? null;
      setQueue(items);
      setNowPlaying(playing);
    }

    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [view]);

  return { queue, nowPlaying, rank, visual };
}
```

- [ ] **Step 3: Render default music layout**

Replace `src-tauri/src/overlay/plugins/song-request/SongRequestOverlay.tsx` with:

```tsx
import { EmptyState } from '../../components/EmptyState';
import { MarqueeText } from '../../components/MarqueeText';
import { OverlayRoute } from '../../runtime/types';
import { useSongRequestData } from './useSongRequestData';
import { SongQueueItem } from './types';

function itemText(item: SongQueueItem) {
  const artists = item.artistNames ? ` - ${item.artistNames}` : '';
  return `${item.songName || '未命名歌曲'}${artists}`;
}

function tierLabel(tier: string) {
  switch (tier) {
    case 'jump_queue':
      return '插队';
    case 'exclusive':
      return '专属';
    case 'playlist_takeover':
      return '包场';
    case 'priority':
      return '优先';
    default:
      return '普通';
  }
}

export function SongRequestOverlay({ route }: { route: OverlayRoute }) {
  const { queue, nowPlaying, rank, visual } = useSongRequestData(route.view as 'playlist' | 'now-playing' | 'rank');

  if (route.view === 'rank') {
    if (!rank.length) return <EmptyState title="暂无点歌排行" subtitle="送礼点歌后将在这里显示" />;
    return (
      <section className="song-card song-rank">
        <div className="song-kicker">点歌排行</div>
        {rank.slice(0, 8).map((item, index) => (
          <div className="song-rank-row" key={`${item.uname || 'user'}-${index}`}>
            <span>#{index + 1}</span>
            <MarqueeText>{item.uname || '观众'}</MarqueeText>
            <strong>{item.value || 0}</strong>
          </div>
        ))}
      </section>
    );
  }

  if (route.view === 'now-playing') {
    if (!nowPlaying) return <EmptyState title="暂无正在播放" subtitle="队列歌曲开始播放后将在这里显示" />;
    return (
      <section className="song-card song-now" data-tier={nowPlaying.tier} data-playing-changed={visual.playingChanged ? '1' : '0'}>
        <div className="song-disc" />
        <div className="song-main">
          <div className="song-kicker">当前播放 · {tierLabel(nowPlaying.tier)}</div>
          <MarqueeText className="song-title">{itemText(nowPlaying)}</MarqueeText>
          <div className="song-meta">{nowPlaying.uname || '观众'} 点播 · {nowPlaying.creditValue || 0} 电池</div>
        </div>
      </section>
    );
  }

  if (!queue.length) return <EmptyState title="今日第一首歌等待点亮" subtitle="送礼点歌后将在这里显示" />;

  const lead = nowPlaying || queue[0];
  const totalValue = queue.reduce((sum, item) => sum + (Number(item.creditValue) || 0), 0);

  return (
    <section className="song-card song-playlist" data-tier={lead.tier} data-high-tier={visual.highTierRequestId ? '1' : '0'}>
      <div className="song-main">
        <div className="song-kicker">本场点歌 {totalValue} 电池 · {tierLabel(lead.tier)}</div>
        <MarqueeText className="song-title">{itemText(lead)}</MarqueeText>
        <div className="song-meta">{lead.uname || '观众'} 点播 · {lead.status === 'playing' ? '播放中' : '排队中'}</div>
      </div>
      <ol className="song-queue">
        {queue.slice(0, 4).map((item, index) => (
          <li key={item.requestId} data-new={visual.newRequestIds.has(item.requestId) ? '1' : '0'} data-tier={item.tier}>
            <span>{index + 1}</span>
            <MarqueeText>{itemText(item)}</MarqueeText>
            <em>{tierLabel(item.tier)}</em>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 4: Add base music CSS**

Append to `src-tauri/src/overlay/styles.css`:

```css
.song-card {
  display: grid;
  width: min(100vw, 760px);
  min-height: 104px;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(20, 20, 26, 0.72);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.28);
}

.song-playlist {
  grid-template-columns: minmax(0, 1fr) minmax(180px, 260px);
}

.song-now {
  grid-template-columns: 84px minmax(0, 1fr);
  align-items: center;
}

.song-kicker {
  color: var(--overlay-primary);
  font-size: 12px;
  font-weight: 900;
}

.song-title {
  margin-top: 4px;
  font-size: 24px;
  font-weight: 950;
}

.song-meta {
  margin-top: 5px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.song-queue {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.song-queue li,
.song-rank-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 12px;
  font-weight: 800;
}

.song-queue em {
  color: var(--overlay-primary);
  font-style: normal;
}

.song-disc {
  width: 72px;
  height: 72px;
  border-radius: 999px;
  background:
    radial-gradient(circle at center, #111827 0 14%, #f8fafc 15% 18%, #111827 19% 48%, #334155 49% 52%, #111827 53%);
}
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run build --prefix src-tauri
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/overlay
git commit -m "feat: render music overlay data in react"
```

---

## Task 5: Music Themes And State-Driven Effects

**Files:**

- Create: `src-tauri/src/overlay/plugins/song-request/SongRequestThemes.tsx`
- Modify: `src-tauri/src/overlay/plugins/song-request/SongRequestOverlay.tsx`
- Modify: `src-tauri/src/overlay/styles.css`

- [ ] **Step 1: Extract theme components**

Create `src-tauri/src/overlay/plugins/song-request/SongRequestThemes.tsx`:

```tsx
import { MarqueeText } from '../../components/MarqueeText';
import { SongQueueItem, SongRequestVisualState } from './types';

export function itemText(item: SongQueueItem) {
  const artists = item.artistNames ? ` - ${item.artistNames}` : '';
  return `${item.songName || '未命名歌曲'}${artists}`;
}

export function tierLabel(tier: string) {
  switch (tier) {
    case 'jump_queue':
      return '插队';
    case 'exclusive':
      return '专属';
    case 'playlist_takeover':
      return '包场';
    case 'priority':
      return '优先';
    default:
      return '普通';
  }
}

interface ThemeProps {
  view: 'playlist' | 'now-playing' | 'rank';
  skin: string;
  queue: SongQueueItem[];
  nowPlaying: SongQueueItem | null;
  rank: Array<{ uname?: string; value?: number; count?: number; tier?: string }>;
  visual: SongRequestVisualState;
}

function QueueList({ queue, visual }: { queue: SongQueueItem[]; visual: SongRequestVisualState }) {
  return (
    <ol className="song-queue">
      {queue.slice(0, 4).map((item, index) => (
        <li key={item.requestId} data-new={visual.newRequestIds.has(item.requestId) ? '1' : '0'} data-tier={item.tier}>
          <span>{index + 1}</span>
          <MarqueeText>{itemText(item)}</MarqueeText>
          <em>{tierLabel(item.tier)}</em>
        </li>
      ))}
    </ol>
  );
}

function RankList({ rank }: { rank: ThemeProps['rank'] }) {
  return (
    <div className="song-rank-list">
      {rank.slice(0, 8).map((item, index) => (
        <div className="song-rank-row" key={`${item.uname || 'user'}-${index}`}>
          <span>#{index + 1}</span>
          <MarqueeText>{item.uname || '观众'}</MarqueeText>
          <strong>{item.value || 0}</strong>
        </div>
      ))}
    </div>
  );
}

export function SongRequestTheme({ view, skin, queue, nowPlaying, rank, visual }: ThemeProps) {
  const lead = nowPlaying || queue[0] || null;
  const totalValue = queue.reduce((sum, item) => sum + (Number(item.creditValue) || 0), 0);
  const className = ['song-card', `song-theme-${skin}`].join(' ');

  if (view === 'rank') {
    return (
      <section className={`${className} song-rank`}>
        <div className="song-kicker">点歌排行</div>
        <RankList rank={rank} />
      </section>
    );
  }

  if (!lead) return null;

  const takeover = lead.tier === 'playlist_takeover';

  return (
    <section
      className={`${className} ${view === 'now-playing' ? 'song-now' : 'song-playlist'}`}
      data-tier={lead.tier}
      data-playing-changed={visual.playingChanged ? '1' : '0'}
      data-high-tier={visual.highTierRequestId ? '1' : '0'}
    >
      {takeover ? <div className="song-takeover">本段歌单由 {lead.uname || '观众'} 包场</div> : null}
      <div className="song-disc" />
      <div className="song-main">
        <div className="song-kicker">{view === 'now-playing' ? '当前播放' : `本场点歌 ${totalValue} 电池`} · {tierLabel(lead.tier)}</div>
        <MarqueeText className="song-title">{itemText(lead)}</MarqueeText>
        <div className="song-meta">{lead.uname || '观众'} 点播 · {lead.status === 'playing' ? '播放中' : '排队中'}</div>
      </div>
      {view === 'playlist' ? <QueueList queue={queue} visual={visual} /> : null}
    </section>
  );
}
```

- [ ] **Step 2: Use theme component in overlay**

Replace `src-tauri/src/overlay/plugins/song-request/SongRequestOverlay.tsx` with:

```tsx
import { EmptyState } from '../../components/EmptyState';
import { OverlayRoute } from '../../runtime/types';
import { parseOverlayConfig } from '../../runtime/query';
import { useSongRequestData } from './useSongRequestData';
import { SongRequestTheme } from './SongRequestThemes';

function resolveSongSkin(skin: string) {
  return skin === 'neon' || skin === 'idol-stage' || skin === 'vinyl' ? skin : 'neon';
}

export function SongRequestOverlay({ route }: { route: OverlayRoute }) {
  const config = parseOverlayConfig();
  const view = route.view as 'playlist' | 'now-playing' | 'rank';
  const { queue, nowPlaying, rank, visual } = useSongRequestData(view);
  const skin = resolveSongSkin(config.skin);

  if (view === 'rank' && !rank.length) {
    return <EmptyState title="暂无点歌排行" subtitle="送礼点歌后将在这里显示" />;
  }
  if (view === 'now-playing' && !nowPlaying) {
    return <EmptyState title="暂无正在播放" subtitle="队列歌曲开始播放后将在这里显示" />;
  }
  if (view === 'playlist' && !queue.length) {
    return <EmptyState title="今日第一首歌等待点亮" subtitle="送礼点歌后将在这里显示" />;
  }

  return <SongRequestTheme view={view} skin={skin} queue={queue} nowPlaying={nowPlaying} rank={rank} visual={visual} />;
}
```

- [ ] **Step 3: Add theme CSS**

Append to `src-tauri/src/overlay/styles.css`:

```css
@keyframes neonPulse {
  0%, 100% { box-shadow: 0 0 18px rgba(139, 92, 246, 0.35); }
  50% { box-shadow: 0 0 34px rgba(34, 211, 238, 0.65); }
}

@keyframes stageBeam {
  from { transform: translateX(-110%) skewX(-12deg); opacity: 0; }
  35% { opacity: 1; }
  to { transform: translateX(240%) skewX(-12deg); opacity: 0; }
}

@keyframes recordSpin {
  to { transform: rotate(360deg); }
}

@keyframes queueGlowIn {
  from { opacity: 0; transform: translateX(14px); }
  to { opacity: 1; transform: translateX(0); }
}

.song-theme-neon {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(34, 211, 238, 0.55);
  background:
    linear-gradient(135deg, rgba(17, 24, 39, 0.88), rgba(49, 46, 129, 0.74)),
    radial-gradient(circle at top right, rgba(236, 72, 153, 0.34), transparent 42%);
}

.song-theme-neon[data-high-tier="1"] {
  animation: neonPulse 2.2s ease-in-out infinite;
}

.song-theme-neon .song-title {
  color: #fdf4ff;
  text-shadow: 0 0 12px rgba(217, 70, 239, 0.5);
}

.song-theme-idol-stage {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(251, 207, 232, 0.7);
  background:
    linear-gradient(90deg, rgba(157, 23, 77, 0.82), rgba(124, 58, 237, 0.74)),
    radial-gradient(circle at 20% 0, rgba(255, 255, 255, 0.32), transparent 28%);
}

.song-theme-idol-stage[data-tier="exclusive"]::after,
.song-theme-idol-stage[data-tier="playlist_takeover"]::after {
  content: "";
  position: absolute;
  inset: 0;
  width: 42%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.28), transparent);
  animation: stageBeam 2.4s ease-out infinite;
}

.song-theme-vinyl {
  border: 1px solid rgba(250, 204, 21, 0.34);
  background:
    linear-gradient(135deg, rgba(28, 25, 23, 0.9), rgba(68, 64, 60, 0.72)),
    radial-gradient(circle at 10% 20%, rgba(250, 204, 21, 0.2), transparent 34%);
}

.song-theme-vinyl .song-disc {
  animation: recordSpin 8s linear infinite;
}

.song-queue li[data-new="1"] {
  animation: queueGlowIn 320ms ease both;
}

.song-queue li[data-tier="jump_queue"] em,
.song-queue li[data-tier="exclusive"] em,
.song-queue li[data-tier="playlist_takeover"] em {
  border-radius: 999px;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.16);
}

.song-takeover {
  grid-column: 1 / -1;
  border-radius: 999px;
  padding: 5px 12px;
  background: rgba(250, 204, 21, 0.18);
  color: #fef3c7;
  font-size: 12px;
  font-weight: 950;
  text-align: center;
}

.motion-off .song-theme-neon,
.motion-off .song-theme-idol-stage::after,
.motion-off .song-theme-vinyl .song-disc {
  animation: none !important;
}
```

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm run build --prefix src-tauri
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/overlay
git commit -m "feat: add music overlay themes"
```

---

## Task 6: Migrate Wish Goal, Recent Gifts, And Gift Rank

**Files:**

- Modify: `src-tauri/src/overlay/plugins/wish-goal/WishGoalOverlay.tsx`
- Modify: `src-tauri/src/overlay/plugins/recent-gifts/RecentGiftsOverlay.tsx`
- Modify: `src-tauri/src/overlay/plugins/gift-rank/GiftRankOverlay.tsx`
- Modify: `src-tauri/src/overlay/styles.css`

- [ ] **Step 1: Implement wish goal overlay**

Replace `src-tauri/src/overlay/plugins/wish-goal/WishGoalOverlay.tsx` with:

```tsx
import { EmptyState } from '../../components/EmptyState';
import { proxyImage } from '../../runtime/fetch';
import { PluginSettings } from '../../runtime/types';

export function WishGoalOverlay({ settings }: { settings: PluginSettings }) {
  const cfg = settings.WishGoal;
  const goals = cfg?.Goals || [];
  if (!goals.length) return <EmptyState title={cfg?.Title || '今日心愿目标'} subtitle="暂无心愿目标" />;

  return (
    <section className="wish-card">
      <div className="wish-title">{cfg?.Title || '今日心愿目标'}</div>
      <div className="wish-list">
        {goals.map(goal => {
          const target = Math.max(1, Number(goal.Target || 1));
          const current = Math.max(0, Number(goal.Current || 0));
          const pct = Math.min(100, (current / target) * 100);
          const icon = proxyImage(goal.Icon);
          return (
            <div className="wish-goal" key={goal.Id || goal.Name}>
              {cfg?.ShowIcons !== false && icon ? <img src={icon} alt="" /> : null}
              <div className="wish-main">
                <div className="wish-line">
                  <strong>{goal.Name || '心愿'}</strong>
                  <span>{current}/{target}</span>
                </div>
                <div className="wish-bar"><div style={{ width: `${pct}%` }} /></div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Implement recent gifts overlay**

Replace `src-tauri/src/overlay/plugins/recent-gifts/RecentGiftsOverlay.tsx` with:

```tsx
import { EmptyState } from '../../components/EmptyState';
import { MarqueeText } from '../../components/MarqueeText';
import { proxyImage } from '../../runtime/fetch';
import { PluginSettings } from '../../runtime/types';

export function RecentGiftsOverlay({ settings }: { settings: PluginSettings }) {
  const cfg = settings.RecentGifts;
  const items = (cfg?.Items || []).slice(0, Math.max(1, Number(cfg?.MaxItems || 3)));
  if (!items.length) return <EmptyState title={cfg?.Title || '最近礼物'} subtitle="等待礼物数据" />;

  return (
    <section className="recent-gifts">
      {items.map((item, index) => {
        const avatar = proxyImage(item.Avatar);
        return (
          <div className="recent-gift" key={`${item.User || 'user'}-${index}`}>
            <div className="recent-avatar">{avatar ? <img src={avatar} alt="" /> : (item.User || '观').slice(0, 1)}</div>
            <div className="recent-text">
              <MarqueeText className="recent-user">{item.User || '观众'}</MarqueeText>
              <MarqueeText className="recent-gift-name">赠送 {item.Gift || '礼物'} x{Number(item.Count || 1)}</MarqueeText>
            </div>
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 3: Implement gift rank overlay**

Replace `src-tauri/src/overlay/plugins/gift-rank/GiftRankOverlay.tsx` with:

```tsx
import { EmptyState } from '../../components/EmptyState';
import { MarqueeText } from '../../components/MarqueeText';
import { proxyImage } from '../../runtime/fetch';
import { PluginSettings } from '../../runtime/types';

function formatValue(value: unknown) {
  const num = Number(value || 0);
  if (num >= 10000) return `${(num / 10000).toFixed(num >= 100000 ? 0 : 1).replace(/\.0$/, '')}万`;
  return String(num);
}

export function GiftRankOverlay({ settings }: { settings: PluginSettings }) {
  const cfg = settings.GiftRank;
  const items = (cfg?.Items || []).slice(0, Math.max(1, Number(cfg?.MaxItems || 3)));
  if (!items.length) return <EmptyState title={cfg?.Title || '礼物排行'} subtitle="等待排行数据" />;

  return (
    <section className={`gift-rank rank-${cfg?.Skin || 'podium'}`}>
      {items.map((item, index) => {
        const avatar = proxyImage(item.Avatar);
        return (
          <div className="gift-rank-slot" key={`${item.User || 'user'}-${index}`}>
            <div className="gift-rank-avatar">{avatar ? <img src={avatar} alt="" /> : (item.User || '观').slice(0, 1)}</div>
            <MarqueeText className="gift-rank-name">{item.User || '观众'}</MarqueeText>
            <div className="gift-rank-value">{formatValue(item.Value)}</div>
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 4: Add CSS for the three overlays**

Append to `src-tauri/src/overlay/styles.css`:

```css
.wish-card,
.recent-gifts,
.gift-rank {
  min-width: 240px;
  padding: 10px;
}

.wish-card {
  border: 2px solid var(--overlay-primary);
  border-radius: 12px;
  background: rgba(30, 34, 40, 0.72);
  backdrop-filter: blur(8px);
}

.wish-title {
  margin-bottom: 8px;
  border-radius: 8px;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.5);
  color: #111827;
  font-weight: 950;
  text-align: center;
}

.wish-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wish-goal {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 9px;
  padding: 7px 8px;
  background: rgba(255, 255, 255, 0.48);
  color: #111827;
}

.wish-goal img {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  object-fit: contain;
}

.wish-main {
  min-width: 0;
  flex: 1;
}

.wish-line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  font-weight: 900;
}

.wish-bar {
  height: 8px;
  margin-top: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.52);
}

.wish-bar div {
  height: 100%;
  border-radius: inherit;
  background: var(--overlay-primary);
}

.recent-gifts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recent-gift {
  display: flex;
  min-height: 58px;
  align-items: center;
  gap: 9px;
  border-left: 4px solid #38bdf8;
  padding: 7px 12px;
  background: linear-gradient(90deg, rgba(0,0,0,.82), rgba(15,23,42,.58));
}

.recent-avatar,
.gift-rank-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 999px;
  background: linear-gradient(135deg, #f9a8d4, #fde68a);
  color: #fff;
  font-weight: 950;
}

.recent-avatar {
  width: 42px;
  height: 42px;
}

.recent-avatar img,
.gift-rank-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.recent-text {
  min-width: 0;
}

.recent-user {
  font-size: 15px;
  font-weight: 950;
}

.recent-gift-name {
  margin-top: 3px;
  color: rgba(255,255,255,.72);
  font-size: 13px;
  font-weight: 800;
}

.gift-rank {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 8px;
}

.gift-rank-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.gift-rank-avatar {
  width: 66px;
  height: 66px;
  border: 4px solid rgba(255,255,255,.8);
}

.gift-rank-name {
  max-width: 112px;
  border-radius: 999px;
  padding: 5px 12px;
  background: rgba(92,84,74,.82);
  font-size: 14px;
  font-weight: 950;
}

.gift-rank-value {
  color: #ffe58a;
  font-size: 12px;
  font-weight: 950;
}

.rank-list {
  flex-direction: column;
  align-items: stretch;
}
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run build --prefix src-tauri
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/overlay
git commit -m "feat: migrate gift and wish overlays to react"
```

---

## Task 7: Migrate Lottery, Gift Effect, And Danmaku Shell

**Files:**

- Modify: `src-tauri/src/overlay/plugins/lottery/LotteryOverlay.tsx`
- Modify: `src-tauri/src/overlay/plugins/gift-effect/GiftEffectOverlay.tsx`
- Modify: `src-tauri/src/overlay/plugins/danmaku/DanmakuOverlay.tsx`
- Modify: `src-tauri/src/overlay/OverlayRouter.tsx`
- Modify: `src-tauri/src/overlay/styles.css`

- [ ] **Step 1: Implement lottery overlay**

Replace `src-tauri/src/overlay/plugins/lottery/LotteryOverlay.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

export function LotteryOverlay({ settings }: { settings: PluginSettings }) {
  const cfg = settings.LotteryInteraction;
  const [visible, setVisible] = useState(false);
  const lastNonce = useRef(0);

  useEffect(() => {
    const nonce = Number(cfg?.DrawNonce || 0);
    if (!nonce || nonce === lastNonce.current) return;
    lastNonce.current = nonce;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), Math.max(1, Number(cfg?.StaySeconds || 8)) * 1000);
    return () => window.clearTimeout(timer);
  }, [cfg?.DrawNonce, cfg?.StaySeconds]);

  if (!cfg?.Enabled) return <EmptyState title={cfg?.Title || '幸运抽奖'} subtitle="抽奖未启用" />;

  return (
    <section className="lottery-card" data-visible={visible ? '1' : '0'}>
      <div className="lottery-title">{cfg.Title || '幸运抽奖'}</div>
      <div className="lottery-wheel"><div className="lottery-pointer" /></div>
      <div className="lottery-result">
        {visible && cfg.LastPrize ? (
          <>
            <div className="lottery-winner">恭喜 {cfg.LastWinner || '幸运观众'} 抽中</div>
            <div className="lottery-prize">{cfg.LastPrize}</div>
          </>
        ) : (
          <div className="lottery-empty">等待抽奖触发</div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Implement gift effect overlay**

Replace `src-tauri/src/overlay/plugins/gift-effect/GiftEffectOverlay.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

export function GiftEffectOverlay({ settings }: { settings: PluginSettings }) {
  const cfg = settings.GiftEffect;
  const [visible, setVisible] = useState(false);
  const lastNonce = useRef(0);

  useEffect(() => {
    const nonce = Number(cfg?.EffectNonce || 0);
    if (!nonce || nonce === lastNonce.current) return;
    lastNonce.current = nonce;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 4200);
    return () => window.clearTimeout(timer);
  }, [cfg?.EffectNonce]);

  if (!cfg?.Enabled) return <EmptyState title="礼物特效" subtitle="特效未启用" />;
  if (!visible) return <EmptyState title="礼物特效" subtitle="等待礼物触发" />;

  return (
    <section className="gift-effect-stage">
      <div className="gift-effect-cup" />
      <div className="gift-effect-bubbles">
        {Array.from({ length: Math.min(36, Math.max(10, Number(cfg.LastCount || 1) * 2)) }).map((_, index) => (
          <span key={index} style={{ left: `${12 + (index * 23) % 76}%`, animationDelay: `${(index % 8) * 60}ms` }}>
            {index % 3 === 0 ? '🎁' : index % 3 === 1 ? '💗' : '✨'}
          </span>
        ))}
      </div>
      <div className="gift-effect-caption">{cfg.LastUser || '观众'} 送出 {cfg.LastGift || '礼物'} x{cfg.LastCount || 1}</div>
    </section>
  );
}
```

- [ ] **Step 3: Implement danmaku shell**

Replace `src-tauri/src/overlay/plugins/danmaku/DanmakuOverlay.tsx` with:

```tsx
import { useEffect, useState } from 'react';

interface LiveEventPayload {
  event?: { kind?: string; user?: string; text?: string; gift?: string; count?: number };
}

export function DanmakuOverlay() {
  const [items, setItems] = useState<Array<{ id: number; text: string; kind: string }>>([]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data) as LiveEventPayload;
        const live = data.event || data;
        const user = live.user || '观众';
        const text = live.text || live.gift || live.kind || '';
        if (!text) return;
        setItems(prev => [...prev.slice(-80), { id: Date.now() + Math.random(), text: `${user}: ${text}`, kind: live.kind || 'event' }]);
      } catch {
        // Keep OBS quiet on malformed packets.
      }
    };
    return () => socket.close();
  }, []);

  return (
    <section className="danmaku-list">
      <div className="danmaku-spacer" />
      {items.map(item => (
        <div className="danmaku-item" data-kind={item.kind} key={item.id}>{item.text}</div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Add CSS for lottery, gift effect, danmaku**

Append to `src-tauri/src/overlay/styles.css`:

```css
.lottery-card {
  min-width: 360px;
  border: 2px solid rgba(216,180,254,.9);
  border-radius: 24px;
  padding: 18px;
  background: linear-gradient(180deg, rgba(82,42,166,.92), rgba(38,20,87,.92));
  box-shadow: 0 22px 60px rgba(40,20,80,.38);
  text-align: center;
}

.lottery-title {
  font-size: 24px;
  font-weight: 950;
}

.lottery-wheel {
  position: relative;
  width: 240px;
  height: 240px;
  margin: 16px auto 14px;
  border: 10px solid #7c3aed;
  border-radius: 999px;
  background: conic-gradient(#facc15 0 25%, #fb7185 0 50%, #60a5fa 0 75%, #a78bfa 0);
}

.lottery-wheel::after {
  content: "抽";
  position: absolute;
  inset: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #fff;
  color: #7c3aed;
  font-size: 42px;
  font-weight: 950;
}

.lottery-pointer {
  position: absolute;
  top: -2px;
  left: 50%;
  width: 0;
  height: 0;
  transform: translateX(-50%);
  border-right: 16px solid transparent;
  border-left: 16px solid transparent;
  border-top: 32px solid #fff;
}

.lottery-result {
  min-height: 58px;
  border-radius: 14px;
  padding: 10px 14px;
  background: rgba(20,12,42,.72);
  font-weight: 900;
}

.lottery-prize {
  margin-top: 4px;
  color: #fde68a;
  font-size: 24px;
}

.gift-effect-stage {
  position: relative;
  width: 360px;
  height: 360px;
}

.gift-effect-cup {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 220px;
  height: 190px;
  transform: translateX(-50%);
  border: 4px solid rgba(55,65,81,.75);
  border-radius: 18px 18px 38px 38px;
  background: linear-gradient(180deg, rgba(255,255,255,.68), rgba(219,234,254,.42));
}

.gift-effect-bubbles span {
  position: absolute;
  top: 20px;
  animation: giftBubble 1.15s ease-in forwards;
  font-size: 24px;
}

.gift-effect-caption {
  position: absolute;
  bottom: 10px;
  left: 50%;
  min-width: 280px;
  transform: translateX(-50%);
  border-radius: 999px;
  padding: 8px 14px;
  background: rgba(88,28,135,.88);
  color: #fef3c7;
  font-weight: 950;
  text-align: center;
}

@keyframes giftBubble {
  from { opacity: 0; transform: translateY(-140px) rotate(0); }
  to { opacity: 1; transform: translateY(72px) rotate(280deg); }
}

.danmaku-list {
  display: flex;
  height: 100%;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
  padding: 4px 6px 8px;
}

.danmaku-spacer {
  flex: 1 0 0;
}

.danmaku-item {
  flex-shrink: 0;
  border-radius: 6px;
  padding: 5px 8px;
  background: rgba(0,0,0,.72);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.5;
  word-break: break-all;
}
```

- [ ] **Step 5: Pass settings to the migrated gift effect overlay**

In `src-tauri/src/overlay/OverlayRouter.tsx`, change the `gift-effect` branch from:

```tsx
content = <GiftEffectOverlay />;
```

to:

```tsx
content = <GiftEffectOverlay settings={settings} />;
```

- [ ] **Step 6: Run build**

Run:

```bash
npm run build --prefix src-tauri
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/overlay
git commit -m "feat: migrate remaining obs overlays to react"
```

---

## Task 8: Compatibility Verification And Final Checks

**Files:**

- No intended code changes unless verification finds a defect.

- [ ] **Step 1: Build frontend and Rust**

Run:

```bash
npm run build --prefix src-tauri
cargo fmt --check
cargo check --workspace
cargo test --workspace --bins --tests
```

Expected:

- Frontend build passes. Existing Vite chunk-size warnings are acceptable.
- Rust format check passes.
- Rust workspace check passes.
- Rust unit/integration tests pass.

- [ ] **Step 2: Verify overlay asset output**

Run:

```bash
test -f src-tauri/dist/assets/overlay.js
test -f src-tauri/dist/assets/overlay.css
```

Expected: both commands exit 0.

- [ ] **Step 3: Smoke test overlay server manually**

Start the app normally so the overlay server runs. Use the configured overlay port from the app, then open these URLs in OBS Browser Source or a browser:

```text
http://127.0.0.1:<port>/
http://127.0.0.1:<port>/wish-goal?transparent=1&skin=compact
http://127.0.0.1:<port>/lottery?transparent=1
http://127.0.0.1:<port>/gift-effect?transparent=1
http://127.0.0.1:<port>/recent-gifts?transparent=1&skin=compact
http://127.0.0.1:<port>/gift-rank?transparent=1&skin=compact
http://127.0.0.1:<port>/song-request/playlist?skin=neon&transparent=1
http://127.0.0.1:<port>/song-request/playlist?skin=idol-stage&transparent=1
http://127.0.0.1:<port>/song-request/now-playing?skin=vinyl&transparent=1
http://127.0.0.1:<port>/song-request/rank?skin=neon&transparent=1
```

Expected:

- Every legacy URL returns the React overlay shell.
- No route shows a visible stack trace.
- Empty states are readable.
- Transparent background works.
- Music theme URLs render distinct visual treatments.
- `STREAMIX_LEGACY_OVERLAYS=1` restores the old static HTML pages for compatibility fallback.

- [ ] **Step 4: Run full workspace doctest and record known failure**

Run:

```bash
cargo test --workspace
```

Expected: unit and integration tests pass. If doctests fail in `streamix_voice` because `libsherpa-onnx-c-api.dylib` is missing or local TTS doc examples contain `<dir>/`, record this as the existing unrelated doctest issue in the final response.

- [ ] **Step 5: Commit verification fixes if needed**

If smoke testing finds a defect, fix only that defect and commit it:

```bash
git add <changed-files>
git commit -m "fix: stabilize react obs overlay migration"
```

If no fixes are needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Unified React runtime: Tasks 1-3.
- Existing URL preservation: Task 2 and Task 8.
- Runtime query options: Task 1.
- Music `neon`, `idol-stage`, and `vinyl` themes: Task 5.
- Music state-driven effects: Task 4 and Task 5.
- Other plugin migration: Task 6 and Task 7.
- Legacy fallback: Task 2 and Task 8.
- OBS-safe error/empty states: Tasks 3-7.
- Verification: Task 8.

Placeholder scan:

- No placeholder markers or deferred implementation notes are used as task instructions.

Type consistency:

- `OverlayRuntimeConfig`, `OverlayRoute`, `PluginSettings`, and music queue types are defined before use.
- Later tasks import the same names and paths introduced in earlier tasks.
- Music queue field names match Rust `QueueItem` camelCase JSON: `requestId`, `songName`, `artistNames`, `creditValue`, `priorityScore`, `requestedAt`.
