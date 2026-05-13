import { useEffect, useState, useRef } from 'react';
import { useTheme, hexToRgb } from '../context/ThemeContext';

export function BackgroundBlobs() {
  const { theme, primaryColor } = useTheme();
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const requestRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);

  const isDark = theme === 'dark';

  // Mouse tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    
    // Add ripple on click
    const handleClick = (e: MouseEvent) => {
      const id = Date.now();
      setRipples(prev => [...prev, { id, x: e.clientX, y: e.clientY }]);
      setTimeout(() => {
        setRipples(prev => prev.filter(r => r.id !== id));
      }, 2000);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleClick);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleClick);
    };
  }, []);

  // Bubble animation on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const bubbles: any[] = [];
    const bubbleCount = 20;

    for (let i = 0; i < bubbleCount; i++) {
      bubbles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 40 + 10,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        opacity: Math.random() * 0.15 + 0.05,
        phase: Math.random() * Math.PI * 2,
      });
    }

    const rgb = hexToRgb(primaryColor) || { r: 75, g: 142, b: 255 };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      
      bubbles.forEach((b) => {
        b.x += b.vx;
        b.y += b.vy;
        b.phase += 0.01;

        if (b.x < -b.radius) b.x = width + b.radius;
        if (b.x > width + b.radius) b.x = -b.radius;
        if (b.y < -b.radius) b.y = height + b.radius;
        if (b.y > height + b.radius) b.y = -b.radius;

        // Interactive distance to mouse
        const dx = mousePos.x - b.x;
        const dy = mousePos.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const nearMouse = dist < 200;
        
        const floatY = Math.sin(b.phase) * 10;
        const currentOpacity = nearMouse ? b.opacity * 2 : b.opacity;

        const gradient = ctx.createRadialGradient(b.x, b.y + floatY, 0, b.x, b.y + floatY, b.radius);
        
        if (nearMouse) {
          // Color changes near mouse
          gradient.addColorStop(0, `rgba(255, 255, 255, ${currentOpacity * 1.2})`);
          gradient.addColorStop(0.4, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${currentOpacity})`);
          gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        } else {
          gradient.addColorStop(0, `rgba(255, 255, 255, ${currentOpacity * 1.5})`);
          gradient.addColorStop(0.3, `rgba(${isDark ? '200, 220, 255' : '150, 180, 255'}, ${currentOpacity})`);
          gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        }

        ctx.beginPath();
        ctx.arc(b.x, b.y + floatY, b.radius * (nearMouse ? 1.1 : 1), 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      });

      requestRef.current = requestAnimationFrame(animate);
    };

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);
    animate();

    return () => {
      cancelAnimationFrame(requestRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [isDark, primaryColor, mousePos.x, mousePos.y]);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1] transition-colors duration-1000"
      style={{ background: isDark ? '#0a0a0f' : '#f0f5ff' }}>
      
      {/* Background Ripple Layer */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-[var(--primary-color)]/5 to-transparent animate-pulse-slow" />
      </div>

      {/* Water Ripples */}
      {ripples.map(ripple => (
        <div 
          key={ripple.id}
          className="absolute rounded-full border border-[var(--primary-color)]/20 animate-ripple"
          style={{
            left: ripple.x,
            top: ripple.y,
            width: '10px',
            height: '10px',
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}

      {/* Mouse Follow Glow */}
      <div 
        className="absolute rounded-full transition-all duration-300 ease-out"
        style={{
          width: '600px',
          height: '600px',
          left: `calc(${mousePos.x}px - 300px)`,
          top: `calc(${mousePos.y}px - 300px)`,
          background: `radial-gradient(circle, ${primaryColor}15 0%, transparent 70%)`,
          filter: 'blur(80px)',
          opacity: 0.6,
        }}
      />

      {/* Main Blobs */}
      <div 
        className="absolute rounded-full animate-blob-slow-1 mix-blend-soft-light"
        style={{
          width: '800px',
          height: '800px',
          left: '-10%',
          top: '-10%',
          background: `radial-gradient(circle, ${primaryColor}10 0%, transparent 70%)`,
          filter: 'blur(100px)',
        }}
      />

      {/* Random Bubbles Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-70" />

      <style>{`
        @keyframes ripple {
          0% { width: 0; height: 0; opacity: 0.5; border-width: 4px; }
          100% { width: 500px; height: 500px; opacity: 0; border-width: 1px; }
        }
        .animate-ripple { animation: ripple 2s cubic-bezier(0, 0.2, 0.8, 1) forwards; }
        
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
        .animate-pulse-slow { animation: pulse-slow 8s infinite ease-in-out; }

        @keyframes blob-slow-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(50px, -30px) scale(1.1); }
          66% { transform: translate(-30px, 50px) scale(0.9); }
        }
        .animate-blob-slow-1 { animation: blob-slow-1 25s infinite ease-in-out; }
      `}</style>
    </div>
  );
}
