import { useEffect, useRef } from 'react';
import { useTheme, hexToHsl } from '../context/ThemeContext';
import { useConfig } from '../context/ConfigContext';

type Trail = { x: number; y: number; t: number };

// 自定义鼠标层：根据 themeFamily 切换不同光标效果
//   ink:     笔尖墨点 + 渐隐拖痕
//   tech:    双环 + 旋转刻度 + 十字准星
//   ocean:   水波涟漪 + 小气泡
//   default: 简洁光晕
export function CursorEffect() {
  const { themeFamily, primaryColor, accentColor, theme } = useTheme();
  const { config } = useConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999, vx: 0, vy: 0, lastX: 0, lastY: 0, t: 0 });
  const trail = useRef<Trail[]>([]);
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

    const onMove = (e: MouseEvent) => {
      const now = performance.now() / 1000;
      const m = mouse.current;
      const dt = Math.max(now - m.t, 0.001);
      m.vx = (e.clientX - m.x) / dt;
      m.vy = (e.clientY - m.y) / dt;
      m.lastX = m.x; m.lastY = m.y;
      m.x = e.clientX; m.y = e.clientY; m.t = now;
      trail.current.push({ x: e.clientX, y: e.clientY, t: now });
      if (trail.current.length > 28) trail.current.shift();
    };
    const onLeave = () => { mouse.current.x = -9999; mouse.current.y = -9999; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseleave', onLeave);

    const pHsl = hexToHsl(primaryColor);
    const aHsl = hexToHsl(accentColor);
    const isDark = theme === 'dark';

    const draw = (ts: number) => {
      const dt = Math.min((ts - lastTs.current) / 1000, 0.05);
      lastTs.current = ts;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const m = mouse.current;
      if (m.x < 0) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      const now = ts / 1000;

      if (themeFamily === 'ink') {
        // 拖痕：墨色线段，按时间衰减
        const pts = trail.current.filter(p => now - p.t < 0.7);
        trail.current = pts;
        if (pts.length > 1) {
          for (let i = 1; i < pts.length; i++) {
            const age = now - pts[i].t;
            const a = Math.max(0, 1 - age / 0.7);
            ctx.strokeStyle = isDark
              ? `rgba(245,245,250,${a * 0.55})`
              : `rgba(30,30,40,${a * 0.55})`;
            ctx.lineWidth = 6 * a;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
            ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          }
        }
        // 笔尖墨点
        const grd = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 14);
        grd.addColorStop(0, isDark ? 'rgba(245,245,250,0.85)' : 'rgba(20,24,32,0.85)');
        grd.addColorStop(1, isDark ? 'rgba(245,245,250,0)' : 'rgba(20,24,32,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(m.x, m.y, 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = isDark ? 'rgba(245,235,225,0.95)' : 'rgba(186,38,38,0.85)';
        ctx.beginPath(); ctx.arc(m.x, m.y, 3.5, 0, Math.PI * 2); ctx.fill();
      } else if (themeFamily === 'tech') {
        // 双环 + 旋转刻度
        const r1 = 22;
        const r2 = 14;
        ctx.strokeStyle = `hsla(${aHsl.h},100%,72%,0.7)`;
        ctx.lineWidth = 1.2;
        ctx.shadowColor = `hsla(${aHsl.h},100%,60%,0.8)`;
        ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(m.x, m.y, r1, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(m.x, m.y, r2, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
        // 旋转刻度
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(now * 1.2);
        for (let i = 0; i < 8; i++) {
          ctx.rotate((Math.PI * 2) / 8);
          ctx.beginPath();
          ctx.moveTo(r1 + 2, 0); ctx.lineTo(r1 + 6, 0);
          ctx.strokeStyle = `hsla(${pHsl.h},100%,75%,0.85)`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
        // 十字准星
        ctx.strokeStyle = `hsla(${aHsl.h},100%,75%,0.5)`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(m.x - r1 - 8, m.y); ctx.lineTo(m.x - r2 - 2, m.y);
        ctx.moveTo(m.x + r2 + 2, m.y); ctx.lineTo(m.x + r1 + 8, m.y);
        ctx.moveTo(m.x, m.y - r1 - 8); ctx.lineTo(m.x, m.y - r2 - 2);
        ctx.moveTo(m.x, m.y + r2 + 2); ctx.lineTo(m.x, m.y + r1 + 8);
        ctx.stroke();
        // 中心点
        ctx.fillStyle = `hsla(${aHsl.h},100%,85%,0.9)`;
        ctx.beginPath(); ctx.arc(m.x, m.y, 1.6, 0, Math.PI * 2); ctx.fill();
        // 数字尾巴
        const speed = Math.min(Math.hypot(m.vx, m.vy), 2000) | 0;
        ctx.fillStyle = `hsla(${aHsl.h},100%,80%,0.85)`;
        ctx.font = '9px "Menlo","Consolas",monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${speed.toString().padStart(4, '0')}`, m.x + r1 + 12, m.y);
      } else if (themeFamily === 'ocean') {
        // 水波涟漪（脉冲半径）
        const pulse = (Math.sin(now * 3) + 1) / 2;
        const r = 14 + pulse * 8;
        ctx.strokeStyle = `hsla(${aHsl.h},80%,70%,${0.6 - pulse * 0.3})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.stroke();
        // 内圈
        const grd = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 18);
        grd.addColorStop(0, `hsla(${pHsl.h},90%,75%,0.7)`);
        grd.addColorStop(1, `hsla(${aHsl.h},85%,60%,0)`);
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(m.x, m.y, 18, 0, Math.PI * 2); ctx.fill();
        // 小气泡
        for (let i = 0; i < 3; i++) {
          const phase = now * (1 + i * 0.3);
          const ox = Math.cos(phase + i) * 14;
          const oy = Math.sin(phase + i) * 14;
          ctx.fillStyle = `hsla(${aHsl.h},80%,80%,0.55)`;
          ctx.beginPath(); ctx.arc(m.x + ox, m.y + oy, 1.4, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        // default 简洁光晕
        const grd = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 22);
        grd.addColorStop(0, `hsla(${pHsl.h},80%,${isDark ? 75 : 55}%,0.5)`);
        grd.addColorStop(1, `hsla(${pHsl.h},80%,50%,0)`);
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(m.x, m.y, 22, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `hsla(${pHsl.h},90%,${isDark ? 85 : 50}%,0.95)`;
        ctx.beginPath(); ctx.arc(m.x, m.y, 2.4, 0, Math.PI * 2); ctx.fill();
      }

      void dt;
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
    };
  }, [themeFamily, primaryColor, accentColor, theme, disabled]);

  if (disabled) return null;
  return (
    <canvas
      ref={ref}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 9999, mixBlendMode: theme === 'dark' ? 'screen' : 'multiply' }}
    />
  );
}
