import { useEffect, useRef } from 'react';
import { useTheme, hexToHsl } from '../context/ThemeContext';
import { useConfig } from '../context/ConfigContext';

// 任意点击都触发一层全屏反馈，调性由 themeFamily 决定
//   ink:     水墨晕染（多层不规则圆扩散）
//   tech:    量子双环震波 + 中心闪
//   ocean:   涟漪扩散
//   default: 简洁单环
type Ripple = {
  x: number;
  y: number;
  r: number;
  alpha: number;
  family: 'ink' | 'tech' | 'ocean' | 'default';
  seed: number;
};

export function ClickRippleEffect() {
  const { themeFamily, primaryColor, accentColor, theme } = useTheme();
  const { config } = useConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const ripples = useRef<Ripple[]>([]);
  const rafRef = useRef<number>(0);
  const lastTs = useRef(0);

  const disabled = !!config?.DisableCursorEffects;

  useEffect(() => {
    if (disabled) return;
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onClick = (e: MouseEvent) => {
      ripples.current.push({
        x: e.clientX, y: e.clientY,
        r: 6, alpha: 1,
        family: themeFamily,
        seed: Math.random() * Math.PI * 2,
      });
      if (themeFamily === 'tech') {
        ripples.current.push({
          x: e.clientX, y: e.clientY,
          r: 2, alpha: 0.8,
          family: 'tech',
          seed: Math.random() * Math.PI * 2,
        });
      }
      if (themeFamily === 'ocean') {
        for (let i = 1; i <= 2; i++) {
          ripples.current.push({
            x: e.clientX, y: e.clientY,
            r: 4, alpha: 0.7 - i * 0.15,
            family: 'ocean',
            seed: Math.random() * Math.PI * 2 + i,
          });
        }
      }
      if (ripples.current.length > 28) ripples.current.splice(0, ripples.current.length - 28);
    };
    window.addEventListener('click', onClick, true);

    const pHsl = hexToHsl(primaryColor);
    const aHsl = hexToHsl(accentColor);
    const isDark = theme === 'dark';

    const draw = (ts: number) => {
      const dt = Math.min((ts - lastTs.current) / 1000, 0.05);
      lastTs.current = ts;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      for (let i = ripples.current.length - 1; i >= 0; i--) {
        const r = ripples.current[i];
        if (r.family === 'ink') {
          r.r += 130 * dt;
          r.alpha -= 0.7 * dt;
        } else if (r.family === 'tech') {
          r.r += 620 * dt;
          r.alpha -= 0.85 * dt;
        } else if (r.family === 'ocean') {
          r.r += 280 * dt;
          r.alpha -= 0.55 * dt;
        } else {
          r.r += 380 * dt;
          r.alpha -= 0.7 * dt;
        }
        if (r.alpha <= 0) { ripples.current.splice(i, 1); continue; }

        if (r.family === 'ink') {
          // 多层不规则圆，模拟墨晕开
          for (let k = 0; k < 3; k++) {
            const rr = r.r * (0.7 + k * 0.18);
            const a = r.alpha * (0.45 - k * 0.12);
            if (a <= 0) continue;
            const grd = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, rr);
            grd.addColorStop(0, isDark
              ? `rgba(245,245,250,${a * 0.55})`
              : `rgba(30,30,40,${a * 0.55})`);
            grd.addColorStop(0.7, isDark
              ? `rgba(245,245,250,${a * 0.18})`
              : `rgba(30,30,40,${a * 0.18})`);
            grd.addColorStop(1, isDark
              ? 'rgba(245,245,250,0)'
              : 'rgba(30,30,40,0)');
            ctx.fillStyle = grd;
            // 不规则: 用椭圆 + 旋转
            ctx.save();
            ctx.translate(r.x, r.y);
            ctx.rotate(r.seed + k * 0.4);
            ctx.beginPath();
            ctx.ellipse(0, 0, rr, rr * (0.85 + Math.sin(r.seed + k) * 0.1), 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        } else if (r.family === 'tech') {
          // 双环 + 中心闪
          ctx.strokeStyle = `hsla(${aHsl.h},100%,80%,${r.alpha})`;
          ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = `hsla(${pHsl.h},100%,75%,${r.alpha * 0.65})`;
          ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.arc(r.x, r.y, r.r * 0.7, 0, Math.PI * 2); ctx.stroke();
          // 6 段断弧（旋转）
          ctx.strokeStyle = `hsla(${aHsl.h},100%,85%,${r.alpha * 0.7})`;
          ctx.lineWidth = 1.6;
          for (let k = 0; k < 6; k++) {
            const a0 = r.seed + k * (Math.PI / 3);
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.r * 1.15, a0, a0 + Math.PI / 10);
            ctx.stroke();
          }
          // 中心闪
          if (r.r < 30) {
            const flash = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, 24);
            flash.addColorStop(0, `hsla(${aHsl.h},100%,90%,${r.alpha * 0.8})`);
            flash.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = flash;
            ctx.beginPath(); ctx.arc(r.x, r.y, 24, 0, Math.PI * 2); ctx.fill();
          }
        } else if (r.family === 'ocean') {
          ctx.strokeStyle = `hsla(${aHsl.h},85%,70%,${r.alpha * 0.7})`;
          ctx.lineWidth = 1.2 + Math.sin(r.r * 0.1) * 0.4;
          ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
          // 内层小气泡
          if (r.r < 80) {
            ctx.fillStyle = `hsla(${pHsl.h},85%,75%,${r.alpha * 0.4})`;
            ctx.beginPath(); ctx.arc(r.x, r.y, r.r * 0.18, 0, Math.PI * 2); ctx.fill();
          }
        } else {
          ctx.strokeStyle = `hsla(${pHsl.h},80%,${isDark ? 80 : 50}%,${r.alpha * 0.7})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('click', onClick, true);
    };
  }, [themeFamily, primaryColor, accentColor, theme, disabled]);

  if (disabled) return null;
  return (
    <canvas
      ref={ref}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 9998 }}
    />
  );
}
