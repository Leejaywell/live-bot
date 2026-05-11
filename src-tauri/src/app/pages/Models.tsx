import { useState, useEffect } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { TextArea } from '../components/TextArea';
import { Toggle } from '../components/Toggle';
import {
  Plus, X, Brain, Sparkles, Zap, Bot, MessageCircle,
  Cpu, CheckCircle2, Mic, Volume2, ChevronDown, Lock,
  Download, AlertCircle,
} from 'lucide-react';
import { api, AppConfig, AiProvider } from '../lib/api';
import { toast } from 'sonner';

// ── 供应商模板 ─────────────────────────────────────────────────────────────────

const LLM_PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek',  apiUrl: 'https://api.deepseek.com/v1',                       model: 'deepseek-chat' },
  { value: 'minimax',  label: 'MiniMax',   apiUrl: 'https://api.minimaxi.com/v1',                       model: 'MiniMax-M2' },
  { value: 'qianwen',  label: '通义千问',  apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-max' },
  { value: 'glm',      label: '智谱 GLM',  apiUrl: 'https://open.bigmodel.cn/api/paas/v4',              model: 'glm-4-flash' },
  { value: 'kimi',     label: 'Kimi',      apiUrl: 'https://api.moonshot.cn/v1',                        model: 'moonshot-v1-8k' },
  { value: 'openai',   label: 'OpenAI',    apiUrl: 'https://api.openai.com/v1',                         model: 'gpt-4o-mini' },
  { value: 'custom',   label: '自定义',    apiUrl: '',                                                   model: '' },
];

const ASR_PROVIDERS = [
  { value: 'funasr',         label: 'FunASR（本地）',        wsUrl: 'ws://localhost:10095' },
  { value: 'sensevoice',     label: 'SenseVoice（本地）',    wsUrl: 'ws://localhost:10096' },
  { value: 'faster-whisper', label: 'Faster-Whisper（本地）',wsUrl: 'ws://localhost:9090'  },
  { value: 'volcengine-asr', label: '火山 ASR（云端）',      wsUrl: ''                     },
];

const ASR_LANGUAGES = [
  { value: 'zh',   label: '中文'    },
  { value: 'en',   label: 'English' },
  { value: 'auto', label: '自动检测' },
];

const TTS_PROVIDERS = [
  { value: 'edge',           label: 'Edge TTS（免费）'    },
  { value: 'minimax-tts',    label: 'MiniMax TTS（云端）' },
  { value: 'cosyvoice',      label: 'CosyVoice（本地）'   },
  { value: 'fish-speech',    label: 'Fish Speech（本地）' },
  { value: 'volcengine-tts', label: '火山 TTS（云端）'    },
  { value: 'azure',          label: 'Azure TTS'            },
];

const EDGE_VOICES = [
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓（温柔女声）' },
  { value: 'zh-CN-YunjianNeural',  label: '云健（沉稳男声）' },
  { value: 'zh-CN-XiaoyiNeural',   label: '晓伊（动漫少女）' },
  { value: 'zh-CN-YunxiNeural',    label: '云希（主播音色）' },
];

const MINIMAX_VOICES = [
  { value: 'zh_female_wanwanxiaohe_moon_bigtts',  label: '弯弯小荷（温柔女声）' },
  { value: 'zh_female_shuangkuaisisi_moon_bigtts', label: '爽快思思（活泼女声）' },
  { value: 'zh_male_tianyu_moon_bigtts',            label: '天宇（沉稳男声）' },
  { value: 'zh_female_xiaoyou_moon_bigtts',         label: '小悠（少女音色）' },
  { value: 'zh_female_zhirou_moon_bigtts',          label: '知柔（温婉女声）' },
  { value: 'zh_male_qinqiang_moon_bigtts',          label: '秦腔（浑厚男声）' },
];

const MAX_PER_TYPE = 3;

// ── 工具 ───────────────────────────────────────────────────────────────────────

export const availableProviders = LLM_PROVIDERS;

type ProviderType = 'llm' | 'asr' | 'tts';

const TYPE_META: Record<ProviderType, { label: string; icon: React.ElementType; accent: string }> = {
  llm: { label: 'LLM',  icon: Cpu,     accent: 'var(--primary-color)' },
  asr: { label: 'ASR',  icon: Mic,     accent: '#34c759'               },
  tts: { label: 'TTS',  icon: Volume2, accent: '#ff9f0a'               },
};

const llmIcon = (name: string): React.ElementType => {
  const map: Record<string, React.ElementType> = {
    DeepSeek: Brain, Kimi: Sparkles, MiniMax: Zap,
    '智谱 GLM': Bot, '通义千问': MessageCircle, OpenAI: Bot,
  };
  return map[name] ?? Sparkles;
};

// ── 通用 GlassSelect ──────────────────────────────────────────────────────────

function GSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full h-[34px] pl-3 pr-8 rounded-lg appearance-none bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[12px] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
    </div>
  );
}

// ── 新建时弹窗：先选类型 ───────────────────────────────────────────────────────

function TypePickerModal({ onPick, onClose }: {
  onPick: (type: ProviderType) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]">
      <GlassCard className="w-[340px] p-6 shadow-2xl border border-white/10">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[13px] font-semibold">选择服务类型</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-2">
          {(['llm', 'asr', 'tts'] as ProviderType[]).map(t => {
            const { label, icon: Icon, accent } = TYPE_META[t];
            const desc = t === 'llm' ? '大语言模型，提供 AI 对话能力' : t === 'asr' ? '语音识别，将语音转为文字' : '语音合成，将文字转为语音';
            return (
              <button key={t} type="button" onClick={() => onPick(t)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 dark:border-white/12 hover:border-[var(--primary-color)]/50 hover:bg-[var(--primary-color)]/5 transition-all text-left group">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all group-hover:scale-105"
                  style={{ background: `${accent}18`, border: `1.5px solid ${accent}30` }}>
                  <Icon className="w-4 h-4" style={{ color: accent }} />
                </div>
                <div>
                  <div className="text-[12px] font-semibold">{label}</div>
                  <div className="text-[10px] text-gray-400">{desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}

// ── 编辑弹窗内容：按类型渲染 ──────────────────────────────────────────────────

function LlmFields({ p, set, errors }: {
  p: AiProvider; set: (patch: Partial<AiProvider>) => void; errors: Record<string, boolean>;
}) {
  const fCls = (k: string) => `w-full h-9${errors[k] ? ' ring-2 ring-red-400/60 border-red-400' : ''}`;
  const updateTemplate = (val: string) => {
    const info = LLM_PROVIDERS.find(lp => lp.value === val);
    if (!info) return;
    if (val === 'custom') {
      set({ Name: '', Model: '', APIUrl: '' });
    } else {
      set({ Name: info.label, Model: info.model || p.Model, APIUrl: info.apiUrl || p.APIUrl });
    }
  };
  const currentTmpl = LLM_PROVIDERS.find(lp => lp.label === p.Name)?.value ?? 'custom';
  const isCustom = currentTmpl === 'custom';

  return (
    <div className="space-y-3.5">
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">供应商</label>
        <GSelect value={currentTmpl} onChange={updateTemplate} options={LLM_PROVIDERS} />
      </div>
      {/* 自定义时显示供应商名称输入框 */}
      {isCustom && (
        <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">
            供应商名称 <span className="text-red-400">*</span>
          </label>
          <Input value={p.Name} onChange={e => set({ Name: e.target.value })}
            className={fCls('Name')} placeholder="例如：我的私有模型" />
          {errors['Name'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
        </div>
      )}
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">模型 <span className="text-red-400">*</span></label>
        <Input mono value={p.Model} onChange={e => set({ Model: e.target.value })} className={fCls('Model')} placeholder="gpt-4o-mini" />
        {errors['Model'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
      </div>
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">API URL <span className="text-red-400">*</span></label>
        <Input mono value={p.APIUrl} onChange={e => set({ APIUrl: e.target.value })} className={fCls('APIUrl')} placeholder="https://api.openai.com/v1" />
        {errors['APIUrl'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
      </div>
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">API Key <span className="text-red-400">*</span></label>
        <Input type="password" mono value={p.APIKey} onChange={e => set({ APIKey: e.target.value })} className={fCls('APIKey')} placeholder="sk-..." />
        {errors['APIKey'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
      </div>
      <div className="flex items-center justify-between p-3 rounded-lg bg-black/5 dark:bg-white/5 border border-gray-200 dark:border-white/10">
        <div>
          <span className="text-[12px] font-medium block">启用</span>
          <span className="text-[10px] text-gray-500">机器人可选用此模型服务</span>
        </div>
        <Toggle checked={p.Enabled} onChange={v => set({ Enabled: v })} />
      </div>
      <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/40">
        <p className="text-[10px] text-blue-600 dark:text-blue-400">昵称和人设请在「AI 机器人」页面的机器人配置中设置</p>
      </div>
    </div>
  );
}

function AsrFields({ p, set }: { p: AiProvider; set: (patch: Partial<AiProvider>) => void }) {
  const currentEngine = ASR_PROVIDERS.find(ap => ap.value === p.Model) ?? ASR_PROVIDERS[0];
  const isSenseVoice = currentEngine.value === 'sensevoice';
  const [svModelOk, setSvModelOk] = useState(true);
  const [svDlStage, setSvDlStage] = useState<'idle' | 'downloading' | 'extracting' | 'done' | 'error'>('idle');
  const [svDlPct, setSvDlPct] = useState(0);

  // 检查 SenseVoice 模型状态
  useEffect(() => {
    if (!isSenseVoice) return;
    api.checkVoiceModels().then(m => setSvModelOk(m.asr_local_model_ok)).catch(() => {});
  }, [isSenseVoice]);

  // 监听下载进度
  useEffect(() => {
    if (!isSenseVoice) return;
    let unl: (() => void) | undefined;
    api.onVoiceModelProgress(data => {
      if (data.stage === 'downloading') { setSvDlStage('downloading'); setSvDlPct(data.pct); }
      else if (data.stage === 'extracting') { setSvDlStage('extracting'); }
      else if (data.stage === 'done') {
        setSvDlStage('done');
        setSvModelOk(true);
        api.checkVoiceModels().then(m => setSvModelOk(m.asr_local_model_ok)).catch(() => {});
        toast.success('SenseVoice 模型下载完成');
      }
    }).then(f => { unl = f; });
    return () => unl?.();
  }, [isSenseVoice]);

  const handleSvDownload = async () => {
    setSvDlStage('downloading'); setSvDlPct(0);
    try { await api.downloadSensevoiceModel(); }
    catch (e) { setSvDlStage('error'); toast.error(`下载失败: ${e}`); }
  };

  const updateEngine = (val: string) => {
    const info = ASR_PROVIDERS.find(ap => ap.value === val);
    if (!info) return;
    // sensevoice 是本地模型，APIUrl 留空
    set({ Name: info.label, Model: val, APIUrl: val === 'sensevoice' ? '' : info.wsUrl });
  };
  return (
    <div className="space-y-3.5">
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">识别引擎</label>
        <GSelect value={currentEngine.value} onChange={updateEngine} options={ASR_PROVIDERS} />
      </div>

      {/* SenseVoice 模型下载 */}
      {isSenseVoice && !svModelOk && (
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
            <AlertCircle className="w-3.5 h-3.5" />本地模型文件缺失
          </div>
          <p className="text-[10px] text-gray-500">SenseVoice 模型（约 155MB）需要下载到本地后才能使用</p>
          {svDlStage === 'downloading' && (
            <div className="space-y-1">
              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${svDlPct}%` }} />
              </div>
              <p className="text-[10px] text-gray-400">{svDlPct}%</p>
            </div>
          )}
          {svDlStage === 'extracting' && <p className="text-[10px] text-gray-400">正在解压...</p>}
          <button
            onClick={handleSvDownload}
            disabled={svDlStage === 'downloading' || svDlStage === 'extracting'}
            className="flex items-center gap-1 h-[26px] px-3 rounded-lg text-[10px] font-medium
                       bg-amber-500 text-white hover:bg-amber-600
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Download className="w-3 h-3" />
            {svDlStage === 'downloading' ? `下载中 ${svDlPct}%` : svDlStage === 'extracting' ? '解压中...' : '下载模型'}
          </button>
        </div>
      )}

      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">WebSocket 地址</label>
        <Input mono value={isSenseVoice ? '' : p.APIUrl} onChange={e => set({ APIUrl: e.target.value })} className="w-full h-9" placeholder={isSenseVoice ? '本地模型，无需配置' : "ws://localhost:10095"} disabled={isSenseVoice} />
        <p className="text-[10px] text-gray-400 mt-0.5">{isSenseVoice ? 'SenseVoice 使用本地 ONNX 推理，无需外部服务' : '本地服务填 ws://localhost:端口'}</p>
      </div>
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">识别语言</label>
        <GSelect value={p.TriggerCommand || 'zh'} onChange={v => set({ TriggerCommand: v })} options={ASR_LANGUAGES} />
      </div>
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">显示名称</label>
        <Input value={p.Nickname} onChange={e => set({ Nickname: e.target.value })} className="w-full h-9" placeholder="主麦 ASR" />
      </div>
      <div className="flex items-center justify-between p-3 rounded-lg bg-black/5 dark:bg-white/5 border border-gray-200 dark:border-white/10">
        <div><span className="text-[12px] font-medium block">启用</span><span className="text-[10px] text-gray-500">语音交互页将使用此引擎</span></div>
        <Toggle checked={p.Enabled} onChange={v => set({ Enabled: v })} />
      </div>
    </div>
  );
}

function TtsFields({ p, set }: { p: AiProvider; set: (patch: Partial<AiProvider>) => void }) {
  const isEdge = p.Name.includes('Edge');
  const isMiniMax = p.Name.includes('MiniMax');
  const ttsSpeed = isNaN(Number(p.TriggerCommand)) ? 1.0 : Number(p.TriggerCommand || '1.0');
  const updateTtsProvider = (val: string) => {
    const info = TTS_PROVIDERS.find(tp => tp.value === val);
    if (info) set({ Name: info.label });
  };
  const voiceListId = isEdge ? 'tts-edge-voices' : isMiniMax ? 'tts-minimax-voices' : undefined;
  const voicePlaceholder = isEdge || isMiniMax ? '选择预设或输入 Voice ID' : 'Voice ID';
  return (
    <div className="space-y-3.5">
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">TTS 供应商</label>
        <GSelect value={TTS_PROVIDERS.find(tp => p.Name.includes(tp.label.split('（')[0]))?.value ?? 'edge'}
          onChange={updateTtsProvider} options={TTS_PROVIDERS} />
      </div>
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">默认音色 / Voice ID</label>
        <input
          list={voiceListId}
          value={p.Model}
          onChange={e => set({ Model: e.target.value })}
          placeholder={voicePlaceholder}
          className="w-full h-9 pl-3 pr-3 rounded-lg text-[12px] font-mono bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50"
        />
        {isEdge && (
          <datalist id="tts-edge-voices">
            {EDGE_VOICES.map(v => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </datalist>
        )}
        {isMiniMax && (
          <datalist id="tts-minimax-voices">
            {MINIMAX_VOICES.map(v => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </datalist>
        )}
      </div>
      {!p.Name.includes('本地') && (
        <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">API Key</label>
          <Input type="password" mono value={p.APIKey} onChange={e => set({ APIKey: e.target.value })} className="w-full h-9" placeholder="留空则免费（Edge TTS）" />
        </div>
      )}
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 flex items-center justify-between">
          语速 <span className="font-mono text-[10px] text-gray-400">{ttsSpeed.toFixed(1)}×</span>
        </label>
        <input type="range" min={0.5} max={2.0} step={0.1} value={ttsSpeed}
          onChange={e => set({ TriggerCommand: e.target.value })}
          className="w-full" style={{ accentColor: 'var(--primary-color)' }} />
      </div>
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">显示名称</label>
        <Input value={p.Nickname} onChange={e => set({ Nickname: e.target.value })} className="w-full h-9" placeholder="主播 TTS" />
      </div>
      <div className="flex items-center justify-between p-3 rounded-lg bg-black/5 dark:bg-white/5 border border-gray-200 dark:border-white/10">
        <div><span className="text-[12px] font-medium block">启用</span><span className="text-[10px] text-gray-500">语音交互页将使用此音色</span></div>
        <Toggle checked={p.Enabled} onChange={v => set({ Enabled: v })} />
      </div>
    </div>
  );
}

// ── 校验 ───────────────────────────────────────────────────────────────────────

function validateProvider(p: AiProvider): Record<string, boolean> {
  if ((p.ProviderType || 'llm') === 'llm') {
    const isCustom = !LLM_PROVIDERS.filter(lp => lp.value !== 'custom').some(lp => lp.label === p.Name);
    return {
      Name:   isCustom && !p.Name.trim(),
      Model:  !p.Model.trim(),
      APIUrl: !p.APIUrl.trim(),
      APIKey: !p.APIKey.trim(),
    };
  }
  return {};
}

// ── 卡片 ───────────────────────────────────────────────────────────────────────

function ProviderCard({ p, onEdit, onRemove, onToggle, refCount }: {
  p: AiProvider; onEdit: () => void; onRemove: () => void; onToggle: () => void; refCount?: number;
}) {
  const type    = (p.ProviderType || 'llm') as ProviderType;
  const { icon: Icon, accent, label: typeLabel } = TYPE_META[type];
  const cardIcon = type === 'llm' ? llmIcon(p.Name) : Icon;
  const CardIcon = cardIcon;
  const sub     = type === 'asr' ? (p.APIUrl || '未配置地址') : type === 'tts' ? (p.Model || '未设置音色') : (p.Model || '未设置模型');
  // LLM：被机器人引用不可删；ASR/TTS：被启用且是唯一启用的不可删
  const isLlmReferenced = type === 'llm' && (refCount ?? 0) > 0;
  const isOnlyEnabled   = type !== 'llm' && p.Enabled && (refCount ?? 0) > 0; // refCount 这里传的是该类型启用数
  const isReferenced    = isLlmReferenced || isOnlyEnabled;
  const refTip = isLlmReferenced
    ? `被 ${refCount} 个机器人引用`
    : isOnlyEnabled ? '唯一启用的服务，请先添加同类服务再删除' : '删除';

  // 卡片主标题：LLM 显示供应商名，ASR/TTS 显示昵称或名称
  const title = type === 'llm' ? p.Name : (p.Nickname || p.Name);

  return (
    <GlassCard className="p-3.5 flex flex-col gap-2.5 relative group">
      {/* 删除按钮 */}
      <button
        onClick={isReferenced ? () => toast.error(refTip) : onRemove}
        className={`absolute right-2 top-2 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${
          isReferenced ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed' : 'bg-red-500 text-white'
        }`}
        title={refTip}>
        {isReferenced ? <Lock className="w-2.5 h-2.5 text-gray-500 dark:text-gray-400" /> : <X className="w-2.5 h-2.5" />}
      </button>

      {/* 头部 */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={p.Enabled ? { background: accent } : { background: 'rgba(0,0,0,0.06)' }}>
          <CardIcon className={`w-4 h-4 ${p.Enabled ? 'text-white' : 'text-gray-400'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-semibold truncate">{title}</span>
            {isLlmReferenced && (
              <span className="text-[9px] text-[var(--primary-color)] bg-[var(--primary-color)]/10 px-1.5 py-0.5 rounded-full shrink-0">
                {refCount}个机器人
              </span>
            )}
          </div>
          <div className="text-[10px] text-gray-400 flex items-center gap-1">
            <span className="px-1 py-px rounded text-[9px] font-medium"
              style={{ background: `${accent}18`, color: accent }}>{typeLabel}</span>
            {type !== 'llm' && <span className="truncate">{p.Name}</span>}
          </div>
        </div>
      </div>

      {/* 模型/地址 */}
      <div className="text-[10px] font-mono text-gray-500 dark:text-gray-400 bg-black/5 dark:bg-white/5 rounded px-2 py-1 truncate">
        {sub}
      </div>

      {/* 操作行 */}
      <div className="flex items-center justify-between">
        <button onClick={onToggle}
          className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition-colors ${
            p.Enabled ? 'text-[var(--primary-color)] bg-[var(--primary-color)]/10' : 'text-gray-400 bg-gray-100 dark:bg-white/5 hover:text-gray-600'
          }`}>
          <CheckCircle2 className="w-3 h-3" />
          {p.Enabled ? '已启用' : '已停用'}
        </button>
        <button onClick={onEdit}
          className="text-[10px] text-gray-400 hover:text-[var(--primary-color)] px-2 py-1 rounded-lg hover:bg-[var(--primary-color)]/5 transition-colors">
          编辑
        </button>
      </div>
    </GlassCard>
  );
}

// ── blank 生成 ─────────────────────────────────────────────────────────────────

function blankProvider(type: ProviderType, nth: number): AiProvider {
  if (type === 'asr') {
    const def = ASR_PROVIDERS[0];
    return { Id: `asr-${Date.now()}`, ProviderType: 'asr', Name: def.label, Model: def.value, APIUrl: def.wsUrl, APIKey: '', SystemPrompt: '', TriggerCommand: 'zh', FuzzyMatch: false, Nickname: `ASR${nth}`, Enabled: true };
  }
  if (type === 'tts') {
    return { Id: `tts-${Date.now()}`, ProviderType: 'tts', Name: 'Edge TTS（免费）', Model: 'zh-CN-XiaoxiaoNeural', APIUrl: '', APIKey: '', SystemPrompt: '', TriggerCommand: '1.0', FuzzyMatch: false, Nickname: `TTS${nth}`, Enabled: true };
  }
  const def = LLM_PROVIDERS[0];
  return { Id: `llm-${Date.now()}`, ProviderType: 'llm', Name: def.label, Model: def.model, APIUrl: def.apiUrl, APIKey: '', SystemPrompt: '', TriggerCommand: '', FuzzyMatch: false, Nickname: '', Enabled: true };
}

// ── 主组件 ─────────────────────────────────────────────────────────────────────

export function Models() {
  const [config,       setConfig]       = useState<AppConfig | null>(null);
  const [pending,      setPending]      = useState<AiProvider | null>(null);
  const [errors,       setErrors]       = useState<Record<string, boolean>>({});
  const [showTypePick, setShowTypePick] = useState(false);

  useEffect(() => { api.loadConfig().then(setConfig).catch(console.error); }, []);

  const handleAdd = () => setShowTypePick(true);

  const handlePickType = (type: ProviderType) => {
    if (!config) return;
    const count = (config.AiProviders ?? []).filter(p => (p.ProviderType || 'llm') === type).length;
    if (count >= MAX_PER_TYPE) {
      toast.error(`${TYPE_META[type].label} 最多配置 ${MAX_PER_TYPE} 个`);
      setShowTypePick(false);
      return;
    }
    setShowTypePick(false);
    setPending(blankProvider(type, count + 1));
    setErrors({});
  };

  const handleEdit = (p: AiProvider) => { setPending({ ...p }); setErrors({}); };

  const handleSave = async () => {
    if (!config || !pending) return;
    const errs = validateProvider(pending);
    if (Object.values(errs).some(Boolean)) { setErrors(errs); toast.error('请填写必填字段'); return; }

    let next: AppConfig;
    if (config.AiProviders.some(p => p.Id === pending.Id)) {
      next = { ...config, AiProviders: config.AiProviders.map(p => p.Id === pending.Id ? pending : p) };
    } else {
      const providers = [...config.AiProviders, pending];
      const isLlm = (pending.ProviderType || 'llm') === 'llm';
      next = { ...config, AiProviders: providers, ActiveProviderId: isLlm && !config.ActiveProviderId ? pending.Id : config.ActiveProviderId };
    }
    try {
      await api.saveConfig(next);
      setConfig(next);
      toast.success('保存成功');
      setPending(null);
      setErrors({});
    } catch (err) { toast.error(`保存失败: ${err}`); }
  };

  const handleRemove = async (id: string) => {
    if (!config) return;
    const target = config.AiProviders.find(p => p.Id === id);
    if (!target) return;
    const type = (target.ProviderType || 'llm') as ProviderType;
    if (type === 'llm') {
      const refCount = (config.AiBots ?? []).filter(b => b.ProviderId === id).length;
      if (refCount > 0) { toast.error(`该模型被 ${refCount} 个机器人引用，请先修改机器人`); return; }
    } else {
      // ASR / TTS：被启用且是该类型唯一启用的，不可删
      const enabledOfType = config.AiProviders.filter(p => (p.ProviderType || 'llm') === type && p.Enabled).length;
      if (target.Enabled && enabledOfType === 1) {
        toast.error(`请先添加另一个 ${TYPE_META[type].label} 服务，再删除此项`);
        return;
      }
    }
    const providers = config.AiProviders.filter(p => p.Id !== id);
    const newActive = providers.find(p => p.Enabled && (p.ProviderType || 'llm') === 'llm')?.Id ?? providers[0]?.Id ?? '';
    const next = { ...config, AiProviders: providers, ActiveProviderId: newActive };
    setConfig(next);
    await api.saveConfig(next).catch(() => toast.error('删除失败'));
  };

  const handleToggle = async (p: AiProvider) => {
    if (!config) return;
    const llmEnabled = config.AiProviders.filter(pp => pp.Enabled && (pp.ProviderType || 'llm') === 'llm').length;
    if (p.Enabled && (p.ProviderType || 'llm') === 'llm' && llmEnabled === 1) { toast.error('至少需要保留一个启用的 LLM'); return; }
    const providers = config.AiProviders.map(item => item.Id === p.Id ? { ...item, Enabled: !item.Enabled } : item);
    const firstLlm  = providers.find(pp => pp.Enabled && (pp.ProviderType || 'llm') === 'llm');
    const next = { ...config, AiProviders: providers, ActiveProviderId: firstLlm?.Id ?? config.ActiveProviderId };
    setConfig(next);
    await api.saveConfig(next).catch(() => toast.error('操作失败'));
  };

  const setPendingField = (patch: Partial<AiProvider>) => {
    if (!pending) return;
    const next = { ...pending, ...patch };
    setPending(next);
    if (Object.keys(errors).length) setErrors(validateProvider(next));
  };

  if (!config) return <div className="p-8 text-center text-gray-500">加载中...</div>;

  const allProviders = config.AiProviders ?? [];
  const totalByType = (t: ProviderType) => allProviders.filter(p => (p.ProviderType || 'llm') === t).length;
  const canAdd = (['llm', 'asr', 'tts'] as ProviderType[]).some(t => totalByType(t) < MAX_PER_TYPE);

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto">
      {/* 页头 */}
      <div className="flex items-start justify-between shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[var(--primary-color)]" />
            模型服务
          </h1>
          <p className="text-[11px] text-gray-400 mt-0.5">管理 LLM · ASR · TTS 服务，每类最多 {MAX_PER_TYPE} 个</p>
        </div>
        <Button variant={canAdd ? 'primary' : 'default'} size="sm" onClick={handleAdd} disabled={!canAdd}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />添加服务
        </Button>
      </div>

      {/* 统一卡片区 */}
      {allProviders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Cpu className="w-12 h-12 text-gray-300 dark:text-gray-600" />
          <div className="text-gray-400 text-[12px]">还没有配置任何服务</div>
          <Button size="sm" variant="primary" onClick={handleAdd}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />添加第一个
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {allProviders.map(p => (
            <ProviderCard key={p.Id} p={p}
              refCount={
                (p.ProviderType || 'llm') === 'llm'
                  ? (config.AiBots ?? []).filter(b => b.ProviderId === p.Id).length
                  : config.AiProviders.filter(pp => (pp.ProviderType || 'llm') === (p.ProviderType || 'llm') && pp.Enabled).length
              }
              onEdit={() => handleEdit(p)}
              onRemove={() => handleRemove(p.Id)}
              onToggle={() => handleToggle(p)}
            />
          ))}
        </div>
      )}

      {/* 类型选择弹窗 */}
      {showTypePick && <TypePickerModal onPick={handlePickType} onClose={() => setShowTypePick(false)} />}

      {/* 编辑弹窗 */}
      {pending && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]">
          <GlassCard className="w-[480px] max-h-[88vh] overflow-hidden flex flex-col shadow-2xl border border-white/10">
            <div className="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
              <h2 className="text-[13px] font-semibold flex items-center gap-2">
                {(() => {
                  const type = (pending.ProviderType || 'llm') as ProviderType;
                  const { icon: Icon, label } = TYPE_META[type];
                  return <><Icon className="w-4 h-4" />{config.AiProviders.some(p => p.Id === pending.Id) ? '编辑' : '添加'} {label}</>;
                })()}
              </h2>
              <button onClick={() => { setPending(null); setErrors({}); }}
                className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {pending.ProviderType === 'asr' ? <AsrFields p={pending} set={setPendingField} />
                : pending.ProviderType === 'tts' ? <TtsFields p={pending} set={setPendingField} />
                : <LlmFields p={pending} set={setPendingField} errors={errors} />}
            </div>
            <div className="p-5 border-t border-white/10 flex gap-2 shrink-0">
              <Button variant="default" className="flex-1 h-10" onClick={() => { setPending(null); setErrors({}); }}>取消</Button>
              <Button variant="primary" className="flex-1 h-10" onClick={handleSave}>保存</Button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
