import { useEffect, useMemo, useState } from 'react';
import { useTheme, type ThemeFamily } from '../context/ThemeContext';

type GreetingMap = { hourFrom: number; hourTo: number; default: string; ink: string };

// 时段问候 (短：2-4 字)。ink 主题用古风变体
const GREETINGS: GreetingMap[] = [
  { hourFrom:  0, hourTo:  5, default: '夜深了',   ink: '夜阑人静' },
  { hourFrom:  5, hourTo:  8, default: '早安',     ink: '晨光熹微' },
  { hourFrom:  8, hourTo: 12, default: '上午好',   ink: '朝霞满天' },
  { hourFrom: 12, hourTo: 14, default: '午安',     ink: '日上三竿' },
  { hourFrom: 14, hourTo: 18, default: '下午好',   ink: '偷得浮闲' },
  { hourFrom: 18, hourTo: 22, default: '晚上好',   ink: '暮色四合' },
  { hourFrom: 22, hourTo: 24, default: '夜深了',   ink: '月明星稀' },
];

function pickGreeting(family: ThemeFamily): string {
  const h = new Date().getHours();
  const g = GREETINGS.find(g => h >= g.hourFrom && h < g.hourTo) ?? GREETINGS[0];
  return family === 'ink' ? g.ink : g.default;
}

interface SplashScreenProps {
  isReady: boolean;
  onDismiss: () => void;
}

type Phase = 'in' | 'showing' | 'fadeout' | 'done';

// 最少显示时间 (ms)：保证 Ken Burns 推镜头能跑出感觉
const MIN_DISPLAY_MS = 2200;
// 淡出时长
const FADEOUT_MS = 520;

export function SplashScreen({ isReady, onDismiss }: SplashScreenProps) {
  const { themeFamily, theme } = useTheme();
  const [phase, setPhase] = useState<Phase>('in');
  const [minElapsed, setMinElapsed] = useState(false);
  const greeting = useMemo(() => pickGreeting(themeFamily), [themeFamily]);

  // 入场后立刻进 showing 阶段
  useEffect(() => {
    const t = window.setTimeout(() => setPhase('showing'), 50);
    return () => window.clearTimeout(t);
  }, []);

  // 最少显示计时
  useEffect(() => {
    const t = window.setTimeout(() => setMinElapsed(true), MIN_DISPLAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  // ready & 最少时间到 → 淡出
  useEffect(() => {
    if (phase === 'showing' && isReady && minElapsed) {
      setPhase('fadeout');
    }
  }, [phase, isReady, minElapsed]);

  useEffect(() => {
    if (phase === 'fadeout') {
      const t = window.setTimeout(() => {
        setPhase('done');
        onDismiss();
      }, FADEOUT_MS);
      return () => window.clearTimeout(t);
    }
  }, [phase, onDismiss]);

  if (phase === 'done') return null;

  return (
    <div
      className={`splash-screen ${phase === 'fadeout' ? 'splash-out' : 'splash-in'}`}
      data-family={themeFamily}
      data-theme={theme}
    >
      <div className="splash-art-frame">
        <Illustration family={themeFamily} />
      </div>
      <div className="splash-vignette" />

      <div className="splash-overlay">
        <div className="splash-greeting">{greeting}</div>
      </div>
    </div>
  );
}

// ─── 主题插画 (inline SVG, 矢量无版权) ────────────────────────────

function Illustration({ family }: { family: ThemeFamily }) {
  switch (family) {
    case 'ink': return <InkIllustration />;
    case 'tech': return <TechIllustration />;
    case 'ocean': return <OceanIllustration />;
    default: return <DefaultIllustration />;
  }
}

function InkIllustration() {
  return (
    <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" className="splash-art">
      <defs>
        <linearGradient id="ink-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#f0e8d4" />
          <stop offset="55%" stopColor="#d8cdac" />
          <stop offset="100%" stopColor="#a3b69a" />
        </linearGradient>
        <linearGradient id="ink-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#9eb1a6" />
          <stop offset="100%" stopColor="#6a8278" />
        </linearGradient>
        <linearGradient id="ink-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#52806b" />
          <stop offset="100%" stopColor="#2b5345" />
        </linearGradient>
        <linearGradient id="ink-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#1f4a3c" />
          <stop offset="100%" stopColor="#0d2d24" />
        </linearGradient>
        <radialGradient id="ink-moon" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%"   stopColor="#fff4dc" stopOpacity="0.95" />
          <stop offset="55%"  stopColor="#ffe7b8" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#ffe7b8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1600" height="1000" fill="url(#ink-sky)" />
      {/* 日/月轮 */}
      <circle cx="1240" cy="220" r="140" fill="url(#ink-moon)" />
      {/* 远山 */}
      <path
        d="M 0 620 L 180 480 L 350 540 L 540 470 L 760 510 L 980 460 L 1240 500 L 1450 470 L 1600 530 L 1600 1000 L 0 1000 Z"
        fill="url(#ink-far)" opacity="0.78"
      />
      {/* 中山 */}
      <path
        d="M 0 720 L 220 600 L 460 660 L 720 580 L 980 640 L 1280 580 L 1600 650 L 1600 1000 L 0 1000 Z"
        fill="url(#ink-mid)" opacity="0.92"
      />
      {/* 近山 */}
      <path
        d="M 0 860 L 180 770 L 460 810 L 760 730 L 1080 790 L 1380 750 L 1600 800 L 1600 1000 L 0 1000 Z"
        fill="url(#ink-near)"
      />
      {/* 山脊金线 */}
      <path
        d="M 0 860 L 180 770 L 460 810 L 760 730 L 1080 790 L 1380 750 L 1600 800"
        fill="none" stroke="#d6a755" strokeWidth="1.5" opacity="0.5"
      />
      {/* 飘散落英 (CSS animate via .ink-petal) */}
      <g className="ink-petals">
        {Array.from({ length: 14 }).map((_, i) => {
          const cx = (i * 137) % 1600 + 60;
          const cy = (i * 211) % 420 + 60;
          const r  = 3 + (i % 3);
          return (
            <circle
              key={i} cx={cx} cy={cy} r={r}
              fill="#f5b6c2" opacity={0.55 + (i % 3) * 0.12}
              style={{ animationDelay: `${(i * 0.5) % 4}s` }}
            />
          );
        })}
      </g>
      {/* 远空一行飞雁 */}
      <g stroke="rgba(40,40,60,0.45)" strokeWidth="1.6" fill="none" strokeLinecap="round">
        <path d="M 800 200 l 12 8 l 12 -8" />
        <path d="M 770 215 l 12 8 l 12 -8" />
        <path d="M 740 230 l 12 8 l 12 -8" />
        <path d="M 710 240 l 12 8 l 12 -8" />
      </g>
    </svg>
  );
}

function TechIllustration() {
  return (
    <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" className="splash-art">
      <defs>
        <radialGradient id="tech-bg" cx="0.5" cy="0.5" r="0.85">
          <stop offset="0%"   stopColor="#101430" />
          <stop offset="60%"  stopColor="#070818" />
          <stop offset="100%" stopColor="#020310" />
        </radialGradient>
        <radialGradient id="tech-cloud-a" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%"   stopColor="hsl(265, 90%, 60%)" stopOpacity="0.55" />
          <stop offset="60%"  stopColor="hsl(265, 80%, 50%)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="hsl(265, 80%, 50%)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="tech-cloud-b" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%"   stopColor="hsl(195, 95%, 60%)" stopOpacity="0.55" />
          <stop offset="60%"  stopColor="hsl(195, 85%, 50%)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="hsl(195, 85%, 50%)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="tech-cloud-c" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%"   stopColor="hsl(320, 85%, 65%)" stopOpacity="0.40" />
          <stop offset="100%" stopColor="hsl(320, 85%, 50%)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1600" height="1000" fill="url(#tech-bg)" />
      {/* 量子云团 */}
      <ellipse cx="380"  cy="280" rx="320" ry="220" fill="url(#tech-cloud-a)" />
      <ellipse cx="1200" cy="380" rx="380" ry="240" fill="url(#tech-cloud-b)" />
      <ellipse cx="700"  cy="780" rx="420" ry="260" fill="url(#tech-cloud-c)" />
      {/* 网格 */}
      <g stroke="rgba(140,180,255,0.06)" strokeWidth="1" fill="none">
        {Array.from({ length: 16 }).map((_, i) => (
          <line key={`v${i}`} x1={i * 100} y1="0" x2={i * 100} y2="1000" />
        ))}
        {Array.from({ length: 10 }).map((_, i) => (
          <line key={`h${i}`} x1="0" y1={i * 100} x2="1600" y2={i * 100} />
        ))}
      </g>
      {/* 粒子 */}
      <g className="tech-particles">
        {Array.from({ length: 60 }).map((_, i) => {
          const cx = (i * 173) % 1600;
          const cy = (i * 257) % 1000;
          const r  = 1 + (i % 4) * 0.5;
          const hue = [195, 265, 320, 165][i % 4];
          return (
            <circle
              key={i} cx={cx} cy={cy} r={r}
              fill={`hsl(${hue}, 95%, 75%)`} opacity={0.55 + (i % 3) * 0.15}
              style={{ animationDelay: `${(i * 0.13) % 3}s` }}
            />
          );
        })}
      </g>
      {/* 粒子连线 (装饰) */}
      <g stroke="rgba(160,200,255,0.20)" strokeWidth="0.8" fill="none">
        <line x1="320"  y1="400" x2="540"  y2="320" />
        <line x1="540"  y1="320" x2="720"  y2="480" />
        <line x1="720"  y1="480" x2="900"  y2="380" />
        <line x1="900"  y1="380" x2="1080" y2="540" />
        <line x1="1080" y1="540" x2="1260" y2="460" />
      </g>
    </svg>
  );
}

function OceanIllustration() {
  return (
    <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" className="splash-art">
      <defs>
        <linearGradient id="ocean-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#0d3854" />
          <stop offset="50%" stopColor="#062338" />
          <stop offset="100%" stopColor="#020e1c" />
        </linearGradient>
        <linearGradient id="ocean-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(180, 230, 255, 0.45)" />
          <stop offset="100%" stopColor="rgba(180, 230, 255, 0)" />
        </linearGradient>
      </defs>
      <rect width="1600" height="1000" fill="url(#ocean-bg)" />
      {/* 上方光柱 */}
      <polygon points="400,0 700,0 900,1000 500,1000" fill="url(#ocean-beam)" opacity="0.55" />
      <polygon points="1100,0 1300,0 1400,1000 1000,1000" fill="url(#ocean-beam)" opacity="0.35" />
      {/* 底部海床起伏 */}
      <path
        d="M 0 880 Q 200 820 400 880 T 800 880 T 1200 880 T 1600 880 L 1600 1000 L 0 1000 Z"
        fill="#01101e"
      />
      {/* 珊瑚剪影 */}
      <g fill="rgba(20, 50, 80, 0.7)">
        <path d="M 200 880 Q 220 800 200 740 Q 180 800 200 880 Z" />
        <path d="M 230 880 Q 250 820 240 760 Q 220 820 230 880 Z" />
        <path d="M 1100 880 Q 1120 800 1100 740 Q 1080 810 1100 880 Z" />
        <path d="M 1130 880 Q 1150 820 1140 770 Q 1120 820 1130 880 Z" />
      </g>
      {/* 漂浮气泡 */}
      <g className="ocean-bubbles">
        {Array.from({ length: 24 }).map((_, i) => {
          const cx = (i * 211) % 1600;
          const cy = 200 + (i * 37) % 700;
          const r  = 2 + (i % 5);
          return (
            <circle
              key={i} cx={cx} cy={cy} r={r}
              fill="rgba(180, 230, 255, 0.45)"
              style={{ animationDelay: `${(i * 0.25) % 4}s` }}
            />
          );
        })}
      </g>
      {/* 漂浮鱼影 (剪影) */}
      <g fill="rgba(80, 130, 170, 0.45)">
        <path d="M 600 480 q 30 -20 60 0 q -20 8 -60 0 z" />
        <path d="M 1180 360 q 30 -20 60 0 q -20 8 -60 0 z" />
      </g>
    </svg>
  );
}

function DefaultIllustration() {
  return (
    <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" className="splash-art">
      <defs>
        <radialGradient id="def-bg" cx="0.5" cy="0.5" r="0.85">
          <stop offset="0%"   stopColor="color-mix(in srgb, var(--primary-color) 18%, transparent)" />
          <stop offset="60%"  stopColor="color-mix(in srgb, var(--primary-color) 6%, transparent)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect width="1600" height="1000" fill="var(--background)" />
      <rect width="1600" height="1000" fill="url(#def-bg)" />
      <g opacity="0.18">
        <circle cx="400"  cy="300" r="260" fill="var(--primary-color)" />
        <circle cx="1200" cy="700" r="320" fill="var(--accent-color)" />
      </g>
    </svg>
  );
}
