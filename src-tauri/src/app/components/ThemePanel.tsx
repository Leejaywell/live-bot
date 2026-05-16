import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Sparkles, Waves, Zap, Cherry, Star, Boxes, Mountain, Coins, Paintbrush, PaintbrushVertical, Trees, CloudRain, Flower2, Lamp, Fish, Shell, Rocket, CloudMoon } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { useTheme, themePresets, type BackgroundEffectType } from '../context/ThemeContext';
import { GlassCard } from './GlassCard';
import { cn } from '../lib/utils';

interface ThemePanelProps {
  onClose: () => void;
}

const backgroundEffects: { id: BackgroundEffectType; name: string; icon: any }[] = [
  { id: 'mountain-parallax', name: '山水层峦', icon: Mountain },
  { id: 'particle-galaxy', name: '粒子星河', icon: Sparkles },
  { id: 'fluid-ripple',    name: '流体波纹', icon: Waves },
  { id: 'aurora-bands',    name: '极光光带', icon: Zap },
  { id: 'sakura-fall',     name: '樱花飘落', icon: Cherry },
  { id: 'constellation',   name: '星座连线', icon: Star },
  { id: 'blobs',           name: '动态气泡', icon: Boxes },
  { id: 'gold-flakes',     name: '金箔微光', icon: Coins },
  { id: 'ink-wash-bloom',  name: '墨韵晕染', icon: Paintbrush },
  { id: 'ink-brush-trace', name: '飞白墨痕', icon: PaintbrushVertical },
  { id: 'misty-peaks',     name: '云岭叠嶂', icon: Mountain },
  { id: 'river-lantern',   name: '江山渔火', icon: Coins },
  { id: 'bamboo-breeze',   name: '竹影摇风', icon: Trees },
  { id: 'bamboo-rain',     name: '雨竹清响', icon: CloudRain },
  { id: 'lotus-pond',      name: '荷塘月色', icon: Flower2 },
  { id: 'palace-lantern',  name: '宫灯霞光', icon: Lamp },
  { id: 'deep-sea-drift',  name: '深海漂流', icon: Fish },
  { id: 'coral-reef',      name: '珊瑚礁光', icon: Shell },
  { id: 'meteor-shower',   name: '流星雨夜', icon: Rocket },
  { id: 'nebula-drift',    name: '星云漂移', icon: CloudMoon },
];

export function ThemePanel({ onClose }: ThemePanelProps) {
  const { theme, setTheme, primaryColor, setPrimaryColor, backgroundEffect, setBackgroundEffect } = useTheme();
  const [showCustom, setShowCustom] = useState(false);
  const [customColor, setCustomColor] = useState(primaryColor);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 200);
  }, [closing, onClose]);

  useEffect(() => {
    setCustomColor(primaryColor);
  }, [primaryColor]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [handleClose]);

  const handlePreset = (color: string) => {
    setPrimaryColor(color);
    setCustomColor(color);
    setShowCustom(false);
  };

  const handleCustomChange = (color: string) => {
    setCustomColor(color);
    setPrimaryColor(color);
  };

  return (
    <div ref={panelRef} className="fixed bottom-4 left-4 w-72 z-[10001] pointer-events-none flex items-end justify-start">
      <GlassCard className={cn('w-full pointer-events-auto shadow-2xl border border-white/10 flex flex-col rounded-[20px] overflow-hidden', closing ? 'animate-panel-out' : 'animate-in slide-in-from-bottom-4 duration-300')}>

        {/* 明亮 / 深邃 */}
        <div className="flex p-3 gap-2 border-b border-white/5">
          <button
            onClick={() => setTheme('light')}
            className={`flex-1 h-8 rounded-xl text-[11px] font-bold transition-all ${
              theme === 'light'
                ? 'bg-white shadow-sm text-[var(--primary-color)]'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            明亮
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={`flex-1 h-8 rounded-xl text-[11px] font-bold transition-all ${
              theme === 'dark'
                ? 'bg-white/15 shadow-sm text-[var(--primary-color)]'
                : 'text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            深邃
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* 颜色覆盖 */}
          <div className="flex justify-between items-end">
            {themePresets.map(preset => {
              const active = primaryColor === preset.primary;
              return (
                <button
                  key={preset.id}
                  onClick={() => handlePreset(preset.primary)}
                  className="flex flex-col items-center gap-1.5 group"
                  title={preset.name}
                >
                  <div
                    className="rounded-full transition-all duration-200"
                    style={{
                      width:       active ? 36 : 30,
                      height:      active ? 36 : 30,
                      background:  preset.primary,
                      outline:     active ? `3px solid ${preset.primary}` : '3px solid transparent',
                      outlineOffset: 2,
                      boxShadow:   active ? `0 4px 12px ${preset.primary}60` : '0 2px 6px rgba(0,0,0,0.12)',
                    }}
                  />
                  <span className="text-[9px] text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-200 transition-colors">
                    {preset.name}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 自定义颜色 */}
          <button
            onClick={() => setShowCustom(v => !v)}
            className="w-full flex items-center justify-between px-3 h-8 rounded-xl bg-black/5 dark:bg-white/5 text-[11px] font-bold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            自定义颜色
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showCustom ? 'rotate-180' : ''}`} />
          </button>

          {showCustom && (
            <div className="flex flex-col items-center gap-3">
              <HexColorPicker
                color={customColor}
                onChange={handleCustomChange}
                style={{ width: '100%', height: '130px' }}
              />
              <div className="flex items-center gap-2">
                <div
                  className="w-5 h-5 rounded-full border-2 border-white shadow"
                  style={{ background: customColor }}
                />
                <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400">
                  {customColor.toUpperCase()}
                </span>
              </div>
            </div>
          )}

          {/* 视觉主题选择 */}
          <div className="space-y-3 pt-2">
            <div className="px-1">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">视觉主题</div>
              <div className="text-[10px] text-gray-400 mt-1">点击主题会恢复该主题自带配色；选择颜色会覆盖主题色但保留动效。</div>
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-[360px] overflow-y-auto pr-1">
              {backgroundEffects.map(eff => {
                const active = backgroundEffect === eff.id;
                const Icon = eff.icon;
                return (
                  <button
                    key={eff.id}
                    onClick={() => setBackgroundEffect(eff.id)}
                    className={cn(
                      "flex items-center gap-2 px-3 h-9 rounded-xl transition-all border",
                      active 
                        ? "bg-[var(--button-active-soft-bg)] border-[var(--button-active-soft-border)] text-[var(--button-active-soft-text)] shadow-sm"
                        : "bg-black/5 dark:bg-white/5 border-transparent text-gray-500 hover:bg-black/10 dark:hover:bg-white/10"
                    )}
                  >
                    <Icon className={cn("w-3.5 h-3.5", active ? "animate-pulse" : "opacity-60")} />
                    <span className="text-[10px] font-bold">{eff.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
