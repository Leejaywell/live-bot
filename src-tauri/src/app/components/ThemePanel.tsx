import { useState, useEffect, useRef } from 'react';
import { X, Sun, Moon, Copy } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { Button } from './Button';
import { Input } from './Input';
import { IconButton } from './IconButton';
import { useTheme, themePresets, hslToHex, hexToHsl } from '../context/ThemeContext';

interface ThemePanelProps {
  onClose: () => void;
}

export function ThemePanel({ onClose }: ThemePanelProps) {
  const { theme, setTheme, primaryColor, setPrimaryColor } = useTheme();
  const [customExpanded, setCustomExpanded] = useState(false);
  const [hue, setHue] = useState(211);
  const [saturation, setSaturation] = useState(100);
  const [lightness, setLightness] = useState(50);
  const [favorites, setFavorites] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hsl = hexToHsl(primaryColor);
    setHue(hsl.h);
    setSaturation(hsl.s);
    setLightness(hsl.l);
  }, [primaryColor]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const hexColor = hslToHex(hue, saturation, lightness);

  const handleHueChange = (value: number) => {
    setHue(value);
    setPrimaryColor(hslToHex(value, saturation, lightness));
  };

  const handleSaturationChange = (value: number) => {
    setSaturation(value);
    setPrimaryColor(hslToHex(hue, value, lightness));
  };

  const handleLightnessChange = (value: number) => {
    setLightness(value);
    setPrimaryColor(hslToHex(hue, saturation, value));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const addToFavorites = () => {
    if (favorites.length < 8 && !favorites.includes(hexColor)) {
      setFavorites([...favorites, hexColor]);
    }
  };

  const removeFromFavorites = (color: string) => {
    setFavorites(favorites.filter(c => c !== color));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-start pointer-events-none">
      <div ref={panelRef} className="pointer-events-auto mb-4 ml-4">
        <GlassCard className="w-[300px] p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[17px] font-bold">外观</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mb-4">
            <div className="flex gap-2 p-1 rounded-2xl bg-white/40 dark:bg-white/10">
              <button
                onClick={() => setTheme('light')}
                className={`flex-1 h-8 rounded-xl flex items-center justify-center gap-2 transition-all ${
                  theme === 'light' ? 'bg-[var(--primary-color)] text-white shadow-lg' : ''
                }`}
              >
                <Sun className="w-4 h-4" />
                <span className="text-[11px]">浅色</span>
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={`flex-1 h-8 rounded-xl flex items-center justify-center gap-2 transition-all ${
                  theme === 'dark' ? 'bg-[var(--primary-color)] text-white shadow-lg' : ''
                }`}
              >
                <Moon className="w-4 h-4" />
                <span className="text-[11px]">深色</span>
              </button>
            </div>
          </div>

          <div className="mb-4">
            <h3 className="text-[11px] font-bold text-gray-500 dark:text-gray-400 tracking-wider mb-3">主色调</h3>
            <div className="flex justify-between mb-2 px-2">
              {themePresets.map((preset, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <button
                    onClick={() => setPrimaryColor(preset.primary)}
                    className={`w-8 h-8 rounded-full transition-all ${
                      primaryColor === preset.primary ? 'ring-3 ring-white dark:ring-gray-300 ring-offset-2 dark:ring-offset-gray-900 scale-110' : 'hover:scale-105'
                    }`}
                    style={{
                      background: `linear-gradient(135deg, ${preset.primary} 0%, ${preset.primaryDark} 100%)`,
                      boxShadow: primaryColor === preset.primary ? `0 4px 16px ${preset.primary}80` : '0 2px 8px rgba(0,0,0,0.1)',
                    }}
                  />
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">{preset.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <button
              onClick={() => setCustomExpanded(!customExpanded)}
              className="w-full p-3 rounded-xl bg-white/40 dark:bg-white/10 flex items-center justify-between hover:bg-white/50 dark:hover:bg-white/15 transition-all"
            >
              <div className="flex items-center gap-2">
                <span className={`transition-transform text-[10px] ${customExpanded ? 'rotate-90' : ''}`}>▸</span>
                <span className="text-[11px] font-semibold">自定义颜色</span>
              </div>
              <span className="font-mono text-[11px] font-semibold" style={{ color: hexColor }}>{hexColor.toUpperCase()}</span>
            </button>

            {customExpanded && (
              <div className="mt-3 space-y-3.5 p-4 rounded-xl bg-white/20 dark:bg-white/5 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <span className="w-5 text-[11px] font-semibold text-gray-600 dark:text-gray-400">H</span>
                  <div className="flex-1 relative">
                    <input
                      type="range"
                      min="0"
                      max="360"
                      value={hue}
                      onChange={(e) => handleHueChange(Number(e.target.value))}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer slider-hue"
                    />
                  </div>
                  <Input
                    type="number"
                    value={hue}
                    onChange={(e) => handleHueChange(Number(e.target.value))}
                    min="0"
                    max="360"
                    className="w-16 h-7 text-[11px] text-center"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <span className="w-5 text-[11px] font-semibold text-gray-600 dark:text-gray-400">S</span>
                  <div className="flex-1 relative">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={saturation}
                      onChange={(e) => handleSaturationChange(Number(e.target.value))}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer slider-saturation"
                      style={{
                        background: `linear-gradient(to right,
                          hsl(${hue}, 0%, ${lightness}%),
                          hsl(${hue}, 100%, ${lightness}%))`
                      }}
                    />
                  </div>
                  <Input
                    type="number"
                    value={saturation}
                    onChange={(e) => handleSaturationChange(Number(e.target.value))}
                    min="0"
                    max="100"
                    className="w-16 h-7 text-[11px] text-center"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <span className="w-5 text-[11px] font-semibold text-gray-600 dark:text-gray-400">L</span>
                  <div className="flex-1 relative">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={lightness}
                      onChange={(e) => handleLightnessChange(Number(e.target.value))}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer slider-lightness"
                      style={{
                        background: `linear-gradient(to right,
                          hsl(${hue}, ${saturation}%, 0%),
                          hsl(${hue}, ${saturation}%, 50%),
                          hsl(${hue}, ${saturation}%, 100%))`
                      }}
                    />
                  </div>
                  <Input
                    type="number"
                    value={lightness}
                    onChange={(e) => handleLightnessChange(Number(e.target.value))}
                    min="0"
                    max="100"
                    className="w-16 h-7 text-[11px] text-center"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Input mono value={hexColor.toUpperCase()} className="flex-1 h-9 font-semibold" readOnly />
                  <IconButton onClick={() => copyToClipboard(hexColor)}>
                    <Copy className="w-3.5 h-3.5" />
                  </IconButton>
                </div>

                <div className="pt-2">
                  <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-2">实时预览</div>
                  <div className="flex gap-2">
                    <div
                      className="flex-1 h-9 rounded-lg flex items-center justify-center text-white text-[10px] font-semibold shadow-md"
                      style={{ background: hexColor }}
                    >
                      按钮
                    </div>
                    <div
                      className="flex-1 h-9 rounded-lg flex items-center justify-center text-[10px] font-semibold"
                      style={{ background: `${hexColor}20`, color: hexColor, border: `1px solid ${hexColor}40` }}
                    >
                      导航
                    </div>
                    <div className="w-10 h-5 rounded-full flex items-center px-0.5 shadow-sm" style={{ background: hexColor }}>
                      <div className="w-4 h-4 rounded-full bg-white shadow translate-x-5 transition-transform" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-bold text-gray-500 dark:text-gray-400 tracking-wider">我的收藏</h3>
              <button
                onClick={() => setFavorites([])}
                className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400"
              >
                清空
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2.5">
              {favorites.map((color, i) => (
                <button
                  key={i}
                  onClick={() => setPrimaryColor(color)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    removeFromFavorites(color);
                  }}
                  className="w-full aspect-square rounded-lg hover:scale-110 transition-transform shadow-md group relative"
                  style={{ background: color }}
                  title={`${color} (右键删除)`}
                >
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors flex items-center justify-center">
                    <X className="w-3 h-3 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
              {Array.from({ length: 8 - favorites.length }).map((_, i) => (
                <button
                  key={`empty-${i}`}
                  onClick={addToFavorites}
                  className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 text-[14px] hover:border-[var(--primary-color)] hover:text-[var(--primary-color)] transition-all"
                >
                  +
                </button>
              ))}
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
