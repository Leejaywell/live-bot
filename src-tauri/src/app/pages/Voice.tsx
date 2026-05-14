import { useState, useEffect, useRef, useCallback } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Toggle } from '../components/Toggle';
import { cn } from '../lib/utils';
import { api, AppConfig } from '../lib/api';
import { Link } from 'react-router-dom';
import { Mic, MicOff, ChevronDown, Cpu, MessageSquareText, Settings as SettingsIcon, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { TtsProvider, availableProviders, findVoice } from '../lib/voices';
import { VoicePicker } from '../components/VoicePicker';

// ── 动画 ───────────────────────────────────────────────────────────────────────

const STYLES = `
@keyframes wave-bar {
  0%, 100% { transform: scaleY(0.15); }
  50%       { transform: scaleY(1);   }
}
@keyframes sub-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0);   }
}
@keyframes mic-ring {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(1.9); opacity: 0;   }
}
@keyframes dot-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
@keyframes ripple-expand {
  0%   { transform: scale(0.5); opacity: 0.55; }
  100% { transform: scale(3.2); opacity: 0;    }
}
@keyframes ripple-bg {
  0%, 100% { opacity: 0.04; }
  50%       { opacity: 0.10; }
}
`;

// ── 类型 ───────────────────────────────────────────────────────────────────────

type MicState = 'off' | 'listening' | 'speaking';

interface SubLine {
  id: string;
  role: 'user' | 'ai';
  text: string;
  fresh: boolean;
}

// ── 工具 ───────────────────────────────────────────────────────────────────────

function parseLog(text: string): SubLine | null {
  if (text.startsWith('弹幕 ')) {
    const rest = text.slice(3);
    const idx  = rest.indexOf(': ');
    if (idx < 0) return null;
    return { id: `${Date.now()}-${Math.random()}`, role: 'user', text: rest.slice(idx + 2), fresh: true };
  }
  const m = text.match(/^\[([^\]]+)\](.+)$/);
  if (m) return { id: `${Date.now()}-${Math.random()}`, role: 'ai', text: m[2], fresh: true };
  return null;
}

// ── 字幕波浪 ───────────────────────────────────────────────────────────────────

function SubWave({ role }: { role: 'user' | 'ai' }) {
  const color = role === 'ai' ? 'var(--primary-color)' : '#6b7280';
  return (
    <span className="inline-flex items-end gap-[2px] ml-1.5 shrink-0" style={{ height: 11 }}>
      {[0, 1, 2, 3, 4].map(i => (
        <span key={i} className="w-[2.5px] rounded-full inline-block"
          style={{
            background: color,
            height: '100%',
            animation: `wave-bar ${0.48 + (i % 3) * 0.14}s ease-in-out infinite`,
            animationDelay: `${i * 0.075}s`,
          }} />
      ))}
    </span>
  );
}

// ── 麦克风波形（横跨全宽） ─────────────────────────────────────────────────────

function FullWave({ active, color, barCount = 40 }: {
  active: boolean; color: string; barCount?: number;
}) {
  return (
    <div className="flex items-end justify-center gap-[3px] w-full" style={{ height: 48 }}>
      {Array.from({ length: barCount }, (_, i) => {
        const mid  = Math.floor(barCount / 2);
        const dist = Math.abs(i - mid);
        const maxH = Math.max(10, 100 - dist * 3.5);
        return (
          <div key={i} className="rounded-full origin-bottom flex-1 max-w-[5px]"
            style={{
              background: color,
              height: `${maxH}%`,
              animation: active ? `wave-bar ${0.5 + (i % 7) * 0.065}s ease-in-out infinite` : 'none',
              animationDelay: `${i * 0.038}s`,
              transform: active ? undefined : 'scaleY(0.1)',
              opacity:   active ? 1 : 0.12,
              transition: 'transform 0.4s, opacity 0.4s',
            }} />
        );
      })}
    </div>
  );
}

// ── 下拉 ───────────────────────────────────────────────────────────────────────

function GlassSelect({ value, onChange, options, disabled, emptyHint }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean; emptyHint?: string;
}) {
  if (options.length === 0) {
    return (
      <Link to="/models"
        className="flex items-center gap-1 h-[30px] px-2.5 rounded-xl text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 whitespace-nowrap">
        <Cpu className="w-3 h-3 shrink-0" />{emptyHint ?? '未配置'}
      </Link>
    );
  }
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        className="h-[30px] pl-2.5 pr-7 rounded-xl appearance-none text-[11px] cursor-pointer
                   bg-white/60 dark:bg-white/8 border border-gray-200 dark:border-white/15
                   focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/40
                   text-gray-700 dark:text-gray-100 disabled:opacity-40">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
    </div>
  );
}

// ── 主组件 ─────────────────────────────────────────────────────────────────────

export function Voice() {
  const [config,  setConfig]  = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [llmId,      setLlmId]      = useState('');
  const [asrId,      setAsrId]      = useState('');
  const [ttsId,      setTtsId]      = useState('');
  const [ttsVoice,   setTtsVoice]   = useState('zh-CN-XiaoxiaoNeural');
  const [voiceOpen,  setVoiceOpen]  = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);   // TTS 默认关闭
  const [asrEnabled, setAsrEnabled] = useState(false);   // 等配置加载后再设

  const [micState,  setMicState]  = useState<MicState>('off');
  const [subtitles, setSubtitles] = useState<SubLine[]>([]);
  const [latency,   setLatency]   = useState(0);

  // 模型状态
  const [modelStatus, setModelStatus] = useState<{ vad_model_ok: boolean; asr_local_model_ok: boolean; asr_model_dir: string } | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subRef    = useRef<HTMLDivElement>(null);

  // ── 加载 ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      api.loadConfig(),
      api.checkVoiceModels().catch(() => null),
    ]).then(([cfg, models]) => {
      setConfig(cfg);
      setModelStatus(models);
      // LLM: 优先用已保存的 active_provider_id，否则找第一个启用的
      const llm = cfg.AiProviders.find(p => p.Id === cfg.ActiveProviderId)
        || cfg.AiProviders.find(p => (p.ProviderType === 'llm' || !p.ProviderType) && p.Enabled);
      // ASR: 优先用已保存的 active_asr_provider_id
      const asr = cfg.AiProviders.find(p => p.Id === cfg.ActiveAsrProviderId)
        || cfg.AiProviders.find(p => p.ProviderType === 'asr' && p.Enabled);
      // TTS: 优先用已保存的 active_tts_provider_id
      const tts = cfg.AiProviders.find(p => p.Id === cfg.ActiveTtsProviderId)
        || cfg.AiProviders.find(p => p.ProviderType === 'tts' && p.Enabled);
      if (llm) setLlmId(llm.Id);
      if (asr) setAsrId(asr.Id);
      if (tts) setTtsId(tts.Id);
      if (cfg.TtsVoice) setTtsVoice(cfg.TtsVoice);
      setTtsEnabled(cfg.TtsEnabled ?? false);
      if (asr) setAsrEnabled(true);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const scheduleSave = useCallback((patch: Partial<AppConfig>) => {
    setConfig(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => api.saveConfig(next).catch(console.error), 600);
      return next;
    });
  }, []);

  const onLlmChange  = (id: string) => { setLlmId(id);  scheduleSave({ ActiveProviderId: id }); };
  const onAsrChange  = (id: string) => { setAsrId(id); scheduleSave({ ActiveAsrProviderId: id }); };
  const onTtsChange  = (id: string) => { setTtsId(id); scheduleSave({ ActiveTtsProviderId: id }); };
  const onTtsToggle  = (v: boolean) => { setTtsEnabled(v); scheduleSave({ TtsEnabled: v }); };
  const onVoiceChange  = (v: string) => { setTtsVoice(v); scheduleSave({ TtsVoice: v }); };
  const onAsrToggle  = (v: boolean) => {
    setAsrEnabled(v);
    // 关闭 ASR 时同时关闭麦克风
    if (!v && micState !== 'off') { setMicState('off'); setLatency(0); }
    scheduleSave({ VadEnabled: v });
  };

  // ── 监控同步 ────────────────────────────────────────────────────────────────

  useEffect(() => {
    let unl: (() => void) | undefined;
    api.onMonitorStatus(s => {
      if (s !== '运行中') { setMicState('off'); setLatency(0); }
    }).then(f => { unl = f; });
    return () => unl?.();
  }, []);

  // ── 实时字幕 ────────────────────────────────────────────────────────────────

  useEffect(() => {
    let unl: (() => void) | undefined;
    api.onMonitorLog(text => {
      const sub = parseLog(text);
      if (!sub) return;
      setSubtitles(prev => [...prev, sub].slice(-60));
      setTimeout(() => {
        setSubtitles(prev => prev.map(s => s.id === sub.id ? { ...s, fresh: false } : s));
      }, 2200);
    }).then(f => { unl = f; });
    return () => unl?.();
  }, []);

  useEffect(() => {
    if (subRef.current) subRef.current.scrollTop = subRef.current.scrollHeight;
  }, [subtitles]);

  // ── 延迟模拟 ────────────────────────────────────────────────────────────────

  useEffect(() => {
    let unl: (() => void) | undefined;
    api.onSessionSummary(() => {
      setLatency(p => Math.max(55, Math.min(480, p + (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 22))));
    }).then(f => { unl = f; });
    return () => unl?.();
  }, []);

  // ── 麦克风 ──────────────────────────────────────────────────────────────────

  const hasAsrConfig  = asrList(config).length > 0 && !!asrId && asrEnabled;
  const vadModelOk    = modelStatus?.vad_model_ok ?? false;
  // ASR 可用条件：有外部 ASR URL（provider 或旧版配置）或本地模型完整
  const hasAnyAsrUrl  = !!(config?.AsrUrl) || asrList(config).some(p => p.Id === asrId && !!p.APIUrl);
  const asrModelOk    = hasAnyAsrUrl || (modelStatus?.asr_local_model_ok ?? false);
  const micEnabled    = hasAsrConfig && vadModelOk && asrModelOk;

  // 麦克风不可用的原因
  const micBlockReasons: string[] = [];
  if (!vadModelOk) micBlockReasons.push('缺少 VAD 模型（silero_vad.onnx）');
  if (hasAsrConfig && !asrModelOk) micBlockReasons.push('缺少 ASR 模型且未配置外部 ASR 地址');
  if (!hasAsrConfig) micBlockReasons.push('请先在「模型服务」中添加并启用 ASR 服务');

  const handleMicClick = async () => {
    if (!vadModelOk) {
      toast.error('缺少 VAD 模型文件，请下载后重试', { description: 'assets/models/silero_vad.onnx' });
      return;
    }
    if (!asrModelOk) {
      toast.error('缺少 ASR 模型文件且未配置外部 ASR 地址', {
        description: '请在模型服务中添加 ASR 服务（如 FunASR），或下载本地 SenseVoice 模型',
      });
      return;
    }
    if (asrList(config).length === 0) {
      toast.error('请先在「模型服务」中添加 ASR 语音识别服务');
      return;
    }
    if (!asrEnabled) {
      toast.error('请先开启 ASR 语音识别开关');
      return;
    }
    if (!asrId) {
      toast.error('请选择 ASR 服务');
      return;
    }
    if (micState === 'off') {
      // 开启：同步保存 vad_enabled=true，再重启 monitor 让 VAD 生效
      const updated = { ...config!, VadEnabled: true };
      setConfig(updated);
      try {
        await api.saveConfig(updated);
        await api.stopMonitor().catch(() => {});
        await api.startMonitor();
        setMicState('listening');
        setLatency(0);
        toast.success('语音识别已开启');
      } catch (e) {
        toast.error(`开启失败: ${e}`);
      }
    } else {
      // 关闭：同步保存 vad_enabled=false，重启 monitor 恢复普通模式
      const updated = { ...config!, VadEnabled: false };
      setConfig(updated);
      await api.saveConfig(updated);
      await api.stopMonitor().catch(() => {});
      await api.startMonitor().catch(() => {});
      setMicState('off');
      setLatency(0);
      toast.success('语音识别已关闭');
    }
  };

  // ── 派生 ────────────────────────────────────────────────────────────────────

  const micActive = micState !== 'off';
  const micColor  = micState === 'speaking' ? '#34c759' : 'var(--primary-color)';

  const llmOpts = llmList(config).map(p => ({ value: p.Id, label: p.Name }));
  const asrOpts = asrList(config).map(p => ({ value: p.Id, label: p.Name }));
  const ttsOpts = ttsList(config).map(p => ({ value: p.Id, label: p.Name }));

  const latestFresh = subtitles.filter(s => s.fresh).at(-1);

  if (loading) return <div className="h-full flex items-center justify-center text-gray-400 text-[12px]">加载中...</div>;

  return (
    <>
      <style>{STYLES}</style>
      <div className="h-full flex flex-col gap-4 p-5 overflow-hidden">

        {/* ══ 上栏：服务配置 + 麦克风 ════════════════════════════════════════ */}
        <div className="flex items-center justify-between shrink-0 bg-white/40 dark:bg-white/5 border border-white/60 dark:border-white/10 rounded-[24px] px-6 py-3 shadow-xl">
          <div className="flex items-center gap-6">

            {/* LLM */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">LLM</span>
              <GlassSelect value={llmId} onChange={onLlmChange} options={llmOpts} emptyHint="去配置" />
            </div>

            <div className="w-px h-4 bg-black/10 dark:bg-white/10" />

            {/* ASR */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">ASR</span>
              <Toggle checked={asrEnabled} onChange={onAsrToggle} />
              <GlassSelect value={asrId} onChange={onAsrChange} options={asrOpts} disabled={!asrEnabled} emptyHint="去配置" />
            </div>

            <div className="w-px h-4 bg-black/10 dark:bg-white/10" />

            {/* TTS */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">TTS</span>
              <Toggle checked={ttsEnabled} onChange={onTtsToggle} />
              <GlassSelect value={ttsId} onChange={onTtsChange} options={ttsOpts} disabled={!ttsEnabled} emptyHint="去配置" />

              {/* 声音选择按钮 */}
              {ttsEnabled && ttsOpts.length > 0 && (
                <button
                  onClick={() => setVoiceOpen(true)}
                  className="flex items-center gap-2 h-[34px] px-4 rounded-full text-[11px] font-bold
                             bg-white/80 dark:bg-white/10 border border-white/40
                             hover:bg-white transition-all text-gray-600 dark:text-gray-200"
                >
                  <span>
                    {(() => {
                      const v = (['edge_tts','minimax_tts','volcano_engine'] as TtsProvider[]).reduce<TtsProvider | undefined>((found, p) => found ?? findVoice(p, ttsVoice), undefined);
                      return v ? `${v.name}` : (ttsVoice || '声音');
                    })()}
                  </span>
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center text-gray-400 transition-all"><SettingsIcon className="w-4 h-4" /></button>
            <button
              onClick={handleMicClick}
              className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg active:scale-95",
                micActive 
                  ? "bg-white text-[var(--primary-color)]" 
                  : "bg-black/5 dark:bg-white/10 text-gray-400"
              )}
            >
              {micActive ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* ══ 下栏：实时字幕 ══════════════════════════════════════════════════ */}
        <GlassCard className="flex-1 flex flex-col overflow-hidden border-white/60 dark:border-white/10 bg-white/60 dark:bg-black/20 shadow-2xl">
          {/* header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-black/5 dark:border-white/8 bg-white/40 dark:bg-black/10 shrink-0">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full transition-colors ${micActive ? 'bg-[var(--primary-color)] animate-pulse' : 'bg-gray-300'}`} />
              <span className="text-[12px] font-bold text-gray-600 dark:text-gray-300">实时字幕</span>
              {micActive && latency > 0 && (
                <span className="text-[10px] text-gray-400 ml-2">{latency}ms</span>
              )}
            </div>
            <button onClick={() => setSubtitles([])} className="h-7 px-3 rounded-full border border-gray-200 dark:border-white/15 text-[10px] font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-white/60 transition-all">
              清空
            </button>
          </div>

          {/* subtitle content */}
          <div ref={subRef} className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-none">
            {subtitles.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 opacity-25 select-none">
                <MessageSquareText className="w-16 h-16 text-gray-400" />
                <p className="text-[13px] font-bold tracking-wide text-gray-400">开启麦克风后，实时字幕将显示在此处</p>
              </div>
            ) : (
              subtitles.map(sub => (
                <div key={sub.id} className={`flex ${sub.role === 'user' ? 'justify-end' : 'justify-start'} ${sub.fresh ? 'animate-in slide-in-from-bottom-2 duration-300' : ''}`}>
                  <div className={cn(
                    "max-w-[82%] px-4 py-2.5 rounded-2xl text-[13px] shadow-sm",
                    sub.role === 'user'
                      ? "bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200 rounded-br-sm"
                      : "bg-[var(--primary-color)] text-white rounded-bl-sm"
                  )}>
                    {sub.text}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* wave at bottom */}
          <div className="px-6 pb-5 pt-2 shrink-0">
            <FullWave active={micActive} color={micActive ? 'var(--primary-color)' : '#d1d5db'} barCount={64} />
          </div>
        </GlassCard>
      </div>

      <VoicePicker
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        providers={config ? availableProviders((config.AiProviders ?? []).filter(p => p.ProviderType === 'tts').map(p => p.Name)) : ['edge_tts']}
        currentVoice={ttsVoice}
        onSelect={v => { setTtsVoice(v); onVoiceChange(v); }}
      />
    </>
  );
}

// ── 工具：从 config 过滤各类 provider ─────────────────────────────────────────

function llmList(config: AppConfig | null) {
  return (config?.AiProviders ?? []).filter(p => (p.ProviderType === 'llm' || !p.ProviderType) && p.Enabled);
}
function asrList(config: AppConfig | null) {
  return (config?.AiProviders ?? []).filter(p => p.ProviderType === 'asr' && p.Enabled);
}
function ttsList(config: AppConfig | null) {
  return (config?.AiProviders ?? []).filter(p => p.ProviderType === 'tts' && p.Enabled);
}
