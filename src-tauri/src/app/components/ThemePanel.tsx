import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { useTheme, themePresets } from '../context/ThemeContext';
import { GlassCard } from './GlassCard';
import { cn } from '../lib/utils';

interface ThemePanelProps {
  onClose: () => void;
}

export function ThemePanel({ onClose }: ThemePanelProps) {
  const { theme, setTheme, primaryColor, setPrimaryColor } = useTheme();
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
          {/* 5 个预设色 */}
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

          {/* 自定义展开 */}
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
        </div>
      </GlassCard>
    </div>
  );
}
