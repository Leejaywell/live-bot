import { useState, useEffect, useRef, useCallback } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Toggle } from '../components/Toggle';
import { cn } from '../lib/utils';
import { api, AppConfig } from '../lib/api';
import { Link } from 'react-router-dom';
import { Mic, MicOff, ChevronDown, Cpu, MessageSquareText, Activity, AlertCircle, AlertTriangle } from 'lucide-react';
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
      <div className="h-full flex flex-col gap-3 p-4 overflow-hidden">

        {/* ══ 上栏：服务配置 + 麦克风 ════════════════════════════════════════ */}
        <GlassCard className="shrink-0 px-5 py-4">
          <div className="flex items-center gap-4 flex-wrap">

            {/* LLM */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 whitespace-nowrap font-medium">LLM</span>
              <GlassSelect value={llmId} onChange={onLlmChange} options={llmOpts} emptyHint="去配置" />
            </div>

            <div className="w-px h-4 bg-black/8 dark:bg-white/12 shrink-0" />

            {/* ASR */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 whitespace-nowrap font-medium">ASR</span>
              <Toggle checked={asrEnabled} onChange={onAsrToggle} />
              <GlassSelect value={asrId} onChange={onAsrChange} options={asrOpts} disabled={!asrEnabled} emptyHint="去配置" />
              {/* 模型缺失警告 */}
              {modelStatus && !vadModelOk && (
                <span className="flex items-center gap-1 text-[10px] text-red-500" title={modelStatus.asr_model_dir}>
                  <AlertTriangle className="w-3 h-3" />缺少 VAD 模型
                </span>
              )}
              {modelStatus && vadModelOk && !asrModelOk && hasAsrConfig && (
                <span className="flex items-center gap-1 text-[10px] text-amber-500">
                  <AlertCircle className="w-3 h-3" />缺少 ASR 模型 — 请到「模型服务」页下载
                </span>
              )}
              {asrList(config).length === 0 && (
                <span className="flex items-center gap-1 text-[10px] text-amber-500">
                  <AlertCircle className="w-3 h-3" />麦克风需要 ASR
                </span>
              )}
            </div>

            <div className="w-px h-4 bg-black/8 dark:bg-white/12 shrink-0" />

            {/* TTS */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 whitespace-nowrap font-medium">TTS</span>
              <Toggle checked={ttsEnabled} onChange={onTtsToggle} />
              <GlassSelect value={ttsId} onChange={onTtsChange} options={ttsOpts} disabled={!ttsEnabled} emptyHint="去配置" />

              {/* 声音选择按钮 */}
              {ttsEnabled && ttsOpts.length > 0 && (
                <>
                  <button
                    onClick={() => setVoiceOpen(true)}
                    className="flex items-center gap-1 h-[30px] pl-2.5 pr-2.5 rounded-xl text-[11px]
                               bg-white/60 dark:bg-white/8 border border-gray-200 dark:border-white/15
                               hover:bg-white/80 dark:hover:bg-white/15 transition-colors
                               text-gray-600 dark:text-gray-300 max-w-[170px] truncate"
                    title={ttsVoice}
                  >
                    <span className="truncate">
                      {(() => {
                        const v = (['edge_tts','minimax_tts','volcano_engine'] as TtsProvider[]).reduce<TtsProvider | undefined>((found, p) => found ?? findVoice(p, ttsVoice), undefined);
                        return v ? `${v.name}` : (ttsVoice || '选择声音');
                      })()}
                    </span>
                    <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
                  </button>
                </>
              )}
            </div>
            <VoicePicker
              open={voiceOpen}
              onClose={() => setVoiceOpen(false)}
              providers={config ? availableProviders((config.AiProviders ?? []).filter(p => p.ProviderType === 'tts').map(p => p.Name)) : ['edge_tts']}
              currentVoice={ttsVoice}
              onSelect={v => { setTtsVoice(v); onVoiceChange(v); }}
            />

            <div className="flex-1" />

            {/* 状态 + 延迟 */}
            <div className="flex items-center gap-2">
              {micActive && latency > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-gray-400 font-mono">
                  <Activity className="w-3 h-3" />{latency}ms
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <div className="w-[6px] h-[6px] rounded-full transition-all"
                  style={{
                    background:  micActive ? '#34c759' : '#d1d5db',
                    boxShadow:   micActive ? '0 0 6px #34c75988' : 'none',
                    animation:   micActive ? 'dot-blink 1.4s ease-in-out infinite' : 'none',
                  }} />
                <span className={cn('text-[10px] font-medium', micActive ? 'text-emerald-500 dark:text-emerald-400' : 'text-gray-400')}>
                  {micState === 'off' ? '空闲' : micState === 'listening' ? '聆听中' : 'AI 回应'}
                </span>
              </div>
            </div>

            <div className="w-px h-4 bg-black/8 dark:bg-white/12 shrink-0" />

            {/* 麦克风按钮 */}
            <div className="relative flex items-center justify-center shrink-0">
              {micActive && (
                <>
                  <div className="absolute rounded-full pointer-events-none"
                    style={{ width: 54, height: 54, border: `1.5px solid ${micColor}`, animation: 'mic-ring 1.8s ease-out infinite' }} />
                  <div className="absolute rounded-full pointer-events-none"
                    style={{ width: 54, height: 54, border: `1.5px solid ${micColor}`, animation: 'mic-ring 1.8s ease-out infinite', animationDelay: '0.9s' }} />
                </>
              )}
              <button
                onClick={handleMicClick}
                title={!micEnabled ? micBlockReasons.join('；') : (micActive ? '点击关闭麦克风' : '点击开启麦克风')}
                className={cn(
                  'relative z-10 w-[42px] h-[42px] rounded-full flex items-center justify-center transition-all',
                  micEnabled ? 'hover:scale-105 active:scale-95' : 'cursor-not-allowed opacity-50',
                )}
                style={{
                  background: micActive
                    ? `linear-gradient(145deg, ${micColor}, ${micColor}bb)`
                    : micEnabled
                      ? 'linear-gradient(145deg, rgba(0,0,0,0.10), rgba(0,0,0,0.07))'
                      : 'rgba(0,0,0,0.05)',
                  boxShadow: micActive
                    ? `0 6px 22px ${micColor}45, 0 0 0 2px ${micColor}22`
                    : '0 2px 10px rgba(0,0,0,0.08)',
                }}>
                {micActive
                  ? <Mic    className="w-5 h-5 text-white" />
                  : <MicOff className={cn('w-5 h-5', micEnabled ? 'text-gray-500' : 'text-gray-300')} />
                }
              </button>
            </div>
          </div>

          {/* 波形行（仅麦克风激活时展开） */}
          <div className={cn(
            'overflow-hidden transition-all',
            micActive ? 'max-h-[60px] mt-3.5 opacity-100' : 'max-h-0 opacity-0',
          )}>
            <FullWave active={micActive} color={micColor} barCount={50} />
          </div>
        </GlassCard>

        {/* ══ 下栏：实时字幕 ══════════════════════════════════════════════════ */}
        <GlassCard className="flex-1 flex flex-col overflow-hidden min-h-0 relative">
          {/* 语音激活时的波纹背景特效 */}
          {micActive && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden rounded-[18px]">
              {/* 脉冲背景光晕 */}
              <div className="absolute w-[500px] h-[500px] rounded-full"
                style={{
                  background: `radial-gradient(circle, ${micColor}18 0%, transparent 65%)`,
                  animation: 'ripple-bg 2.4s ease-in-out infinite',
                }} />
              {/* 三层涟漪圆环 */}
              {[0, 0.8, 1.6].map((delay, i) => (
                <div key={i} className="absolute rounded-full border"
                  style={{
                    width: 120 + i * 80,
                    height: 120 + i * 80,
                    borderColor: `${micColor}35`,
                    animation: `ripple-expand 2.8s ease-out infinite`,
                    animationDelay: `${delay}s`,
                  }} />
              ))}
            </div>
          )}
          {/* 头部 */}
          <div className="relative z-10 flex items-center justify-between px-5 py-3 border-b border-black/5 dark:border-white/8 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-[6px] h-[6px] rounded-full shrink-0"
                style={{
                  background:  micActive ? '#34c759' : '#d1d5db',
                  boxShadow:   micActive ? '0 0 6px #34c75980' : 'none',
                  animation:   micActive ? 'dot-blink 1.4s ease-in-out infinite' : 'none',
                }} />
              <span className="text-[12px] font-semibold">实时字幕</span>
            </div>
            {subtitles.length > 0 && (
              <button onClick={() => setSubtitles([])}
                className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors px-2 py-0.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/8">
                清空
              </button>
            )}
          </div>

          {/* 字幕内容 */}
          <div ref={subRef} className="relative z-10 flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {subtitles.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2.5 opacity-35 select-none">
                <MessageSquareText className="w-9 h-9 text-gray-400" />
                {modelStatus && (!vadModelOk || !asrModelOk) ? (
                  <div className="text-[11px] text-gray-400 text-center leading-relaxed space-y-1.5 max-w-[320px]">
                    <p className="font-semibold text-amber-500">缺少语音识别模型文件</p>
                    {!vadModelOk && (
                      <p>请下载 silero_vad.onnx 到 assets/models/ 目录</p>
                    )}
                    {vadModelOk && !asrModelOk && !hasAnyAsrUrl && (
                      <p>请到「模型服务」页添加 SenseVoice ASR 并下载模型</p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 text-center leading-relaxed">
                    {!micEnabled
                      ? '请先在「模型服务」中配置 ASR，再开启麦克风'
                      : micActive
                        ? '等待语音输入或弹幕...'
                        : '开启麦克风后，实时字幕将显示在此处'}
                  </p>
                )}
              </div>
            ) : (
              subtitles.map(s => (
                <div key={s.id}
                  className={cn('flex items-start gap-2', s.role === 'ai' ? 'justify-end' : 'justify-start')}
                  style={{ animation: 'sub-in 0.2s ease-out' }}>
                  {s.role === 'user' && (
                    <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5 bg-black/6 dark:bg-white/10 text-gray-500">
                      弹
                    </span>
                  )}
                  <div className={cn(
                    'flex items-end max-w-[80%] text-[12px] leading-relaxed transition-colors duration-700',
                    s.fresh
                      ? s.role === 'ai'
                        ? 'text-[var(--primary-color)] font-medium'
                        : 'text-gray-800 dark:text-gray-100 font-medium'
                      : 'text-gray-400 dark:text-gray-500',
                  )}>
                    {s.text}
                    {s.fresh && <SubWave role={s.role} />}
                  </div>
                  {s.role === 'ai' && (
                    <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5 bg-[var(--primary-color)]/12 text-[var(--primary-color)]">
                      AI
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* 底部最新字幕高亮 + 波浪特效 */}
          {latestFresh && (
            <div className={cn(
              'relative z-10 shrink-0 px-5 py-3 border-t flex items-center gap-2.5',
              latestFresh.role === 'ai'
                ? 'border-[var(--primary-color)]/12 bg-[var(--primary-color)]/5'
                : 'border-black/5 dark:border-white/8 bg-black/2 dark:bg-white/2',
            )}>
              <span className={cn(
                'shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full',
                latestFresh.role === 'ai'
                  ? 'bg-[var(--primary-color)]/15 text-[var(--primary-color)]'
                  : 'bg-black/8 dark:bg-white/12 text-gray-500',
              )}>
                {latestFresh.role === 'ai' ? 'AI' : '弹幕'}
              </span>
              <span className={cn(
                'flex-1 text-[13px] font-medium leading-snug truncate',
                latestFresh.role === 'ai' ? 'text-[var(--primary-color)]' : 'text-gray-800 dark:text-gray-100',
              )}>
                {latestFresh.text}
              </span>
              {/* 底部栏专属大波浪 */}
              <div className="flex items-end gap-[2.5px] shrink-0" style={{ height: 18 }}>
                {[0, 1, 2, 3, 4, 5, 6].map(i => {
                  const color = latestFresh.role === 'ai' ? 'var(--primary-color)' : '#6b7280';
                  return (
                    <div key={i} className="w-[3px] rounded-full"
                      style={{
                        background: color,
                        height: `${55 + (i % 3) * 20}%`,
                        animation: `wave-bar ${0.42 + (i % 4) * 0.11}s ease-in-out infinite`,
                        animationDelay: `${i * 0.07}s`,
                      }} />
                  );
                })}
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    </>
  );
}

// ── 工具：从 config 过滤各类 provider ─────────────────────────────────────────

function llmList(config: AppConfig | null) {
  return (config?.AiProviders ?? []).filter(p => (p.ProviderType === 'llm' || !p.ProviderType));
}
function asrList(config: AppConfig | null) {
  return (config?.AiProviders ?? []).filter(p => p.ProviderType === 'asr');
}
function ttsList(config: AppConfig | null) {
  return (config?.AiProviders ?? []).filter(p => p.ProviderType === 'tts');
}
