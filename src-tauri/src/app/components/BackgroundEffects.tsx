import { useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useConfig } from '../context/ConfigContext';
import { BackgroundBlobs } from './BackgroundBlobs';

// ─── 共用 Canvas Hook ─────────────────────────────────────────────────────────
function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number) => void,
  setup?: (canvas: HTMLCanvasElement) => () => void,
) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf: number;
    let last = 0;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const cleanupSetup = setup?.(canvas);

    const loop = (ts: number) => {
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;
      draw(ctx, canvas.width, canvas.height, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      cleanupSetup?.();
    };
  });
  return ref;
}

// ─── 底层渐变（慢速色相循环，不受主题色影响）────────────────────────────────
export function BaseGradientEffect() {
  const { theme } = useTheme();
  const t = useRef(0);

  const ref = useCanvas((ctx, w, h, dt) => {
    const isDark = theme === 'dark';
    t.current += dt * 0.035;

    // 三个慢速漂移的径向光源，色相各自独立循环
    const h1 = (t.current * 18)        % 360;
    const h2 = (t.current * 12 + 120)  % 360;
    const h3 = (t.current * 9  + 240)  % 360;

    const x1 = w * (0.18 + 0.18 * Math.sin(t.current * 0.55));
    const y1 = h * (0.22 + 0.18 * Math.cos(t.current * 0.40));
    const x2 = w * (0.78 + 0.14 * Math.cos(t.current * 0.48));
    const y2 = h * (0.70 + 0.14 * Math.sin(t.current * 0.62));
    const x3 = w * (0.50 + 0.10 * Math.sin(t.current * 0.30 + 1));
    const y3 = h * (0.45 + 0.10 * Math.cos(t.current * 0.35 + 2));
    const R  = Math.max(w, h);

    // 底色
    ctx.fillStyle = isDark ? '#06060f' : '#f0f1fc';
    ctx.fillRect(0, 0, w, h);

    // 光源 1
    const g1 = ctx.createRadialGradient(x1, y1, 0, x1, y1, R * 0.72);
    g1.addColorStop(0, isDark ? `hsla(${h1},65%,18%,.92)` : `hsla(${h1},75%,88%,.90)`);
    g1.addColorStop(1, `hsla(${h1},45%,10%,0)`);
    ctx.fillStyle = g1; ctx.fillRect(0, 0, w, h);

    // 光源 2
    const g2 = ctx.createRadialGradient(x2, y2, 0, x2, y2, R * 0.60);
    g2.addColorStop(0, isDark ? `hsla(${h2},55%,22%,.75)` : `hsla(${h2},70%,86%,.75)`);
    g2.addColorStop(1, `hsla(${h2},40%,10%,0)`);
    ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);

    // 光源 3（补色，居中漂移）
    const g3 = ctx.createRadialGradient(x3, y3, 0, x3, y3, R * 0.45);
    g3.addColorStop(0, isDark ? `hsla(${h3},50%,16%,.55)` : `hsla(${h3},65%,90%,.55)`);
    g3.addColorStop(1, `hsla(${h3},35%,10%,0)`);
    ctx.fillStyle = g3; ctx.fillRect(0, 0, w, h);
  });

  return <canvas ref={ref} className="fixed inset-0 w-full h-full" style={{ zIndex: -1 }} />;
}

// ─── 1. 粒子星河 ── 紫蓝星空 ────────────────────────────────────────────────
export function ParticleGalaxyEffect() {
  const { theme } = useTheme();
  const state = useRef({
    particles: [] as { x: number; y: number; vx: number; vy: number; size: number; alpha: number; trail: { x: number; y: number }[] }[],
    mouse: { x: -9999, y: -9999 },
  });

  const ref = useCanvas(
    (ctx, w, h) => {
      const [r, g, b] = [110, 100, 255] as const; // 紫蓝
      const isDark = theme === 'dark';
      const s = state.current;

      if (s.particles.length === 0) {
        for (let i = 0; i < 140; i++) {
          s.particles.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .5, vy: (Math.random() - .5) * .5, size: Math.random() * 2 + .5, alpha: Math.random() * .5 + .2, trail: [] });
        }
      }

      ctx.fillStyle = isDark ? 'rgba(6,6,15,.18)' : 'rgba(240,241,252,.18)';
      ctx.fillRect(0, 0, w, h);

      for (const p of s.particles) {
        const dx = s.mouse.x - p.x, dy = s.mouse.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 130 && dist > 1) { p.vx += dx / dist * .04; p.vy += dy / dist * .04; }
        p.vx *= .985; p.vy *= .985;
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 10) p.trail.shift();

        if (p.trail.length > 1) {
          ctx.beginPath(); ctx.moveTo(p.trail[0].x, p.trail[0].y);
          p.trail.forEach(t => ctx.lineTo(t.x, t.y));
          ctx.strokeStyle = `rgba(${r},${g},${b},${p.alpha * .25})`;
          ctx.lineWidth = p.size * .5; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha})`; ctx.fill();
      }
    },
    (canvas) => {
      const s = state.current;
      const onMove = (e: MouseEvent) => { s.mouse.x = e.clientX; s.mouse.y = e.clientY; };
      const onClick = (e: MouseEvent) => {
        for (let i = 0; i < 22; i++) {
          const a = Math.random() * Math.PI * 2, sp = Math.random() * 4 + 1;
          s.particles.push({ x: e.clientX, y: e.clientY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: Math.random() * 2.5 + .5, alpha: .9, trail: [] });
        }
        if (s.particles.length > 220) s.particles.splice(0, s.particles.length - 220);
      };
      window.addEventListener('mousemove', onMove);
      canvas.addEventListener('click', onClick);
      return () => { window.removeEventListener('mousemove', onMove); canvas.removeEventListener('click', onClick); };
    },
  );
  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 2. 流体波纹 ── 青蓝水波 ────────────────────────────────────────────────
export function FluidRippleEffect() {
  const { theme } = useTheme();
  const ripples = useRef<{ x: number; y: number; r: number; alpha: number }[]>([]);
  const t = useRef(0);
  const lastMoveRipple = useRef(0);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const [r, g, b] = [0, 195, 228] as const; // 青蓝
      const isDark = theme === 'dark';
      t.current += dt;

      ctx.fillStyle = isDark ? 'rgba(6,6,15,.88)' : 'rgba(240,241,252,.88)';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < 6; i++) {
        const y0 = h * (i + 1) / 7;
        const amp = 18 + i * 6;
        const freq = .004 + i * .001;
        const speed = t.current * (.3 + i * .05);
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const y = y0 + Math.sin(x * freq + speed) * amp + Math.cos(x * freq * 1.7 + speed * .8) * amp * .5;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${r},${g},${b},${isDark ? .07 : .09})`;
        ctx.lineWidth = 1.5; ctx.stroke();
      }

      for (let i = ripples.current.length - 1; i >= 0; i--) {
        const rp = ripples.current[i];
        rp.r += 120 * dt; rp.alpha -= .6 * dt;
        if (rp.alpha <= 0) { ripples.current.splice(i, 1); continue; }
        for (let ring = 0; ring < 3; ring++) {
          const rr = rp.r - ring * 22;
          if (rr < 0) continue;
          ctx.beginPath(); ctx.arc(rp.x, rp.y, rr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${r},${g},${b},${rp.alpha * (1 - ring * .3)})`;
          ctx.lineWidth = 2 - ring * .5; ctx.stroke();
        }
      }
    },
    (canvas) => {
      const onMove = (e: MouseEvent) => {
        const now = Date.now();
        if (now - lastMoveRipple.current > 130) {
          ripples.current.push({ x: e.clientX, y: e.clientY, r: 0, alpha: .38 });
          lastMoveRipple.current = now;
        }
      };
      const onClick = (e: MouseEvent) => ripples.current.push({ x: e.clientX, y: e.clientY, r: 0, alpha: .9 });
      window.addEventListener('mousemove', onMove);
      canvas.addEventListener('click', onClick);
      return () => { window.removeEventListener('mousemove', onMove); canvas.removeEventListener('click', onClick); };
    },
  );
  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 3. 极光光带 ── 绿紫真实极光色 ─────────────────────────────────────────
export function AuroraBandsEffect() {
  const { theme } = useTheme();
  const flashes = useRef<{ x: number; t: number; alpha: number }[]>([]);
  const mouse = useRef({ x: -9999, y: -9999 });
  const time = useRef(0);

  // 真实极光色相：绿 → 青 → 蓝紫 → 品红
  const BANDS = [
    { hue: 145, yRatio: .22, amp: .12, freq: .80, alpha: .58 },
    { hue: 175, yRatio: .37, amp: .10, freq: 1.10, alpha: .42 },
    { hue: 265, yRatio: .52, amp: .08, freq: 1.40, alpha: .36 },
    { hue: 308, yRatio: .65, amp: .07, freq: .90, alpha: .26 },
  ];

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      time.current += dt * .4;

      ctx.fillStyle = isDark ? 'rgba(6,6,15,.88)' : 'rgba(240,241,252,.88)';
      ctx.fillRect(0, 0, w, h);

      for (const band of BANDS) {
        const hShift = band.hue + Math.sin(time.current * .3) * 12; // 轻微色相呼吸
        const points: [number, number][] = [];
        for (let x = 0; x <= w; x += 6) {
          const nx = x / w;
          const y = h * (band.yRatio + band.amp * Math.sin(nx * Math.PI * 3 * band.freq + time.current) + band.amp * .5 * Math.cos(nx * Math.PI * 5 * band.freq + time.current * 1.3));
          points.push([x, y]);
        }
        ctx.beginPath();
        ctx.moveTo(0, h);
        points.forEach(([px, py]) => ctx.lineTo(px, py));
        ctx.lineTo(w, h); ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0,   `hsla(${hShift},82%,${isDark ? 62 : 50}%,0)`);
        grad.addColorStop(.35, `hsla(${hShift},82%,${isDark ? 62 : 50}%,${band.alpha})`);
        grad.addColorStop(.65, `hsla(${(hShift + 18) % 360},82%,${isDark ? 66 : 54}%,${band.alpha})`);
        grad.addColorStop(1,   `hsla(${hShift},82%,${isDark ? 62 : 50}%,0)`);
        ctx.fillStyle = grad; ctx.fill();
      }

      // 鼠标发光晕
      if (mouse.current.x > 0) {
        const mg = ctx.createRadialGradient(mouse.current.x, mouse.current.y, 0, mouse.current.x, mouse.current.y, 140);
        mg.addColorStop(0, `rgba(180,255,210,${isDark ? .20 : .14})`);
        mg.addColorStop(1, `rgba(180,255,210,0)`);
        ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h);
      }

      for (let i = flashes.current.length - 1; i >= 0; i--) {
        const f = flashes.current[i];
        f.t += dt * 1.8; f.alpha = Math.max(0, 1 - f.t);
        if (f.alpha <= 0) { flashes.current.splice(i, 1); continue; }
        const spread = f.t * w * .5;
        const grad = ctx.createRadialGradient(f.x, h * .4, 0, f.x, h * .4, spread);
        grad.addColorStop(0, `rgba(160,255,200,${f.alpha * .75})`);
        grad.addColorStop(1, `rgba(160,255,200,0)`);
        ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
      }
    },
    (canvas) => {
      const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
      const onClick = (e: MouseEvent) => flashes.current.push({ x: e.clientX, t: 0, alpha: 1 });
      window.addEventListener('mousemove', onMove);
      canvas.addEventListener('click', onClick);
      return () => { window.removeEventListener('mousemove', onMove); canvas.removeEventListener('click', onClick); };
    },
  );
  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 4. 樱花飘落 ── 粉玫瑰 ─────────────────────────────────────────────────
export function SakuraFallEffect() {
  const { theme } = useTheme();
  const petals = useRef<{ x: number; y: number; vx: number; vy: number; rot: number; vr: number; size: number; alpha: number; burst: boolean }[]>([]);
  const mouse = useRef({ x: -9999, y: -9999 });
  const initialized = useRef(false);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const [r, g, b] = [255, 132, 165] as const; // 樱花粉
      const isDark = theme === 'dark';
      const ps = petals.current;

      if (!initialized.current) {
        initialized.current = true;
        for (let i = 0; i < 60; i++) {
          ps.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * 30, vy: Math.random() * 40 + 20, rot: Math.random() * Math.PI * 2, vr: (Math.random() - .5) * 2, size: Math.random() * 10 + 6, alpha: Math.random() * .5 + .3, burst: false });
        }
      }

      if (Math.random() < .3) {
        ps.push({ x: Math.random() * w, y: -20, vx: (Math.random() - .5) * 25, vy: Math.random() * 35 + 20, rot: Math.random() * Math.PI * 2, vr: (Math.random() - .5) * 2.5, size: Math.random() * 10 + 6, alpha: Math.random() * .5 + .3, burst: false });
      }

      ctx.fillStyle = isDark ? 'rgba(6,6,15,.20)' : 'rgba(240,241,252,.20)';
      ctx.fillRect(0, 0, w, h);

      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];

        const pdx = p.x - mouse.current.x, pdy = p.y - mouse.current.y;
        const pdist = Math.hypot(pdx, pdy);
        if (pdist < 90 && pdist > 0.5) {
          p.vx += (pdx / pdist) * 55 * dt;
          p.vy -= 18 * dt;
        }

        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.burst) { p.vy += 80 * dt; p.alpha -= 1.5 * dt; }
        if (p.y > h + 30 || p.alpha < .02) { ps.splice(i, 1); continue; }

        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * .55, 0, 0, Math.PI * 2);
        const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
        grd.addColorStop(0, `rgba(${r},${g},${b},${p.alpha})`);
        grd.addColorStop(1, `rgba(255,210,220,${p.alpha * .3})`);
        ctx.fillStyle = grd; ctx.fill();
        ctx.restore();
      }

      if (ps.length > 200) ps.splice(0, ps.length - 200);
    },
    (canvas) => {
      const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
      const onClick = (e: MouseEvent) => {
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2, sp = Math.random() * 150 + 50;
          petals.current.push({ x: e.clientX, y: e.clientY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, rot: Math.random() * Math.PI * 2, vr: (Math.random() - .5) * 5, size: Math.random() * 8 + 5, alpha: .9, burst: true });
        }
      };
      window.addEventListener('mousemove', onMove);
      canvas.addEventListener('click', onClick);
      return () => { window.removeEventListener('mousemove', onMove); canvas.removeEventListener('click', onClick); };
    },
  );
  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}


// ─── 7. 星座连线 ── 星光银蓝 ────────────────────────────────────────────────
export function ConstellationEffect() {
  const { theme } = useTheme();
  const stars = useRef<{ x: number; y: number; size: number; twinkle: number; tp: number }[]>([]);
  const rings = useRef<{ x: number; y: number; r: number; alpha: number }[]>([]);
  const mouse = useRef({ x: -9999, y: -9999 });
  const initialized = useRef(false);
  const LINK_DIST = 110;

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const [r, g, b] = [185, 205, 255] as const; // 星光银蓝
      const isDark = theme === 'dark';

      if (!initialized.current) {
        initialized.current = true;
        for (let i = 0; i < 80; i++) {
          stars.current.push({ x: Math.random() * w, y: Math.random() * h, size: Math.random() * 1.8 + .4, twinkle: Math.random() * Math.PI * 2, tp: Math.random() * 2 + 1 });
        }
      }

      ctx.fillStyle = isDark ? 'rgba(6,6,15,.22)' : 'rgba(240,241,252,.22)';
      ctx.fillRect(0, 0, w, h);

      const ss = stars.current;
      for (let i = 0; i < ss.length; i++) {
        for (let j = i + 1; j < ss.length; j++) {
          const d = Math.hypot(ss[i].x - ss[j].x, ss[i].y - ss[j].y);
          if (d < LINK_DIST) {
            ctx.beginPath(); ctx.moveTo(ss[i].x, ss[i].y); ctx.lineTo(ss[j].x, ss[j].y);
            ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - d / LINK_DIST) * (isDark ? .20 : .14)})`;
            ctx.lineWidth = .8; ctx.stroke();
          }
        }
      }

      for (const s of ss) {
        s.twinkle += dt * s.tp;
        const a = .4 + Math.sin(s.twinkle) * .3;
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.size * 4);
        grad.addColorStop(0, `rgba(${r},${g},${b},${a * .4})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 4, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`; ctx.fill();
      }

      // 鼠标作为虚拟星点，向附近恒星连线
      if (mouse.current.x > 0) {
        for (const s of ss) {
          const d = Math.hypot(s.x - mouse.current.x, s.y - mouse.current.y);
          if (d < LINK_DIST * 1.6) {
            ctx.beginPath(); ctx.moveTo(mouse.current.x, mouse.current.y); ctx.lineTo(s.x, s.y);
            ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - d / (LINK_DIST * 1.6)) * (isDark ? .48 : .32)})`;
            ctx.lineWidth = 1; ctx.stroke();
          }
        }
        ctx.beginPath(); ctx.arc(mouse.current.x, mouse.current.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},.88)`; ctx.fill();
        const mg = ctx.createRadialGradient(mouse.current.x, mouse.current.y, 0, mouse.current.x, mouse.current.y, 18);
        mg.addColorStop(0, `rgba(${r},${g},${b},.32)`);
        mg.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mouse.current.x, mouse.current.y, 18, 0, Math.PI * 2); ctx.fill();
      }

      for (let i = rings.current.length - 1; i >= 0; i--) {
        const rg = rings.current[i];
        rg.r += 90 * dt; rg.alpha -= .8 * dt;
        if (rg.alpha <= 0) { rings.current.splice(i, 1); continue; }
        ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${rg.alpha})`;
        ctx.lineWidth = 1.5; ctx.stroke();
      }
    },
    (canvas) => {
      const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
      const onClick = (e: MouseEvent) => {
        stars.current.push({ x: e.clientX, y: e.clientY, size: Math.random() * 2 + 1, twinkle: 0, tp: Math.random() * 2 + 1 });
        if (stars.current.length > 130) stars.current.shift();
        rings.current.push({ x: e.clientX, y: e.clientY, r: 4, alpha: 1 });
      };
      window.addEventListener('mousemove', onMove);
      canvas.addEventListener('click', onClick);
      return () => { window.removeEventListener('mousemove', onMove); canvas.removeEventListener('click', onClick); };
    },
  );
  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 8. 山水层峦 ────────────────────────────────────────────────────────────
export function MountainParallaxEffect() {
  const { theme } = useTheme();
  const t = useRef(0);

  const ref = useCanvas((ctx, w, h, dt) => {
    const isDark = theme === 'dark';
    t.current += dt * 0.09;

    ctx.fillStyle = isDark ? 'rgba(6,6,15,.74)' : 'rgba(240,241,252,.72)';
    ctx.fillRect(0, 0, w, h);

    const layers = [
      { baseY: 0.78, amp: 18, hue: isDark ? 210 : 215, alpha: isDark ? 0.22 : 0.14, speed: 0.4 },
      { baseY: 0.70, amp: 28, hue: isDark ? 205 : 210, alpha: isDark ? 0.18 : 0.11, speed: 0.28 },
      { baseY: 0.62, amp: 34, hue: isDark ? 198 : 204, alpha: isDark ? 0.14 : 0.09, speed: 0.18 },
    ];

    for (const layer of layers) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 12) {
        const nx = x / w;
        const y = h * layer.baseY
          + Math.sin(nx * Math.PI * 4 + t.current * layer.speed * 3) * layer.amp
          + Math.cos(nx * Math.PI * 7 + t.current * layer.speed * 1.8) * layer.amp * 0.45;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = `hsla(${layer.hue},24%,${isDark ? 48 : 58}%,${layer.alpha})`;
      ctx.fill();
    }
  });

  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 10. 金箔微光 ───────────────────────────────────────────────────────────
export function GoldFlakesEffect() {
  const { theme } = useTheme();
  const flakes = useRef(
    Array.from({ length: 80 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      size: 1 + Math.random() * 4,
      vy: 4 + Math.random() * 10,
      tw: Math.random() * Math.PI * 2,
      tp: 0.8 + Math.random() * 1.4,
    })),
  );

  const ref = useCanvas((ctx, w, h, dt) => {
    const isDark = theme === 'dark';
    ctx.fillStyle = isDark ? 'rgba(12,10,15,.82)' : 'rgba(245,242,236,.80)';
    ctx.fillRect(0, 0, w, h);

    for (const flake of flakes.current) {
      flake.y += flake.vy * dt;
      flake.tw += dt * flake.tp;
      if (flake.y > h + 8) {
        flake.y = -8;
        flake.x = Math.random() * w;
      }
      const alpha = 0.18 + (Math.sin(flake.tw) + 1) * 0.14;
      ctx.beginPath();
      ctx.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2);
      ctx.fillStyle = isDark
        ? `rgba(255,214,120,${alpha})`
        : `rgba(198,148,40,${alpha * 0.78})`;
      ctx.fill();
    }
  });

  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── Background Manager ───────────────────────────────────────────────────────
export function BackgroundManager() {
  const { backgroundEffect, theme } = useTheme();
  const { config } = useConfig();
  const isDark = theme === 'dark';

  if (config?.DisableBackgroundEffects) {
    return <div className="fixed inset-0 z-0 transition-colors duration-1000" style={{ background: isDark ? '#06060f' : '#f0f1fc' }} />;
  }

  const effect = (() => {
    switch (backgroundEffect) {
      case 'blobs':           return <BackgroundBlobs />;
      case 'particle-galaxy': return <ParticleGalaxyEffect />;
      case 'fluid-ripple':    return <FluidRippleEffect />;
      case 'aurora-bands':    return <AuroraBandsEffect />;
      case 'sakura-fall':     return <SakuraFallEffect />;
      case 'constellation':   return <ConstellationEffect />;
      case 'mountain-parallax': return <MountainParallaxEffect />;
      case 'gold-flakes':     return <GoldFlakesEffect />;
      default:                return <BackgroundBlobs />;
    }
  })();

  return (
    <>
      <BaseGradientEffect />
      {effect}
    </>
  );
}
