import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useTheme, hexToRgb, hexToHsl, hslToHex } from '../context/ThemeContext';
import { useConfig } from '../context/ConfigContext';
import { BackgroundBlobs } from './BackgroundBlobs';

// Helper for percentage
const pct = (v: number, max: number) => `${(v / max * 100).toFixed(1)}%`;

/** 共享的鼠标响应背景层 */
const MouseFollowerBackground = ({ children }: { children?: React.ReactNode }) => {
  const { theme, primaryColor } = useTheme();
  const mousePos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [smoothMouse, setSmoothMouse] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const smoothRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const isDark = theme === 'dark';

  useEffect(() => {
    const onMove = (e: MouseEvent) => { mousePos.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      smoothRef.current = {
        x: smoothRef.current.x + (mousePos.current.x - smoothRef.current.x) * 0.05,
        y: smoothRef.current.y + (mousePos.current.y - smoothRef.current.y) * 0.05,
      };
      setSmoothMouse({ ...smoothRef.current });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const rgb = useMemo(() => hexToRgb(primaryColor) || { r: 75, g: 142, b: 255 }, [primaryColor]);
  const { h, s, l } = useMemo(() => hexToHsl(primaryColor), [primaryColor]);
  
  // 辅助色偏移
  const mx = smoothMouse.x / window.innerWidth;
  const shiftedColor = useMemo(() => {
    const hueShift = (mx - 0.5) * 60;
    return hexToRgb(hslToHex(((h + hueShift) % 360 + 360) % 360, Math.max(35, s), Math.min(72, l + 5))) || rgb;
  }, [h, s, l, mx, rgb]);

  const ambientBg = isDark
    ? `linear-gradient(135deg, rgba(${rgb.r},${rgb.g},${rgb.b},0.12) 0%, rgba(${shiftedColor.r},${shiftedColor.g},${shiftedColor.b},0.06) 50%, transparent 100%)`
    : `linear-gradient(135deg, rgba(${rgb.r},${rgb.g},${rgb.b},0.10) 0%, rgba(${shiftedColor.r},${shiftedColor.g},${shiftedColor.b},0.05) 55%, rgba(${rgb.r},${rgb.g},${rgb.b},0.03) 100%)`;

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none transition-colors duration-1000" style={{ background: isDark ? '#070710' : '#ecf0fc' }}>
      {/* 基础氛围渐变 */}
      <div className="absolute inset-0" style={{ background: ambientBg }} />
      
      {/* 鼠标跟随聚光灯 */}
      <div
        className="absolute inset-0 transition-opacity duration-1000"
        style={{
          background: `
            radial-gradient(ellipse 60% 50% at ${pct(smoothMouse.x, window.innerWidth)} ${pct(smoothMouse.y, window.innerHeight)},
              rgba(${rgb.r},${rgb.g},${rgb.b},${isDark ? 0.25 : 0.15}) 0%,
              transparent 65%),
            radial-gradient(ellipse 50% 45% at ${pct(window.innerWidth - smoothMouse.x, window.innerWidth)} ${pct(window.innerHeight - smoothMouse.y, window.innerHeight)},
              rgba(${shiftedColor.r},${shiftedColor.g},${shiftedColor.b},${isDark ? 0.15 : 0.10}) 0%,
              transparent 60%)
          `,
        }}
      />
      {children}
    </div>
  );
};

// 1. 动态气泡 (Blobs - 本身自带背景逻辑，这里只取其 Canvas 层)
const BlobsEffect = () => <BackgroundBlobs />;

// 2. 动态流体色彩 (Mesh Gradient Flow)
const MeshGradientEffect = () => {
  const { primaryColor, theme } = useTheme();
  const rgb = hexToRgb(primaryColor) || { r: 75, g: 142, b: 255 };
  const isDark = theme === 'dark';

  return (
    <div className="absolute inset-0">
      <div 
        className="absolute w-[800px] h-[800px] rounded-full blur-[120px] animate-pulse transition-all duration-1000"
        style={{ 
          background: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.20 : 0.12})`,
          top: '-10%', left: '-10%',
          animationDuration: '8s'
        }}
      />
      <div 
        className="absolute w-[600px] h-[600px] rounded-full blur-[100px] animate-pulse transition-all duration-1000"
        style={{ 
          background: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.15 : 0.08})`,
          bottom: '10%', right: '10%',
          animationDuration: '12s',
          animationDelay: '2s'
        }}
      />
    </div>
  );
};

// 3. 极光幻影 (Aurora Borealis)
const AuroraEffect = () => {
  const { primaryColor } = useTheme();
  return (
    <div className="absolute inset-0">
      <div className="absolute -inset-[10px] opacity-40">
        <div className="absolute top-0 left-1/4 w-[120%] h-[50%] blur-[100px] animate-aurora" style={{ background: `linear-gradient(to right, transparent, ${primaryColor}, transparent)`, transform: 'rotate(-10deg)' }} />
        <div className="absolute top-0 right-1/4 w-[100%] h-[40%] blur-[80px] animate-aurora" style={{ background: `linear-gradient(to right, transparent, ${primaryColor}88, transparent)`, transform: 'rotate(5deg)', animationDelay: '2s' }} />
      </div>
      <style>{`
        @keyframes aurora {
          0%, 100% { transform: translateY(0) scale(1) rotate(-10deg); opacity: 0.3; }
          50% { transform: translateY(20px) scale(1.1) rotate(-8deg); opacity: 0.6; }
        }
        .animate-aurora { animation: aurora 15s infinite ease-in-out; }
      `}</style>
    </div>
  );
};

// 4. 极简工业网格 (Modern Technical Grid)
const GridEffect = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <div className="absolute inset-0 opacity-50" style={{ 
      backgroundImage: `linear-gradient(${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'} 1px, transparent 1px), linear-gradient(90deg, ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'} 1px, transparent 1px)`,
      backgroundSize: '40px 40px'
    }}>
      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at center, transparent 0%, ${isDark ? 'rgba(7,7,16,0.3)' : 'rgba(236,240,252,0.3)'} 90%)` }} />
    </div>
  );
};

// 5. 颗粒质感噪点 (Film Grain & Noise)
const NoiseEffect = () => {
  return (
    <div className="absolute inset-0 opacity-[0.04] mix-blend-overlay">
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <filter id="noiseFilter">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noiseFilter)" />
      </svg>
    </div>
  );
};

// 6. 交互式悬浮粒子 (Interactive Particle Field)
const ParticlesEffect = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    const particles: any[] = [];
    const count = 120;

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 1.5 + 0.5
      });
    }

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)';
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    const onResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [isDark]);

  return <canvas ref={canvasRef} className="absolute inset-0" />;
};

// 7. 3D 浮动几何体 (Parallax Floating Shapes)
const ParallaxEffect = () => {
  const { primaryColor } = useTheme();
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="absolute w-64 h-64 border-2 rounded-full animate-float opacity-20" style={{ borderColor: primaryColor, top: '20%', left: '20%' }} />
      <div className="absolute w-32 h-32 border-2 rotate-45 animate-float-slow opacity-20" style={{ borderColor: primaryColor, bottom: '20%', right: '20%' }} />
      <style>{`
        @keyframes float {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          50% { transform: translate(30px, -30px) rotate(15deg); }
        }
        @keyframes float-slow {
          0%, 100% { transform: translate(0, 0) rotate(45deg); }
          50% { transform: translate(-40px, 40px) rotate(60deg); }
        }
        .animate-float { animation: float 12s infinite ease-in-out; }
        .animate-float-slow { animation: float-slow 18s infinite ease-in-out; }
      `}</style>
    </div>
  );
};

// 8. 动态水波纹 (SVG Turbulence Ripples)
const RipplesEffect = () => {
  const { primaryColor } = useTheme();
  return (
    <div className="absolute inset-0">
      <svg className="absolute inset-0 w-full h-full opacity-20" style={{ color: primaryColor }}>
        <filter id="ripple">
          <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="1" seed="2">
            <animate attributeName="baseFrequency" dur="12s" values="0.01;0.025;0.01" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="30" />
        </filter>
        <rect width="100%" height="100%" fill="currentColor" filter="url(#ripple)" />
      </svg>
    </div>
  );
};

// 9. 摩斯电码/数据流 (Data Stream Bits)
const DataStreamEffect = () => {
  const { primaryColor } = useTheme();
  return (
    <div className="absolute inset-0 font-mono text-[10px] opacity-[0.06]" style={{ color: primaryColor }}>
      {Array.from({ length: 24 }).map((_, i) => (
        <div key={i} className="absolute whitespace-nowrap animate-slide-right" style={{ top: `${i * 4.2}%`, animationDuration: `${12 + i % 15}s`, animationDelay: `${-i * 0.5}s` }}>
          {Array.from({ length: 60 }).map(() => (Math.random() > 0.5 ? '0' : '1')).join(' ')}
        </div>
      ))}
      <style>{`
        @keyframes slide-right {
          from { transform: translateX(-80%); }
          to { transform: translateX(100%); }
        }
        .animate-slide-right { animation: slide-right linear infinite; }
      `}</style>
    </div>
  );
};

// 10. 全景星空背景 (Minimalist Starfield)
const StarfieldEffect = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const stars = useMemo(() => Array.from({ length: 70 }).map((_, i) => ({
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    size: Math.random() * 2 + 0.5,
    delay: Math.random() * 5,
    dur: 3 + Math.random() * 4
  })), []);

  return (
    <div className="absolute inset-0">
      {stars.map((s, i) => (
        <div 
          key={i} 
          className="absolute rounded-full animate-twinkle" 
          style={{ 
            top: s.top, left: s.left,
            width: `${s.size}px`, height: `${s.size}px`, 
            background: isDark ? 'white' : '#475569',
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.dur}s`
          }} 
        />
      ))}
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.3); }
        }
        .animate-twinkle { animation: twinkle infinite ease-in-out; }
      `}</style>
    </div>
  );
};

export function BackgroundManager() {
  const { backgroundEffect, theme } = useTheme();
  const { config } = useConfig();
  const isDark = theme === 'dark';

  if (config?.DisableBackgroundEffects) {
    return (
      <div 
        className="fixed inset-0 z-0 transition-colors duration-1000" 
        style={{ background: isDark ? '#070710' : '#ecf0fc' }} 
      />
    );
  }

  const renderEffect = () => {
    switch (backgroundEffect) {
      case 'blobs': return <BlobsEffect />;
      case 'mesh': return <MeshGradientEffect />;
      case 'aurora': return <AuroraEffect />;
      case 'grid': return <GridEffect />;
      case 'noise': return <NoiseEffect />;
      case 'particles': return <ParticlesEffect />;
      case 'parallax': return <ParallaxEffect />;
      case 'ripples': return <RipplesEffect />;
      case 'data-stream': return <DataStreamEffect />;
      case 'starfield': return <StarfieldEffect />;
      default: return <BlobsEffect />;
    }
  };

  return (
    <MouseFollowerBackground>
      {renderEffect()}
    </MouseFollowerBackground>
  );
}
