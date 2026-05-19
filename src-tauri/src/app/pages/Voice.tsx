import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Toggle } from '../components/Toggle';
import { cn } from '../lib/utils';
import { api, AppConfig, VoiceLatency } from '../lib/api';
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
@keyframes aurora-flow {
  0%   { transform: translate3d(-6%, -4%, 0) scale(1); opacity: 0.28; }
  50%  { transform: translate3d(5%, 3%, 0) scale(1.08); opacity: 0.48; }
  100% { transform: translate3d(-4%, 6%, 0) scale(0.98); opacity: 0.24; }
}
@keyframes stage-spotlight {
  0%, 100% { transform: translateY(0) scale(1); opacity: 0.58; }
  50%      { transform: translateY(-10px) scale(1.06); opacity: 0.78; }
}
@keyframes caption-pop {
  0%   { opacity: 0; transform: translateY(16px) scale(0.992); filter: blur(8px); }
  100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}
@keyframes caption-glow {
  0%, 100% { box-shadow: 0 0 0 rgba(59, 130, 246, 0); }
  50%      { box-shadow: 0 0 32px rgba(59, 130, 246, 0.16); }
}
@keyframes caption-sweep {
  0%   { transform: translateX(-120%); opacity: 0; }
  22%  { opacity: 0.38; }
  100% { transform: translateX(120%); opacity: 0; }
}
@keyframes mic-pulse-strong {
  0%   { transform: scale(1); opacity: 0.56; }
  100% { transform: scale(2.25); opacity: 0; }
}
@keyframes curtain-breathe {
  0%, 100% { opacity: 0.35; }
  50%      { opacity: 0.52; }
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
type ReloadTarget = 'voice' | 'tts';

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
    return null;
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
    text.includes('[ASR] 识别结果为空') ||
    text.includes('[ASR] 识别失败:') ||
    text.includes('[ASR→AI]')
  ) {
    return 'settled';
  }
  return 'idle';
}

function describeVoiceLog(text: string): string | null {
  if (text.includes('麦克风已就绪')) return '麦克风已开启，等待说话';
  if (text.includes('SenseVoice ASR 已加载')) return 'ASR 模型就绪，等待说话';
  if (text.includes('本地 ASR 模型加载失败')) return '⚠️ ASR 模型加载失败，请重新下载 SenseVoice 模型';
  if (text.includes('[VAD] 检测到语音段，正在识别')) return '检测到你正在说话，识别中...';
  if (text.includes('[VAD] 检测到语音段（ASR 模型未就绪')) return '⚠️ 检测到语音但 ASR 未就绪，请检查模型';
  if (text.includes('[VAD] 开始录音')) return '检测到你正在说话';
  if (text.includes('[VAD] 话轮结束')) return '说话结束，正在识别';
  if (text.includes('[ASR] 识别结果:')) return '识别完成';
  if (text.includes('[ASR] 识别结果为空')) return '语音过短或音量太低，请再试一次';
  if (text.includes('[ASR→AI]')) return 'AI 已收到语音内容';
  if (text.includes('[ASR] 识别失败:')) return text.replace('[ASR] ', '');
  if (text.includes('[麦克风] 音量全静音')) return '⚠️ 麦克风无声，请检查系统麦克风权限和输入音量';
  if (text.includes('[麦克风] 音量 peak=')) return '麦克风正常采集中';
  if (text.includes('ASR 服务不可达')) return text;
  if (text.includes('麦克风启动失败')) return text;
  if (text.includes('VAD 初始化失败')) return text;
  return null;
}

function parseMicPeak(text: string): number | null {
  const m = text.match(/peak=([0-9.]+)/i);
  if (!m) return null;
  const peak = Number(m[1]);
  if (!Number.isFinite(peak)) return null;
  return Math.max(0, Math.min(1, peak));
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

// ── 专业参数滑块 ──────────────────────────────────────────────────────────────

function ProSlider({ label, hint, value, min, max, step, format, onChange }: {
  label: string; hint: string; value: number;
  min: number; max: number; step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">{label}</span>
        <span className="text-[10px] font-mono text-[var(--primary-color)]">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 cursor-pointer rounded-full accent-[var(--primary-color)]" />
      <p className="text-[9px] text-gray-400">{hint}</p>
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
  const [voiceLevel,  setVoiceLevel]  = useState(0);
  const [latency,     setLatency]     = useState(0);
  const [latencyBreakdown, setLatencyBreakdown] = useState<VoiceLatency | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState({ gender: '女AI', prompt: '' });
  const [proMode, setProMode] = useState(false);

  // 模型状态
  const [modelStatus, setModelStatus] = useState<{ model_dir: string; models: Record<string, boolean> } | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReloads = useRef<Set<ReloadTarget>>(new Set());
  const micVisualTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorRestarting = useRef(false);
  const vadEnabledRef = useRef(false);

  // ── 加载 ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      api.loadConfig(),
      api.checkModels().catch(() => null),
    ]).then(([cfg, models]) => {
      setConfig(cfg);
      vadEnabledRef.current = Boolean(cfg.VadEnabled);
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
      setTtsEnabled(Boolean(cfg.TtsEnabled));
      setMicState('off');
      setVoiceStatus('麦克风未开启');
      setVoiceDetail(cfg.VadEnabled ? '等待监听线程状态' : '麦克风关闭中');
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const scheduleSave = useCallback((patch: Partial<AppConfig>, reloadTarget?: ReloadTarget) => {
    if (reloadTarget) pendingReloads.current.add(reloadTarget);
    setConfig(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if ('VadEnabled' in patch && typeof patch.VadEnabled === 'boolean') {
        vadEnabledRef.current = patch.VadEnabled;
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await api.saveConfig(next);
          const reloads = new Set(pendingReloads.current);
          pendingReloads.current.clear();
          if (reloads.size === 0) return;
          const running = await api.getMonitorStatus().catch(() => false);
          if (!running) return;
          if (reloads.has('voice')) await api.reloadMonitorVoice();
          if (reloads.has('tts')) await api.reloadMonitorTts();
        } catch (err) {
          console.error(err);
        }
      }, 600);
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

  const onLlmChange    = (id: string) => { setLlmId(id);  scheduleSave({ ActiveProviderId: id }, 'voice'); };
  const onAsrChange    = (id: string) => { setAsrId(id); scheduleSave({ ActiveAsrProviderId: id }, 'voice'); };
  const restartMonitorIfRunning = useCallback(async () => {
    const running = await api.getMonitorStatus().catch(() => false);
    if (!running) return;
    monitorRestarting.current = true;
    await api.stopMonitor().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 250));
    await api.startMonitor();
    monitorRestarting.current = false;
  }, []);
  const refreshMonitorTtsIfRunning = useCallback(async () => {
    const running = await api.getMonitorStatus().catch(() => false);
    if (running) await api.reloadMonitorTts();
  }, []);

  const onTtsChange    = async (id: string) => {
    if (!config) return;
    setTtsId(id);
    const updated = { ...config, ActiveTtsProviderId: id };
    setConfig(updated);
    try {
      await api.saveConfig(updated);
      await refreshMonitorTtsIfRunning();
    } catch (e) {
      toast.error(`语音播报服务切换失败: ${e}`);
    }
  };
  const onTtsToggle    = async (v: boolean) => {
    if (!config) return;
    setTtsEnabled(v);
    const updated = { ...config, TtsEnabled: v, DanmuAnnounce: v ? false : config.DanmuAnnounce };
    setConfig(updated);
    try {
      await api.saveConfig(updated);
      await refreshMonitorTtsIfRunning();
      if (v) sessionStorage.setItem('danmuAnnounce', 'false');
    } catch (e) {
      setTtsEnabled(config.TtsEnabled);
      setConfig(config);
      console.error('voice tts toggle failed:', e);
    }
  };
  const onVoiceChange  = async (v: string)  => {
    if (!config) return;
    setTtsVoice(v);
    const updated = { ...config, TtsVoice: v };
    setConfig(updated);
    try {
      await api.saveConfig(updated);
      await refreshMonitorTtsIfRunning();
    } catch (e) {
      toast.error(`音色切换失败: ${e}`);
    }
  };
  const onSpeedChange  = (v: number)  => { setTtsSpeed(v); scheduleSave({ TtsSpeed: v }, 'tts'); };

  // ── 监控同步 ────────────────────────────────────────────────────────────────

  useEffect(() => {
    let unl: (() => void) | undefined;
    api.getMonitorStatus().then((running) => {
      if (running && config?.VadEnabled) {
        setMicState('listening');
        setVoiceStatus('麦克风已开启，等待说话');
        setVoiceDetail('等待语音链路事件');
      } else {
        setMicState('off');
        setVoiceStatus('麦克风未开启');
        setVoiceDetail(config?.VadEnabled ? '监听线程未运行' : '麦克风关闭中');
        setVoiceLevel(0);
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
        setVoiceLevel(0);
        setLatency(0);
        setLatencyBreakdown(null);
      }
    }).then(f => { unl = f; });
    return () => unl?.();
  }, [config?.VadEnabled]);

  // ── 实时字幕：轮询 + 事件双保险 ────────────────────────────────────────────

  const seenLogCount = useRef(0);

  useEffect(() => {
    const applyLog = (text: string) => {
      if (!vadEnabledRef.current && (
        text.includes('[VAD]') ||
        text.includes('[ASR]') ||
        text.includes('[麦克风]') ||
        text.includes('麦克风输入流') ||
        text.includes('麦克风设备')
      )) {
        return;
      }
      setVoiceDetail(text);
      const micLogState = classifyMicLog(text);
      const statusText = describeVoiceLog(text);
      if (statusText) setVoiceStatus(statusText);
      if (micLogState === 'speaking') {
        setMicState('speaking');
        setVoiceLevel(prev => Math.max(prev, 0.8));
        if (micVisualTimer.current) clearTimeout(micVisualTimer.current);
        micVisualTimer.current = setTimeout(() => {
          setMicState(prev => (prev === 'off' ? prev : 'listening'));
        }, 1600);
      } else if (micLogState === 'settled') {
        if (micVisualTimer.current) clearTimeout(micVisualTimer.current);
        setMicState(prev => (prev === 'off' ? prev : 'listening'));
      }

      const peak = parseMicPeak(text);
      if (peak !== null) setVoiceLevel(prev => Math.max(prev, peak));

      const sub = parseLog(text);
      if (!sub) return;
      setSubtitles(prev => [...prev, sub].slice(-20));
      setTimeout(() => {
        setSubtitles(prev => prev.map(s => s.id === sub.id ? { ...s, fresh: false } : s));
      }, 2200);
    };

    // 轮询：每 300ms 拉取一次后台日志缓冲区，只处理新增行
    const pollLogs = async () => {
      try {
        const logs = await api.getMonitorLogs();
        const newStart = seenLogCount.current;
        if (logs.length > newStart) {
          for (let i = newStart; i < logs.length; i++) applyLog(logs[i]);
          seenLogCount.current = logs.length;
        }
        // 若后台重启（日志数量减少），重置计数器
        if (logs.length < seenLogCount.current) {
          seenLogCount.current = 0;
        }
      } catch { /* ignore */ }
    };
    const pollTimer = setInterval(pollLogs, 300);

    // 事件监听作为辅助（部分环境可能不工作）
    let unl: (() => void) | undefined;
    let unlBatch: (() => void) | undefined;
    api.onMonitorLog(applyLog).then(f => { unl = f; }).catch(() => {});
    api.onMonitorLogs(lines => { for (const line of lines) applyLog(line); }).then(f => { unlBatch = f; }).catch(() => {});

    return () => {
      clearInterval(pollTimer);
      unl?.();
      unlBatch?.();
      if (micVisualTimer.current) clearTimeout(micVisualTimer.current);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setVoiceLevel(prev => {
        const next = prev * 0.72;
        return next < 0.03 ? 0 : next;
      });
    }, 90);
    return () => clearInterval(timer);
  }, []);

  // ── 链路延迟 ────────────────────────────────────────────────────────────────

  useEffect(() => {
    let unl: (() => void) | undefined;
    api.onVoiceLatency((data) => {
      setLatency(data.total_ms);
      setLatencyBreakdown(data);
    }).then(f => { unl = f; });
    return () => unl?.();
  }, []);

  // ── 麦克风 ──────────────────────────────────────────────────────────────────

  const currentAsrProvider = findAsrProvider(config, asrId);
  const usingBuiltInSenseVoice = currentAsrProvider?.Model === 'sensevoice' || (!currentAsrProvider && !(config?.AsrUrl));
  const usingExternalAsrService = !usingBuiltInSenseVoice && (!!currentAsrProvider?.APIUrl || !!config?.AsrUrl);
  // 内置 SenseVoice 不需要额外 provider 配置，始终视为已配置
  const hasAsrConfig  = usingBuiltInSenseVoice || usingExternalAsrService;
  const vadModelOk    = modelStatus?.models['silero-vad'] ?? false;
  const asrModelOk    = usingExternalAsrService || (modelStatus?.models['sensevoice'] ?? false);
  // 模型缺失时仍允许启动（monitor 会自动下载），外部 ASR 服务不可用时才完全禁用
  const micEnabled    = hasAsrConfig;

  // 提示信息（不阻止启动，在日志区展示）
  const micBlockReasons: string[] = [];
  if (!vadModelOk) micBlockReasons.push('VAD 模型未就绪，启动时将自动下载');
  if (usingBuiltInSenseVoice && !asrModelOk) micBlockReasons.push('SenseVoice 模型未就绪，启动时将自动下载');
  if (!usingBuiltInSenseVoice && hasAsrConfig) micBlockReasons.push('当前 ASR 依赖外部 WebSocket 服务，请确认服务已启动');
  if (!hasAsrConfig) micBlockReasons.push('请先在「设置」中配置语音识别服务');

  const handleMicClick = async () => {
    if (!config) return;
    if (!hasAsrConfig) { toast.error('请先配置语音识别服务'); return; }
    const nextVad = !config.VadEnabled;
    const wasRunning = await api.getMonitorStatus().catch(() => false);
    const updated = { ...config, VadEnabled: nextVad };
    vadEnabledRef.current = nextVad;
    setConfig(updated);
    monitorRestarting.current = true;
    try {
      await api.saveConfig(updated);
      if (wasRunning) {
        await api.reloadMonitorVoice();
      }
      setMicState(nextVad && wasRunning ? 'listening' : 'off');
      if (!nextVad || !wasRunning) setVoiceLevel(0);
      monitorRestarting.current = false;
      toast.success(nextVad
        ? (wasRunning ? '麦克风已开启' : '麦克风配置已开启，不会启动弹幕监听')
        : '麦克风已关闭');
    } catch (e) {
      vadEnabledRef.current = config.VadEnabled;
      monitorRestarting.current = false;
      setMicState(config.VadEnabled ? 'listening' : 'off');
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
  const latestUserText = [...subtitles].reverse().find(s => s.role === 'user')?.text || '等待语音识别结果';
  const latestAiText = [...subtitles].reverse().find(s => s.role === 'ai')?.text || '等待 LLM 回复';
  const micScale = 1 + voiceLevel * 0.18;
  const micGlow = 14 + Math.round(voiceLevel * 30);

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


	        {/* ══ 上栏：服务配置 + 麦克风 ════════════════════════════════════════ */}
	        <div className="shrink-0 bg-white/40 dark:bg-white/5 border border-white/60 dark:border-white/10 rounded-[24px] px-5 py-3 shadow-xl">
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-[10px] font-black text-gray-400 tracking-[0.18em] whitespace-nowrap" title="语言模型">模型</span>
                    <GlassSelect value={llmId} onChange={onLlmChange} options={llmOpts} emptyHint="去配置" />
                  </div>

                  <div className="w-px h-4 bg-black/10 dark:bg-white/10 hidden sm:block" />

                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-[10px] font-black text-gray-400 tracking-[0.18em] whitespace-nowrap" title="语音转文字（基础能力）">转写</span>
                    {asrOpts.length === 0 ? (
                      <Link to="/models" className="flex items-center gap-1 h-[30px] px-2.5 rounded-xl text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 whitespace-nowrap">
                        <Cpu className="w-3 h-3 shrink-0" />去配置
                      </Link>
                    ) : (
                      <GlassSelect value={asrId} onChange={onAsrChange} options={asrOpts} />
                    )}
                  </div>

                  <div className="w-px h-4 bg-black/10 dark:bg-white/10 hidden sm:block" />

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-gray-400 tracking-[0.18em] whitespace-nowrap" title="语音播报（可选）">播报</span>
                    {ttsOpts.length === 0 ? (
                      <Link to="/models" className="flex items-center gap-1 h-[30px] px-2.5 rounded-xl text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 whitespace-nowrap">
                        <Cpu className="w-3 h-3 shrink-0" />去配置
                      </Link>
                    ) : (
                      <Toggle checked={ttsEnabled} onChange={onTtsToggle} />
                    )}
                  </div>

                  {ttsEnabled && ttsOpts.length > 0 && (
                    <>
                      <div className="w-px h-4 bg-black/10 dark:bg-white/10 hidden sm:block" />
                    {(() => {
                      const selTts = config?.AiProviders.find(p => p.Id === ttsId);
                      if (selTts?.Name.includes('本地')) {
                        return (
                          <div className="px-3 py-1.5 rounded-full bg-white/70 dark:bg-white/10 border border-white/40 dark:border-white/20 text-[11px] font-bold text-gray-500 whitespace-nowrap">
                            本地播报
                          </div>
                        );
                      }
                      return (
                        <button onClick={() => setVoiceOpen(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/80 dark:bg-white/10 border border-white/40 dark:border-white/20 text-[11px] font-bold text-gray-600 dark:text-gray-200 hover:bg-white dark:hover:bg-white/20 transition-colors max-w-[170px] shrink min-w-0">
                          <Volume2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span className="truncate">
                            {(() => {
                              const v = (['edge_tts','minimax_tts','volcano_engine'] as TtsProvider[]).reduce<TtsVoice | undefined>((found, pr) => found ?? findVoice(pr, ttsVoice), undefined);
                              return v ? v.name : (ttsVoice || '选声音');
                            })()}
                          </span>
                          <ChevronDown className="w-3 h-3 opacity-50 shrink-0" />
                        </button>
                      );
                    })()}

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">语速</span>
                      <input type="range" min={0.5} max={2.0} step={0.1} value={ttsSpeed}
                        onChange={e => onSpeedChange(Number(e.target.value))}
                        className="w-16 cursor-pointer" style={{ accentColor: 'var(--primary-color)' }} />
                      <span className="text-[10px] font-mono text-gray-500 whitespace-nowrap">{ttsSpeed.toFixed(1)}×</span>
                    </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
            {/* 通用/专业 模式切换 */}
            <div className="flex items-center p-0.5 rounded-xl bg-black/5 dark:bg-white/8 border border-gray-200 dark:border-white/12">
              {(['通用', '专业'] as const).map(m => (
                <button key={m} onClick={() => setProMode(m === '专业')}
                  className={cn('h-6 px-3 rounded-lg text-[10px] font-bold transition-all',
                    (m === '专业') === proMode
                      ? 'bg-white dark:bg-white/15 text-gray-700 dark:text-gray-100 shadow-sm'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300')}>
                  {m}
                </button>
              ))}
            </div>
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
        </div>

        {/* ══ 下栏：字幕 + 可选专业面板 ══════════════════════════════════════ */}
        <div className="flex-1 flex gap-4 min-h-0">

          {/* 字幕卡片 */}
          <GlassCard className="relative flex-1 flex flex-col overflow-hidden border-white/60 dark:border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(238,242,247,0.94))] dark:bg-[linear-gradient(180deg,rgba(15,18,28,0.96),rgba(8,10,18,0.98))] shadow-2xl min-w-0">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse at 50% 18%, rgba(255,255,255,0.72), rgba(191,219,254,0.22) 34%, transparent 62%)',
                opacity: micActive ? 0.78 + voiceLevel * 0.2 : 0.42,
                animation: 'stage-spotlight 5.5s ease-in-out infinite',
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse at center, transparent 34%, rgba(15,23,42,0.08) 78%, rgba(15,23,42,0.18) 100%)',
                animation: 'curtain-breathe 6s ease-in-out infinite',
              }}
            />
            <div className="absolute left-1/2 top-4 h-[52%] w-[52%] -translate-x-1/2 rounded-full bg-amber-200/18 blur-3xl pointer-events-none" style={{ opacity: micActive ? 0.42 + voiceLevel * 0.28 : 0.18 }} />
            <div className="absolute bottom-0 left-0 right-0 h-28 bg-[linear-gradient(180deg,transparent,rgba(148,163,184,0.14))] dark:bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.28))] pointer-events-none" />
            <div className="flex items-center justify-between px-5 py-3 border-b border-black/5 dark:border-white/8 bg-white/40 dark:bg-black/10 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-2 h-2 rounded-full transition-colors ${micActive ? 'bg-[var(--primary-color)] animate-pulse' : 'bg-gray-300'}`} />
                <span className="text-[12px] font-bold text-gray-600 dark:text-gray-300 shrink-0">实时字幕</span>
                {micActive && latency > 0 && (
                  <span
                    className="text-[10px] text-gray-400 ml-2"
                    title={latencyBreakdown
                      ? `ASR ${latencyBreakdown.asr_ms}ms · 首字 ${latencyBreakdown.ai_first_chunk_ms ?? '-'}ms · AI完成 ${latencyBreakdown.ai_total_ms}ms`
                      : undefined}
                  >
                    {latency}ms
                  </span>
                )}
              </div>
              <button onClick={() => setSubtitles([])} className="h-7 px-3 rounded-full border border-gray-200 dark:border-white/15 text-[10px] font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-white/60 transition-all">清空</button>
            </div>
            <div className="relative flex-1 min-h-0 p-6 flex flex-col justify-center gap-5">
              {subtitles.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 opacity-40 select-none text-center relative z-10">
                  <div className="w-24 h-24 rounded-full border border-white/50 dark:border-white/10 bg-white/55 dark:bg-white/5 flex items-center justify-center shadow-xl">
                    <MessageSquareText className="w-11 h-11 text-gray-400" />
                  </div>
                  <p className="text-[15px] font-bold tracking-wide text-gray-400">开启麦克风后，字幕舞台将在这里点亮</p>
                </div>
              ) : (
                <div className="relative z-10 grid grid-rows-2 gap-5 h-full min-h-0">
                  <div className="relative overflow-hidden rounded-[18px] border border-white/70 dark:border-white/10 bg-white/76 dark:bg-white/7 px-6 py-5 shadow-xl" style={{ animation: 'caption-glow 4.5s ease-in-out infinite' }}>
                    <div className="absolute inset-y-0 w-1/2 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent)] dark:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.10),transparent)]" style={{ animation: 'caption-sweep 3.2s ease-in-out infinite' }} />
                    <div className="relative flex items-center gap-2 text-[11px] font-black tracking-[0.24em] text-slate-400 uppercase">
                      <span>语音识别</span>
                      {latestFresh?.role === 'user' && <SubWave role="user" />}
                    </div>
                    <div key={`user-${latestUserText}`} className="relative mt-4 text-[clamp(26px,3.1vw,44px)] leading-[1.16] font-black text-slate-800 dark:text-slate-50 break-words" style={{ animation: 'caption-pop 420ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
                      {latestUserText}
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-[18px] border border-amber-200/70 dark:border-amber-300/15 bg-[linear-gradient(135deg,rgba(251,191,36,0.13),rgba(255,255,255,0.70))] dark:bg-[linear-gradient(135deg,rgba(69,42,10,0.56),rgba(15,23,42,0.92))] px-6 py-5 shadow-xl" style={{ animation: 'caption-glow 5.2s ease-in-out infinite' }}>
                    <div className="absolute inset-y-0 w-1/2 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.48),transparent)] dark:bg-[linear-gradient(90deg,transparent,rgba(251,191,36,0.10),transparent)]" style={{ animation: 'caption-sweep 3.8s ease-in-out infinite' }} />
                    <div className="relative flex items-center gap-2 text-[11px] font-black tracking-[0.24em] text-amber-600/80 dark:text-amber-200/80 uppercase">
                      <span>LLM 回复</span>
                      {latestFresh?.role === 'ai' && <SubWave role="ai" />}
                    </div>
                    <div key={`ai-${latestAiText}`} className="relative mt-4 text-[clamp(22px,2.4vw,34px)] leading-[1.2] font-bold text-slate-800 dark:text-white break-words" style={{ animation: 'caption-pop 480ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
                      {latestAiText}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 pb-6 pt-2 shrink-0">
              <div className="flex items-center gap-5">
                <div className="relative shrink-0">
                  {micActive && (
                    <>
                      <div className="absolute inset-0 rounded-full border-2 border-[var(--primary-color)]/45" style={{ animation: 'mic-pulse-strong 1.25s ease-out infinite', transform: `scale(${1 + voiceLevel * 0.12})` }} />
                      <div className="absolute inset-0 rounded-full border-2 border-emerald-400/30" style={{ animation: 'mic-pulse-strong 1.65s ease-out infinite', animationDelay: '0.25s', transform: `scale(${1 + voiceLevel * 0.16})` }} />
                    </>
                  )}
                  <div
                    className={cn(
                      'relative w-20 h-20 rounded-full flex items-center justify-center border transition-all duration-150',
                      micActive
                        ? 'bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.96),rgba(191,219,254,0.75))] border-sky-200/80 dark:border-sky-400/20'
                        : 'bg-white/70 dark:bg-white/5 border-white/60 dark:border-white/10'
                    )}
                    style={{ transform: `scale(${micScale})`, boxShadow: micActive ? `0 0 ${micGlow}px rgba(59,130,246,0.28)` : 'none' }}
                  >
                    {micActive ? <Mic className="w-9 h-9 text-[var(--primary-color)]" /> : <MicOff className="w-9 h-9 text-gray-400" />}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-black tracking-[0.22em] text-gray-400 uppercase">人声输入强度</span>
                    <span className="text-[11px] font-mono text-gray-500">{Math.round(voiceLevel * 100)}%</span>
                  </div>
                  <FullWave active={micActive} color={micActive ? 'var(--primary-color)' : '#d1d5db'} barCount={72} />
                </div>
              </div>
            </div>
          </GlassCard>

          {/* 专业参数面板 */}
          {proMode && config && (
            <div className="w-56 shrink-0 flex flex-col gap-3 overflow-y-auto scrollbar-none">

              {/* VAD */}
              <div className="rounded-2xl border border-white/50 dark:border-white/10 bg-white/60 dark:bg-white/5 p-4 space-y-4">
                <p className="text-[10px] font-black tracking-widest text-gray-400 uppercase">VAD 检测</p>
                <ProSlider label="麦克风增益" hint="放大麦克风输入（1.0 = 原始）"
                  value={config.VoiceMicGain ?? 1.0} min={0.5} max={4.0} step={0.1}
                  format={v => v.toFixed(1) + '×'}
                  onChange={v => scheduleSave({ VoiceMicGain: v }, 'voice')} />
                <ProSlider label="灵敏度" hint="越低越灵敏"
                  value={config.VadThreshold} min={0.1} max={0.9} step={0.05}
                  format={v => v.toFixed(2)}
                  onChange={v => scheduleSave({ VadThreshold: v }, 'voice')} />
                <ProSlider label="最短语音" hint="秒"
                  value={config.VadMinSpeechDuration} min={0.04} max={0.5} step={0.01}
                  format={v => v.toFixed(2) + 's'}
                  onChange={v => scheduleSave({ VadMinSpeechDuration: v }, 'voice')} />
                <ProSlider label="静音判停" hint="秒"
                  value={config.VadMinSilenceDuration} min={0.2} max={1.5} step={0.05}
                  format={v => v.toFixed(2) + 's'}
                  onChange={v => scheduleSave({ VadMinSilenceDuration: v }, 'voice')} />
              </div>

              {/* ASR */}
              <div className="rounded-2xl border border-white/50 dark:border-white/10 bg-white/60 dark:bg-white/5 p-4 space-y-3">
                <p className="text-[10px] font-black tracking-widest text-gray-400 uppercase">ASR 识别</p>
                <div>
                  <p className="text-[10px] text-gray-500 mb-1.5">识别语言</p>
                  <select value={config.AsrLanguage ?? 'zh'} onChange={e => scheduleSave({ AsrLanguage: e.target.value }, 'voice')}
                    className="w-full h-8 rounded-xl text-[11px] px-2.5 bg-white/60 dark:bg-white/8 border border-gray-200 dark:border-white/15 text-gray-700 dark:text-gray-100 focus:outline-none">
                    <option value="zh">普通话</option>
                    <option value="yue">粤语</option>
                    <option value="en">English</option>
                    <option value="ja">日語</option>
                    <option value="ko">한국어</option>
                    <option value="auto">自动检测（易误判）</option>
                  </select>
                </div>
              </div>

              {/* AI 回复 */}
              <div className="rounded-2xl border border-white/50 dark:border-white/10 bg-white/60 dark:bg-white/5 p-4 space-y-4">
                <p className="text-[10px] font-black tracking-widest text-gray-400 uppercase">AI 回复</p>
                <ProSlider label="Temperature" hint="越高越随机创意"
                  value={config.VoiceTemperature ?? 0.7} min={0.0} max={2.0} step={0.05}
                  format={v => v.toFixed(2)}
                  onChange={v => scheduleSave({ VoiceTemperature: v }, 'voice')} />
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">最大字数</span>
                    <span className="text-[10px] font-mono text-[var(--primary-color)]">
                      {(config.VoiceReplyMaxChars ?? 120) === 0 ? '不限' : `${config.VoiceReplyMaxChars ?? 120}字`}
                    </span>
                  </div>
                  <input type="range" min={0} max={300} step={10}
                    value={config.VoiceReplyMaxChars ?? 120}
                    onChange={e => scheduleSave({ VoiceReplyMaxChars: Number(e.target.value) }, 'voice')}
                    className="w-full h-1 cursor-pointer rounded-full accent-[var(--primary-color)]" />
                  <p className="text-[9px] text-gray-400">0 = 不限制，防止长篇回复拖慢 TTS</p>
                </div>
              </div>

              {/* TTS */}
              <div className="rounded-2xl border border-white/50 dark:border-white/10 bg-white/60 dark:bg-white/5 p-4 space-y-4">
                <p className="text-[10px] font-black tracking-widest text-gray-400 uppercase">TTS 播报</p>
                <ProSlider label="语速" hint="倍率"
                  value={ttsSpeed} min={0.5} max={2.0} step={0.1}
                  format={v => v.toFixed(1) + '×'}
                  onChange={v => onSpeedChange(v)} />
                <ProSlider label="音调" hint="-1 ~ +1"
                  value={config.TtsPitch ?? 0} min={-1} max={1} step={0.1}
                  format={v => (v >= 0 ? '+' : '') + v.toFixed(1)}
                  onChange={v => scheduleSave({ TtsPitch: v }, 'tts')} />
              </div>

            </div>
          )}

        </div>

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
              const running = await api.getMonitorStatus().catch(() => false);
              if (running) await api.reloadMonitorVoice();
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
