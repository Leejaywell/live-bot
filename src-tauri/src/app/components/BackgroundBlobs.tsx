import { useTheme } from '../context/ThemeContext';

export function BackgroundBlobs() {
  const { theme, primaryColor } = useTheme();

  const isLight = theme === 'light';

  const blob1Opacity = isLight ? 0.4 : 0.4;
  const blob2Opacity = isLight ? 0.4 : 0.4;
  const blob3Opacity = isLight ? 0.4 : 0.4;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Top-left primary color blob */}
      <div
        className="absolute rounded-full"
        style={{
          width: '520px',
          height: '520px',
          left: '-160px',
          top: '-180px',
          background: `radial-gradient(circle, ${primaryColor} 0%, transparent 70%)`,
          opacity: blob1Opacity,
          filter: 'blur(80px)',
        }}
      />

      {/* Top-right rose pink blob */}
      <div
        className="absolute rounded-full"
        style={{
          width: '480px',
          height: '480px',
          right: '-120px',
          top: '-120px',
          background: 'radial-gradient(circle, #ff2d55 0%, transparent 70%)',
          opacity: blob2Opacity,
          filter: 'blur(80px)',
        }}
      />

      {/* Bottom-right emerald green blob */}
      <div
        className="absolute rounded-full"
        style={{
          width: '500px',
          height: '500px',
          right: '-100px',
          bottom: '-100px',
          background: 'radial-gradient(circle, #34c759 0%, transparent 70%)',
          opacity: blob3Opacity,
          filter: 'blur(80px)',
        }}
      />
    </div>
  );
}
