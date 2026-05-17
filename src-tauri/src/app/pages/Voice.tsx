import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Toggle } from '../components/Toggle';
import { Input } from '../components/Input';
import { cn } from '../lib/utils';
import { api, AppConfig } from '../lib/api';
import { Link } from 'react-router-dom';
import { Mic, MicOff, ChevronDown, Cpu, MessageSquareText, Settings as SettingsIcon, AlertCircle, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { TtsProvider, TtsVoice, availableProviders, findVoice } from '../lib/voices';
import { VoicePicker } from '../components/VoicePicker';
import { Modal, ModalCloseButton } from '../components/Modal';
import { Button } from '../components/Button';

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

type LogMicState = 'idle' | 'speaking' | 'settled';

// ── 工具 ───────────────────────────────────────────────────────────────────────

function parseLog(text: string): SubLine | null {
  if (text.startsWith('弹幕 ')) {
    const rest = text.slice(3);
    const idx  = rest.indexOf(': ');
    if (idx < 0) return null;
    return { id: `${Date.now()}-${Math.random()}`, role: 'user', text: rest.slice(idx + 2).trim(), fresh: true };
  }
  if (text.startsWith('机器人发送: ')) {
    const rest = text.slice(7);
    const m = rest.match(/^\[([^\]]+)\](.+)$/);
    if (m) return { id: `${Date.now()}-${Math.random()}`, role: 'ai', text: m[2].trim(), fresh: true };
    return { id: `${Date.now()}-${Math.random()}`, role: 'ai', text: rest.trim(), fresh: true };
  }
  const m = text.match(/^\[([^\]]+)\](.+)$/);
  if (m) {
    const tag = m[1];
    const content = m[2].trim();
    if (tag === 'ASR') {
      if (content.startsWith('识别结果: ')) {
        return { id: `${Date.now()}-${Math.random()}`, role: 'user', text: content.slice(5).trim(), fresh: true };
      }
      return null;
    }
    if (tag === 'ASR→AI') {
      return { id: `${Date.now()}-${Math.random()}`, role: 'ai', text: content, fresh: true };
    }
    // 其他带中括号的消息尝试作为 AI 回复（如直连 logs）
    return { id: `${Date.now()}-${Math.random()}`, role: 'ai', text: content, fresh: true };
  }
  return null;
}

function classifyMicLog(text: string): LogMicState {
  if (
    text.includes('[VAD] 开始录音') ||
    text.includes('[VAD] 检测到语音段')
  ) {
    return 'speaking';
  }
  if (
    text.includes('[VAD] 话轮结束') ||
    text.includes('[ASR] 识别结果:') ||
    text.includes('[ASR] 识别失败:') ||
    text.includes('[ASR→AI]')
  ) {
    return 'settled';
  }
  return 'idle';
}

function describeVoiceLog(text: string): string | null {
  if (text.includes('麦克风已就绪')) return '麦克风已开启，等待说话';
  if (text.includes('[VAD] 开始录音') || text.includes('[VAD] 检测到语音段')) return '检测到你正在说话';
  if (text.includes('[VAD] 话轮结束')) return '说话结束，正在识别';
  if (text.includes('[ASR] 识别结果:')) return '识别完成';
  if (text.includes('[ASR→AI]')) return 'AI 已收到语音内容';
  if (text.includes('[ASR] 识别失败:')) return text.replace('[ASR] ', '');
  if (text.includes('ASR 服务不可达')) return text;
  if (text.includes('麦克风启动失败')) return text;
  if (text.includes('VAD 初始化失败')) return text;
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
  const [ttsSpeed,   setTtsSpeed]   = useState(1.0);
  const [voiceOpen,  setVoiceOpen]  = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);   // TTS 默认关闭

  const [micState,    setMicState]    = useState<MicState>('off');
  const [voiceStatus, setVoiceStatus] = useState('麦克风未开启');
  const [voiceDetail, setVoiceDetail] = useState('等待语音链路事件');
  const [subtitles,   setSubtitles]   = useState<SubLine[]>([]);
  const [latency,     setLatency]     = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState({ gender: '女AI', prompt: '' });

  // 模型状态
  const [modelStatus, setModelStatus] = useState<{ model_dir: string; models: Record<string, boolean> } | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subRef    = useRef<HTMLDivElement>(null);
  const micVisualTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorRestarting = useRef(false);

  // ── 加载 ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      api.loadConfig(),
      api.checkModels().catch(() => null),
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
      if (cfg.TtsSpeed) setTtsSpeed(cfg.TtsSpeed);
      setTtsEnabled(false); // always start off; runtime-only
      setMicState(cfg.VadEnabled ? 'listening' : 'off');
      setVoiceStatus(cfg.VadEnabled ? '麦克风已开启，等待说话' : '麦克风未开启');
      setVoiceDetail(cfg.VadEnabled ? '等待语音链路事件' : '麦克风关闭中');
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

  // Sync settings modal draft when it opens
  useEffect(() => {
    if (settingsOpen && config) {
      setSettingsDraft({
        gender: config.VoiceGender ?? inferGenderFromVoice(ttsVoice),
        prompt: config.VoiceSystemPrompt ?? '',
      });
    }
  }, [settingsOpen]);

  const onLlmChange    = (id: string) => { setLlmId(id);  scheduleSave({ ActiveProviderId: id }); };
  const onAsrChange    = (id: string) => { setAsrId(id); scheduleSave({ ActiveAsrProviderId: id }); };
  const onTtsChange    = (id: string) => { setTtsId(id); scheduleSave({ ActiveTtsProviderId: id }); };
  const onTtsToggle    = (v: boolean) => { setTtsEnabled(v); };
  const onVoiceChange  = (v: string)  => { setTtsVoice(v); scheduleSave({ TtsVoice: v }); };
  const onSpeedChange  = (v: number)  => { setTtsSpeed(v); scheduleSave({ TtsSpeed: v }); };

  // ── 监控同步 ────────────────────────────────────────────────────────────────

  useEffect(() => {
    let unl: (() => void) | undefined;
    api.getMonitorStatus().then((running) => {
      if (running && config?.VadEnabled) {
        setMicState('listening');
        setVoiceStatus('麦克风已开启，等待说话');
        setVoiceDetail('等待语音链路事件');
      }
    }).catch(() => {});
    api.onMonitorStatus(s => {
      if (s === '运行中') {
        monitorRestarting.current = false;
        if (config?.VadEnabled) {
          setMicState('listening');
          setVoiceStatus('麦克风已开启，等待说话');
          setVoiceDetail('监听线程已运行，等待语音链路事件');
        }
        return;
      }
      if (!monitorRestarting.current) {
        setMicState('off');
        setVoiceStatus('麦克风未开启');
        setVoiceDetail('监听线程已停止');
        setLatency(0);
      }
    }).then(f => { unl = f; });
    return () => unl?.();
  }, [config?.VadEnabled]);

  // ── 实时字幕 ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const applyLog = (text: string) => {
      setVoiceDetail(text);
      const micLogState = classifyMicLog(text);
      const statusText = describeVoiceLog(text);
      if (statusText) setVoiceStatus(statusText);
      if (micLogState === 'speaking') {
        setMicState('speaking');
        if (micVisualTimer.current) clearTimeout(micVisualTimer.current);
        micVisualTimer.current = setTimeout(() => {
          setMicState(prev => (prev === 'off' ? prev : 'listening'));
        }, 1600);
      } else if (micLogState === 'settled') {
        if (micVisualTimer.current) clearTimeout(micVisualTimer.current);
        setMicState(prev => (prev === 'off' ? prev : 'listening'));
      }

      const sub = parseLog(text);
      if (!sub) return;
      setSubtitles(prev => [...prev, sub].slice(-60));
      setTimeout(() => {
        setSubtitles(prev => prev.map(s => s.id === sub.id ? { ...s, fresh: false } : s));
      }, 2200);
    };

    let unl: (() => void) | undefined;
    let unlBatch: (() => void) | undefined;
    api.onMonitorLog(applyLog).then(f => { unl = f; });
    api.onMonitorLogs(lines => { for (const line of lines) applyLog(line); }).then(f => { unlBatch = f; });
    return () => {
      unl?.();
      unlBatch?.();
      if (micVisualTimer.current) clearTimeout(micVisualTimer.current);
    };
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

  const currentAsrProvider = findAsrProvider(config, asrId);
  const usingBuiltInSenseVoice = currentAsrProvider?.Model === 'sensevoice' || (!currentAsrProvider && !(config?.AsrUrl));
  const usingExternalAsrService = !usingBuiltInSenseVoice && (!!currentAsrProvider?.APIUrl || !!config?.AsrUrl);
  const hasAsrProvider = asrList(config).length > 0 && !!asrId;
  const hasAsrConfig  = usingBuiltInSenseVoice ? hasAsrProvider : usingExternalAsrService;
  const vadModelOk    = modelStatus?.models['silero-vad'] ?? false;
  const asrModelOk    = usingExternalAsrService || (modelStatus?.models['sensevoice'] ?? false);
  const micEnabled    = hasAsrConfig && vadModelOk && asrModelOk;

  // 麦克风不可用的原因
  const micBlockReasons: string[] = [];
  if (!vadModelOk) micBlockReasons.push('缺少语音检测模型，请先下载模型文件');
  if (usingBuiltInSenseVoice && !asrModelOk) micBlockReasons.push('缺少 SenseVoice 本地模型，请先下载后再开启');
  if (!usingBuiltInSenseVoice && hasAsrConfig) micBlockReasons.push('当前 ASR 依赖外部 WebSocket 服务，请确认对应服务已启动');
  if (!hasAsrConfig) micBlockReasons.push('请先在「模型服务」中添加并启用语音识别服务');

  const handleMicClick = async () => {
    if (!config) {
      setVoiceDetail('配置尚未加载，无法开启麦克风');
      return;
    }
    if (!hasAsrConfig) {
      setVoiceDetail('麦克风未启动：未配置 ASR 服务');
      toast.error('请先在「模型服务」中配置语音识别服务');
      return;
    }
    if (!vadModelOk) {
      setVoiceDetail('麦克风未启动：缺少 VAD 语音检测模型');
      toast.error('缺少语音检测模型', { description: '请先在「模型服务」页下载所需模型文件' });
      return;
    }
    if (!asrModelOk) {
      setVoiceDetail('麦克风未启动：缺少 ASR 模型或外部 ASR 服务不可用');
      toast.error('缺少语音识别模型', { description: '请下载本地 SenseVoice 模型，或确认外部 ASR 服务已启动' });
      return;
    }
    const nextVad = !(config.VadEnabled);
    const updated = { ...config, VadEnabled: nextVad };
    setConfig(updated);
    monitorRestarting.current = true;
    setVoiceStatus(nextVad ? '正在开启麦克风...' : '正在关闭麦克风...');
    setVoiceDetail(nextVad ? '正在重启监听并申请麦克风链路' : '正在关闭监听和麦克风链路');
    try {
      console.info('[Voice] mic toggle requested', {
        nextVad,
        asrId,
        usingBuiltInSenseVoice,
        hasAsrConfig,
        vadModelOk,
        asrModelOk,
      });
      setVoiceDetail('正在保存麦克风配置...');
      await api.saveConfig(updated);
      setVoiceDetail('正在停止旧监听线程...');
      await api.stopMonitor().catch(() => {});
      if (nextVad) {
        setVoiceDetail('正在启动监听线程...');
        await api.startMonitor();
      }
      setMicState(nextVad ? 'listening' : 'off');
      setVoiceStatus(nextVad ? '麦克风已开启，等待说话' : '麦克风未开启');
      setVoiceDetail(nextVad ? '监听线程已启动，等待语音链路事件' : '麦克风关闭完成');
      monitorRestarting.current = false;
      toast.success(nextVad ? '麦克风已开启' : '麦克风已关闭');
    } catch (e) {
      console.error('[Voice] mic toggle failed', e);
      monitorRestarting.current = false;
      setMicState(config.VadEnabled ? 'listening' : 'off');
      setVoiceStatus(config.VadEnabled ? '麦克风已开启，等待说话' : '麦克风未开启');
      setVoiceDetail(`操作失败: ${String(e)}`);
      toast.error(`操作失败: ${e}`);
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

        {currentAsrProvider && currentAsrProvider.Model !== 'sensevoice' && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-amber-500/8 border border-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[11px] font-bold">当前语音转文字是外部服务接入模式。仅在这里选择 FunASR / Faster-Whisper 不会自动启动服务，需要对应的 WebSocket 端点已经可用。</span>
          </div>
        )}

        <div className="px-4 py-3 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", micState === 'speaking' ? 'bg-emerald-500' : micState === 'listening' ? 'bg-sky-500' : 'bg-gray-300')} />
            <span className="text-[12px] font-bold text-gray-700 dark:text-gray-200">{voiceStatus}</span>
          </div>
          <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 break-all">{voiceDetail}</p>
        </div>

	        {/* ══ 上栏：服务配置 + 麦克风 ════════════════════════════════════════ */}
	        <div className="flex items-center justify-between shrink-0 bg-white/40 dark:bg-white/5 border border-white/60 dark:border-white/10 rounded-[24px] px-6 py-3 shadow-xl">
	          <div className="flex items-center gap-6">

            {/* LLM */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-black text-gray-400 tracking-widest" title="语言模型">语言模型</span>
              <GlassSelect value={llmId} onChange={onLlmChange} options={llmOpts} emptyHint="去配置" />
            </div>

            <div className="w-px h-4 bg-black/10 dark:bg-white/10" />

            {/* ASR */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-black text-gray-400 tracking-widest" title="语音转文字（基础能力）">语音转文字</span>
              {asrOpts.length === 0 ? (
                <Link to="/models" className="flex items-center gap-1 h-[30px] px-2.5 rounded-xl text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 whitespace-nowrap">
                  <Cpu className="w-3 h-3 shrink-0" />去配置
                </Link>
              ) : (
                <GlassSelect value={asrId} onChange={onAsrChange} options={asrOpts} />
              )}
            </div>

            <div className="w-px h-4 bg-black/10 dark:bg-white/10" />

            {/* TTS */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-black text-gray-400 tracking-widest" title="语音播报（可选）">语音播报</span>
              {ttsOpts.length === 0 ? (
                <Link to="/models" className="flex items-center gap-1 h-[30px] px-2.5 rounded-xl text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 whitespace-nowrap">
                  <Cpu className="w-3 h-3 shrink-0" />去配置
                </Link>
              ) : (
                <>
                  <Toggle checked={ttsEnabled} onChange={onTtsToggle} />
                  {ttsEnabled && (() => {
                    const selTts = config?.AiProviders.find(p => p.Id === ttsId);
                    if (selTts?.Name.includes('本地')) return (
                      <span className="text-[10px] font-bold text-gray-400 whitespace-nowrap">{selTts.Name}</span>
                    );
                    return (
                      <button onClick={() => setVoiceOpen(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/80 dark:bg-white/10 border border-white/40 dark:border-white/20 text-[11px] font-bold text-gray-600 dark:text-gray-200 hover:bg-white dark:hover:bg-white/20 transition-colors">
                        <Volume2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        {(() => {
                          const v = (['edge_tts','minimax_tts','volcano_engine'] as TtsProvider[]).reduce<TtsVoice | undefined>((found, pr) => found ?? findVoice(pr, ttsVoice), undefined);
                          return v ? v.name : (ttsVoice || '选声音');
                        })()}
                        <ChevronDown className="w-3 h-3 opacity-50" />
                      </button>
                    );
                  })()}
                  {/* 语速滑块：TTS 启用后显示 */}
                  {ttsEnabled && (
                    <div className="flex items-center gap-2 ml-1">
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">语速</span>
                      <input type="range" min={0.5} max={2.0} step={0.1} value={ttsSpeed}
                        onChange={e => onSpeedChange(Number(e.target.value))}
                        className="w-20 cursor-pointer" style={{ accentColor: 'var(--primary-color)' }} />
                      <span className="text-[10px] font-mono text-gray-500 w-7 text-right">{ttsSpeed.toFixed(1)}×</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
	            <button onClick={() => setSettingsOpen(true)} className="w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-all"><SettingsIcon className="w-4 h-4" /></button>
	            {/* Mic button with pulsing rings when active */}
	            <div className="relative">
              {micActive && (
                <>
                  <div className="absolute inset-0 rounded-full border-2 border-[var(--primary-color)]/50 animate-mic-ring" />
                  <div className="absolute inset-0 rounded-full border-2 border-[var(--primary-color)]/30 animate-mic-ring" style={{ animationDelay: '0.7s' }} />
                </>
              )}
	              <button
	                onClick={handleMicClick}
                  title={hasAsrConfig ? (micActive ? '关闭麦克风' : '开启麦克风') : '请先配置语音识别服务'}
	                className={cn(
	                  "relative w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg active:scale-95",
	                  micActive
                    ? "bg-white text-[var(--primary-color)]"
                    : "bg-black/5 dark:bg-white/10 text-gray-400"
                )}
              >
                {micActive ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* ══ 下栏：实时字幕 ══════════════════════════════════════════════════ */}
        <GlassCard className="flex-1 flex flex-col overflow-hidden border-white/60 dark:border-white/10 bg-white/60 dark:bg-black/20 shadow-2xl">
          {/* header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-black/5 dark:border-white/8 bg-white/40 dark:bg-black/10 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-2 h-2 rounded-full transition-colors ${micActive ? 'bg-[var(--primary-color)] animate-pulse' : 'bg-gray-300'}`} />
              <span className="text-[12px] font-bold text-gray-600 dark:text-gray-300 shrink-0">实时字幕</span>
              <span className="text-[11px] text-gray-400 truncate">{voiceStatus}</span>
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
                <p className="text-[11px] text-gray-400">{voiceStatus}</p>
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
        providers={(() => {
          const list = (config?.AiProviders ?? []).filter(p => p.ProviderType === 'tts' && p.Enabled);
          return config ? availableProviders(list.map(p => p.Name)) : ['edge_tts' as const];
        })()}
        currentVoice={ttsVoice}
        onSelect={v => { setTtsVoice(v); onVoiceChange(v); }}
      />

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} className="max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <h3 className="text-[14px] font-bold">语音交互提示词</h3>
          <ModalCloseButton onClose={() => setSettingsOpen(false)} className="w-8 h-8" />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-500 font-medium shrink-0">AI 性别</span>
            <div className="flex items-center gap-1 p-0.5 rounded-xl bg-black/5 dark:bg-white/8 border border-gray-200 dark:border-white/12">
              {(['女AI', '男AI'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setSettingsDraft(d => ({ ...d, gender: g }))}
                  className={`h-[28px] px-4 rounded-lg text-[11px] font-medium transition-all ${
                    settingsDraft.gender === g
                      ? 'bg-white dark:bg-white/20 text-[var(--primary-color)] shadow-sm'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[12px] text-gray-500 mb-2 block font-medium">系统提示词</label>
            <textarea
              className="w-full h-40 px-4 py-3 rounded-xl bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50 resize-none"
              value={settingsDraft.prompt}
              onChange={e => setSettingsDraft(d => ({ ...d, prompt: e.target.value }))}
              placeholder="语音交互模式下 AI 的系统提示词..."
            />
            <p className="text-[11px] text-gray-400 mt-1.5">
              可使用 <code className="bg-black/5 px-1 rounded">{'{gender}'}</code> 占位符，自动替换为所选 AI 性别
            </p>
          </div>
        </div>
        <div className="flex gap-2 px-6 pb-6 shrink-0">
          <Button variant="primary" className="flex-1" onClick={async () => {
            if (!config) return;
            const next = {
              ...config,
              VoiceGender: settingsDraft.gender,
              VoiceSystemPrompt: settingsDraft.prompt,
            };
            try {
              await api.saveConfig(next);
              setConfig(next);
              toast.success('保存成功');
              setSettingsOpen(false);
            } catch (err) {
              toast.error(`保存失败: ${err}`);
            }
          }}>保存</Button>
        </div>
      </Modal>
    </>
  );
}

// ── 工具：从 config 过滤各类 provider ─────────────────────────────────────────

function inferGenderFromVoice(voice: string): '男AI' | '女AI' {
  // Edge TTS: YunXi / YunYe / YunJian... = 男; XiaoXiao... = 女
  if (/yun/i.test(voice)) return '男AI';
  // MiniMax/Volcano: zh_male_* = 男; zh_female_* = 女
  if (/_male_/i.test(voice)) return '男AI';
  return '女AI';
}

function llmList(config: AppConfig | null) {
  return (config?.AiProviders ?? []).filter(p => (p.ProviderType === 'llm' || !p.ProviderType) && p.Enabled);
}
function asrList(config: AppConfig | null) {
  return (config?.AiProviders ?? []).filter(p => p.ProviderType === 'asr' && p.Enabled);
}
function ttsList(config: AppConfig | null) {
  return (config?.AiProviders ?? []).filter(p => p.ProviderType === 'tts' && p.Enabled);
}
function findAsrProvider(config: AppConfig | null, id: string) {
  return (config?.AiProviders ?? []).find(p => p.ProviderType === 'asr' && p.Id === id);
}
