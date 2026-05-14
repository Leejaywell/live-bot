import { useEffect, useState, useRef, useCallback } from 'react';
import { useTheme, hexToRgb, hexToHsl, hslToHex } from '../context/ThemeContext';

export function BackgroundBlobs() {
  const { theme, primaryColor } = useTheme();
  const mousePos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [smoothMouse, setSmoothMouse] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const smoothRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  const isDark = theme === 'dark';

  // Smooth mouse tracking via rAF
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      const id = Date.now();
      setRipples(prev => [...prev, { id, x: e.clientX, y: e.clientY }]);
      setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 2200);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onClick);
    };
  }, []);

  // Lerp smooth mouse update
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

  // Derive a complementary hue-shifted color from mouse X position
  const { h, s, l } = hexToHsl(primaryColor);
  const mx = smoothMouse.x / window.innerWidth;   // 0→1
  const my = smoothMouse.y / window.innerHeight;  // 0→1
  const hueShift = (mx - 0.5) * 60;               // ±30° based on mouse X
  const shiftedColor = hslToHex(
    ((h + hueShift) % 360 + 360) % 360,
    Math.max(30, s),
    Math.min(70, l + 5),
  );
  const rgb  = hexToRgb(primaryColor)  || { r: 75, g: 142, b: 255 };
  const rgb2 = hexToRgb(shiftedColor)  || rgb;

  // Canvas bubble animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = (canvas.width  = window.innerWidth);
    let H = (canvas.height = window.innerHeight);

    const COUNT = 22;
    const bubbles = Array.from({ length: COUNT }, () => ({
      x:       Math.random() * W,
      y:       Math.random() * H,
      r:       Math.random() * 45 + 12,
      vx:      (Math.random() - 0.5) * 0.35,
      vy:      (Math.random() - 0.5) * 0.35,
      opacity: Math.random() * 0.13 + 0.04,
      phase:   Math.random() * Math.PI * 2,
      hue:     Math.random() * 40 - 20,   // per-bubble hue offset
    }));

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      bubbles.forEach(b => {
        b.x += b.vx;
        b.y += b.vy;
        b.phase += 0.008;
        if (b.x < -b.r) b.x = W + b.r;
        if (b.x > W + b.r) b.x = -b.r;
        if (b.y < -b.r) b.y = H + b.r;
        if (b.y > H + b.r) b.y = -b.r;

        const dx   = smoothRef.current.x - b.x;
        const dy   = smoothRef.current.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const near = dist < 220;
        const floatY = Math.sin(b.phase) * 8;
        const scale  = near ? 1.15 : 1;
        const op     = near ? Math.min(b.opacity * 2.2, 0.35) : b.opacity;

        // Color blends between primary and shifted color near mouse
        const t = near ? Math.max(0, 1 - dist / 220) : 0;
        const br = Math.round(rgb.r + (rgb2.r - rgb.r) * t);
        const bg = Math.round(rgb.g + (rgb2.g - rgb.g) * t);
        const bb = Math.round(rgb.b + (rgb2.b - rgb.b) * t);

        const cx = b.x;
        const cy = b.y + floatY;
        const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.r * scale);
        gr.addColorStop(0,   `rgba(255,255,255,${op * 1.4})`);
        gr.addColorStop(0.35,`rgba(${br},${bg},${bb},${op})`);
        gr.addColorStop(1,   'rgba(255,255,255,0)');

        ctx.beginPath();
        ctx.arc(cx, cy, b.r * scale, 0, Math.PI * 2);
        ctx.fillStyle = gr;
        ctx.fill();
      });

      animFrameRef.current = requestAnimationFrame(draw);
    };

    const onResize = () => {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);
    draw();
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, [isDark, primaryColor]);   // re-init on theme/color change

  const pct = (v: number, max: number) => `${(v / max * 100).toFixed(1)}%`;

  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none z-[-1] transition-colors duration-1000"
      style={{ background: isDark ? '#08080f' : '#f0f4ff' }}
    >
      {/* Water-ripple gradient — follows mouse smoothly */}
      <div
        className="absolute inset-0 transition-all duration-200"
        style={{
          background: `
            radial-gradient(ellipse 70% 60% at ${pct(smoothMouse.x, window.innerWidth)} ${pct(smoothMouse.y, window.innerHeight)},
              rgba(${rgb.r},${rgb.g},${rgb.b},${isDark ? 0.18 : 0.14}) 0%,
              transparent 65%),
            radial-gradient(ellipse 60% 55% at ${pct(window.innerWidth - smoothMouse.x, window.innerWidth)} ${pct(window.innerHeight - smoothMouse.y, window.innerHeight)},
              rgba(${rgb2.r},${rgb2.g},${rgb2.b},${isDark ? 0.12 : 0.10}) 0%,
              transparent 60%)
          `,
        }}
      />

      {/* Slow-wave ambient layer */}
      <div
        className="absolute inset-0 animate-wave-drift opacity-40"
        style={{
          background: `
            radial-gradient(ellipse 120% 80% at 30% 20%,
              rgba(${rgb.r},${rgb.g},${rgb.b},0.08) 0%, transparent 55%),
            radial-gradient(ellipse 100% 90% at 80% 70%,
              rgba(${rgb2.r},${rgb2.g},${rgb2.b},0.07) 0%, transparent 55%)
          `,
        }}
      />

      {/* Click ripples */}
      {ripples.map(r => (
        <div
          key={r.id}
          className="absolute rounded-full animate-ripple-expand"
          style={{
            left: r.x, top: r.y,
            width: 10, height: 10,
            transform: 'translate(-50%,-50%)',
            border: `2px solid rgba(${rgb.r},${rgb.g},${rgb.b},0.4)`,
          }}
        />
      ))}

      {/* Bubbles canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ opacity: isDark ? 0.8 : 0.65 }} />

      <style>{`
        @keyframes ripple-expand {
          0%   { width: 0;     height: 0;     opacity: 0.7; }
          100% { width: 480px; height: 480px; opacity: 0;   }
        }
        .animate-ripple-expand { animation: ripple-expand 2.2s cubic-bezier(0,.2,.8,1) forwards; }

        @keyframes wave-drift {
          0%,100% { transform: translate(0,0) scale(1); }
          33%     { transform: translate(30px,-20px) scale(1.05); }
          66%     { transform: translate(-20px,35px) scale(0.97); }
        }
        .animate-wave-drift { animation: wave-drift 20s infinite ease-in-out; }
      `}</style>
    </div>
  );
}
