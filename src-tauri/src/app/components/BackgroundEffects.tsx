import { useEffect, useRef, type DependencyList } from 'react';
import { hexToHsl, hexToRgb, hslToHex, useTheme } from '../context/ThemeContext';
import { useConfig } from '../context/ConfigContext';
import { BackgroundBlobs } from './BackgroundBlobs';

// ─── 共用 Canvas Hook ─────────────────────────────────────────────────────────
function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number) => void,
  setup?: (canvas: HTMLCanvasElement) => () => void,
  deps: DependencyList = [],
) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const setupRef = useRef(setup);

  useEffect(() => {
    drawRef.current = draw;
    setupRef.current = setup;
  });

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf: number;
    let last = 0;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const cleanupSetup = setupRef.current?.(canvas);

    const loop = (ts: number) => {
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;
      drawRef.current(ctx, canvas.width, canvas.height, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      cleanupSetup?.();
    };
  }, deps);
  return ref;
}

// ─── 底层渐变（慢速色相循环，不受主题色影响）────────────────────────────────
export function BaseGradientEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const t = useRef(0);

  const ref = useCanvas((ctx, w, h, dt) => {
    const isDark = theme === 'dark';
    t.current += dt * 0.035;
    const primaryHsl = hexToHsl(primaryColor);
    const accentHsl = hexToHsl(accentColor);

    // 三个慢速漂移的径向光源，色相各自独立循环
    const h1 = (primaryHsl.h + t.current * 18) % 360;
    const h2 = (accentHsl.h + t.current * 12) % 360;
    const h3 = (primaryHsl.h + 150 + t.current * 9) % 360;

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

function drawMountainRange(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  options: { baseY: number; amp: number; hue: number; lightness: number; alpha: number; speed: number; detail?: number },
) {
  const { baseY, amp, hue, lightness, alpha, speed, detail = 4 } = options;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 10) {
    const nx = x / w;
    const y = h * baseY
      + Math.sin(nx * Math.PI * detail + t * speed * 2.8) * amp
      + Math.cos(nx * Math.PI * (detail + 2.5) + t * speed * 1.6) * amp * 0.42
      + Math.sin(nx * Math.PI * (detail * 1.9) - t * speed * 1.2) * amp * 0.18;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = `hsla(${hue},24%,${lightness}%,${alpha})`;
  ctx.fill();
}

function drawBambooLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  angle: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(length * 0.18, -length * 0.18, length, 0);
  ctx.quadraticCurveTo(length * 0.18, length * 0.18, 0, 0);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// ─── 1. 粒子星河 ── 紫蓝星空 ────────────────────────────────────────────────
export function ParticleGalaxyEffect() {
  const { theme, primaryColor } = useTheme();
  const state = useRef({
    particles: [] as { x: number; y: number; vx: number; vy: number; size: number; alpha: number; trail: { x: number; y: number }[] }[],
    mouse: { x: -9999, y: -9999 },
  });

  const ref = useCanvas(
    (ctx, w, h) => {
      const color = hexToRgb(primaryColor) || { r: 110, g: 100, b: 255 };
      const { r, g, b } = color;
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
  const { theme, primaryColor } = useTheme();
  const ripples = useRef<{ x: number; y: number; r: number; alpha: number }[]>([]);
  const t = useRef(0);
  const lastMoveRipple = useRef(0);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const color = hexToRgb(primaryColor) || { r: 0, g: 195, b: 228 };
      const { r, g, b } = color;
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
  const { theme, primaryColor, accentColor } = useTheme();
  const flashes = useRef<{ x: number; t: number; alpha: number }[]>([]);
  const mouse = useRef({ x: -9999, y: -9999 });
  const time = useRef(0);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      time.current += dt * .4;
      const primaryHsl = hexToHsl(primaryColor);
      const accentHsl = hexToHsl(accentColor);
      const bands = [
        { hue: primaryHsl.h, yRatio: .22, amp: .12, freq: .80, alpha: .58 },
        { hue: (primaryHsl.h + 28) % 360, yRatio: .37, amp: .10, freq: 1.10, alpha: .42 },
        { hue: accentHsl.h, yRatio: .52, amp: .08, freq: 1.40, alpha: .36 },
        { hue: (accentHsl.h + 32) % 360, yRatio: .65, amp: .07, freq: .90, alpha: .26 },
      ];

      ctx.fillStyle = isDark ? 'rgba(6,6,15,.88)' : 'rgba(240,241,252,.88)';
      ctx.fillRect(0, 0, w, h);

      for (const band of bands) {
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
  const { theme, primaryColor } = useTheme();
  const petals = useRef<{ x: number; y: number; vx: number; vy: number; rot: number; vr: number; size: number; alpha: number; burst: boolean }[]>([]);
  const mouse = useRef({ x: -9999, y: -9999 });
  const initialized = useRef(false);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const rgb = hexToRgb(hslToHex(hexToHsl(primaryColor).h, 82, 72)) || { r: 255, g: 132, b: 165 };
      const { r, g, b } = rgb;
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
        const width = p.size;
        const height = p.size * 1.25;
        const edgeR = Math.min(255, Math.round(r + 22));
        const edgeG = Math.min(255, Math.round(g + 10));
        const edgeB = Math.min(255, Math.round(b + 18));

        ctx.beginPath();
        ctx.moveTo(0, -height * 0.55);
        ctx.bezierCurveTo(width * 0.6, -height * 0.3, width * 0.62, height * 0.18, 0, height * 0.52);
        ctx.bezierCurveTo(-width * 0.62, height * 0.18, -width * 0.6, -height * 0.3, 0, -height * 0.55);
        ctx.closePath();

        const grd = ctx.createLinearGradient(0, -height * 0.55, 0, height * 0.52);
        grd.addColorStop(0, `rgba(255,248,250,${p.alpha * 0.96})`);
        grd.addColorStop(0.35, `rgba(${edgeR},${edgeG},${edgeB},${p.alpha * 0.92})`);
        grd.addColorStop(1, `rgba(${r},${g},${b},${p.alpha * 0.72})`);
        ctx.fillStyle = grd;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, -height * 0.38);
        ctx.quadraticCurveTo(width * 0.08, -height * 0.02, 0, height * 0.3);
        ctx.quadraticCurveTo(-width * 0.08, -height * 0.02, 0, -height * 0.38);
        ctx.closePath();
        ctx.fillStyle = `rgba(255,255,255,${p.alpha * 0.24})`;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(-width * 0.1, height * 0.48);
        ctx.quadraticCurveTo(0, height * 0.34, width * 0.1, height * 0.48);
        ctx.lineWidth = Math.max(0.8, width * 0.06);
        ctx.strokeStyle = `rgba(${Math.max(120, r - 55)},${Math.max(90, g - 45)},${Math.max(100, b - 40)},${p.alpha * 0.45})`;
        ctx.stroke();
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
  const { theme, accentColor } = useTheme();
  const stars = useRef<{ x: number; y: number; size: number; twinkle: number; tp: number }[]>([]);
  const rings = useRef<{ x: number; y: number; r: number; alpha: number }[]>([]);
  const mouse = useRef({ x: -9999, y: -9999 });
  const initialized = useRef(false);
  const LINK_DIST = 110;

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const color = hexToRgb(accentColor) || { r: 185, g: 205, b: 255 };
      const { r, g, b } = color;
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

// ─── 8. 千里江山图 ──────────────────────────────────────────────────────────
// 多层视差青绿山峦（石青/石绿/赭石矿物色）+ 流云穿峰 + 江水倒影 + 涟漪
// + 孔明灯 + 落英 + 鎏金粒子 + 飞雁 V 字 + 朱砂印章 + 鼠标拨云 + 点击水墨
export function MountainParallaxEffect() {
  const { theme, primaryColor } = useTheme();
  const t = useRef(0);
  const initialized = useRef(false);
  const clouds = useRef<{ x: number; y: number; vx: number; w: number; alpha: number }[]>([]);
  const ripples = useRef<{ x: number; y: number; r: number; alpha: number }[]>([]);
  const lanterns = useRef<{ x: number; y: number; vy: number; vx: number; size: number; flicker: number }[]>([]);
  const petals = useRef<{ x: number; y: number; vy: number; vx: number; rot: number; vr: number; size: number; phase: number }[]>([]);
  const gold = useRef<{ x: number; y: number; vy: number; size: number; tw: number; tp: number }[]>([]);
  const geese = useRef<{ x: number; y: number; vx: number; count: number; flap: number }[]>([]);
  const seals = useRef<{ nx: number; ny: number; size: number; t: number; phase: number; text: string }[]>([]);
  const mouse = useRef({ x: -9999, y: -9999 });

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      t.current += dt;
      const pHsl = hexToHsl(primaryColor);

      // ── 一次性初始化 ──
      if (!initialized.current) {
        initialized.current = true;
        for (let i = 0; i < 7; i++) {
          clouds.current.push({
            x: Math.random() * w,
            y: 0.20 * h + Math.random() * 0.36 * h,
            vx: 6 + Math.random() * 12,
            w: 180 + Math.random() * 260,
            alpha: 0.14 + Math.random() * 0.18,
          });
        }
        for (let i = 0; i < 5; i++) {
          lanterns.current.push({
            x: Math.random() * w,
            y: 0.40 * h + Math.random() * 0.42 * h,
            vy: -3 - Math.random() * 4,
            vx: (Math.random() - 0.5) * 6,
            size: 5 + Math.random() * 4,
            flicker: Math.random() * Math.PI * 2,
          });
        }
        for (let i = 0; i < 36; i++) {
          petals.current.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vy: 14 + Math.random() * 20,
            vx: (Math.random() - 0.5) * 12,
            rot: Math.random() * Math.PI * 2,
            vr: (Math.random() - 0.5) * 2,
            size: 4 + Math.random() * 5,
            phase: Math.random() * Math.PI * 2,
          });
        }
        for (let i = 0; i < 70; i++) {
          gold.current.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vy: 3 + Math.random() * 7,
            size: 0.6 + Math.random() * 1.6,
            tw: Math.random() * Math.PI * 2,
            tp: 1.2 + Math.random() * 2.2,
          });
        }
        geese.current.push({ x: -200, y: 0.13 * h, vx: 28, count: 6, flap: 0 });
        const sealTexts = ['江', '山', '千', '里', '云', '岚', '溪', '远'];
        for (let i = 0; i < 4; i++) {
          seals.current.push({
            nx: 0.08 + Math.random() * 0.84,
            ny: 0.62 + Math.random() * 0.28,
            size: 28 + Math.random() * 18,
            t: Math.random() * 10,
            phase: Math.random() * Math.PI * 2,
            text: sealTexts[Math.floor(Math.random() * sealTexts.length)],
          });
        }
      }

      // ── 天空: 半透明覆盖 ──
      ctx.fillStyle = isDark ? 'rgba(8,16,24,.78)' : 'rgba(232,238,228,.74)';
      ctx.fillRect(0, 0, w, h);

      // 远空朝霞 / 月色渐变
      const skyG = ctx.createLinearGradient(0, 0, 0, h * 0.72);
      if (isDark) {
        skyG.addColorStop(0, 'rgba(20,28,52,0.55)');
        skyG.addColorStop(1, 'rgba(60,80,90,0)');
      } else {
        skyG.addColorStop(0, 'rgba(220,230,210,0.6)');
        skyG.addColorStop(1, 'rgba(240,240,230,0)');
      }
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, w, h * 0.72);

      // 日/月轮
      const moonX = w * (0.74 + Math.sin(t.current * 0.05) * 0.015);
      const moonY = h * 0.17;
      const moonR = 90;
      const moon = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moonR);
      if (isDark) {
        moon.addColorStop(0, 'rgba(248,232,200,0.55)');
        moon.addColorStop(0.35, 'rgba(248,232,200,0.16)');
      } else {
        moon.addColorStop(0, 'rgba(255,242,210,0.62)');
        moon.addColorStop(0.4, 'rgba(255,210,170,0.20)');
      }
      moon.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = moon;
      ctx.beginPath(); ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2); ctx.fill();

      // ── 多层山峦 ──
      const drawMountain = (
        baseY: number, amp: number, freq: number, speed: number,
        fillTop: string, fillBottom: string, ridgeColor?: string,
      ) => {
        const grad = ctx.createLinearGradient(0, baseY * h - amp * 2, 0, h);
        grad.addColorStop(0, fillTop);
        grad.addColorStop(1, fillBottom);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, h);
        const pts: { x: number; y: number }[] = [];
        for (let x = 0; x <= w; x += 8) {
          const nx = x / w;
          const y = baseY * h
            + Math.sin(nx * freq + t.current * speed) * amp
            + Math.cos(nx * freq * 2.3 + t.current * speed * 0.7) * amp * 0.55
            + Math.sin(nx * freq * 4.7 + t.current * speed * 0.3) * amp * 0.25;
          pts.push({ x, y });
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();

        if (ridgeColor) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.strokeStyle = ridgeColor;
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }
        return pts;
      };

      // 远山 (赭石冷调)
      drawMountain(
        0.44, 18, Math.PI * 2.6, 0.18,
        isDark ? 'hsla(210,30%,32%,0.55)' : 'hsla(200,30%,72%,0.55)',
        isDark ? 'hsla(220,40%,20%,0.85)' : 'hsla(210,30%,80%,0.85)',
      );
      // 远山 2 (浅石青)
      drawMountain(
        0.53, 26, Math.PI * 3.2, 0.22,
        isDark ? 'hsla(190,55%,28%,0.78)' : 'hsla(185,55%,66%,0.72)',
        isDark ? 'hsla(195,65%,16%,0.95)' : 'hsla(190,50%,70%,0.94)',
        isDark ? 'rgba(220,200,150,0.20)' : 'rgba(180,140,80,0.20)',
      );
      // 中山 (石绿)
      drawMountain(
        0.62, 32, Math.PI * 3.8, 0.27,
        isDark ? 'hsla(155,60%,26%,0.92)' : 'hsla(150,58%,58%,0.85)',
        isDark ? 'hsla(160,70%,14%,1)' : 'hsla(155,52%,50%,1)',
        isDark ? 'rgba(220,190,130,0.36)' : 'rgba(160,120,60,0.30)',
      );

      // ── 流云带（鼠标可拨动）──
      for (const c of clouds.current) {
        c.x += c.vx * dt;
        const dx = c.x - mouse.current.x;
        const dy = c.y - mouse.current.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 220 && dist > 0.01) {
          c.x += (dx / dist) * 40 * dt;
          c.y += (dy / dist) * 22 * dt;
        }
        if (c.x - c.w > w) c.x = -c.w;
        const cg = ctx.createLinearGradient(c.x, c.y - 20, c.x, c.y + 20);
        cg.addColorStop(0, `rgba(255,255,255,${isDark ? c.alpha * 0.65 : c.alpha})`);
        cg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, c.w, 16, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── 近山 (石青/石绿 + 金线山脊) ──
      drawMountain(
        0.74, 40, Math.PI * 4.4, 0.34,
        isDark ? 'hsla(180,75%,20%,0.98)' : 'hsla(170,62%,46%,0.94)',
        isDark ? 'hsla(190,82%,9%,1)' : 'hsla(175,58%,36%,1)',
        isDark ? 'rgba(248,212,130,0.6)' : 'rgba(180,130,40,0.48)',
      );

      // ── 江水反射区 ──
      const waterTop = 0.83 * h;
      const water = ctx.createLinearGradient(0, waterTop, 0, h);
      water.addColorStop(0, isDark ? 'rgba(10,30,50,0.5)' : 'rgba(170,210,220,0.5)');
      water.addColorStop(1, isDark ? 'rgba(4,12,24,0.95)' : 'rgba(220,230,232,0.94)');
      ctx.fillStyle = water; ctx.fillRect(0, waterTop, w, h - waterTop);

      // 江面横向波纹
      for (let yy = waterTop; yy < h; yy += 4) {
        const off = Math.sin((yy - waterTop) * 0.08 + t.current * 1.4) * 0.6;
        ctx.fillStyle = `rgba(255,255,255,${0.018 + 0.024 * off})`;
        ctx.fillRect(0, yy, w, 1);
      }
      // 月光倒影柱
      const reflG = ctx.createLinearGradient(moonX, waterTop, moonX, h);
      reflG.addColorStop(0, isDark ? 'rgba(248,232,200,0.18)' : 'rgba(255,232,200,0.16)');
      reflG.addColorStop(1, 'rgba(255,232,200,0)');
      ctx.fillStyle = reflG;
      ctx.fillRect(moonX - 50, waterTop, 100, h - waterTop);

      // 涟漪
      for (let i = ripples.current.length - 1; i >= 0; i--) {
        const r = ripples.current[i];
        r.r += 28 * dt; r.alpha -= 0.55 * dt;
        if (r.alpha <= 0) { ripples.current.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, r.r, r.r * 0.32, 0, 0, Math.PI * 2);
        ctx.strokeStyle = isDark
          ? `rgba(180,220,240,${r.alpha * 0.55})`
          : `rgba(120,160,200,${r.alpha * 0.55})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // ── 孔明灯 ──
      for (const l of lanterns.current) {
        l.y += l.vy * dt; l.x += l.vx * dt; l.flicker += dt * 3;
        if (l.y < -30) {
          l.y = h - 60 + Math.random() * 40;
          l.x = Math.random() * w;
        }
        const glow = 0.7 + Math.sin(l.flicker) * 0.2;
        const grd = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.size * 6.5);
        grd.addColorStop(0, `rgba(255,180,80,${0.75 * glow})`);
        grd.addColorStop(0.5, `rgba(255,130,50,${0.22 * glow})`);
        grd.addColorStop(1, 'rgba(255,100,30,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(l.x, l.y, l.size * 6.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,165,75,${0.92 * glow})`;
        ctx.beginPath(); ctx.ellipse(l.x, l.y, l.size * 0.65, l.size * 0.95, 0, 0, Math.PI * 2); ctx.fill();
        // 灯绳
        ctx.strokeStyle = `rgba(140,80,40,${0.6 * glow})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(l.x, l.y + l.size * 0.95); ctx.lineTo(l.x, l.y + l.size * 1.6); ctx.stroke();
      }

      // ── 飞雁 V 字 ──
      for (let i = geese.current.length - 1; i >= 0; i--) {
        const g = geese.current[i];
        g.x += g.vx * dt; g.flap += dt * 6;
        if (g.x > w + 200) { geese.current.splice(i, 1); continue; }
        for (let k = 0; k < g.count; k++) {
          const side = k === 0 ? 0 : (k % 2 === 0 ? 1 : -1);
          const rank = Math.ceil(k / 2);
          const gx = g.x - rank * 20 * (side >= 0 ? 1 : 1);
          const gy = g.y + rank * 11;
          const xOff = side * rank * 18;
          const wing = Math.sin(g.flap + k * 0.6) * 4;
          ctx.strokeStyle = isDark ? 'rgba(225,225,235,0.6)' : 'rgba(60,60,80,0.6)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(gx + xOff - 6, gy + wing);
          ctx.lineTo(gx + xOff, gy);
          ctx.lineTo(gx + xOff + 6, gy + wing);
          ctx.stroke();
        }
      }
      if (Math.random() < 0.0012) {
        geese.current.push({
          x: -100, y: 0.10 * h + Math.random() * 0.16 * h,
          vx: 22 + Math.random() * 14,
          count: 5 + Math.floor(Math.random() * 4),
          flap: 0,
        });
      }

      // ── 落英缤纷 ──
      for (const p of petals.current) {
        p.y += p.vy * dt;
        p.x += p.vx * dt + Math.sin(p.phase + p.y * 0.01) * 14 * dt;
        p.rot += p.vr * dt;
        if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
        if (p.x > w + 10) p.x = -10;
        if (p.x < -10) p.x = w + 10;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = isDark ? 'rgba(255,200,210,0.80)' : 'rgba(240,170,180,0.85)';
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── 鎏金粒子 ──
      for (const f of gold.current) {
        f.y += f.vy * dt; f.tw += dt * f.tp;
        if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
        const a = 0.35 + (Math.sin(f.tw) + 1) * 0.34;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
        ctx.fillStyle = isDark
          ? `rgba(255,210,120,${a})`
          : `rgba(200,160,60,${a * 0.78})`;
        ctx.fill();
        if (f.size > 1.2) {
          const gg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.size * 4);
          gg.addColorStop(0, `rgba(255,220,140,${a * 0.45})`);
          gg.addColorStop(1, 'rgba(255,200,100,0)');
          ctx.fillStyle = gg;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.size * 4, 0, Math.PI * 2); ctx.fill();
        }
      }

      // ── 朱砂印章 (淡入淡出循环) ──
      for (const s of seals.current) {
        s.t += dt;
        const pulse = (Math.sin(s.t * 0.4 + s.phase) + 1) / 2;
        const a = Math.max(0, pulse - 0.55) * 0.7;
        if (a < 0.01) continue;
        const sx = w * s.nx, sy = h * s.ny;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.fillStyle = `rgba(186,38,38,${a})`;
        ctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size);
        ctx.strokeStyle = `rgba(255,235,225,${a * 0.7})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(-s.size / 2 + 3, -s.size / 2 + 3, s.size - 6, s.size - 6);
        ctx.fillStyle = `rgba(255,235,225,${a})`;
        ctx.font = `bold ${s.size * 0.6}px "Songti SC","STSong","SimSun",serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.text, 0, 2);
        ctx.restore();
      }

      // suppress unused-var warning for primaryHsl (color hooks into future tinting)
      void pHsl;
    },
    (canvas) => {
      const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
      const onLeave = () => { mouse.current = { x: -9999, y: -9999 }; };
      const onClick = (e: MouseEvent) => {
        const wy = window.innerHeight * 0.84;
        const y = Math.max(e.clientY, wy);
        ripples.current.push({ x: e.clientX, y, r: 6, alpha: 1 });
        ripples.current.push({ x: e.clientX, y, r: 14, alpha: 0.7 });
        for (let i = 0; i < 14; i++) {
          petals.current.push({
            x: e.clientX, y: e.clientY,
            vy: 30 + Math.random() * 40,
            vx: (Math.random() - 0.5) * 90,
            rot: Math.random() * Math.PI * 2,
            vr: (Math.random() - 0.5) * 5,
            size: 4 + Math.random() * 5,
            phase: Math.random() * Math.PI * 2,
          });
        }
        if (petals.current.length > 80) petals.current.splice(0, petals.current.length - 80);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseleave', onLeave);
      canvas.addEventListener('click', onClick);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseleave', onLeave);
        canvas.removeEventListener('click', onClick);
      };
    },
  );

  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 10. 金箔微光 ───────────────────────────────────────────────────────────
export function GoldFlakesEffect() {
  const { theme, primaryColor } = useTheme();
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
    const flakeColor = hexToRgb(hslToHex(hexToHsl(primaryColor).h, 72, 62)) || { r: 255, g: 214, b: 120 };
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
        ? `rgba(${flakeColor.r},${flakeColor.g},${flakeColor.b},${alpha})`
        : `rgba(${flakeColor.r},${flakeColor.g},${flakeColor.b},${alpha * 0.78})`;
      ctx.fill();
    }
  });

  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 11. 墨韵晕染 ──────────────────────────────────────────────────────────
export function InkWashBloomEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const pools = useRef<{ x: number; y: number; r: number; dx: number; dy: number; alpha: number; pulse: number }[]>([]);
  const blooms = useRef<{ x: number; y: number; r: number; alpha: number }[]>([]);
  const mouse = useRef({ x: -9999, y: -9999 });
  const t = useRef(0);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      const ink = hexToRgb(primaryColor) || { r: 92, g: 110, b: 130 };
      const accent = hexToRgb(accentColor) || { r: 194, g: 204, b: 215 };
      t.current += dt;

      if (pools.current.length === 0) {
        for (let i = 0; i < 9; i++) {
          pools.current.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: 90 + Math.random() * 150,
            dx: (Math.random() - 0.5) * 10,
            dy: (Math.random() - 0.5) * 6,
            alpha: 0.08 + Math.random() * 0.08,
            pulse: Math.random() * Math.PI * 2,
          });
        }
      }

      ctx.fillStyle = isDark ? 'rgba(10,12,16,.82)' : 'rgba(244,241,234,.82)';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < 3; i++) {
        const bandY = h * (0.22 + i * 0.2) + Math.sin(t.current * (0.22 + i * 0.08)) * 18;
        const band = ctx.createLinearGradient(0, bandY - 80, 0, bandY + 80);
        band.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},0)`);
        band.addColorStop(0.45, `rgba(${accent.r},${accent.g},${accent.b},${isDark ? 0.03 : 0.045})`);
        band.addColorStop(1, `rgba(${accent.r},${accent.g},${accent.b},0)`);
        ctx.fillStyle = band;
        ctx.fillRect(0, bandY - 80, w, 160);
      }

      for (const pool of pools.current) {
        pool.x += pool.dx * dt;
        pool.y += pool.dy * dt;
        pool.pulse += dt * 0.4;
        if (pool.x < -pool.r) pool.x = w + pool.r;
        if (pool.x > w + pool.r) pool.x = -pool.r;
        if (pool.y < -pool.r) pool.y = h + pool.r;
        if (pool.y > h + pool.r) pool.y = -pool.r;

        const radius = pool.r * (0.9 + Math.sin(pool.pulse) * 0.08);
        const grad = ctx.createRadialGradient(pool.x, pool.y, radius * 0.08, pool.x, pool.y, radius);
        grad.addColorStop(0, `rgba(${ink.r},${ink.g},${ink.b},${pool.alpha * 1.6})`);
        grad.addColorStop(0.55, `rgba(${ink.r},${ink.g},${ink.b},${pool.alpha})`);
        grad.addColorStop(0.82, `rgba(${accent.r},${accent.g},${accent.b},${pool.alpha * 0.45})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(pool.x, pool.y, radius, radius * (0.78 + Math.sin(pool.pulse * 1.5) * 0.06), Math.sin(pool.pulse) * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      if (mouse.current.x > 0) {
        const cursorWash = ctx.createRadialGradient(mouse.current.x, mouse.current.y, 0, mouse.current.x, mouse.current.y, 120);
        cursorWash.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},${isDark ? 0.10 : 0.08})`);
        cursorWash.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cursorWash;
        ctx.fillRect(0, 0, w, h);
      }

      for (let i = blooms.current.length - 1; i >= 0; i--) {
        const bloom = blooms.current[i];
        bloom.r += 90 * dt;
        bloom.alpha -= 0.35 * dt;
        if (bloom.alpha <= 0) {
          blooms.current.splice(i, 1);
          continue;
        }
        const bloomGrad = ctx.createRadialGradient(bloom.x, bloom.y, bloom.r * 0.12, bloom.x, bloom.y, bloom.r);
        bloomGrad.addColorStop(0, `rgba(${ink.r},${ink.g},${ink.b},${bloom.alpha * 0.75})`);
        bloomGrad.addColorStop(0.72, `rgba(${accent.r},${accent.g},${accent.b},${bloom.alpha * 0.18})`);
        bloomGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bloomGrad;
        ctx.beginPath();
        ctx.arc(bloom.x, bloom.y, bloom.r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    (canvas) => {
      const onMove = (e: MouseEvent) => {
        mouse.current = { x: e.clientX, y: e.clientY };
      };
      const onClick = (e: MouseEvent) => {
        blooms.current.push({ x: e.clientX, y: e.clientY, r: 18, alpha: 0.8 });
      };
      window.addEventListener('mousemove', onMove);
      canvas.addEventListener('click', onClick);
      return () => {
        window.removeEventListener('mousemove', onMove);
        canvas.removeEventListener('click', onClick);
      };
    },
  );

  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 12. 飞白墨痕 ──────────────────────────────────────────────────────────
export function InkBrushTraceEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const strokes = useRef<{ x: number; y: number; vx: number; vy: number; len: number; width: number; alpha: number; wobble: number; tilt: number }[]>([]);
  const splats = useRef<{ x: number; y: number; r: number; alpha: number; grow: number }[]>([]);
  const lastTrace = useRef(0);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      const ink = hexToRgb(primaryColor) || { r: 74, g: 86, b: 99 };
      const accent = hexToRgb(accentColor) || { r: 180, g: 102, b: 88 };

      if (strokes.current.length === 0) {
        for (let i = 0; i < 14; i++) {
          strokes.current.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: 18 + Math.random() * 32,
            vy: (Math.random() - 0.5) * 10,
            len: 90 + Math.random() * 120,
            width: 10 + Math.random() * 18,
            alpha: 0.08 + Math.random() * 0.08,
            wobble: Math.random() * Math.PI * 2,
            tilt: (Math.random() - 0.5) * 0.35,
          });
        }
      }

      ctx.fillStyle = isDark ? 'rgba(12,10,14,.84)' : 'rgba(243,239,232,.84)';
      ctx.fillRect(0, 0, w, h);

      for (const stroke of strokes.current) {
        stroke.x += stroke.vx * dt;
        stroke.y += stroke.vy * dt;
        stroke.wobble += dt * 0.8;
        if (stroke.x - stroke.len > w + 60) {
          stroke.x = -stroke.len;
          stroke.y = Math.random() * h;
        }

        const yDrift = Math.sin(stroke.wobble) * 18;
        const endX = stroke.x + stroke.len;
        const endY = stroke.y + yDrift;
        const ctrlX = stroke.x + stroke.len * 0.52;
        const ctrlY = stroke.y - 28 + Math.cos(stroke.wobble * 1.3) * 22;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = `rgba(${ink.r},${ink.g},${ink.b},${stroke.alpha})`;
        ctx.lineWidth = stroke.width;
        ctx.beginPath();
        ctx.moveTo(stroke.x, stroke.y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
        ctx.stroke();

        for (let i = -1; i <= 1; i++) {
          ctx.strokeStyle = `rgba(${accent.r},${accent.g},${accent.b},${stroke.alpha * 0.18})`;
          ctx.lineWidth = Math.max(1.2, stroke.width * 0.12);
          ctx.beginPath();
          ctx.moveTo(stroke.x + i * 2.5, stroke.y - i * 1.6);
          ctx.quadraticCurveTo(ctrlX, ctrlY + i * 6, endX - i * 5, endY + i * 3);
          ctx.stroke();
        }
        ctx.restore();
      }

      for (let i = splats.current.length - 1; i >= 0; i--) {
        const splat = splats.current[i];
        splat.r += splat.grow * dt;
        splat.alpha -= 0.42 * dt;
        if (splat.alpha <= 0) {
          splats.current.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(splat.x, splat.y, splat.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ink.r},${ink.g},${ink.b},${splat.alpha * 0.7})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(splat.x + splat.r * 0.65, splat.y - splat.r * 0.3, splat.r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${splat.alpha * 0.28})`;
        ctx.fill();
      }
    },
    (canvas) => {
      const onMove = (e: MouseEvent) => {
        const now = Date.now();
        if (now - lastTrace.current < 120) return;
        lastTrace.current = now;
        splats.current.push({ x: e.clientX, y: e.clientY, r: 3, alpha: 0.55, grow: 10 + Math.random() * 14 });
      };
      const onClick = (e: MouseEvent) => {
        for (let i = 0; i < 12; i++) {
          splats.current.push({
            x: e.clientX + (Math.random() - 0.5) * 36,
            y: e.clientY + (Math.random() - 0.5) * 24,
            r: 2 + Math.random() * 5,
            alpha: 0.75,
            grow: 18 + Math.random() * 24,
          });
        }
      };
      window.addEventListener('mousemove', onMove);
      canvas.addEventListener('click', onClick);
      return () => {
        window.removeEventListener('mousemove', onMove);
        canvas.removeEventListener('click', onClick);
      };
    },
  );

  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 13. 云岭叠嶂 ──────────────────────────────────────────────────────────
export function MistyPeaksEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const t = useRef(0);

  const ref = useCanvas((ctx, w, h, dt) => {
    const isDark = theme === 'dark';
    const primary = hexToHsl(primaryColor);
    const accent = hexToRgb(accentColor) || { r: 209, g: 181, b: 124 };
    t.current += dt * 0.12;

    ctx.fillStyle = isDark ? 'rgba(7,11,12,.82)' : 'rgba(241,244,239,.82)';
    ctx.fillRect(0, 0, w, h);

    const sun = ctx.createRadialGradient(w * 0.76, h * 0.22, 0, w * 0.76, h * 0.22, w * 0.24);
    sun.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},${isDark ? 0.24 : 0.18})`);
    sun.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);

    drawMountainRange(ctx, w, h, t.current, { baseY: 0.83, amp: 22, hue: primary.h, lightness: isDark ? 42 : 66, alpha: isDark ? 0.24 : 0.16, speed: 0.42, detail: 4 });
    drawMountainRange(ctx, w, h, t.current + 0.6, { baseY: 0.72, amp: 34, hue: (primary.h + 10) % 360, lightness: isDark ? 36 : 60, alpha: isDark ? 0.18 : 0.13, speed: 0.28, detail: 5 });
    drawMountainRange(ctx, w, h, t.current + 1.1, { baseY: 0.60, amp: 40, hue: (primary.h + 18) % 360, lightness: isDark ? 31 : 54, alpha: isDark ? 0.14 : 0.10, speed: 0.18, detail: 6 });
    drawMountainRange(ctx, w, h, t.current + 1.8, { baseY: 0.48, amp: 28, hue: (primary.h + 26) % 360, lightness: isDark ? 27 : 48, alpha: isDark ? 0.09 : 0.07, speed: 0.10, detail: 7 });

    for (let i = 0; i < 5; i++) {
      const y = h * (0.30 + i * 0.12) + Math.sin(t.current * (0.6 + i * 0.08) + i) * 16;
      const grad = ctx.createLinearGradient(0, y, 0, y + 46);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, `rgba(255,255,255,${isDark ? 0.045 : 0.08})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - 10, w, 70);
    }

    ctx.strokeStyle = isDark ? 'rgba(230,232,240,0.18)' : 'rgba(102,116,130,0.16)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      const bx = w * (0.2 + i * 0.16) + Math.sin(t.current * 0.7 + i) * 24;
      const by = h * (0.28 + (i % 2) * 0.05);
      ctx.beginPath();
      ctx.moveTo(bx - 7, by);
      ctx.lineTo(bx, by - 4);
      ctx.lineTo(bx + 7, by);
      ctx.stroke();
    }
  });

  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 14. 江山渔火 ──────────────────────────────────────────────────────────
export function RiverLanternEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const lanterns = useRef<{ x: number; y: number; size: number; vy: number; phase: number; alpha: number }[]>([]);
  const t = useRef(0);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      const primary = hexToHsl(primaryColor);
      const accent = hexToRgb(accentColor) || { r: 242, g: 194, b: 107 };
      t.current += dt * 0.16;

      if (lanterns.current.length === 0) {
        for (let i = 0; i < 14; i++) {
          lanterns.current.push({
            x: Math.random() * w,
            y: h * (0.62 + Math.random() * 0.24),
            size: 4 + Math.random() * 6,
            vy: 1 + Math.random() * 4,
            phase: Math.random() * Math.PI * 2,
            alpha: 0.35 + Math.random() * 0.35,
          });
        }
      }

      ctx.fillStyle = isDark ? 'rgba(7,11,12,.84)' : 'rgba(237,244,243,.84)';
      ctx.fillRect(0, 0, w, h);

      const skyGlow = ctx.createRadialGradient(w * 0.72, h * 0.20, 0, w * 0.72, h * 0.20, w * 0.22);
      skyGlow.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},${isDark ? 0.22 : 0.16})`);
      skyGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = skyGlow;
      ctx.fillRect(0, 0, w, h);

      drawMountainRange(ctx, w, h, t.current, { baseY: 0.62, amp: 34, hue: primary.h, lightness: isDark ? 32 : 54, alpha: isDark ? 0.18 : 0.12, speed: 0.22, detail: 5 });
      drawMountainRange(ctx, w, h, t.current + 0.8, { baseY: 0.52, amp: 26, hue: (primary.h + 12) % 360, lightness: isDark ? 26 : 48, alpha: isDark ? 0.12 : 0.08, speed: 0.12, detail: 6 });

      const river = ctx.createLinearGradient(0, h * 0.58, 0, h);
      river.addColorStop(0, isDark ? 'rgba(11,22,25,0.30)' : 'rgba(186,208,210,0.20)');
      river.addColorStop(1, isDark ? 'rgba(8,16,18,0.60)' : 'rgba(207,225,226,0.34)');
      ctx.fillStyle = river;
      ctx.fillRect(0, h * 0.58, w, h * 0.42);

      for (let i = 0; i < 8; i++) {
        const y = h * (0.62 + i * 0.045);
        ctx.beginPath();
        for (let x = 0; x <= w; x += 10) {
          const waveY = y + Math.sin(x * 0.012 + t.current * (1.2 + i * 0.08)) * (2 + i * 0.35);
          x === 0 ? ctx.moveTo(x, waveY) : ctx.lineTo(x, waveY);
        }
        ctx.strokeStyle = `rgba(${accent.r},${accent.g},${accent.b},${isDark ? 0.05 : 0.04})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (const lantern of lanterns.current) {
        lantern.phase += dt * 0.8;
        lantern.y += Math.sin(lantern.phase) * 2 * dt + lantern.vy * dt * 0.16;
        if (lantern.y > h * 0.9) lantern.y = h * 0.62;

        const glow = ctx.createRadialGradient(lantern.x, lantern.y, 0, lantern.x, lantern.y, lantern.size * 5);
        glow.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},${lantern.alpha})`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(lantern.x, lantern.y, lantern.size * 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${Math.min(0.95, lantern.alpha + 0.15)})`;
        ctx.fillRect(lantern.x - lantern.size * 0.5, lantern.y - lantern.size * 0.7, lantern.size, lantern.size * 1.4);

        ctx.beginPath();
        ctx.moveTo(lantern.x - lantern.size * 0.45, lantern.y + lantern.size * 1.6);
        ctx.lineTo(lantern.x - lantern.size * 0.15, lantern.y + lantern.size * 8);
        ctx.lineTo(lantern.x + lantern.size * 0.15, lantern.y + lantern.size * 8);
        ctx.lineTo(lantern.x + lantern.size * 0.45, lantern.y + lantern.size * 1.6);
        ctx.closePath();
        ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${lantern.alpha * 0.32})`;
        ctx.fill();
      }
    },
    (canvas) => {
      const onClick = (e: MouseEvent) => {
        lanterns.current.push({ x: e.clientX, y: e.clientY, size: 5 + Math.random() * 6, vy: 2 + Math.random() * 3, phase: Math.random() * Math.PI * 2, alpha: 0.75 });
        if (lanterns.current.length > 22) lanterns.current.shift();
      };
      canvas.addEventListener('click', onClick);
      return () => canvas.removeEventListener('click', onClick);
    },
  );

  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 15. 竹影摇风 ──────────────────────────────────────────────────────────
export function BambooBreezeEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const stalks = useRef<{ x: number; width: number; sway: number; height: number; alpha: number }[]>([]);
  const t = useRef(0);
  const mouse = useRef({ x: 0, y: 0 });

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      const primary = hexToRgb(primaryColor) || { r: 85, g: 122, b: 99 };
      const accent = hexToRgb(accentColor) || { r: 199, g: 223, b: 180 };
      t.current += dt * 0.7;

      if (stalks.current.length === 0) {
        for (let i = 0; i < 16; i++) {
          stalks.current.push({
            x: w * (i / 15) + (Math.random() - 0.5) * 24,
            width: 8 + Math.random() * 10,
            sway: Math.random() * Math.PI * 2,
            height: h * (0.55 + Math.random() * 0.32),
            alpha: 0.10 + Math.random() * 0.12,
          });
        }
      }

      ctx.fillStyle = isDark ? 'rgba(8,12,10,.84)' : 'rgba(239,246,239,.84)';
      ctx.fillRect(0, 0, w, h);

      const lightBeam = ctx.createRadialGradient(w * 0.78, h * 0.16, 0, w * 0.78, h * 0.16, w * 0.30);
      lightBeam.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},${isDark ? 0.16 : 0.12})`);
      lightBeam.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = lightBeam;
      ctx.fillRect(0, 0, w, h);

      for (const stalk of stalks.current) {
        const sway = Math.sin(t.current + stalk.sway + mouse.current.x / Math.max(1, w) * 1.4) * 12;
        const x = stalk.x + sway;
        const grad = ctx.createLinearGradient(x, h - stalk.height, x, h);
        grad.addColorStop(0, `rgba(${primary.r},${primary.g},${primary.b},${stalk.alpha * 0.8})`);
        grad.addColorStop(0.5, `rgba(${accent.r},${accent.g},${accent.b},${stalk.alpha})`);
        grad.addColorStop(1, `rgba(${primary.r},${primary.g},${primary.b},${stalk.alpha * 1.2})`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, h - stalk.height, stalk.width, stalk.height);

        for (let joint = 1; joint < 7; joint++) {
          const jy = h - stalk.height + (stalk.height / 7) * joint;
          ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${stalk.alpha * 0.55})`;
          ctx.fillRect(x - 1, jy, stalk.width + 2, 2);
        }

        for (let i = 0; i < 5; i++) {
          const leafY = h - stalk.height + stalk.height * (0.18 + i * 0.14);
          const leafAngle = Math.sin(t.current * 1.6 + stalk.sway + i) * 0.18;
          drawBambooLeaf(ctx, x + stalk.width * 0.5, leafY, 26 + i * 3, -0.7 + leafAngle, `rgba(${accent.r},${accent.g},${accent.b},${stalk.alpha * 1.1})`);
          drawBambooLeaf(ctx, x + stalk.width * 0.5, leafY + 5, 24 + i * 2, 0.45 + leafAngle, `rgba(${primary.r},${primary.g},${primary.b},${stalk.alpha * 1.15})`);
        }
      }
    },
    (canvas) => {
      const onMove = (e: MouseEvent) => {
        mouse.current = { x: e.clientX, y: e.clientY };
      };
      window.addEventListener('mousemove', onMove);
      return () => window.removeEventListener('mousemove', onMove);
    },
  );

  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 16. 雨竹清响 ──────────────────────────────────────────────────────────
export function BambooRainEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const drops = useRef(
    Array.from({ length: 120 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      len: 12 + Math.random() * 18,
      speed: 160 + Math.random() * 160,
    })),
  );
  const ripples = useRef<{ x: number; y: number; r: number; alpha: number }[]>([]);
  const t = useRef(0);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      const primary = hexToRgb(primaryColor) || { r: 63, g: 103, b: 86 };
      const accent = hexToRgb(accentColor) || { r: 169, g: 209, b: 191 };
      t.current += dt;

      ctx.fillStyle = isDark ? 'rgba(8,12,10,.88)' : 'rgba(238,245,241,.86)';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < 8; i++) {
        const x = w * (0.08 + i * 0.12) + Math.sin(t.current * (0.6 + i * 0.04)) * 8;
        const stalkHeight = h * (0.58 + (i % 3) * 0.08);
        ctx.fillStyle = `rgba(${primary.r},${primary.g},${primary.b},${isDark ? 0.18 : 0.14})`;
        ctx.fillRect(x, h - stalkHeight, 10, stalkHeight);
        for (let j = 0; j < 4; j++) {
          const ly = h - stalkHeight + stalkHeight * (0.2 + j * 0.18);
          drawBambooLeaf(ctx, x + 5, ly, 26, -0.85 + Math.sin(t.current * 1.3 + i + j) * 0.06, `rgba(${accent.r},${accent.g},${accent.b},${isDark ? 0.16 : 0.12})`);
          drawBambooLeaf(ctx, x + 5, ly + 4, 22, 0.55 + Math.cos(t.current * 1.2 + i + j) * 0.05, `rgba(${primary.r},${primary.g},${primary.b},${isDark ? 0.18 : 0.14})`);
        }
      }

      ctx.strokeStyle = `rgba(${accent.r},${accent.g},${accent.b},${isDark ? 0.24 : 0.18})`;
      ctx.lineWidth = 1.2;
      for (const drop of drops.current) {
        drop.x += -40 * dt;
        drop.y += drop.speed * dt;
        if (drop.y > h + 20 || drop.x < -20) {
          drop.x = Math.random() * w + 30;
          drop.y = -20;
        }
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x - 6, drop.y + drop.len);
        ctx.stroke();

        if (drop.y > h * 0.84 && Math.random() < 0.03) {
          ripples.current.push({ x: drop.x, y: h * 0.88 + Math.random() * 10, r: 2, alpha: 0.35 });
        }
      }

      const groundMist = ctx.createLinearGradient(0, h * 0.72, 0, h);
      groundMist.addColorStop(0, 'rgba(0,0,0,0)');
      groundMist.addColorStop(1, isDark ? 'rgba(12,22,18,0.24)' : 'rgba(205,223,215,0.18)');
      ctx.fillStyle = groundMist;
      ctx.fillRect(0, h * 0.72, w, h * 0.28);

      for (let i = ripples.current.length - 1; i >= 0; i--) {
        const ripple = ripples.current[i];
        ripple.r += 36 * dt;
        ripple.alpha -= 0.4 * dt;
        if (ripple.alpha <= 0) {
          ripples.current.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.ellipse(ripple.x, ripple.y, ripple.r * 1.8, ripple.r * 0.72, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${accent.r},${accent.g},${accent.b},${ripple.alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },
    (canvas) => {
      const onClick = (e: MouseEvent) => {
        ripples.current.push({ x: e.clientX, y: e.clientY, r: 4, alpha: 0.6 });
      };
      canvas.addEventListener('click', onClick);
      return () => canvas.removeEventListener('click', onClick);
    },
  );

  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 古风 1. 荷塘月色 ──────────────────────────────────────────────────────────
export function LotusPondEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const t = useRef(0);
  const petals = useRef<{ x: number; y: number; r: number; angle: number; phase: number; alpha: number }[]>([]);
  const ripples = useRef<{ x: number; y: number; rr: number; alpha: number }[]>([]);
  const mouse = useRef({ x: -9999, y: -9999 });

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      const pond = hexToRgb(primaryColor) || { r: 122, g: 158, b: 142 };
      const petal = hexToRgb(accentColor) || { r: 232, g: 196, b: 196 };
      t.current += dt * 0.5;

      if (petals.current.length === 0) {
        for (let i = 0; i < 12; i++) {
          petals.current.push({
            x: Math.random() * w,
            y: h * (0.38 + Math.random() * 0.50),
            r: 18 + Math.random() * 22,
            angle: Math.random() * Math.PI * 2,
            phase: Math.random() * Math.PI * 2,
            alpha: 0.18 + Math.random() * 0.20,
          });
        }
      }

      ctx.fillStyle = isDark ? 'rgba(9,17,16,.88)' : 'rgba(240,245,242,.88)';
      ctx.fillRect(0, 0, w, h);

      // 月光光晕
      const moonX = w * 0.72, moonY = h * 0.18;
      const moon = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, w * 0.26);
      moon.addColorStop(0, `rgba(230,240,220,${isDark ? 0.28 : 0.18})`);
      moon.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = moon;
      ctx.fillRect(0, 0, w, h);

      // 水面渐变
      const water = ctx.createLinearGradient(0, h * 0.38, 0, h);
      water.addColorStop(0, `rgba(${pond.r},${pond.g},${pond.b},${isDark ? 0.14 : 0.10})`);
      water.addColorStop(1, `rgba(${pond.r},${pond.g},${pond.b},${isDark ? 0.28 : 0.20})`);
      ctx.fillStyle = water;
      ctx.fillRect(0, h * 0.38, w, h * 0.62);

      // 水波纹
      for (let i = 0; i < 6; i++) {
        const wy = h * (0.45 + i * 0.08);
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const wv = wy + Math.sin(x * 0.008 + t.current * (0.7 + i * 0.05)) * (3 + i * 0.5);
          x === 0 ? ctx.moveTo(x, wv) : ctx.lineTo(x, wv);
        }
        ctx.strokeStyle = `rgba(${pond.r},${pond.g},${pond.b},${isDark ? 0.12 : 0.09})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 荷叶
      for (let i = 0; i < 8; i++) {
        const lx = w * (0.08 + i * 0.12) + Math.sin(t.current * 0.4 + i) * 10;
        const ly = h * (0.52 + (i % 3) * 0.08);
        const lr = 28 + (i % 3) * 12;
        ctx.beginPath();
        ctx.arc(lx, ly, lr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${pond.r - 10},${pond.g + 10},${pond.b - 20},${isDark ? 0.16 : 0.12})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${pond.r},${pond.g + 20},${pond.b},${isDark ? 0.10 : 0.07})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 莲花花瓣
      for (const p of petals.current) {
        p.phase += dt * 0.3;
        p.x += Math.sin(p.phase) * 0.3;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        grad.addColorStop(0, `rgba(255,240,240,${p.alpha * 1.2})`);
        grad.addColorStop(0.5, `rgba(${petal.r},${petal.g},${petal.b},${p.alpha})`);
        grad.addColorStop(1, `rgba(${petal.r},${petal.g},${petal.b},0)`);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r * 0.55, p.r, p.angle, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // 月亮倒影
      const refGrad = ctx.createRadialGradient(moonX, h * 0.72, 0, moonX, h * 0.72, 44);
      refGrad.addColorStop(0, `rgba(230,240,220,${isDark ? 0.14 : 0.08})`);
      refGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = refGrad;
      ctx.beginPath();
      ctx.ellipse(moonX, h * 0.72, 44, 14, 0, 0, Math.PI * 2);
      ctx.fill();

      // 点击涟漪
      for (let i = ripples.current.length - 1; i >= 0; i--) {
        const rp = ripples.current[i];
        rp.rr += 80 * dt; rp.alpha -= 0.5 * dt;
        if (rp.alpha <= 0) { ripples.current.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.ellipse(rp.x, rp.y, rp.rr * 1.8, rp.rr * 0.6, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${pond.r},${pond.g},${pond.b},${rp.alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },
    (canvas) => {
      const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
      const onClick = (e: MouseEvent) => ripples.current.push({ x: e.clientX, y: e.clientY, rr: 4, alpha: 0.65 });
      window.addEventListener('mousemove', onMove);
      canvas.addEventListener('click', onClick);
      return () => { window.removeEventListener('mousemove', onMove); canvas.removeEventListener('click', onClick); };
    },
  );
  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 古风 2. 宫灯霞光 ──────────────────────────────────────────────────────────
export function PalaceLanternEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const t = useRef(0);
  const sparks = useRef<{ x: number; y: number; vx: number; vy: number; alpha: number; size: number }[]>([]);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      const red = hexToRgb(primaryColor) || { r: 192, g: 57, b: 43 };
      const gold = hexToRgb(accentColor) || { r: 240, g: 192, b: 96 };
      t.current += dt * 0.6;

      ctx.fillStyle = isDark ? 'rgba(24,12,8,.90)' : 'rgba(253,240,236,.88)';
      ctx.fillRect(0, 0, w, h);

      // 暗夜天空渐变
      if (isDark) {
        const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
        sky.addColorStop(0, 'rgba(14,6,4,0.0)');
        sky.addColorStop(1, `rgba(${red.r * 0.3},${red.g * 0.1},${red.b * 0.1},0.18)`);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h * 0.55);
      }

      // 三盏宫灯
      const lanternDefs = [
        { cx: w * 0.22, cy: h * 0.22, ry: 46, rx: 28 },
        { cx: w * 0.50, cy: h * 0.15, ry: 58, rx: 35 },
        { cx: w * 0.78, cy: h * 0.25, ry: 44, rx: 27 },
      ];
      for (const [idx, ld] of lanternDefs.entries()) {
        const sway = Math.sin(t.current * 0.7 + idx * 1.2) * 8;
        const lx = ld.cx + sway;
        const ly = ld.cy;

        // 灯笼光晕
        const glowR = ld.ry * 4.5;
        const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, glowR);
        glow.addColorStop(0, `rgba(${gold.r},${gold.g},${gold.b},${isDark ? 0.28 : 0.16})`);
        glow.addColorStop(0.4, `rgba(${red.r},${red.g},${red.b},${isDark ? 0.10 : 0.06})`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        // 灯笼主体
        const body = ctx.createRadialGradient(lx - ld.rx * 0.3, ly - ld.ry * 0.2, 0, lx, ly, ld.rx * 1.2);
        body.addColorStop(0, `rgba(${gold.r},${gold.g},${gold.b * 0.6},${isDark ? 0.85 : 0.70})`);
        body.addColorStop(0.55, `rgba(${red.r},${red.g},${red.b},${isDark ? 0.80 : 0.65})`);
        body.addColorStop(1, `rgba(${red.r * 0.6},${red.g * 0.3},${red.b * 0.3},${isDark ? 0.50 : 0.38})`);
        ctx.beginPath();
        ctx.ellipse(lx, ly, ld.rx, ld.ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = body;
        ctx.fill();

        // 灯笼横条
        for (let ri = -2; ri <= 2; ri++) {
          const ry2 = ly + (ri / 2.5) * ld.ry;
          const rw = Math.sqrt(Math.max(0, 1 - (ri / 2.5) ** 2)) * ld.rx;
          ctx.beginPath();
          ctx.moveTo(lx - rw, ry2);
          ctx.lineTo(lx + rw, ry2);
          ctx.strokeStyle = `rgba(${gold.r},${gold.g},${gold.b},${isDark ? 0.22 : 0.16})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        // 吊绳
        ctx.beginPath();
        ctx.moveTo(lx, ly - ld.ry);
        ctx.lineTo(lx + sway * 0.3, ly - ld.ry - 36);
        ctx.strokeStyle = `rgba(${gold.r},${gold.g},${gold.b},${isDark ? 0.45 : 0.32})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // 流苏
        for (let fi = -2; fi <= 2; fi++) {
          const fx = lx + fi * 5;
          const fLen = 22 + Math.abs(fi) * 6 + Math.sin(t.current * 2 + fi) * 5;
          ctx.beginPath();
          ctx.moveTo(fx, ly + ld.ry);
          ctx.lineTo(fx + Math.sin(t.current * 1.5 + fi) * 4, ly + ld.ry + fLen);
          ctx.strokeStyle = `rgba(${gold.r},${gold.g},${gold.b},${isDark ? 0.55 : 0.38})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // 火花粒子
        if (Math.random() < 0.12) {
          sparks.current.push({ x: lx, y: ly - ld.ry, vx: (Math.random() - 0.5) * 22, vy: -18 - Math.random() * 20, alpha: 0.9, size: 1.5 + Math.random() * 1.5 });
        }
      }

      for (let i = sparks.current.length - 1; i >= 0; i--) {
        const sp = sparks.current[i];
        sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.vy += 22 * dt;
        sp.alpha -= 1.4 * dt;
        if (sp.alpha <= 0) { sparks.current.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${gold.r},${gold.g},${gold.b},${sp.alpha})`;
        ctx.fill();
      }
      if (sparks.current.length > 120) sparks.current.splice(0, sparks.current.length - 120);
    },
    (canvas) => {
      const onClick = (e: MouseEvent) => {
        for (let i = 0; i < 16; i++) {
          sparks.current.push({ x: e.clientX, y: e.clientY, vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 40, alpha: 1, size: 2 + Math.random() * 2 });
        }
      };
      canvas.addEventListener('click', onClick);
      return () => canvas.removeEventListener('click', onClick);
    },
  );
  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 海洋 1. 深海漂流 ──────────────────────────────────────────────────────────
export function DeepSeaDriftEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const t = useRef(0);
  const jellies = useRef<{ x: number; y: number; vy: number; phase: number; r: number; alpha: number; hue: number }[]>([]);
  const bubbles = useRef<{ x: number; y: number; vy: number; r: number; phase: number }[]>([]);
  const initialized = useRef(false);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      const sea = hexToRgb(primaryColor) || { r: 10, g: 107, b: 140 };
      const glow = hexToRgb(accentColor) || { r: 106, g: 228, b: 216 };
      t.current += dt * 0.5;

      if (!initialized.current) {
        initialized.current = true;
        for (let i = 0; i < 8; i++) {
          jellies.current.push({ x: Math.random() * w, y: Math.random() * h, vy: -12 - Math.random() * 16, phase: Math.random() * Math.PI * 2, r: 22 + Math.random() * 28, alpha: 0.22 + Math.random() * 0.22, hue: 170 + Math.random() * 60 });
        }
        for (let i = 0; i < 40; i++) {
          bubbles.current.push({ x: Math.random() * w, y: Math.random() * h, vy: -18 - Math.random() * 30, r: 2 + Math.random() * 5, phase: Math.random() * Math.PI * 2 });
        }
      }

      ctx.fillStyle = isDark ? 'rgba(3,13,18,.90)' : 'rgba(232,245,248,.90)';
      ctx.fillRect(0, 0, w, h);

      // 深海光柱
      for (let i = 0; i < 4; i++) {
        const bx = w * (0.15 + i * 0.22) + Math.sin(t.current * 0.3 + i) * 20;
        const beam = ctx.createLinearGradient(bx - 24, 0, bx + 24, 0);
        beam.addColorStop(0, 'rgba(0,0,0,0)');
        beam.addColorStop(0.5, `rgba(${glow.r},${glow.g},${glow.b},${isDark ? 0.06 : 0.04})`);
        beam.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = beam;
        ctx.fillRect(bx - 60, 0, 120, h);
      }

      // 焦散光斑
      for (let i = 0; i < 12; i++) {
        const cx = w * ((Math.sin(t.current * 0.4 + i * 1.7) + 1) / 2);
        const cy = h * 0.18 + (Math.cos(t.current * 0.3 + i) + 1) * 30;
        const caustic = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28 + i * 4);
        caustic.addColorStop(0, `rgba(${glow.r},${glow.g},${glow.b},${isDark ? 0.09 : 0.06})`);
        caustic.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = caustic;
        ctx.beginPath(); ctx.ellipse(cx, cy, 28 + i * 4, 10 + i * 2, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 水母
      for (const jelly of jellies.current) {
        jelly.phase += dt * 0.8;
        jelly.y += jelly.vy * dt + Math.sin(jelly.phase) * 6 * dt;
        jelly.x += Math.sin(jelly.phase * 0.7) * 8 * dt;
        if (jelly.y < -jelly.r * 2) { jelly.y = h + jelly.r; jelly.x = Math.random() * w; }
        if (jelly.x < -jelly.r) jelly.x = w + jelly.r;
        if (jelly.x > w + jelly.r) jelly.x = -jelly.r;

        const bell = ctx.createRadialGradient(jelly.x, jelly.y - jelly.r * 0.3, 0, jelly.x, jelly.y, jelly.r);
        bell.addColorStop(0, `hsla(${jelly.hue},70%,80%,${jelly.alpha * 0.7})`);
        bell.addColorStop(0.6, `hsla(${jelly.hue},60%,65%,${jelly.alpha * 0.5})`);
        bell.addColorStop(1, `hsla(${jelly.hue},50%,55%,0)`);
        ctx.beginPath();
        ctx.ellipse(jelly.x, jelly.y, jelly.r, jelly.r * 0.6, 0, Math.PI, 0);
        ctx.fillStyle = bell;
        ctx.fill();

        // 触手
        for (let ti = -3; ti <= 3; ti++) {
          const tx = jelly.x + ti * (jelly.r / 4);
          ctx.beginPath();
          ctx.moveTo(tx, jelly.y);
          const tentLen = jelly.r * (1.5 + Math.abs(ti) * 0.3);
          ctx.quadraticCurveTo(tx + Math.sin(jelly.phase + ti) * 14, jelly.y + tentLen * 0.5, tx + Math.sin(jelly.phase * 1.4 + ti) * 18, jelly.y + tentLen);
          ctx.strokeStyle = `hsla(${jelly.hue},60%,75%,${jelly.alpha * 0.35})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      // 气泡
      for (const bub of bubbles.current) {
        bub.phase += dt * 0.9;
        bub.y += bub.vy * dt;
        bub.x += Math.sin(bub.phase) * 8 * dt;
        if (bub.y < -10) { bub.y = h + 10; bub.x = Math.random() * w; }
        ctx.beginPath(); ctx.arc(bub.x, bub.y, bub.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${glow.r},${glow.g},${glow.b},${isDark ? 0.25 : 0.18})`;
        ctx.lineWidth = 0.8; ctx.stroke();
        const hilite = ctx.createRadialGradient(bub.x - bub.r * 0.3, bub.y - bub.r * 0.3, 0, bub.x, bub.y, bub.r);
        hilite.addColorStop(0, `rgba(255,255,255,${isDark ? 0.28 : 0.20})`);
        hilite.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hilite; ctx.fill();
      }
    },
    (canvas) => {
      const onClick = (e: MouseEvent) => {
        for (let i = 0; i < 8; i++) {
          bubbles.current.push({ x: e.clientX, y: e.clientY, vy: -28 - Math.random() * 28, r: 3 + Math.random() * 6, phase: Math.random() * Math.PI * 2 });
        }
        if (bubbles.current.length > 80) bubbles.current.splice(0, bubbles.current.length - 80);
      };
      canvas.addEventListener('click', onClick);
      return () => canvas.removeEventListener('click', onClick);
    },
  );
  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 海洋 2. 珊瑚礁光 ──────────────────────────────────────────────────────────
export function CoralReefEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const t = useRef(0);
  const fish = useRef<{ x: number; y: number; vx: number; size: number; phase: number; hue: number }[]>([]);
  const initialized = useRef(false);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      const sea = hexToRgb(primaryColor) || { r: 46, g: 157, b: 170 };
      const coral = hexToRgb(accentColor) || { r: 255, g: 127, b: 110 };
      t.current += dt * 0.55;

      if (!initialized.current) {
        initialized.current = true;
        for (let i = 0; i < 10; i++) {
          fish.current.push({ x: Math.random() * w, y: h * (0.25 + Math.random() * 0.5), vx: 18 + Math.random() * 28, size: 8 + Math.random() * 12, phase: Math.random() * Math.PI * 2, hue: Math.random() * 60 + 10 });
        }
      }

      ctx.fillStyle = isDark ? 'rgba(4,18,20,.90)' : 'rgba(234,247,248,.90)';
      ctx.fillRect(0, 0, w, h);

      // 水面光
      const sunBeam = ctx.createLinearGradient(0, 0, 0, h * 0.35);
      sunBeam.addColorStop(0, `rgba(${sea.r + 30},${sea.g + 20},${sea.b},${isDark ? 0.08 : 0.06})`);
      sunBeam.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sunBeam;
      ctx.fillRect(0, 0, w, h * 0.35);

      // 焦散
      for (let i = 0; i < 10; i++) {
        const cx = w * ((Math.sin(t.current * 0.35 + i * 2.1) + 1) / 2);
        const cy = h * 0.08 + Math.cos(t.current * 0.28 + i) * 18;
        const cs = ctx.createRadialGradient(cx, cy, 0, cx, cy, 32);
        cs.addColorStop(0, `rgba(${sea.r + 40},${sea.g + 30},${sea.b + 10},${isDark ? 0.10 : 0.07})`);
        cs.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cs;
        ctx.beginPath(); ctx.ellipse(cx, cy, 32, 11, 0.4, 0, Math.PI * 2); ctx.fill();
      }

      // 底部珊瑚礁剪影
      const coralDefs = [
        { x: w * 0.06, type: 'branch', h: h * 0.26 },
        { x: w * 0.18, type: 'fan', h: h * 0.20 },
        { x: w * 0.31, type: 'round', h: h * 0.16 },
        { x: w * 0.46, type: 'branch', h: h * 0.28 },
        { x: w * 0.60, type: 'fan', h: h * 0.22 },
        { x: w * 0.74, type: 'round', h: h * 0.18 },
        { x: w * 0.88, type: 'branch', h: h * 0.24 },
      ];

      for (const cd of coralDefs) {
        const baseY = h;
        const topY = baseY - cd.h;
        const alpha = isDark ? 0.20 : 0.14;
        if (cd.type === 'branch') {
          ctx.strokeStyle = `rgba(${coral.r},${coral.g},${coral.b},${alpha})`;
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          const drawBranch = (x: number, y: number, angle: number, length: number, depth: number) => {
            if (depth === 0 || length < 6) return;
            ctx.beginPath();
            ctx.moveTo(x, y);
            const ex = x + Math.sin(angle) * length;
            const ey = y - Math.cos(angle) * length;
            ctx.lineTo(ex, ey);
            ctx.lineWidth = Math.max(1, depth * 1.2);
            ctx.stroke();
            const sway = Math.sin(t.current * 0.6 + x * 0.01) * 0.12;
            drawBranch(ex, ey, angle + 0.42 + sway, length * 0.65, depth - 1);
            drawBranch(ex, ey, angle - 0.38 + sway, length * 0.60, depth - 1);
          };
          drawBranch(cd.x, baseY, 0, cd.h * 0.55, 4);
        } else if (cd.type === 'fan') {
          for (let fi = -5; fi <= 5; fi++) {
            const fa = (fi / 5) * 0.7 + Math.sin(t.current * 0.5 + cd.x) * 0.06;
            ctx.beginPath();
            ctx.moveTo(cd.x, baseY);
            ctx.lineTo(cd.x + Math.sin(fa) * cd.h, baseY - Math.cos(fa) * cd.h);
            ctx.strokeStyle = `rgba(${coral.r - 10},${coral.g + 20},${coral.b + 30},${alpha * (1 - Math.abs(fi) / 7)})`;
            ctx.lineWidth = 1.5; ctx.stroke();
          }
        } else {
          ctx.beginPath();
          ctx.arc(cd.x, baseY, cd.h * 0.5, Math.PI, 0);
          ctx.fillStyle = `rgba(${coral.r + 20},${coral.g - 10},${coral.b - 20},${alpha * 0.7})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cd.x - cd.h * 0.18, baseY, cd.h * 0.35, Math.PI, 0);
          ctx.fillStyle = `rgba(${coral.r},${coral.g + 10},${coral.b},${alpha * 0.5})`;
          ctx.fill();
        }
      }

      // 小鱼
      for (const f of fish.current) {
        f.phase += dt * 2.5;
        f.x += f.vx * dt;
        f.y += Math.sin(f.phase) * 14 * dt;
        if (f.x > w + f.size * 3) { f.x = -f.size * 3; f.y = h * (0.25 + Math.random() * 0.5); }

        ctx.save();
        ctx.translate(f.x, f.y);
        const tailWag = Math.sin(f.phase) * 0.3;
        // 鱼身
        ctx.beginPath();
        ctx.ellipse(0, 0, f.size, f.size * 0.45, 0, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${f.hue + 10},80%,${isDark ? 62 : 56}%,${isDark ? 0.42 : 0.30})`;
        ctx.fill();
        // 鱼尾
        ctx.beginPath();
        ctx.moveTo(-f.size * 0.8, 0);
        ctx.lineTo(-f.size * 1.6 + Math.sin(tailWag) * 6, -f.size * 0.5);
        ctx.lineTo(-f.size * 1.6 + Math.sin(tailWag) * 6, f.size * 0.5);
        ctx.closePath();
        ctx.fillStyle = `hsla(${f.hue},70%,${isDark ? 55 : 48}%,${isDark ? 0.35 : 0.25})`;
        ctx.fill();
        ctx.restore();
      }
    },
    (canvas) => {
      const onClick = (e: MouseEvent) => {
        fish.current.push({ x: e.clientX, y: e.clientY, vx: 22 + Math.random() * 20, size: 8 + Math.random() * 10, phase: Math.random() * Math.PI * 2, hue: Math.random() * 60 + 10 });
        if (fish.current.length > 20) fish.current.shift();
      };
      canvas.addEventListener('click', onClick);
      return () => canvas.removeEventListener('click', onClick);
    },
  );
  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 星空 1. 量子粒子场 ──────────────────────────────────────────────────────
// 3D 粒子云 + 距离阈值连线 + 鼠标引力井 + 量子涨落 + 纠缠对 + 点击坍缩
type QParticle = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  baseSize: number;
  hue: number;
  pulse: number;
  pulseSpeed: number;
};
type QCloud = { x: number; y: number; vx: number; vy: number; r: number; hue: number; alpha: number };
type Entangle = { a: number; b: number; alpha: number; phase: number };
type Collapse = { x: number; y: number; r: number; alpha: number };

const Q_PARTICLE_COUNT = 280;
const Q_LINK_DIST = 110;

export function MeteorShowerEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const t = useRef(0);
  const initialized = useRef(false);
  const particles = useRef<QParticle[]>([]);
  const clouds = useRef<QCloud[]>([]);
  const entangles = useRef<Entangle[]>([]);
  const collapses = useRef<Collapse[]>([]);
  const mouse = useRef({ x: -9999, y: -9999 });

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      t.current += dt;
      const pHsl = hexToHsl(primaryColor);
      const aHsl = hexToHsl(accentColor);

      if (!initialized.current) {
        initialized.current = true;
        for (let i = 0; i < Q_PARTICLE_COUNT; i++) {
          particles.current.push({
            x: Math.random() * w,
            y: Math.random() * h,
            z: Math.random(),
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            vz: (Math.random() - 0.5) * 0.04,
            baseSize: 0.6 + Math.random() * 1.6,
            hue: Math.random() < 0.5 ? pHsl.h : aHsl.h,
            pulse: Math.random() * Math.PI * 2,
            pulseSpeed: 0.4 + Math.random() * 1.4,
          });
        }
        for (let i = 0; i < 5; i++) {
          clouds.current.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 6,
            r: 140 + Math.random() * 220,
            hue: i % 2 === 0 ? pHsl.h : aHsl.h,
            alpha: 0.05 + Math.random() * 0.05,
          });
        }
      }

      // ── 深空底色 ──
      ctx.fillStyle = isDark ? 'rgba(4,6,18,0.92)' : 'rgba(232,238,252,0.88)';
      ctx.fillRect(0, 0, w, h);

      // ── 量子云团 (柔光球漂移) ──
      for (const c of clouds.current) {
        c.x += c.vx * dt; c.y += c.vy * dt;
        if (c.x < -c.r) c.x = w + c.r; if (c.x > w + c.r) c.x = -c.r;
        if (c.y < -c.r) c.y = h + c.r; if (c.y > h + c.r) c.y = -c.r;
        const pulse = 0.85 + Math.sin(t.current * 0.4 + c.hue * 0.03) * 0.15;
        const grd = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r * pulse);
        grd.addColorStop(0, `hsla(${c.hue},80%,${isDark ? 55 : 60}%,${c.alpha * 1.8})`);
        grd.addColorStop(0.4, `hsla(${(c.hue + 30) % 360},75%,${isDark ? 50 : 55}%,${c.alpha})`);
        grd.addColorStop(1, `hsla(${c.hue},70%,50%,0)`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r * pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── 粒子运动 + 鼠标引力井 ──
      const mx = mouse.current.x, my = mouse.current.y;
      for (const p of particles.current) {
        // 布朗扰动 + 阻尼
        p.vx += (Math.random() - 0.5) * 10 * dt;
        p.vy += (Math.random() - 0.5) * 10 * dt;
        p.vz += (Math.random() - 0.5) * 0.04 * dt;
        p.vx *= 0.985; p.vy *= 0.985; p.vz *= 0.99;

        // 鼠标引力井 (半径 240, 力 ~距离反比)
        if (mx > 0) {
          const dx = mx - p.x, dy = my - p.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < 240 * 240 && distSq > 1) {
            const dist = Math.sqrt(distSq);
            const force = 140 * (1 - dist / 240);
            p.vx += (dx / dist) * force * dt;
            p.vy += (dy / dist) * force * dt;
          }
        }

        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.pulse += p.pulseSpeed * dt;
        if (p.z < 0.05) { p.z = 0.05; p.vz *= -1; }
        if (p.z > 1) { p.z = 1; p.vz *= -1; }
        if (p.x < 0) { p.x = 0; p.vx *= -0.6; }
        if (p.x > w) { p.x = w; p.vx *= -0.6; }
        if (p.y < 0) { p.y = 0; p.vy *= -0.6; }
        if (p.y > h) { p.y = h; p.vy *= -0.6; }
      }

      // ── 连线 (距离 + z 接近度阈值, O(n²) 但 280 颗可控) ──
      ctx.lineWidth = 0.6;
      const arr = particles.current;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        for (let j = i + 1; j < arr.length; j++) {
          const b = arr[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const distSq = dx * dx + dy * dy;
          if (distSq >= Q_LINK_DIST * Q_LINK_DIST) continue;
          const zDiff = Math.abs(a.z - b.z);
          if (zDiff >= 0.35) continue;
          const dist = Math.sqrt(distSq);
          const alpha = (1 - dist / Q_LINK_DIST) * (1 - zDiff / 0.35) * 0.4;
          const hue = (a.hue + b.hue) / 2;
          ctx.strokeStyle = `hsla(${hue},85%,${isDark ? 70 : 45}%,${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // ── 粒子 (z 投影大小 + 脉冲) ──
      for (const p of particles.current) {
        const size = p.baseSize * (0.35 + p.z * 1.4) * (1 + Math.sin(p.pulse) * 0.22);
        const alpha = 0.55 + p.z * 0.45;
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 4);
        grd.addColorStop(0, `hsla(${p.hue},92%,${isDark ? 78 : 55}%,${alpha * 0.55})`);
        grd.addColorStop(1, `hsla(${p.hue},80%,50%,0)`);
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(p.x, p.y, size * 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `hsla(${p.hue},96%,${isDark ? 90 : 42}%,${alpha})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
      }

      // ── 量子涨落 (随机粒子瞬时爆发) ──
      if (Math.random() < 0.07) {
        const p = particles.current[Math.floor(Math.random() * particles.current.length)];
        const burst = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 44);
        burst.addColorStop(0, `hsla(${p.hue},100%,88%,0.75)`);
        burst.addColorStop(1, `hsla(${p.hue},90%,55%,0)`);
        ctx.fillStyle = burst;
        ctx.beginPath(); ctx.arc(p.x, p.y, 44, 0, Math.PI * 2); ctx.fill();
      }

      // ── 纠缠对 (远距离波动连接) ──
      if (Math.random() < 0.01 && entangles.current.length < 3) {
        const a = Math.floor(Math.random() * particles.current.length);
        let b = Math.floor(Math.random() * particles.current.length);
        if (b === a) b = (b + 1) % particles.current.length;
        entangles.current.push({ a, b, alpha: 1, phase: 0 });
      }
      for (let i = entangles.current.length - 1; i >= 0; i--) {
        const e = entangles.current[i];
        e.alpha -= 0.4 * dt;
        e.phase += dt * 8;
        if (e.alpha <= 0) { entangles.current.splice(i, 1); continue; }
        const a = particles.current[e.a], b = particles.current[e.b];
        if (!a || !b) { entangles.current.splice(i, 1); continue; }
        ctx.strokeStyle = `hsla(${(a.hue + b.hue) / 2},100%,75%,${e.alpha * 0.7})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        const segs = 24;
        const nxRaw = -(b.y - a.y), nyRaw = b.x - a.x;
        const nl = Math.hypot(nxRaw, nyRaw) || 1;
        const nx = nxRaw / nl, ny = nyRaw / nl;
        for (let k = 1; k <= segs; k++) {
          const tt = k / segs;
          const lx = a.x + (b.x - a.x) * tt;
          const ly = a.y + (b.y - a.y) * tt;
          const wave = Math.sin(tt * Math.PI * 3 + e.phase) * 10 * Math.sin(tt * Math.PI);
          ctx.lineTo(lx + nx * wave, ly + ny * wave);
        }
        ctx.stroke();
      }

      // ── 鼠标引力井指示 ──
      if (mx > 0) {
        const ring = ctx.createRadialGradient(mx, my, 0, mx, my, 240);
        ring.addColorStop(0, 'rgba(0,0,0,0)');
        ring.addColorStop(0.65, `hsla(${aHsl.h},100%,70%,0.06)`);
        ring.addColorStop(0.92, `hsla(${aHsl.h},100%,75%,0.18)`);
        ring.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ring;
        ctx.beginPath(); ctx.arc(mx, my, 240, 0, Math.PI * 2); ctx.fill();
      }

      // ── 量子坍缩 (点击震波) ──
      for (let i = collapses.current.length - 1; i >= 0; i--) {
        const c = collapses.current[i];
        c.r += 700 * dt;
        c.alpha -= 0.8 * dt;
        if (c.alpha <= 0) { collapses.current.splice(i, 1); continue; }
        ctx.strokeStyle = `hsla(${aHsl.h},100%,80%,${c.alpha})`;
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = `hsla(${pHsl.h},100%,75%,${c.alpha * 0.65})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 0.65, 0, Math.PI * 2); ctx.stroke();
      }
    },
    (canvas) => {
      const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
      const onLeave = () => { mouse.current = { x: -9999, y: -9999 }; };
      const onClick = (e: MouseEvent) => {
        collapses.current.push({ x: e.clientX, y: e.clientY, r: 8, alpha: 1 });
        collapses.current.push({ x: e.clientX, y: e.clientY, r: 4, alpha: 0.75 });
        // 点击=量子坍缩：把附近粒子向外推
        for (const p of particles.current) {
          const dx = p.x - e.clientX, dy = p.y - e.clientY;
          const distSq = dx * dx + dy * dy;
          if (distSq < 200 * 200 && distSq > 1) {
            const dist = Math.sqrt(distSq);
            const force = 380 * (1 - dist / 200);
            p.vx += (dx / dist) * force;
            p.vy += (dy / dist) * force;
          }
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseleave', onLeave);
      canvas.addEventListener('click', onClick);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseleave', onLeave);
        canvas.removeEventListener('click', onClick);
      };
    },
  );
  return <canvas ref={ref} className="fixed inset-0 w-full h-full z-0" />;
}

// ─── 星空 2. 星云漂移 ──────────────────────────────────────────────────────────
export function NebulaDriftEffect() {
  const { theme, primaryColor, accentColor } = useTheme();
  const t = useRef(0);
  const stars = useRef<{ x: number; y: number; size: number; twinkle: number; tp: number; hue: number }[]>([]);
  const dust = useRef<{ x: number; y: number; vx: number; vy: number; r: number; hue: number; alpha: number }[]>([]);
  const mouse = useRef({ x: -9999, y: -9999 });
  const initialized = useRef(false);

  const ref = useCanvas(
    (ctx, w, h, dt) => {
      const isDark = theme === 'dark';
      const primaryHsl = hexToHsl(primaryColor);
      const accentHsl = hexToHsl(accentColor);
      t.current += dt * 0.35;

      if (!initialized.current) {
        initialized.current = true;
        for (let i = 0; i < 160; i++) {
          stars.current.push({ x: Math.random() * w, y: Math.random() * h, size: 0.3 + Math.random() * 2.2, twinkle: Math.random() * Math.PI * 2, tp: 0.4 + Math.random() * 2, hue: primaryHsl.h + (Math.random() - 0.5) * 80 });
        }
        for (let i = 0; i < 28; i++) {
          dust.current.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 4, r: 40 + Math.random() * 90, hue: primaryHsl.h + (Math.random() - 0.5) * 120, alpha: 0.03 + Math.random() * 0.04 });
        }
      }

      ctx.fillStyle = isDark ? 'rgba(10,6,15,.90)' : 'rgba(246,240,255,.90)';
      ctx.fillRect(0, 0, w, h);

      // 星云云团
      for (const d of dust.current) {
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.x < -d.r * 2) d.x = w + d.r;
        if (d.x > w + d.r * 2) d.x = -d.r;
        if (d.y < -d.r * 2) d.y = h + d.r;
        if (d.y > h + d.r * 2) d.y = -d.r;

        const pulseFactor = 0.85 + Math.sin(t.current * 0.5 + d.hue * 0.05) * 0.10;
        const gr = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * pulseFactor);
        gr.addColorStop(0, `hsla(${d.hue},70%,${isDark ? 60 : 50}%,${d.alpha * 2.2})`);
        gr.addColorStop(0.5, `hsla(${d.hue + 30},65%,${isDark ? 55 : 45}%,${d.alpha})`);
        gr.addColorStop(1, `hsla(${d.hue},60%,50%,0)`);
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r * pulseFactor, d.r * pulseFactor * (0.7 + Math.sin(t.current * 0.3 + d.hue) * 0.15), t.current * 0.1 + d.hue * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }

      // 中央高亮星云核
      const core1 = ctx.createRadialGradient(w * 0.42, h * 0.38, 0, w * 0.42, h * 0.38, w * 0.32);
      core1.addColorStop(0, `hsla(${primaryHsl.h},75%,${isDark ? 65 : 55}%,${isDark ? 0.07 : 0.04})`);
      core1.addColorStop(0.5, `hsla(${accentHsl.h},65%,${isDark ? 60 : 50}%,${isDark ? 0.04 : 0.025})`);
      core1.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = core1; ctx.fillRect(0, 0, w, h);

      // 繁星
      for (const s of stars.current) {
        s.twinkle += dt * s.tp;
        const a = (0.25 + Math.sin(s.twinkle) * 0.22) * (isDark ? 1 : 0.55);
        if (s.size > 1.5) {
          const grd = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.size * 3);
          grd.addColorStop(0, `hsla(${s.hue},80%,90%,${a * 0.35})`);
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${s.hue},70%,92%,${a})`;
        ctx.fill();
      }

      // 鼠标光晕
      if (mouse.current.x > 0) {
        const mg = ctx.createRadialGradient(mouse.current.x, mouse.current.y, 0, mouse.current.x, mouse.current.y, 120);
        mg.addColorStop(0, `hsla(${primaryHsl.h},80%,${isDark ? 75 : 60}%,${isDark ? 0.12 : 0.07})`);
        mg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h);
      }
    },
    (canvas) => {
      const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
      const onClick = (e: MouseEvent) => {
        for (let i = 0; i < 6; i++) {
          dust.current.push({ x: e.clientX, y: e.clientY, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 14, r: 30 + Math.random() * 60, hue: hexToHsl(primaryColor).h + (Math.random() - 0.5) * 100, alpha: 0.05 + Math.random() * 0.06 });
        }
        if (dust.current.length > 50) dust.current.splice(0, dust.current.length - 50);
      };
      window.addEventListener('mousemove', onMove);
      canvas.addEventListener('click', onClick);
      return () => { window.removeEventListener('mousemove', onMove); canvas.removeEventListener('click', onClick); };
    },
  );
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
      case 'ink-wash-bloom':  return <InkWashBloomEffect />;
      case 'ink-brush-trace': return <InkBrushTraceEffect />;
      case 'misty-peaks':     return <MistyPeaksEffect />;
      case 'river-lantern':   return <RiverLanternEffect />;
      case 'bamboo-breeze':   return <BambooBreezeEffect />;
      case 'bamboo-rain':     return <BambooRainEffect />;
      case 'lotus-pond':      return <LotusPondEffect />;
      case 'palace-lantern':  return <PalaceLanternEffect />;
      case 'deep-sea-drift':  return <DeepSeaDriftEffect />;
      case 'coral-reef':      return <CoralReefEffect />;
      case 'meteor-shower':   return <MeteorShowerEffect />;
      case 'nebula-drift':    return <NebulaDriftEffect />;
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
