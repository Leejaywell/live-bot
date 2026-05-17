import React, { useState, useEffect, useCallback } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { Toggle } from '../components/Toggle';
import { api, VoiceChangerState } from '../lib/api';
import { useConfig } from '../context/ConfigContext';
import { 
  Mic, 
  Search, 
  CheckCircle2, 
  X, 
  Activity,
  User,
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
  onnx_ready: boolean;
  size: string;
  avatar?: string;
}

export function VoiceChanger() {
  const { config, modelDl, cancelModel, downloadModel, updateConfig } = useConfig();
  const [searchQuery, setSearchQuery] = useState('');
  const [models, setModels] = useState<RvcModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [state, setState] = useState<VoiceChangerState | null>(null);
  const [pendingDownloads, setPendingDownloads] = useState<Record<string, boolean>>({});
  const [converting, setConverting] = useState<Record<string, boolean>>({});
  const [selectedTag, setSelectedTag] = useState('全部');

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

  const refreshState = useCallback(async () => {
    try {
      const next = await api.getVoiceChangerState();
      setState(next);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchModels();
    refreshState();
  }, [fetchModels, refreshState]);

  useEffect(() => {
    if (!config) return;
    if (state?.running && state.model_id) {
      setActiveModelId(state.model_id);
    } else if (!activeModelId && config.VoiceChangerModelId) {
      setActiveModelId(config.VoiceChangerModelId);
    }
  }, [config, state, activeModelId]);

  useEffect(() => {
    if (!state?.running) return;
    const timer = window.setInterval(() => {
      refreshState();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state?.running, refreshState]);

  useEffect(() => {
    const hasFinished = Object.entries(modelDl).some(([, dl]) => !dl.active && dl.pct === 100);
    if (hasFinished) {
      fetchModels(searchQuery);
    }
  }, [modelDl, fetchModels, searchQuery]);

  const ALL_TAGS = ['全部', '热门', '原神', '星穹铁道', '崩坏3', '虚拟歌手', '国漫', '动漫', '女声', '男声', '御姐', '萝莉', '少女', '温柔', '活泼', '甜美', '元气', '仙气', '冷感', '清冷', '中二', '戏剧', '神秘', '傲娇', '干练', '豪迈', '清纯', '少年', '低沉', '大叔', '磁性', '热血'];

  const filteredModels = selectedTag === '全部' ? models : models.filter(m => m.tags.includes(selectedTag));

  const isActive = state?.running ?? false;
  const inputGain = Math.min(config?.VoiceChangerInputGain ?? 1, 2);
  const wetMix = Math.min(config?.VoiceChangerWetMix ?? 1, 1);
  const frameMs = Math.min(config?.VoiceChangerFrameMs ?? 40, 80);

  const toggleVoiceChanger = async () => {
    try {
      if (isActive) {
        await api.stopVoiceChanger();
        await refreshState();
        toast.info('变声器已关闭');
      } else {
        if (!activeModelId) {
          toast.error('请先选择一个已安装的音色模型');
          return;
        }
        await api.startVoiceChanger(activeModelId, inputGain, wetMix, frameMs);
        await updateConfig({ VoiceChangerModelId: activeModelId });
        await refreshState();
        toast.success('变声器已开启');
      }
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const handleDownload = async (id: string) => {
    setPendingDownloads(prev => ({ ...prev, [id]: true }));
    toast.info('开始下载模型…');
    try {
      await downloadModel(id);
      await fetchModels(searchQuery);
    } catch (err) {
      toast.error(`下载失败: ${err}`);
    } finally {
      setPendingDownloads(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleConvert = async (id: string) => {
    setConverting(prev => ({ ...prev, [id]: true }));
    toast.info('正在转换模型格式，请稍候…');
    try {
      const msg = await api.convertRvcPthToOnnx(id);
      toast.success(msg);
      await fetchModels(searchQuery);
    } catch (err) {
      toast.error(`转换失败: ${err}`, { duration: 8000 });
    } finally {
      setConverting(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleSelectModel = async (id: string) => {
    setActiveModelId(id);
    try {
      await updateConfig({ VoiceChangerModelId: id });
      if (isActive && id !== state?.model_id) {
        await api.switchVoiceChangerModel(id, inputGain, wetMix, frameMs);
        await refreshState();
        toast.success('已切换变声音色');
      }
    } catch (err) {
      toast.error(`切换失败: ${err}`);
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
                    正在运行 - {models.find(m => m.id === (state?.model_id || activeModelId))?.name || state?.model_id || '未知模型'}
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
          <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">运行状态</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-1 text-[11px]">
            <div className="text-gray-400">处理帧数</div>
            <div className="font-mono text-right">{state?.processed_frames ?? 0}</div>
            <div className="text-gray-400">输出延迟</div>
            <div className="font-mono text-right">{state?.output_latency_ms ?? 0}ms</div>
            <div className="text-gray-400">最近错误</div>
            <div className="text-right text-amber-600 dark:text-amber-400 truncate">
              {state?.last_error || '无'}
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Model Gallery Section */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-1">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <h2 className="text-[13px] font-black text-gray-400 uppercase tracking-widest shrink-0">音色模型库</h2>
            <div className="h-4 w-px bg-black/5 dark:bg-white/10 shrink-0" />
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
              {ALL_TAGS.map(tag => (
                <span
                  key={tag}
                  onClick={() => setSelectedTag(tag)}
                  className={`px-2 py-0.5 rounded-md text-[10px] cursor-pointer transition-colors font-bold shrink-0 ${
                    selectedTag === tag
                      ? 'bg-[var(--primary-color)] text-white'
                      : 'bg-black/5 dark:bg-white/5 text-gray-500 hover:text-[var(--primary-color)]'
                  }`}
                >{tag}</span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-4 gap-2 border-dashed border-gray-300 dark:border-white/20"
              onClick={() => toast.info('请将 RVC 模型放到缓存目录的 rvc/<模型ID>/ 下。支持直接放 model.onnx；若只有 model.pth，启动时会自动尝试转换。')}
            >
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
            ) : filteredModels.length === 0 ? (
              <div className="col-span-3 py-16 text-center text-gray-400 text-[12px]">没有符合「{selectedTag}」标签的模型</div>
            ) : filteredModels.map(m => {
              const dl = modelDl[m.id] ?? { active: false, pct: 0 };
              const isPending = !m.installed && (pendingDownloads[m.id] || dl.active);
              const isSelected = activeModelId === m.id;
              const isPthOnly = m.installed && !m.onnx_ready;
              
              return (
                <GlassCard 
                  key={m.id} 
                  hoverable 
                  className={`p-4 group relative overflow-hidden transition-all duration-300 ${isSelected ? 'border-[var(--primary-color)]/50 ring-1 ring-[var(--primary-color)]/20' : 'border-white/60 dark:border-white/10'}`}
                  onClick={() => m.onnx_ready && setActiveModelId(m.id)}
                >
                  <div className="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-[var(--primary-color)]/5 blur-2xl group-hover:bg-[var(--primary-color)]/10 transition-all" />
                  
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-white/20 text-xl select-none">
                        {m.avatar ? m.avatar : <User className="w-5 h-5 text-indigo-500/70" />}
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
                    {isPending ? (
                      <div className="flex items-center gap-2 flex-1">
                        <div className="flex-1 h-1 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`h-full bg-[var(--primary-color)] ${dl.pct === 0 ? 'animate-pulse w-full opacity-60' : ''}`}
                            style={{ width: dl.pct > 0 ? `${dl.pct}%` : undefined }}
                          />
                        </div>
                        <span className="text-[9px] font-mono text-gray-400 min-w-[36px] text-right">
                          {dl.stage === 'converting'
                            ? '转换中'
                            : dl.stage === 'extracting'
                            ? '解压中'
                            : dl.pct > 0
                            ? `${dl.pct}%`
                            : (dl.downloaded_mb ? `${dl.downloaded_mb}MB` : '准备中')}
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); cancelModel(m.id); }} className="p-1 hover:text-red-500 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : isPthOnly ? (
                      <Button
                        size="xs"
                        variant="outline"
                        className="h-7 px-3 text-[10px] font-black gap-1.5 border-amber-400/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                        disabled={converting[m.id]}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConvert(m.id);
                        }}
                      >
                        {converting[m.id] ? '转换中…' : '转为 ONNX'}
                      </Button>
                    ) : m.installed ? (
                      <Button
                        size="xs"
                        variant={isSelected ? 'primary' : 'outline'}
                        className="h-7 px-3 text-[10px] font-black"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectModel(m.id);
                        }}
                      >
                        {isSelected ? '当前使用' : (isActive ? '切换到此音色' : '使用此音色')}
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="default"
                        className="h-7 px-3 text-[10px] font-black gap-1.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(m.id);
                        }}
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
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">输入增益</div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                className="w-24 accent-[var(--primary-color)]"
                min="0"
                max="2"
                step="0.1"
                value={inputGain}
                onChange={(e) => updateConfig({ VoiceChangerInputGain: Number(e.target.value) }).catch(() => {})}
              />
              <span className="text-[11px] font-mono font-bold text-[var(--primary-color)]">{inputGain.toFixed(1)}x</span>
            </div>
          </div>
          <div className="w-px h-8 bg-black/5 dark:bg-white/10" />
          <div className="space-y-1">
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">干湿比</div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                className="w-24 accent-[var(--primary-color)]"
                min="0"
                max="1"
                step="0.05"
                value={wetMix}
                onChange={(e) => updateConfig({ VoiceChangerWetMix: Number(e.target.value) }).catch(() => {})}
              />
              <span className="text-[11px] font-mono font-bold">{Math.round(wetMix * 100)}%</span>
            </div>
          </div>
          <div className="w-px h-8 bg-black/5 dark:bg-white/10" />
          <div className="space-y-1">
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">处理帧长</div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                className="w-24 accent-[var(--primary-color)]"
                min="20"
                max="80"
                step="10"
                value={frameMs}
                onChange={(e) => updateConfig({ VoiceChangerFrameMs: Number(e.target.value) }).catch(() => {})}
              />
              <span className="text-[11px] font-mono font-bold">{frameMs}ms</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-[10px] text-gray-400 font-bold leading-none">{isActive ? '正在处理音频' : '等待启动'}</div>
            <div className="text-[11px] font-mono text-emerald-500 font-bold">Latency: {state?.output_latency_ms ?? 0}ms</div>
          </div>
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-emerald-500" />
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
