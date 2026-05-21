import React, { useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from '../../assets/logo.svg?url';

export type SplashMode = 'boot' | 'replay';
export const SPLASH_REPLAY_EVENT = 'streamix:replay-splash';

interface SplashProps {
  mode?: SplashMode;
  onDismiss: () => void;
  /** boot 模式下要等待的最小展示时长 (ms) */
  minDurationMs?: number;
  /** replay 模式下的固定展示时长 (ms) */
  replayDurationMs?: number;
  /** boot 模式下，外部判定可以收起 splash 的信号 */
  ready?: boolean;
}

const LOAD_STAGES = [
  { to: 14,  zh: '初始化运行时',     en: 'Booting runtime',       sub: 'streamix · core' },
  { to: 30,  zh: '加载本地配置',     en: 'Loading local config',  sub: '账号 · 房间 · 偏好项' },
  { to: 50,  zh: '检查可选组件',     en: 'Checking optional parts',  sub: '模型 · 插件 · 缓存' },
  { to: 68,  zh: '同步互动规则',     en: 'Syncing rules',         sub: '欢迎 · 感谢 · 关键词' },
  { to: 86,  zh: '准备工作台',       en: 'Preparing workspace',   sub: '面板 · 数据 · 快捷操作' },
  { to: 100, zh: '准备就绪',         en: 'Ready',                 sub: '可以开始配置和连接' },
] as const;

const FOUNTAIN_CHIPS: Array<[string, string]> = [
  ['😍', '主播好可爱'], ['🌹', '送朵小红花'], ['✨', '首播打卡'], ['💖', '关注啦'],
  ['🔥', '气氛拉满'],   ['🥰', '声音温柔'],   ['🎤', '能点歌吗'], ['🌟', '又来啦'],
  ['🍑', '抱抱主播'],   ['💎', '冲榜一'],     ['🌈', '彩虹屁'],   ['🎉', '新人首关'],
];

const STYLE_ID = 'streamix-splash-styles';
const SPLASH_CSS = `
@keyframes sx-sp-x { from { transform: translateX(-50%); } to { transform: translateX(calc(-50% + var(--dx, 0px))); } }
@keyframes sx-sp-y {
  0%   { transform: translateY(0); opacity: 0; }
  8%   { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translateY(var(--dy, 0)); opacity: 0; }
}
@keyframes sx-sp-jet {
  0%, 100% { opacity: .55; transform: translateX(-50%) scaleY(1); }
  50%      { opacity: .95; transform: translateX(-50%) scaleY(1.18); }
}
@keyframes sx-sp-spin { to { transform: rotate(360deg); } }
@keyframes sx-sp-mark {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.03); }
}
@keyframes sx-sp-fade-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes sx-sp-fade-out { from { opacity: 1; } to { opacity: 0; } }

.sx-sp-root {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  background: var(--background, #f0f4ff);
  color: var(--foreground, #1a1a1a);
  overflow: hidden;
  animation: sx-sp-fade-in .22s ease both;
  user-select: none; cursor: pointer;
}
.sx-sp-root.is-leaving { animation: sx-sp-fade-out .28s ease both; }

.sx-sp-stage {
  position: relative; width: min(100vw, 1280px); height: 100vh;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}

.sx-sp-glow {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse 70% 50% at 50% 100%,
    color-mix(in srgb, var(--primary-color, #4b8eff) 16%, transparent) 0%,
    transparent 70%);
}

.sx-sp-jet {
  position: absolute; left: 50%; bottom: 18%;
  width: 44px; height: 110px;
  background: radial-gradient(ellipse at 50% 100%, var(--primary-color, #4b8eff) 0%, transparent 65%);
  filter: blur(10px); transform-origin: 50% 100%;
  animation: sx-sp-jet 1.4s ease-in-out infinite;
  pointer-events: none;
}

.sx-sp-shell {
  position: absolute; left: 50%; bottom: 18%;
  animation: sx-sp-x var(--d, 4.5s) cubic-bezier(.45,0,.55,1) infinite;
  will-change: transform;
}
.sx-sp-inner {
  animation: sx-sp-y var(--d, 4.5s) cubic-bezier(.18,.95,.7,1) infinite;
  will-change: transform, opacity;
}

.sx-sp-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 500; white-space: nowrap;
  background: var(--surface-bg, rgba(255,255,255,.82));
  color: var(--foreground, #1a1a1a);
  border: 1px solid var(--surface-border, rgba(0,0,0,.06));
  box-shadow: 0 4px 14px color-mix(in srgb, var(--primary-color, #4b8eff) 28%, transparent);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}

.sx-sp-mark-wrap {
  position: relative; z-index: 4;
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  animation: sx-sp-mark 3.2s ease-in-out infinite;
  margin-top: -6%;
}
.sx-sp-logo {
  width: 64px; height: 64px; border-radius: 18px;
  box-shadow: 0 12px 32px color-mix(in srgb, var(--primary-color, #4b8eff) 30%, transparent);
}
.sx-sp-title {
  font-weight: 800; letter-spacing: -.02em; line-height: 1;
  font-size: 34px;
  display: flex; align-items: baseline; gap: 10px;
}
.sx-sp-title small {
  font-size: 14px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase;
  opacity: .55;
}
.sx-sp-tagline {
  font-size: 11px; letter-spacing: .22em; text-transform: uppercase;
  color: var(--muted-text, rgba(0,0,0,.55));
}

.sx-sp-foot {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 0 40px 28px;
  display: flex; flex-direction: column; gap: 8px;
  font-family: inherit;
}
.sx-sp-foot-line {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 11px; color: var(--muted-text, rgba(0,0,0,.55));
}
.sx-sp-foot-stage {
  display: flex; align-items: center; gap: 8px;
}
.sx-sp-spin {
  display: inline-block; width: 10px; height: 10px; border-radius: 50%;
  border: 1.5px solid var(--primary-color, #4b8eff);
  border-right-color: transparent;
  animation: sx-sp-spin 1s linear infinite;
}
.sx-sp-stage-zh { color: var(--foreground); font-weight: 600; }
.sx-sp-stage-en {
  opacity: .55; letter-spacing: .04em;
  font-family: ui-monospace, "JetBrains Mono", "Sarasa Mono SC", monospace;
}
.sx-sp-pct {
  font-family: ui-monospace, "JetBrains Mono", "Sarasa Mono SC", monospace;
  font-variant-numeric: tabular-nums;
  color: var(--foreground); font-weight: 600;
}
.sx-sp-bar {
  position: relative; height: 2px; border-radius: 2px; overflow: hidden;
  background: color-mix(in srgb, var(--foreground, #000) 10%, transparent);
}
.sx-sp-bar-fill {
  position: absolute; inset: 0;
  background: var(--primary-color, #4b8eff);
  box-shadow: 0 0 12px color-mix(in srgb, var(--primary-color, #4b8eff) 50%, transparent);
  transition: width .2s linear;
}

.sx-sp-skip {
  position: absolute; top: 16px; right: 20px;
  font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--muted-text, rgba(0,0,0,.55));
  opacity: .8;
}
.sx-sp-skip kbd {
  display: inline-block; padding: 1px 6px; margin-left: 4px;
  border-radius: 4px;
  border: 1px solid var(--surface-border, rgba(0,0,0,.1));
  background: var(--surface-bg, rgba(255,255,255,.5));
  font-family: ui-monospace, monospace; font-size: 10px;
}
`;

function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SPLASH_CSS;
  document.head.appendChild(el);
}

export function Splash({
  mode = 'boot',
  onDismiss,
  minDurationMs = 2500,
  replayDurationMs = 6000,
  ready = true,
}: SplashProps) {
  ensureStyles();

  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const startedAt = useRef(performance.now());

  // 12 个抛物粒子：随机方向 / 高度 / 时长 / 延迟（mount 时一次性计算）
  const particles = useMemo(() => FOUNTAIN_CHIPS.map((c, i) => {
    const d = 3.6 + Math.random() * 2.4;
    return {
      content: c,
      d,
      delay: -(i / FOUNTAIN_CHIPS.length) * d - Math.random() * 0.4,
      dx: (Math.random() - 0.5) * 480,
      dy: -(220 + Math.random() * 140),
      rot: (Math.random() - 0.5) * 24,
    };
  }), []);

  // 进度动画 — 6 阶段 × 11s 循环
  useEffect(() => {
    let raf = 0;
    const loopMs = 11000;
    const holdMs = 1300;
    const tick = (now: number) => {
      const elapsed = (now - startedAt.current) % (loopMs + holdMs);
      setPct(elapsed >= loopMs ? 100 : (elapsed / loopMs) * 100);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 阶段索引
  let stageIdx = LOAD_STAGES.findIndex((s) => pct < s.to);
  if (stageIdx === -1) stageIdx = LOAD_STAGES.length - 1;
  const stage = LOAD_STAGES[stageIdx];

  // 收起逻辑
  const dismiss = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onDismiss, 280);
  };

  useEffect(() => {
    if (mode === 'replay') {
      const t = window.setTimeout(dismiss, replayDurationMs);
      return () => window.clearTimeout(t);
    }
    // boot: 等 ready=true 且达到最小展示时长
    if (!ready) return;
    const elapsed = performance.now() - startedAt.current;
    const remain = Math.max(0, minDurationMs - elapsed);
    const t = window.setTimeout(dismiss, remain);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ready, minDurationMs, replayDurationMs]);

  // Esc / Enter / Space 跳过
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  return (
    <div
      className={`sx-sp-root${leaving ? ' is-leaving' : ''}`}
      onClick={dismiss}
      role="presentation"
      aria-label="启动加载"
    >
      <div className="sx-sp-glow" />

      <div className="sx-sp-stage">
        <div className="sx-sp-jet" />

        {particles.map((p, i) => (
          <div
            key={i}
            className="sx-sp-shell"
            style={{ ['--d' as any]: `${p.d}s`, ['--dx' as any]: `${p.dx}px`, animationDelay: `${p.delay}s` }}
          >
            <div
              className="sx-sp-inner"
              style={{ ['--d' as any]: `${p.d}s`, ['--dy' as any]: `${p.dy}px`, animationDelay: `${p.delay}s` }}
            >
              <span className="sx-sp-chip" style={{ transform: `rotate(${p.rot}deg)` }}>
                <span>{p.content[0]}</span>
                <span>{p.content[1]}</span>
              </span>
            </div>
          </div>
        ))}

        <div className="sx-sp-mark-wrap">
          <img src={logoUrl} alt="流光" className="sx-sp-logo" />
          <div className="sx-sp-title">
            <span>流光</span>
            <small>Streamix</small>
          </div>
          <div className="sx-sp-tagline">YOUR LIVE STREAM COPILOT</div>
        </div>
      </div>

      <div className="sx-sp-skip">点击任意位置跳过 <kbd>Esc</kbd></div>

      <div className="sx-sp-foot">
        <div className="sx-sp-foot-line">
          <span className="sx-sp-foot-stage">
            <span className="sx-sp-spin" />
            <span className="sx-sp-stage-zh">{stage.zh}</span>
            <span className="sx-sp-stage-en">{stage.en}</span>
          </span>
          <span className="sx-sp-pct">{String(Math.floor(pct)).padStart(2, '0')}%</span>
        </div>
        <div className="sx-sp-bar">
          <div className="sx-sp-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
