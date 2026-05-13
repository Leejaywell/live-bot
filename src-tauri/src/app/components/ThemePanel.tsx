import { useState, useRef, useEffect } from 'react';
import { X, RotateCcw, Palette } from 'lucide-react';
import { HexColorWheel } from 'react-colorful';
import { useTheme } from '../context/ThemeContext';
import { GlassCard } from './GlassCard';
import { Button } from './Button';

interface ThemePanelProps {
  onClose: () => void;
}

export function ThemePanel({ onClose }: ThemePanelProps) {
  const { 
    theme, setTheme, primaryColor, setPrimaryColor, 
    blur, updateTheme, resetTheme 
  } = useTheme();
  
  // Local state for "Save to apply" logic
  const [tempColor, setTempColor] = useState(primaryColor);
  const [tempBlur, setTempBlur] = useState(blur);
  
  const panelRef = useRef<HTMLDivElement>(null);

  // Sync with context if context changes elsewhere
  useEffect(() => {
    setTempColor(primaryColor);
    setTempBlur(blur);
  }, [primaryColor, blur]);

  const handleApply = () => {
    setPrimaryColor(tempColor);
    updateTheme({ blur: tempBlur });
    onClose();
  };

  const handleReset = () => {
    resetTheme();
    onClose();
  };

  return (
    <div className="fixed bottom-4 left-4 w-72 z-[10001] pointer-events-none flex items-end justify-start p-0">
      <GlassCard 
        ref={panelRef}
        className="w-full pointer-events-auto shadow-2xl border border-white/10 flex flex-col animate-in slide-in-from-bottom-4 duration-300 h-auto max-h-[85vh] overflow-hidden rounded-[24px]"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/5 shrink-0 bg-white/5">
          <h2 className="text-[14px] font-black flex items-center gap-2">
            <Palette className="w-4 h-4 text-[var(--primary-color)]" />
            主题实验室
          </h2>
          <div className="flex items-center gap-1">
            <button 
              onClick={handleReset}
              className="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title="重置全部"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-none">
          {/* 模式选择 */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">显示模式</label>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
              <button
                onClick={() => setTheme('light')}
                className={`h-9 rounded-xl flex items-center justify-center gap-2 transition-all ${
                  theme === 'light' 
                    ? 'bg-white dark:bg-white/10 text-[var(--primary-color)] shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <div className="w-3 h-3 rounded-full bg-white border border-gray-300 shadow-inner" />
                <span className="text-[11px] font-bold">明亮</span>
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={`h-9 rounded-xl flex items-center justify-center gap-2 transition-all ${
                  theme === 'dark' 
                    ? 'bg-white dark:bg-white/10 text-[var(--primary-color)] shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <div className="w-3 h-3 rounded-full bg-gray-900 border border-white/10 shadow-lg" />
                <span className="text-[11px] font-bold">深邃</span>
              </button>
            </div>
          </div>

          {/* 圆形颜色选择器 */}
          <div className="space-y-4 flex flex-col items-center">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest self-start">色彩选取</label>
            <div className="relative group">
              <style>{`
                .custom-wheel .react-colorful {
                  width: 180px;
                  height: 180px;
                }
                .custom-wheel .react-colorful__pointer {
                  width: 18px;
                  height: 18px;
                  border-radius: 50%;
                  border: 3px solid #fff;
                  box-shadow: 0 4px 10px rgba(0,0,0,0.2);
                }
              `}</style>
              <div className="custom-wheel">
                <HexColorWheel color={tempColor} onChange={setTempColor} />
              </div>
              <div 
                className="absolute inset-0 m-auto w-10 h-10 rounded-full border-4 border-white shadow-lg pointer-events-none transition-transform duration-300 group-hover:scale-110" 
                style={{ background: tempColor }} 
              />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[12px] font-black font-mono tracking-widest">{tempColor.toUpperCase()}</span>
              <div className="w-12 h-1 bg-[var(--primary-color)] rounded-full opacity-30" />
            </div>
          </div>

          {/* 玻璃感调节 */}
          <div className="space-y-4">
             <div className="flex items-center justify-between">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">模糊强度</label>
                <span className="text-[10px] font-mono text-[var(--primary-color)]">{tempBlur}px</span>
             </div>
             <div className="px-1">
                <input 
                  type="range" 
                  min="0" max="40" 
                  value={tempBlur}
                  onChange={e => setTempBlur(parseInt(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-black/10 dark:bg-white/10 cursor-pointer accent-[var(--primary-color)]" 
                />
             </div>
          </div>
        </div>

        <div className="p-4 bg-white/5 border-t border-white/5 shrink-0 flex gap-2">
          <Button variant="default" className="flex-1 h-10 rounded-2xl font-bold text-[12px]" onClick={onClose}>取消</Button>
          <Button variant="primary" className="flex-1 h-10 rounded-2xl font-bold text-[12px] shadow-lg shadow-[var(--primary-color)]/20" onClick={handleApply}>保存应用</Button>
        </div>
      </GlassCard>
    </div>
  );
}
