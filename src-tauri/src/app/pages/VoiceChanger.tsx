import React, { useState, useEffect, useCallback } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { Toggle } from '../components/Toggle';
import { api, DlState } from '../lib/api';
import { useConfig } from '../context/ConfigContext';
import { 
  Mic, 
  Volume2, 
  Search, 
  Download, 
  CheckCircle2, 
  X, 
  Play, 
  Square,
  Activity,
  User,
  Sparkles,
  CloudDownload,
  Plus
} from 'lucide-react';
import { toast } from 'sonner';

interface RvcModel {
  id: string;
  name: string;
  author: string;
  description: string;
  preview_url?: string;
  tags: string[];
  installed: boolean;
  size: string;
}

export function VoiceChanger() {
  const { modelDl, downloadModel, cancelModel } = useConfig();
  const [isActive, setIsMonitoring] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [models, setModels] = useState<RvcModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);

  const fetchModels = useCallback(async (query: string = '') => {
    setLoading(true);
    try {
      const res = await api.searchRvcModels(query);
      setModels(res);
    } catch (err) {
      console.error(err);
      toast.error('获取模型列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
    api.getVoiceChangerStatus().then(setIsMonitoring);
  }, [fetchModels]);

  const toggleVoiceChanger = async () => {
    try {
      if (isActive) {
        await api.stopVoiceChanger();
        setIsMonitoring(false);
        toast.info('变声器已关闭');
      } else {
        if (!activeModelId) {
          toast.error('请先选择一个已安装的音色模型');
          return;
        }
        await api.startVoiceChanger(activeModelId);
        setIsMonitoring(true);
        toast.success('变声器已开启');
      }
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const handleDownload = async (id: string) => {
    try {
      await downloadModel(id);
    } catch (err) {
      toast.error('开始下载失败');
    }
  };

  return (
    <div className="p-5 h-full flex flex-col gap-5 overflow-hidden">
      {/* Top Status Bar */}
      <div className="flex gap-4 shrink-0">
        <GlassCard className="flex-1 p-5 flex items-center justify-between border-[var(--primary-color)]/20 bg-[var(--primary-color)]/5">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${isActive ? 'bg-[var(--primary-color)] text-white shadow-lg shadow-[var(--primary-color)]/30 scale-110' : 'bg-black/5 dark:bg-white/5 text-gray-400'}`}>
              <Mic className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[15px] font-black tracking-tight">AI 实时变声</div>
              <div className="text-[11px] text-gray-500 font-bold flex items-center gap-1.5 mt-0.5">
                {isActive ? (
                  <>
                    <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    正在运行 - {models.find(m => m.id === activeModelId)?.name || '未知模型'}
                  </>
                ) : '待机中'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Toggle checked={isActive} onChange={toggleVoiceChanger} size="lg" />
          </div>
        </GlassCard>

        <GlassCard className="w-[300px] p-5 flex flex-col justify-center gap-1.5">
          <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">输入增益</div>
          <div className="h-1.5 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden flex gap-0.5">
            <div className="h-full bg-emerald-500/60 w-[40%]" />
            <div className="h-full bg-emerald-500/60 w-[20%]" />
            <div className="h-full bg-amber-500/60 w-[15%]" />
          </div>
          <div className="flex justify-between text-[9px] text-gray-400 font-mono mt-1">
            <span>-60dB</span>
            <span>-20dB</span>
            <span>0dB</span>
          </div>
        </GlassCard>
      </div>

      {/* Model Gallery Section */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-1">
          <div className="flex items-center gap-3">
            <h2 className="text-[13px] font-black text-gray-400 uppercase tracking-widest">音色模型库</h2>
            <div className="h-4 w-px bg-black/5 dark:bg-white/10" />
            <div className="flex gap-1.5">
              {['全部', '御姐', '萝莉', '大叔', '动漫'].map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/5 text-[10px] text-gray-500 hover:text-[var(--primary-color)] cursor-pointer transition-colors font-bold">{tag}</span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-9 px-4 gap-2 border-dashed border-gray-300 dark:border-white/20">
              <Plus className="w-4 h-4" />
              导入本地模型
            </Button>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchModels(searchQuery)}
                placeholder="搜索音色模型..." 
                className="pl-9 h-9 text-[11px] bg-white/50 dark:bg-black/20"
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 scrollbar-none">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-40 rounded-3xl bg-black/5 dark:bg-white/5 animate-pulse" />
              ))
            ) : models.map(m => {
              const dl = modelDl[m.id] ?? { active: false, pct: 0 };
              const isSelected = activeModelId === m.id;
              
              return (
                <GlassCard 
                  key={m.id} 
                  hoverable 
                  className={`p-4 group relative overflow-hidden transition-all duration-300 ${isSelected ? 'border-[var(--primary-color)]/50 ring-1 ring-[var(--primary-color)]/20' : 'border-white/60 dark:border-white/10'}`}
                  onClick={() => m.installed && setActiveModelId(m.id)}
                >
                  <div className="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-[var(--primary-color)]/5 blur-2xl group-hover:bg-[var(--primary-color)]/10 transition-all" />
                  
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-white/20">
                        <User className="w-5 h-5 text-indigo-500/70" />
                      </div>
                      <div>
                        <div className="text-[12px] font-black truncate max-w-[120px]">{m.name}</div>
                        <div className="text-[9px] text-gray-400 font-bold">@ {m.author}</div>
                      </div>
                    </div>
                    {m.installed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500/60" />
                    ) : (
                      <span className="text-[9px] font-mono text-gray-400 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded uppercase">{m.size}</span>
                    )}
                  </div>

                  <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2 h-7 leading-relaxed mb-4">
                    {m.description || "一个极具特色的 RVC 音色模型，适合多种直播场景。"}
                  </p>

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex gap-1">
                      {m.tags.slice(0, 2).map(t => (
                        <span key={t} className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 text-[8px] text-gray-400 font-black uppercase">{t}</span>
                      ))}
                    </div>
                    {dl.active ? (
                      <div className="flex items-center gap-2 flex-1">
                        <div className="flex-1 h-1 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-[var(--primary-color)]" style={{ width: `${dl.pct}%` }} />
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); cancelModel(m.id); }} className="p-1 hover:text-red-500 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : m.installed ? (
                      <Button 
                        size="xs" 
                        variant={isSelected ? 'primary' : 'outline'} 
                        className="h-7 px-3 text-[10px] font-black"
                      >
                        {isSelected ? '当前使用' : '使用此音色'}
                      </Button>
                    ) : (
                      <Button 
                        size="xs" 
                        variant="default" 
                        className="h-7 px-3 text-[10px] font-black gap-1.5"
                        onClick={(e) => { e.stopPropagation(); handleDownload(m.id); }}
                      >
                        <CloudDownload className="w-3 h-3" />
                        下载安装
                      </Button>
                    )}
                  </div>
                </GlassCard>
              );
            })}
          </div>
        </div>
      </div>

      {/* Control Panel */}
      <GlassCard className="shrink-0 p-4 border-t border-white/20 bg-white/30 dark:bg-white/5 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="space-y-1">
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">变声延迟</div>
            <div className="flex items-center gap-3">
              <input type="range" className="w-24 accent-[var(--primary-color)]" min="64" max="512" step="64" />
              <span className="text-[11px] font-mono font-bold text-[var(--primary-color)]">128ms</span>
            </div>
          </div>
          <div className="w-px h-8 bg-black/5 dark:bg-white/10" />
          <div className="space-y-1">
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">干湿比</div>
            <div className="flex items-center gap-3">
              <input type="range" className="w-24 accent-[var(--primary-color)]" min="0" max="100" />
              <span className="text-[11px] font-mono font-bold">100%</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-[10px] text-gray-400 font-bold leading-none">正在处理音频</div>
            <div className="text-[11px] font-mono text-emerald-500 font-bold">Latency: 42ms</div>
          </div>
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-emerald-500" />
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
