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
import { Input } from '../components/Input';

// ── 动画 ───────────────────────────────────────────────────────────────────────

const STYLES = `
@keyframes wave-bar {
  0%, 100% { transform: scaleY(0.15); }
  50%       { transform: scaleY(1);   }
}
@keyframes sub-in {
  0% { opacity: 0; transform: translateY(20px) scale(0.95); filter: blur(10px); }
  100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}
@keyframes sub-float-up {
  0% { transform: translateY(0) scale(1); opacity: 1; filter: blur(0); }
  100% { transform: translateY(-40px) scale(0.9); opacity: 0; filter: blur(8px); }
}
@keyframes mic-ring {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(1.9); opacity: 0;   }
}
@keyframes aurora-mesh {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes bubble-glow {
  0%, 100% { box-shadow: 0 0 20px rgba(59, 130, 246, 0.1); }
  50% { box-shadow: 0 0 40px rgba(59, 130, 246, 0.25); }
}
@keyframes stage-spotlight {
  0%, 100% { transform: translateY(0) scale(1); opacity: 0.58; }
  50%      { transform: translateY(-10px) scale(1.06); opacity: 0.78; }
}
@keyframes mic-pulse-strong {
  0%   { transform: scale(1); opacity: 0.56; }
  100% { transform: scale(2.25); opacity: 0; }
}
@keyframes curtain-breathe {
  0%, 100% { opacity: 0.35; }
  50%      { opacity: 0.52; }
}
@keyframes drift-up {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(-60px); opacity: 0; }
}
@keyframes voice-stage-scan {
  0% { transform: translateX(-110%); opacity: 0; }
  18% { opacity: 0.65; }
  100% { transform: translateX(110%); opacity: 0; }
}
@keyframes voice-orbit {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes voice-thinking-dot {
  0%, 100% { transform: translateY(0); opacity: 0.35; }
  50% { transform: translateY(-4px); opacity: 1; }
}
.voice-stage-scan { animation: voice-stage-scan 2.4s ease-in-out infinite; }
.voice-orbit { animation: voice-orbit 10s linear infinite; }
.voice-thinking-dot { animation: voice-thinking-dot 1.1s ease-in-out infinite; }
`;

// ── 类型 ───────────────────────────────────────────────────────────────────────

type MicState = 'off' | 'listening' | 'speaking';
type VoiceStage = 'idle' | 'listening' | 'speaking' | 'recognizing' | 'thinking' | 'replying' | 'error';

interface SubLine {
  id: string;
  role: 'user' | 'ai';
  text: string;
  fresh: boolean;
}

type LogMicState = 'idle' | 'speaking' | 'settled';
type ReloadTarget = 'voice' | 'tts';

const VOICE_STAGE_META: Record<VoiceStage, {
  label: string;
  caption: string;
  accent: string;
  soft: string;
  wash: string;
}> = {
  idle: {
    label: '待机',
    caption: '等待语音链路',
    accent: '#94a3b8',
    soft: 'rgba(148, 163, 184, 0.16)',
    wash: 'linear-gradient(-45deg, rgba(226,232,240,0.42), rgba(241,245,249,0.36))',
  },
  listening: {
    label: '聆听',
    caption: '等待说话',
    accent: 'var(--primary-color)',
    soft: 'rgba(var(--primary-rgb, 59, 130, 246), 0.16)',
    wash: 'linear-gradient(-45deg, rgba(59,130,246,0.13), rgba(14,165,233,0.10), rgba(255,255,255,0.08))',
  },
  speaking: {
    label: '收音',
    caption: '正在接收人声',
    accent: '#34c759',
    soft: 'rgba(52, 199, 89, 0.18)',
    wash: 'linear-gradient(-45deg, rgba(52,199,89,0.16), rgba(45,212,191,0.12), rgba(59,130,246,0.10))',
  },
  recognizing: {
    label: '转写',
    caption: '语音转文字',
    accent: '#06b6d4',
    soft: 'rgba(6, 182, 212, 0.18)',
    wash: 'linear-gradient(-45deg, rgba(6,182,212,0.16), rgba(59,130,246,0.12), rgba(255,255,255,0.08))',
  },
  thinking: {
    label: '思考',
    caption: '组织回复',
    accent: '#8b5cf6',
    soft: 'rgba(139, 92, 246, 0.18)',
    wash: 'linear-gradient(-45deg, rgba(139,92,246,0.16), rgba(59,130,246,0.11), rgba(236,72,153,0.08))',
  },
  replying: {
    label: '回应',
    caption: 'AI 正在输出',
    accent: '#f59e0b',
    soft: 'rgba(245, 158, 11, 0.18)',
    wash: 'linear-gradient(-45deg, rgba(245,158,11,0.16), rgba(251,191,36,0.10), rgba(139,92,246,0.10))',
  },
  error: {
    label: '异常',
    caption: '查看链路日志',
    accent: '#ef4444',
    soft: 'rgba(239, 68, 68, 0.16)',
    wash: 'linear-gradient(-45deg, rgba(239,68,68,0.14), rgba(245,158,11,0.10), rgba(255,255,255,0.08))',
  },
};

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

function classifyVoiceStageLog(text: string): { stage: VoiceStage; holdMs?: number } | null {
  if (
    text.includes('麦克风启动失败') ||
    text.includes('VAD 初始化失败') ||
    text.includes('[ASR] 识别失败:') ||
    text.includes('[ASR→AI] LLM 未返回内容') ||
    text.includes('[ASR→AI] 未配置启用的 AI 机器人')
  ) {
    return { stage: 'error', holdMs: 3200 };
  }
  if (text.includes('[VAD] 开始录音')) return { stage: 'speaking', holdMs: 1800 };
  if (
    text.includes('[VAD] 检测到语音段，正在识别') ||
    text.includes('[VAD] 话轮结束') ||
    text.includes('[ASR] 实时识别:')
  ) {
    return { stage: 'recognizing', holdMs: 5200 };
  }
  if (text.includes('[ASR] 识别结果:')) return { stage: 'thinking', holdMs: 7000 };
  if (text.includes('[ASR→AI]')) return { stage: 'replying', holdMs: 3600 };
  if (text.includes('麦克风已就绪') || text.includes('[麦克风] 音量 peak=')) return { stage: 'listening' };
  if (text.includes('监听已停止')) return { stage: 'idle' };
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

function FullWave({ active, voiceLevel, color, barCount = 40 }: {
  active: boolean; voiceLevel: number; color: string; barCount?: number;
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
              animation: (active || voiceLevel > 0.01) ? `wave-bar ${0.5 + (i % 7) * 0.065}s ease-in-out infinite` : 'none',
              animationDelay: `${i * 0.038}s`,
              transform: (active || voiceLevel > 0.01) ? undefined : 'scaleY(0.1)',
              opacity:   (active || voiceLevel > 0.01) ? 1 : 0.12,
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
  const [visualStage, setVisualStage] = useState<VoiceStage>('idle');
  const [latency,     setLatency]     = useState(0);
  const [latencyBreakdown, setLatencyBreakdown] = useState<VoiceLatency | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState({
    gender: '女AI',
    prompt: '',
    obsEnabled: false,
    obsHost: '127.0.0.1',
    obsPort: 4455,
    obsPassword: '',
  });
  const [proMode, setProMode] = useState(false);

  // 模型状态
  const [modelStatus, setModelStatus] = useState<{ model_dir: string; models: Record<string, boolean> } | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReloads = useRef<Set<ReloadTarget>>(new Set());
  const micVisualTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorRestarting = useRef(false);
  const vadEnabledRef = useRef(false);

  const setStage = useCallback((stage: VoiceStage, holdMs?: number) => {
    if (stageTimer.current) {
      clearTimeout(stageTimer.current);
      stageTimer.current = null;
    }
    setVisualStage(stage);
    if (!holdMs) return;
    stageTimer.current = setTimeout(() => {
      setVisualStage(vadEnabledRef.current ? 'listening' : 'idle');
    }, holdMs);
  }, []);

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
      setStage('idle');
      setVoiceStatus('麦克风未开启');
      setVoiceDetail(cfg.VadEnabled ? '等待监听线程状态' : '麦克风关闭中');
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const refreshModelStatus = useCallback(async () => {
    const models = await api.checkModels().catch(() => null);
    setModelStatus(models);
    return models;
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
        obsEnabled: config.ObsEnabled ?? false,
        obsHost: config.ObsHost || '127.0.0.1',
        obsPort: config.ObsPort || 4455,
        obsPassword: config.ObsPassword || '',
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
        setStage('listening');
        setVoiceStatus('麦克风已开启，等待说话');
        setVoiceDetail('等待语音链路事件');
      } else {
        setMicState('off');
        setStage('idle');
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
          setStage('listening');
          setVoiceStatus('麦克风已开启，等待说话');
          setVoiceDetail('监听线程已运行，等待语音链路事件');
        }
        return;
      }
      if (!monitorRestarting.current) {
        setMicState('off');
        setStage('idle');
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
      // 允许播放器音量日志通过，无论 VAD 是否开启
      const isPlayerLog = text.includes('[播放器]');

      if (!isPlayerLog && !vadEnabledRef.current && (
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
      const nextStage = classifyVoiceStageLog(text);
      if (nextStage) setStage(nextStage.stage, nextStage.holdMs);
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
      setSubtitles(prev => {
        const next = [...prev, sub].slice(-30);
        return next;
      });
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
      if (stageTimer.current) clearTimeout(stageTimer.current);
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
  // 普通监听不再隐式下载模型；语音入口按需检查并提示下载
  const micEnabled    = hasAsrConfig;

  // 提示信息（不阻止启动，在日志区展示）
  const micBlockReasons: string[] = [];
  if (!vadModelOk) micBlockReasons.push('VAD 模型未就绪，启用前需要先下载');
  if (usingBuiltInSenseVoice && !asrModelOk) micBlockReasons.push('SenseVoice 模型未就绪，启用前需要先下载');
  if (!usingBuiltInSenseVoice && hasAsrConfig) micBlockReasons.push('当前 ASR 依赖外部 WebSocket 服务，请确认服务已启动');
  if (!hasAsrConfig) micBlockReasons.push('请先在「设置」中配置语音识别服务');

  const handleMicClick = async () => {
    if (!config) return;
    if (!hasAsrConfig) { toast.error('请先配置语音识别服务'); return; }
    const nextVad = !config.VadEnabled;
    if (nextVad) {
      const missingModels: Array<{ id: string; name: string }> = [];
      if (!vadModelOk) missingModels.push({ id: 'silero-vad', name: 'VAD 模型' });
      if (usingBuiltInSenseVoice && !asrModelOk) {
        missingModels.push({ id: 'sensevoice', name: 'SenseVoice 模型' });
      }

      if (missingModels.length > 0) {
        const confirmed = window.confirm(
          `启用麦克风前需要先下载：${missingModels.map((item) => item.name).join('、')}。\n现在开始下载吗？`,
        );
        if (!confirmed) return;
        try {
          for (const item of missingModels) {
            toast.info(`开始下载${item.name}`);
            await api.downloadModel(item.id);
          }
          const models = await refreshModelStatus();
          const refreshedVadOk = models?.models['silero-vad'] ?? false;
          const refreshedAsrOk = usingExternalAsrService || (models?.models['sensevoice'] ?? false);
          if (!refreshedVadOk || (usingBuiltInSenseVoice && !refreshedAsrOk)) {
            toast.error('模型仍未就绪，请检查下载结果');
            return;
          }
        } catch (e) {
          toast.error(`模型下载失败: ${e}`);
          return;
        }
      }
    }

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
      setStage(nextVad && wasRunning ? 'listening' : 'idle');
      if (!nextVad || !wasRunning) setVoiceLevel(0);
      monitorRestarting.current = false;
      toast.success(nextVad
        ? (wasRunning ? '麦克风已开启' : '麦克风配置已开启，不会启动弹幕监听')
        : '麦克风已关闭');
    } catch (e) {
      vadEnabledRef.current = config.VadEnabled;
      monitorRestarting.current = false;
      setMicState(config.VadEnabled ? 'listening' : 'off');
      setStage(config.VadEnabled ? 'listening' : 'idle');
      toast.error(`操作失败: ${e}`);
    }
  };

  // ── 派生 ────────────────────────────────────────────────────────────────────

  const micActive = micState !== 'off';
  const activeStage: VoiceStage = micActive || visualStage === 'error' ? visualStage : 'idle';
  const stageMeta = VOICE_STAGE_META[activeStage];
  const micColor  = stageMeta.accent;

  const llmOpts = llmList(config).map(p => ({ value: p.Id, label: p.Name }));
  const asrOpts = asrList(config).map(p => ({ value: p.Id, label: p.Name }));
  const ttsOpts = ttsList(config).map(p => ({ value: p.Id, label: p.Name }));

  const micScale = 1 + voiceLevel * 0.18;
  const micGlow = 14 + Math.round(voiceLevel * 30);
  const stageIntensity = micActive ? Math.min(1, 0.55 + voiceLevel * 0.45) : 0.32;

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
                      <div className="absolute inset-0 rounded-full border-2" style={{ borderColor: stageMeta.accent, opacity: 0.42, animation: 'mic-pulse-strong 1.25s ease-out infinite', transform: `scale(${1 + voiceLevel * 0.2})` }} />
                      <div className="absolute inset-0 rounded-full border-2" style={{ borderColor: stageMeta.accent, opacity: 0.25, animation: 'mic-pulse-strong 1.65s ease-out infinite', animationDelay: '0.25s', transform: `scale(${1 + voiceLevel * 0.25})` }} />
                    </>
                  )}
	              <button
	                onClick={handleMicClick}
                  title={hasAsrConfig ? (micActive ? '关闭麦克风' : '开启麦克风') : '请先配置语音识别服务'}
	                className={cn(
	                  "relative w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg active:scale-95",
	                  micActive
                    ? "bg-white"
                    : "bg-black/5 dark:bg-white/10 text-gray-400"
                )}
                style={{ color: micActive ? micColor : undefined, transform: `scale(${micScale})`, boxShadow: micActive ? `0 0 ${micGlow}px ${stageMeta.soft}` : 'none' }}
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
            {/* 动态流光背景 */}
            <div
              className="absolute inset-0 pointer-events-none transition-opacity duration-1000"
              style={{
                background: stageMeta.wash,
                backgroundSize: '400% 400%',
                animation: 'aurora-mesh 15s ease infinite',
                opacity: stageIntensity,
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `radial-gradient(circle at 50% 20%, ${stageMeta.soft} 0%, rgba(255,255,255,0.26) 34%, transparent 70%)`,
                opacity: activeStage === 'idle' ? 0.45 : 0.78,
              }}
            />
            <div
              className="absolute left-1/2 top-4 h-[60%] w-[80%] -translate-x-1/2 rounded-[100%] blur-[80px] pointer-events-none"
              style={{ background: stageMeta.soft, animation: 'curtain-breathe 5.2s ease-in-out infinite' }}
            />
            {(activeStage === 'recognizing' || activeStage === 'thinking') && (
              <div className="absolute inset-x-8 top-[46%] h-px overflow-hidden rounded-full bg-white/20 dark:bg-white/10 pointer-events-none">
                <div className="voice-stage-scan h-full w-1/2 bg-gradient-to-r from-transparent via-white/80 to-transparent" />
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-white/40 dark:from-black/20 to-transparent pointer-events-none" />
            <div className="flex items-center justify-between px-5 py-3 border-b border-black/5 dark:border-white/8 bg-white/40 dark:bg-black/10 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="w-4 h-4 text-gray-500" />
                  <span className="text-[13px] font-black tracking-tight">实时字幕</span>
                </div>
                <span
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black tracking-[0.14em] shrink-0"
                  style={{ color: stageMeta.accent, background: stageMeta.soft, borderColor: stageMeta.soft }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: stageMeta.accent, boxShadow: `0 0 12px ${stageMeta.accent}` }} />
                  {stageMeta.label}
                </span>
                <span className="truncate text-[11px] font-medium text-gray-500 dark:text-gray-300">{stageMeta.caption}</span>
                {latency > 0 && micActive && (
                  <span
                    className="hidden sm:inline text-[10px] font-mono text-gray-400"
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
            <div className="relative flex-1 min-h-0 px-8 py-6 flex flex-col">
              <div className="flex-1 overflow-hidden relative" id="subtitle-container">
                {subtitles.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center gap-4 select-none text-center">
                    <div className="relative w-28 h-28 rounded-full flex items-center justify-center">
                      <div
                        className="absolute inset-0 rounded-full border"
                        style={{ borderColor: stageMeta.soft, background: stageMeta.soft, boxShadow: `0 0 54px ${stageMeta.soft}` }}
                      />
                      <div
                        className={cn(
                          'absolute inset-2 rounded-full border border-dashed opacity-60',
                          (activeStage === 'thinking' || activeStage === 'replying') && 'voice-orbit'
                        )}
                        style={{ borderColor: stageMeta.accent }}
                      />
                      <MessageSquareText className="relative w-11 h-11" style={{ color: stageMeta.accent }} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[15px] font-black tracking-[0.22em] uppercase" style={{ color: stageMeta.accent }}>{stageMeta.label}</p>
                      <p className="text-[12px] font-semibold text-gray-400">{micActive ? voiceStatus : '等待舞台点亮'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col justify-end items-center pb-8">
                    {subtitles.slice(-3).map((sub, i, arr) => {
                      const isLatest = i === arr.length - 1;
                      const distance = arr.length - 1 - i;

                      return (
                        <div
                          key={sub.id}
                          className={cn(
                            "flex flex-col gap-3 transition-all duration-1000 cubic-bezier(0.16, 1, 0.3, 1)",
                            sub.role === 'ai' ? 'items-start self-start ml-4' : 'items-end self-end mr-4'
                          )}
                          style={{
                            opacity: isLatest ? 1 : Math.max(0, 0.3 - distance * 0.1),
                            transform: isLatest
                              ? 'translateY(0) scale(1)'
                              : `translateY(${-40 - distance * 30}px) scale(${0.9 - distance * 0.05})`,
                            filter: isLatest ? 'none' : `blur(${2 + distance * 2}px)`,
                            zIndex: 10 - distance,
                            position: isLatest ? 'relative' : 'absolute',
                            bottom: isLatest ? 0 : 'auto',
                            transitionDelay: isLatest ? '0ms' : '50ms'
                          }}
                        >
                          {isLatest && (
                            <div className={cn(
                              "flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black tracking-[0.18em] border shadow-sm animate-sub-in",
                              sub.role === 'ai'
                                ? 'bg-amber-500/18 text-amber-600 dark:text-amber-300 border-amber-500/30'
                                : 'bg-sky-500/20 text-sky-600 dark:text-sky-300 border-sky-500/30'
                            )}>
                              {sub.role === 'ai' ? 'AI 回应' : '我的语音'}
                              {sub.fresh && <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping" />}
                              {sub.fresh && <SubWave role={sub.role} />}
                            </div>
                          )}

                          <div className={cn(
                            "relative overflow-hidden px-7 py-4 rounded-[28px] text-[16px] font-bold leading-relaxed shadow-2xl backdrop-blur-xl transition-all border",
                            isLatest
                              ? (sub.role === 'ai'
                                  ? 'bg-white/95 dark:bg-white/10 text-slate-900 dark:text-white border-amber-200/80 dark:border-amber-300/20'
                                  : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white border-blue-400/50')
                              : 'bg-transparent text-gray-400 border-transparent shadow-none'
                          )}
                          style={{
                            animation: isLatest ? 'bubble-glow 4s ease-in-out infinite' : 'none',
                            maxWidth: isLatest ? '90%' : '70%',
                            boxShadow: isLatest ? undefined : 'none',
                            overflowWrap: 'anywhere',
                          }}>
                            {isLatest && sub.fresh && (
                              <span className="absolute inset-y-0 -left-1/2 w-1/2 voice-stage-scan bg-gradient-to-r from-transparent via-white/50 to-transparent pointer-events-none" />
                            )}
                            {sub.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 pb-6 pt-2 shrink-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2 opacity-40">
                    <span className="text-[9px] font-black tracking-[0.22em] text-gray-400 uppercase">实时波纹</span>
                    <span className="text-[9px] font-mono" style={{ color: stageMeta.accent }}>{Math.round(voiceLevel * 100)}%</span>
                  </div>
                  <FullWave active={micActive} voiceLevel={voiceLevel} color={(micActive || voiceLevel > 0.01) ? stageMeta.accent : '#d1d5db'} barCount={80} />
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
              className="w-full h-32 px-4 py-3 rounded-xl bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50 resize-none"
              value={settingsDraft.prompt}
              onChange={e => setSettingsDraft(d => ({ ...d, prompt: e.target.value }))}
              placeholder="语音交互模式下 AI 的系统提示词..."
            />
            <p className="text-[11px] text-gray-400 mt-1.5">
              可使用 <code className="bg-black/5 px-1 rounded">{'{gender}'}</code> 占位符，自动替换为所选 AI 性别
            </p>
          </div>

          <div className="h-px bg-white/10 my-2" />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-[13px] font-bold">OBS 场景感知</h4>
                <p className="text-[11px] text-gray-500">连接 OBS WebSocket 5.x 实现推流/场景同步</p>
              </div>
              <Toggle
                checked={settingsDraft.obsEnabled}
                onChange={v => setSettingsDraft(d => ({ ...d, obsEnabled: v }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] text-gray-500 ml-1">Host</label>
                <Input
                  value={settingsDraft.obsHost}
                  onChange={e => setSettingsDraft(d => ({ ...d, obsHost: e.target.value }))}
                  placeholder="127.0.0.1"
                  className="h-9 text-[12px]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-gray-500 ml-1">Port</label>
                <Input
                  type="number"
                  value={settingsDraft.obsPort}
                  onChange={e => setSettingsDraft(d => ({ ...d, obsPort: parseInt(e.target.value) || 0 }))}
                  placeholder="4455"
                  className="h-9 text-[12px]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-gray-500 ml-1">Password</label>
              <Input
                type="password"
                value={settingsDraft.obsPassword}
                onChange={e => setSettingsDraft(d => ({ ...d, obsPassword: e.target.value }))}
                placeholder="OBS WebSocket 密码（可选）"
                className="h-9 text-[12px]"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-2 px-6 pb-6 shrink-0">
          <Button variant="primary" className="flex-1" onClick={async () => {
            if (!config) return;
            const next = {
              ...config,
              VoiceGender: settingsDraft.gender,
              VoiceSystemPrompt: settingsDraft.prompt,
              ObsEnabled: settingsDraft.obsEnabled,
              ObsHost: settingsDraft.obsHost,
              ObsPort: settingsDraft.obsPort,
              ObsPassword: settingsDraft.obsPassword,
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
