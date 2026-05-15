import { useEffect, useState, useRef } from 'react';
import { useTheme, hexToRgb, hexToHsl, hslToHex } from '../context/ThemeContext';
import { useConfig } from '../context/ConfigContext';

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

interface Bubble {
  x: number; y: number; r: number;
  vy: number; wobble: number; phase: number; speed: number; opacity: number;
  hue: number;
  popping: boolean; popT: number;
}

export function BackgroundBlobs() {
  const { theme, primaryColor } = useTheme();
  const { config } = useConfig();
  const mousePos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [smoothMouse, setSmoothMouse] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const smoothRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const bubblesRef = useRef<Bubble[]>([]);

  // Smooth primary color transition
  const targetRgbRef = useRef({ r: 75, g: 142, b: 255 });
  const smoothRgbAnimRef = useRef({ r: 75, g: 142, b: 255 });
  const [displayRgb, setDisplayRgb] = useState({ r: 75, g: 142, b: 255 });

  const isDark = theme === 'dark';
  const disabled = config?.DisableBackgroundEffects;

  useEffect(() => {
    if (disabled) return;
    const onMove = (e: MouseEvent) => { mousePos.current = { x: e.clientX, y: e.clientY }; };
    const onClick = (e: MouseEvent) => {
      let popped = false;
      for (const b of bubblesRef.current) {
        if (b.popping) continue;
        const drawX = b.x + Math.sin(b.phase) * b.wobble;
        const dx = e.clientX - drawX;
        const dy = e.clientY - b.y;
        if (Math.sqrt(dx * dx + dy * dy) < b.r) {
          b.popping = true; b.popT = 0;
          popped = true;
          break;
        }
      }
      const id = Date.now();
      setRipples(prev => [...prev, { id, x: e.clientX, y: e.clientY }]);
      setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 2500);
      void popped;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mousedown', onClick); };
  }, [disabled]);

  useEffect(() => {
    if (disabled) return;
    let rafId: number;
    const tick = () => {
      smoothRef.current = {
        x: smoothRef.current.x + (mousePos.current.x - smoothRef.current.x) * 0.05,
        y: smoothRef.current.y + (mousePos.current.y - smoothRef.current.y) * 0.05,
      };
      setSmoothMouse({ ...smoothRef.current });

      const t = targetRgbRef.current;
      const s = smoothRgbAnimRef.current;
      smoothRgbAnimRef.current = {
        r: s.r + (t.r - s.r) * 0.05,
        g: s.g + (t.g - s.g) * 0.05,
        b: s.b + (t.b - s.b) * 0.05,
      };
      setDisplayRgb({
        r: Math.round(smoothRgbAnimRef.current.r),
        g: Math.round(smoothRgbAnimRef.current.g),
        b: Math.round(smoothRgbAnimRef.current.b),
      });

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [disabled]);

  const { h, s, l } = hexToHsl(primaryColor);
  const mx = smoothMouse.x / window.innerWidth;
  const hueShift = (mx - 0.5) * 70;
  const shiftedColor = hslToHex(((h + hueShift) % 360 + 360) % 360, Math.max(35, s), Math.min(72, l + 5));
  const rgb  = hexToRgb(primaryColor) || { r: 75, g: 142, b: 255 };
  const rgb2 = hexToRgb(shiftedColor) || rgb;

  targetRgbRef.current = rgb;

  useEffect(() => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = (canvas.width  = window.innerWidth);
    let H = (canvas.height = window.innerHeight);

    const COUNT = 18;
    const mkBubble = (): Bubble => ({
      x: Math.random() * W,
      y: H - Math.random() * H,
      r: Math.random() * 80 + 28,
      vy: -(Math.random() * 0.35 + 0.15),
      wobble: Math.random() * 45 + 20,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.014 + 0.007,
      opacity: Math.random() * 0.22 + (isDark ? 0.16 : 0.12),
      hue: Math.random() * 360,
      popping: false, popT: 0,
    });
    
    // Always re-initialize bubbles on enable to ensure state is fresh
    bubblesRef.current = Array.from({ length: COUNT }, mkBubble);
    const bubbles = bubblesRef.current;

    const drawBubble = (drawX: number, drawY: number, R: number, op: number, br: number, bg: number, bb: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(drawX, drawY, R, 0, Math.PI * 2);
      ctx.clip();

      const gr = ctx.createRadialGradient(drawX - R * 0.28, drawY - R * 0.28, 0, drawX, drawY, R);
      if (isDark) {
        gr.addColorStop(0,    `rgba(${Math.min(br+55,255)},${Math.min(bg+55,255)},${Math.min(bb+55,255)},${op * 0.50})`);
        gr.addColorStop(0.55, `rgba(${br},${bg},${bb},${op * 0.80})`);
        gr.addColorStop(0.88, `rgba(${br},${bg},${bb},${op * 1.05})`);
        gr.addColorStop(1,    `rgba(${br},${bg},${bb},0)`);
      } else {
        gr.addColorStop(0,    `rgba(255,255,255,${op * 1.4})`);
        gr.addColorStop(0.38, `rgba(${br},${bg},${bb},${op * 0.55})`);
        gr.addColorStop(0.80, `rgba(${br},${bg},${bb},${op * 0.88})`);
        gr.addColorStop(0.93, `rgba(${br},${bg},${bb},${op * 1.0})`);
        gr.addColorStop(1,    `rgba(${br},${bg},${bb},0)`);
      }
      ctx.beginPath();
      ctx.arc(drawX, drawY, R, 0, Math.PI * 2);
      ctx.fillStyle = gr;
      ctx.fill();

      const gX = drawX - R * 0.30, gY = drawY - R * 0.32, gR = R * 0.44;
      const glare = ctx.createRadialGradient(gX, gY, 0, gX, gY, gR);
      glare.addColorStop(0,   `rgba(255,255,255,${isDark ? 0.38 : 0.60})`);
      glare.addColorStop(0.5, `rgba(255,255,255,${isDark ? 0.12 : 0.22})`);
      glare.addColorStop(1,   'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.arc(gX, gY, gR, 0, Math.PI * 2);
      ctx.fillStyle = glare;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(drawX, drawY, R, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${br},${bg},${bb},${Math.min(op * 3.2, isDark ? 0.72 : 0.58)})`;
      ctx.lineWidth = isDark ? 2.0 : 1.6;
      ctx.stroke();
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      bubbles.forEach(b => {
        if (b.popping) {
          b.popT += 0.07;
          const sc = 1 + b.popT * 0.5;
          const popOp = Math.max(0, 1 - b.popT * 1.8) * b.opacity * 2.2;
          if (b.popT >= 1 || popOp <= 0) {
            b.popping = false; b.popT = 0;
            b.y = H + b.r + Math.random() * 80;
            b.x = Math.random() * W;
            b.r = Math.random() * 80 + 28;
            b.hue = Math.random() * 360;
            b.opacity = Math.random() * 0.22 + (isDark ? 0.16 : 0.12);
            b.vy = -(Math.random() * 0.35 + 0.15);
            return;
          }
          const drawX = b.x + Math.sin(b.phase) * b.wobble;
          const drawY = b.y;
          const R = b.r * sc;
          const [br, bg, bb] = hsl2rgb(b.hue, 80, isDark ? 65 : 58);
          const fragCount = 6;
          for (let fi = 0; fi < fragCount; fi++) {
            const angle = (fi / fragCount) * Math.PI * 2;
            const fragDist = b.r * b.popT * 1.4;
            const fx = drawX + Math.cos(angle) * fragDist;
            const fy = drawY + Math.sin(angle) * fragDist;
            const fr = b.r * 0.12 * (1 - b.popT);
            ctx.beginPath();
            ctx.arc(fx, fy, Math.max(1, fr), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${br},${bg},${bb},${popOp * 0.8})`;
            ctx.fill();
          }
          drawBubble(drawX, drawY, R, popOp, br, bg, bb);
          return;
        }
        b.phase += b.speed;
        b.y += b.vy;
        if (b.y + b.r < -10) {
          b.y = H + b.r + Math.random() * 60;
          b.x = Math.random() * W;
          b.r = Math.random() * 80 + 28;
          b.hue = Math.random() * 360;
          b.opacity = Math.random() * 0.22 + (isDark ? 0.16 : 0.12);
          b.vy = -(Math.random() * 0.35 + 0.15);
        }
        const drawX = b.x + Math.sin(b.phase) * b.wobble;
        const drawY = b.y;
        const dx   = smoothRef.current.x - drawX;
        const dy   = smoothRef.current.y - drawY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const near = dist < 260;
        const t    = near ? Math.max(0, 1 - dist / 260) : 0;
        const op   = near ? Math.min(b.opacity * 2.4, isDark ? 0.60 : 0.50) : b.opacity;
        const sc   = near ? 1 + t * 0.18 : 1;
        const sat = 72 + t * 16;
        const lit = isDark ? 58 + t * 18 : 52 + t * 14;
        const [br, bg, bb] = hsl2rgb(b.hue, sat, lit);
        drawBubble(drawX, drawY, b.r * sc, op, br, bg, bb);
      });
      animFrameRef.current = requestAnimationFrame(draw);
    };

    const onResize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    draw();
    return () => { cancelAnimationFrame(animFrameRef.current); window.removeEventListener('resize', onResize); };
  }, [isDark, primaryColor, disabled]);

  const pct = (v: number, max: number) => `${(v / max * 100).toFixed(1)}%`;
  const dr = displayRgb;

  const ambientBg = isDark
    ? `linear-gradient(135deg, rgba(${dr.r},${dr.g},${dr.b},0.20) 0%, rgba(${rgb2.r},${rgb2.g},${rgb2.b},0.10) 50%, rgba(0,0,0,0) 100%)`
    : `linear-gradient(135deg, rgba(${dr.r},${dr.g},${dr.b},0.13) 0%, rgba(${rgb2.r},${rgb2.g},${rgb2.b},0.07) 55%, rgba(${dr.r},${dr.g},${dr.b},0.05) 100%)`;

  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none z-0 transition-colors duration-1000"
      style={{ background: isDark ? '#070710' : '#ecf0fc' }}
    >
      {!disabled && (
        <>
          <div className="absolute inset-0" style={{ background: ambientBg }} />
          <div
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(ellipse 65% 55% at ${pct(smoothMouse.x, window.innerWidth)} ${pct(smoothMouse.y, window.innerHeight)},
                  rgba(${dr.r},${dr.g},${dr.b},${isDark ? 0.30 : 0.17}) 0%,
                  transparent 60%),
                radial-gradient(ellipse 55% 50% at ${pct(window.innerWidth - smoothMouse.x, window.innerWidth)} ${pct(window.innerHeight - smoothMouse.y, window.innerHeight)},
                  rgba(${rgb2.r},${rgb2.g},${rgb2.b},${isDark ? 0.20 : 0.12}) 0%,
                  transparent 55%)
              `,
            }}
          />
          <div
            className="absolute inset-0 animate-wave-drift"
            style={{
              opacity: isDark ? 0.65 : 0.5,
              background: `
                radial-gradient(ellipse 130% 80% at 15% 10%,
                  rgba(${dr.r},${dr.g},${dr.b},${isDark ? 0.15 : 0.09}) 0%, transparent 55%),
                radial-gradient(ellipse 110% 90% at 90% 80%,
                  rgba(${rgb2.r},${rgb2.g},${rgb2.b},${isDark ? 0.12 : 0.08}) 0%, transparent 55%)
              `,
            }}
          />
          {ripples.map(r => (
            <div
              key={r.id}
              className="absolute rounded-full animate-ripple-expand"
              style={{
                left: r.x, top: r.y,
                width: 10, height: 10,
                transform: 'translate(-50%,-50%)',
                border: `2px solid rgba(${dr.r},${dr.g},${dr.b},${isDark ? 0.60 : 0.42})`,
              }}
            />
          ))}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ opacity: isDark ? 1.0 : 0.75 }}
          />
        </>
      )}

      <style>{`
        @keyframes ripple-expand {
          0%   { width: 0;     height: 0;     opacity: 0.85; }
          100% { width: 520px; height: 520px; opacity: 0;    }
        }
        .animate-ripple-expand { animation: ripple-expand 2.4s cubic-bezier(0,.2,.8,1) forwards; }

        @keyframes wave-drift {
          0%,100% { transform: translate(0,0)       scale(1);    }
          33%     { transform: translate(45px,-28px) scale(1.04); }
          66%     { transform: translate(-28px,42px) scale(0.97); }
        }
        .animate-wave-drift { animation: wave-drift 24s infinite ease-in-out; }
      `}</style>
    </div>
  );
}
