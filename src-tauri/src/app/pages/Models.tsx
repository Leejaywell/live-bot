import React, { useState, useEffect } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import {
  Plus, Brain, Sparkles, Zap, Bot, MessageCircle,
  Cpu, Mic, Volume2, ChevronDown, Star,
  Download, AlertCircle, MoreHorizontal, ChevronRight,
} from 'lucide-react';
import { api, AppConfig, AiProvider } from '../lib/api';
import { toast } from 'sonner';
import { Modal, ModalCloseButton } from '../components/Modal';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../components/ui/collapsible';
import { cn } from '../lib/utils';

// ── 供应商模板 ─────────────────────────────────────────────────────────────────

const LLM_PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek',  apiUrl: 'https://api.deepseek.com/v1',                       model: 'deepseek-chat',  desc: '高性价比，中文理解力出色' },
  { value: 'minimax',  label: 'MiniMax',   apiUrl: 'https://api.minimaxi.com/v1',                       model: 'MiniMax-M2',     desc: '多模态能力，低延迟响应' },
  { value: 'qianwen',  label: '通义千问',  apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-max',       desc: '阿里云生态，企业级安全合规' },
  { value: 'glm',      label: '智谱 GLM',  apiUrl: 'https://open.bigmodel.cn/api/paas/v4',              model: 'glm-4-flash',    desc: '国产开源大模型，学术研究友好' },
  { value: 'kimi',     label: 'Kimi',      apiUrl: 'https://api.moonshot.cn/v1',                        model: 'moonshot-v1-8k', desc: '超长上下文窗口，支持联网搜索' },
  { value: 'openai',   label: 'OpenAI',    apiUrl: 'https://api.openai.com/v1',                         model: 'gpt-4o-mini',    desc: '全球领先，丰富插件生态' },
  { value: 'custom',   label: '自定义',    apiUrl: '',                                                   model: '',               desc: '自托管模型，完全数据可控' },
];

const ASR_PROVIDERS = [
  { value: 'funasr',         label: 'FunASR（外部服务）',        wsUrl: 'ws://localhost:10095', desc: '需单独启动 FunASR WebSocket 服务后接入' },
  { value: 'sensevoice',     label: 'SenseVoice（内置本地）',    wsUrl: '',                     desc: '内置本地识别，支持普通话 / 粤语 / 英语 / 日语 / 韩语；其他方言（闽南语、四川话等）需接云端 ASR' },
  { value: 'faster-whisper', label: 'Faster-Whisper（外部服务）',wsUrl: 'ws://localhost:9090',  desc: '需单独启动 Faster-Whisper / WhisperLive 服务后接入' },
  { value: 'volcengine-asr', label: '火山 ASR（云端）',          wsUrl: '',                     desc: '云端流式识别，超低延迟' },
];

const ASR_LANGUAGES = [
  { value: 'zh',   label: '普通话' },
  { value: 'yue',  label: '粤语'   },
  { value: 'en',   label: 'English' },
  { value: 'ja',   label: '日語'   },
  { value: 'ko',   label: '한국어'  },
  { value: 'auto', label: '自动检测（易误判）' },
];

const TTS_PROVIDERS = [
  { value: 'edge',           label: 'Edge TTS（免费）',     desc: '微软免费音色，稳定可靠',          providerId: 'edge_tts',       wsUrl: '',                                             httpUrl: '',                                      model: 'zh-CN-XiaoxiaoNeural' },
  { value: 'minimax-tts',    label: 'MiniMax TTS（云端）',  desc: '云端高保真合成，丰富音色库',      providerId: 'minimax_tts',    wsUrl: 'wss://api.minimaxi.com/ws/v1/t2a_v2',          httpUrl: 'https://api.minimaxi.com/v1/t2a_v2',   model: 'speech-2.8-turbo' },
  { value: 'kokoro',         label: 'Kokoro（本地）',       desc: '本地多语言合成，音质自然流畅',    providerId: '',               wsUrl: '',                                             httpUrl: '',                                      model: '' },
  { value: 'melo-tts',       label: 'MeloTTS（本地）',      desc: '本地中英双语合成，轻量极速',      providerId: '',               wsUrl: '',                                             httpUrl: '',                                      model: '' },
  { value: 'piper-zh',       label: 'Piper（本地）',        desc: '本地中文合成，资源消耗最低',      providerId: '',               wsUrl: '',                                             httpUrl: '',                                      model: '' },
  { value: 'cosyvoice',      label: 'CosyVoice（本地）',    desc: '本地零成本合成，情感表达丰富',    providerId: '',               wsUrl: '',                                             httpUrl: '',                                      model: '' },
  { value: 'fish-speech',    label: 'Fish Speech（本地）',  desc: '本地开源合成，音色可定制',        providerId: '',               wsUrl: '',                                             httpUrl: '',                                      model: '' },
  { value: 'volcengine-tts', label: '火山 TTS（云端）',     desc: '云端低延迟，大厂品质保证',        providerId: 'volcano_engine', wsUrl: 'wss://openspeech.bytedance.com/api/v3/tts/bidirection', httpUrl: '',                             model: 'seed-tts-2.0' },
  { value: 'azure',          label: 'Azure TTS',            desc: '微软神经网络，多语言自然语音',    providerId: '',               wsUrl: '',                                             httpUrl: '',                                      model: '' },
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

// No hard cap — users can add as many providers as they need

// ── 工具 ───────────────────────────────────────────────────────────────────────

export const availableProviders = LLM_PROVIDERS;

type ProviderType = 'llm' | 'asr' | 'tts';

const TYPE_META: Record<ProviderType, { label: string; icon: React.ElementType; accent: string }> = {
  llm: { label: '大语言模型', icon: Cpu,     accent: 'var(--primary-color)' },
  asr: { label: '语音转文字', icon: Mic,     accent: '#34c759'               },
  tts: { label: '语音播报',   icon: Volume2, accent: '#ff9f0a'               },
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
        <Input type="password" mono value={p.APIKey} onChange={e => set({ APIKey: e.target.value })} className={fCls('APIKey')} placeholder="填写 API Key" />
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

function AsrFields({ p, set, usedEngines, errors }: { p: AiProvider; set: (patch: Partial<AiProvider>) => void; usedEngines: string[]; errors: Record<string, boolean> }) {
  const currentEngine = ASR_PROVIDERS.find(ap => ap.value === p.Model) ?? ASR_PROVIDERS[0];
  const isSenseVoice = currentEngine.value === 'sensevoice';
  const needsWsService = !isSenseVoice;
  const [svModelOk, setSvModelOk] = useState(true);
  const [svDlStage, setSvDlStage] = useState<'idle' | 'downloading' | 'extracting' | 'done' | 'error'>('idle');
  const [svDlPct, setSvDlPct] = useState(0);

  // 检查 SenseVoice 模型状态
  useEffect(() => {
    if (!isSenseVoice) return;
    api.checkModels().then(m => setSvModelOk(m.models['sensevoice'] ?? false)).catch(() => {});
  }, [isSenseVoice]);

  // 监听下载进度
  useEffect(() => {
    if (!isSenseVoice) return;
    let unl: (() => void) | undefined;
    api.onModelDlProgress(data => {
      if (data.model_id !== 'sensevoice') return;
      if (data.stage === 'downloading') { setSvDlStage('downloading'); setSvDlPct(data.pct); }
      else if (data.stage === 'extracting') { setSvDlStage('extracting'); }
      else if (data.stage === 'done') {
        setSvDlStage('done');
        setSvModelOk(true);
        toast.success('SenseVoice 模型下载完成');
      }
    }).then(f => { unl = f; });
    return () => unl?.();
  }, [isSenseVoice]);

  const handleSvDownload = async () => {
    setSvDlStage('downloading'); setSvDlPct(0);
    try { await api.downloadModel('sensevoice'); }
    catch (e) { setSvDlStage('error'); toast.error(`下载失败: ${e}`); }
  };

  const updateEngine = (val: string) => {
    const info = ASR_PROVIDERS.find(ap => ap.value === val);
    if (!info) return;
    // SenseVoice 走应用内置本地链路；其余 ASR 需要外部 WebSocket 服务地址。
    set({ Name: info.label, Model: val, APIUrl: val === 'sensevoice' ? '' : info.wsUrl });
  };
  return (
    <div className="space-y-3.5">
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">识别引擎</label>
        <GSelect value={currentEngine.value} onChange={updateEngine}
          options={ASR_PROVIDERS.filter(ap => !usedEngines.includes(ap.value))} />
        <p className="text-[10px] text-gray-400 mt-1">{currentEngine.desc}</p>
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

      {needsWsService && (
        <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">WebSocket 地址 <span className="text-red-400">*</span></label>
          <Input mono value={p.APIUrl} onChange={e => set({ APIUrl: e.target.value })}
            className={`w-full h-9${errors['APIUrl'] ? ' ring-2 ring-red-400/60 border-red-400' : ''}`}
            placeholder="wss://your-service-url" />
          {errors['APIUrl']
            ? <p className="text-[10px] text-red-400 mt-0.5">必填</p>
            : <p className="text-[10px] text-gray-400 mt-0.5">{currentEngine.value === 'volcengine-asr' ? '云端服务的 WebSocket 接入地址' : '对应 ASR 服务监听的 WebSocket 地址；仅填写不会自动启动服务'}</p>}
        </div>
      )}
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">识别语言</label>
        <GSelect value={p.TriggerCommand || 'zh'} onChange={v => set({ TriggerCommand: v })} options={ASR_LANGUAGES} />
      </div>
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">显示名称</label>
        <Input value={p.Nickname} onChange={e => set({ Nickname: e.target.value })} className="w-full h-9" placeholder="主麦语音转文字" />
      </div>
      <div className="flex items-center justify-between p-3 rounded-lg bg-black/5 dark:bg-white/5 border border-gray-200 dark:border-white/10">
        <div><span className="text-[12px] font-medium block">启用</span><span className="text-[10px] text-gray-500">语音交互页将使用此引擎</span></div>
        <Toggle checked={p.Enabled} onChange={v => set({ Enabled: v })} />
      </div>
    </div>
  );
}

// 本地 sherpa-onnx TTS 型号配置
const SHERPA_LOCAL_TTS = [
  { nameKey: 'Kokoro', modelId: 'kokoro-sherpa', size: '约 320MB', desc: 'Kokoro 多语言模型' },
  { nameKey: 'MeloTTS', modelId: 'melo-tts',    size: '约 80MB',  desc: 'MeloTTS 中英双语模型' },
  { nameKey: 'Piper',  modelId: 'piper-zh',      size: '约 60MB',  desc: 'Piper 中文模型' },
];

function TtsFields({ p, set, usedProviders, errors, modelState }: {
  p: AiProvider; set: (patch: Partial<AiProvider>) => void;
  usedProviders: string[]; errors: Record<string, boolean>;
  modelState: Record<string, boolean>;
}) {
  const isEdge  = p.Name.includes('Edge');
  const isLocal = p.Name.includes('本地') || p.Name.includes('CosyVoice') || p.Name.includes('Fish Speech');
  const isCloud = !isEdge && !isLocal;

  // 本地 sherpa 模型识别
  const sherpaInfo = SHERPA_LOCAL_TTS.find(s => p.Name.includes(s.nameKey));
  const localModelOk = sherpaInfo ? (modelState[sherpaInfo.modelId] ?? false) : true;

  const [dlStage, setDlStage] = useState<'idle' | 'downloading' | 'extracting' | 'done' | 'error'>('idle');
  const [dlPct,   setDlPct]   = useState(0);
  const [dlMb,    setDlMb]    = useState(0);

  useEffect(() => {
    if (!sherpaInfo) return;
    let unl: (() => void) | undefined;
    api.onModelDlProgress(data => {
      if (data.model_id !== sherpaInfo.modelId) return;
      if (data.stage === 'downloading') {
        setDlStage('downloading');
        setDlPct(data.pct);
        if (data.downloaded_mb) setDlMb(parseFloat(data.downloaded_mb));
      }
      else if (data.stage === 'extracting') setDlStage('extracting');
      else if (data.stage === 'done') { setDlStage('done'); toast.success(`${sherpaInfo.desc}下载完成`); }
      else if (data.stage === 'error') setDlStage('error');
    }).then(f => { unl = f; });
    return () => unl?.();
  }, [sherpaInfo?.modelId]);

  const handleDownload = async () => {
    if (!sherpaInfo) return;
    setDlStage('downloading'); setDlPct(0);
    try { await api.downloadModel(sherpaInfo.modelId); }
    catch (e) { setDlStage('error'); toast.error(`下载失败: ${e}`); }
  };

  const updateTtsProvider = (val: string) => {
    const info = TTS_PROVIDERS.find(tp => tp.value === val);
    if (info) set({ Name: info.label, APIUrl: info.wsUrl, TtsHttpUrl: info.httpUrl, Model: info.model });
  };
  const availableTtsProviders = TTS_PROVIDERS.filter(tp =>
    !usedProviders.some(name => name.includes(tp.label.split('（')[0]))
  );

  return (
    <div className="space-y-3.5">
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">语音播报供应商</label>
        <GSelect value={TTS_PROVIDERS.find(tp => p.Name.includes(tp.label.split('（')[0]))?.value ?? 'edge'}
          onChange={updateTtsProvider} options={availableTtsProviders} />
      </div>

      {/* 本地 sherpa-onnx 模型下载提示 */}
      {sherpaInfo && !localModelOk && (
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
            <AlertCircle className="w-3.5 h-3.5" />本地模型文件缺失
          </div>
          <p className="text-[10px] text-gray-500">{sherpaInfo.desc}（{sherpaInfo.size}）需要下载到本地后才能使用</p>
          {dlStage === 'downloading' && (
            <div className="space-y-1">
              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all"
                  style={{ width: dlPct > 0 ? `${dlPct}%` : '100%', opacity: dlPct > 0 ? 1 : 0.4 }} />
              </div>
              <p className="text-[10px] text-gray-400">
                {dlPct > 0 ? `${dlPct}%` : dlMb > 0 ? `已下载 ${dlMb.toFixed(1)} MB` : '连接中...'}
              </p>
            </div>
          )}
          {dlStage === 'extracting' && <p className="text-[10px] text-gray-400">正在解压...</p>}
          <button onClick={handleDownload}
            disabled={dlStage === 'downloading' || dlStage === 'extracting'}
            className="flex items-center gap-1 h-[26px] px-3 rounded-lg text-[10px] font-medium
                       bg-amber-500 text-white hover:bg-amber-600
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            <Download className="w-3 h-3" />
            {dlStage === 'downloading' ? `下载中 ${dlPct}%`
              : dlStage === 'extracting' ? '解压中...' : '下载模型'}
          </button>
        </div>
      )}
      {sherpaInfo && localModelOk && (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
          ✓ 本地模型已就绪
        </div>
      )}

      {isCloud && (
        <div className="space-y-2">
          <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">WSS URL <span className="text-red-400">*</span></label>
          <Input mono value={p.APIUrl} onChange={e => set({ APIUrl: e.target.value })}
            className={`w-full h-9${errors['APIUrl'] ? ' ring-2 ring-red-400/60 border-red-400' : ''}`}
            placeholder="wss://api.example.com/ws/v1/t2a_v2" />
          </div>
          <div>
            <label className="text-[11px] text-gray-500 mb-1.5 block">HTTPS URL（实时弹幕优先）</label>
            <Input mono value={p.TtsHttpUrl ?? ''} onChange={e => set({ TtsHttpUrl: e.target.value })}
              className="w-full h-9"
              placeholder="https://api.example.com/v1/t2a_v2" />
          </div>
          {errors['APIUrl'] && <p className="text-[10px] text-red-400 mt-0.5">WSS URL 必填</p>}
          <p className="text-[10px] text-gray-400">语音陪伴使用 WSS；实时弹幕播报优先使用 HTTPS，未填 HTTPS 时回退 WSS。</p>
        </div>
      )}
      {isCloud && (
        <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">API Key <span className="text-red-400">*</span></label>
          <Input type="password" mono value={p.APIKey} onChange={e => set({ APIKey: e.target.value })}
            className={`w-full h-9${errors['APIKey'] ? ' ring-2 ring-red-400/60 border-red-400' : ''}`}
            placeholder="填写 API Key" />
          {errors['APIKey'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
        </div>
      )}
      {isCloud && (
        <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">模型 / Voice ID <span className="text-red-400">*</span></label>
          <Input
            mono
            value={p.Model}
            onChange={e => set({ Model: e.target.value })}
            className={`w-full h-9${errors['Model'] ? ' ring-2 ring-red-400/60 border-red-400' : ''}`}
            placeholder="例如：speech-2.6-turbo 或 voice_id"
          />
          {errors['Model'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
        </div>
      )}
      {isEdge && (
        <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">API Key</label>
          <Input type="password" mono value={p.APIKey} onChange={e => set({ APIKey: e.target.value })} className="w-full h-9" placeholder="留空则免费" />
        </div>
      )}
      <div>
        <label className="text-[11px] text-gray-500 mb-1.5 block">显示名称 {isCloud && <span className="text-red-400">*</span>}</label>
        <Input
          value={p.Nickname}
          onChange={e => set({ Nickname: e.target.value })}
          className={`w-full h-9${errors['Nickname'] ? ' ring-2 ring-red-400/60 border-red-400' : ''}`}
          placeholder="主播语音播报"
        />
        {errors['Nickname'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
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
  const type = (p.ProviderType || 'llm') as ProviderType;
  if (type === 'llm') {
    const isCustom = !LLM_PROVIDERS.filter(lp => lp.value !== 'custom').some(lp => lp.label === p.Name);
    return {
      Name:   isCustom && !p.Name.trim(),
      Model:  !p.Model.trim(),
      APIUrl: !p.APIUrl.trim(),
      APIKey: !p.APIKey.trim(),
    };
  }
  if (type === 'asr') {
    const needsWsService = (ASR_PROVIDERS.find(ap => ap.label === p.Name || ap.value === p.Model)?.value ?? 'sensevoice') !== 'sensevoice';
    return { APIUrl: needsWsService && !p.APIUrl.trim() };
  }
  if (type === 'tts') {
    const isLocal = p.Name.includes('本地') || p.Name.includes('CosyVoice') || p.Name.includes('Fish Speech');
    const isEdge  = p.Name.includes('Edge');
    const isCloud = !isLocal && !isEdge;
    return {
      APIUrl: isCloud && !p.APIUrl.trim(),
      APIKey: isCloud && !p.APIKey.trim(),
      Model: isCloud && !p.Model.trim(),
      Nickname: isCloud && !p.Nickname.trim(),
    };
  }
  return {};
}

function getProviderType(p: AiProvider): ProviderType {
  return (p.ProviderType || 'llm') as ProviderType;
}

function getProviderTitle(p: AiProvider): string {
  const type = getProviderType(p);
  return type === 'llm' ? p.Name : (p.Nickname || p.Name);
}

function getProviderDetail(p: AiProvider): string {
  const type = getProviderType(p);
  if (type === 'llm') return p.Model || '未设置模型';
  if (type === 'asr') {
    const lang = ASR_LANGUAGES.find(item => item.value === (p.TriggerCommand || 'zh'))?.label ?? '中文';
    const mode = p.Model === 'sensevoice'
      ? '内置本地识别'
      : p.Model === 'volcengine-asr'
      ? '云端识别'
      : '外部服务接入';
    return `${mode} · ${lang}`;
  }
  return ''; // TTS detail 由 desc 展示
}

function getProviderDesc(p: AiProvider): string {
  const type = getProviderType(p);
  if (type === 'llm') {
    const tpl = LLM_PROVIDERS.find(lp => lp.label === p.Name);
    return tpl?.desc ?? '';
  }
  if (type === 'asr') {
    const tpl = ASR_PROVIDERS.find(ap => ap.label === p.Name || ap.value === p.Model);
    return tpl?.desc ?? '';
  }
  const tpl = TTS_PROVIDERS.find(tp => p.Name.includes(tp.label.split('（')[0]));
  return tpl?.desc ?? '';
}

function getProviderUsage(p: AiProvider, config: AppConfig): string {
  const type = getProviderType(p);
  if (type === 'llm') {
    const refs = (config.AiBots ?? []).filter(bot => bot.ProviderId === p.Id);
    return refs.length ? `被 ${refs.length} 个机器人引用` : '未被机器人引用';
  }
  if (type === 'asr') {
    return p.Enabled ? '语音陪伴页可用' : '当前未参与语音识别';
  }
  return p.Enabled ? '语音陪伴页可用' : '当前未参与语音播报';
}

function getProviderStatus(p: AiProvider, modelState: Record<string, boolean>): { label: string; tone: string } {
  const type = getProviderType(p);
  if (!p.Enabled) return { label: '已停用', tone: 'text-gray-400 bg-gray-500/10 border-gray-300/30' };
  if (type === 'asr' && p.Model === 'sensevoice' && !modelState.sensevoice) {
    return { label: '模型缺失', tone: 'text-amber-500 bg-amber-500/10 border-amber-500/20' };
  }
  if (type === 'tts') {
    const sherpa = SHERPA_LOCAL_TTS.find(s => p.Name.includes(s.nameKey));
    if (sherpa && !modelState[sherpa.modelId]) {
      return { label: '模型缺失', tone: 'text-amber-500 bg-amber-500/10 border-amber-500/20' };
    }
  }
  if (type === 'llm' && !p.APIKey.trim()) {
    return { label: '未完成配置', tone: 'text-amber-500 bg-amber-500/10 border-amber-500/20' };
  }
  return { label: '已就绪', tone: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' };
}

function getDefaultProviderId(config: AppConfig, type: ProviderType): string {
  if (type === 'llm') return config.ActiveProviderId;
  if (type === 'asr') return config.ActiveAsrProviderId;
  return config.ActiveTtsProviderId;
}

function withDefaultProviderId(config: AppConfig, type: ProviderType, id: string): AppConfig {
  if (type === 'llm') return { ...config, ActiveProviderId: id };
  if (type === 'asr') return { ...config, ActiveAsrProviderId: id };
  return { ...config, ActiveTtsProviderId: id };
}

function resolveActiveProviders(config: AppConfig): AppConfig {
  const providers = config.AiProviders ?? [];
  const pick = (type: ProviderType, currentId: string) => {
    const typed = providers.filter(p => getProviderType(p) === type);
    if (typed.length === 0) return '';
    const current = typed.find(p => p.Id === currentId);
    if (current?.Enabled) return current.Id;
    return typed.find(p => p.Enabled)?.Id ?? typed[0].Id;
  };
  return {
    ...config,
    ActiveProviderId: pick('llm', config.ActiveProviderId),
    ActiveAsrProviderId: pick('asr', config.ActiveAsrProviderId),
    ActiveTtsProviderId: pick('tts', config.ActiveTtsProviderId),
  };
}

function getProviderInfra(p: AiProvider): string {
  const type = getProviderType(p);
  if (type === 'llm') return '云端 API';
  if (type === 'asr') return p.Model === 'volcengine-asr' ? '云端识别' : '本地识别';
  if (p.Name.includes('Edge')) return '免费在线';
  return p.Name.includes('本地') ? '本地播报' : '云端播报';
}

function getProviderWarnings(p: AiProvider, config: AppConfig, modelState: Record<string, boolean>): string[] {
  const type = getProviderType(p);
  const warnings: string[] = [];
  if (type === 'llm' && !p.APIKey.trim()) warnings.push('缺少 API Key');
  if (type === 'asr' && p.Model === 'sensevoice' && !modelState.sensevoice) warnings.push('SenseVoice 模型未下载');
  if (type === 'asr' && p.Model !== 'sensevoice' && !p.APIUrl.trim()) warnings.push('未配置 WebSocket 地址');
  if (type === 'tts' && !p.Name.includes('Edge') && !p.Name.includes('本地') && !p.APIUrl.trim()) warnings.push('未配置 WSS 地址');
  if (type === 'tts' && !p.Name.includes('Edge') && !p.Name.includes('本地') && !p.APIKey.trim()) warnings.push('缺少 API Key');
  if (type === 'tts') {
    const sherpa = SHERPA_LOCAL_TTS.find(s => p.Name.includes(s.nameKey));
    if (sherpa && !modelState[sherpa.modelId]) warnings.push(`${sherpa.desc}未下载`);
  }
  if (type === 'llm' && (config.AiBots ?? []).every(bot => bot.ProviderId !== p.Id)) warnings.push('当前没有机器人使用');
  return warnings;
}










// ── ProviderRow ──────────────────────────────────────────────────────────────

function ProviderRow({
  provider, isDefault, status, usage, detail, desc, onEdit, onToggle, onRemove, onSetDefault,
}: {
  provider: AiProvider;
  isDefault: boolean;
  status: { label: string; tone: string };
  usage: string;
  detail: string;
  desc: string;
  onEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onSetDefault: () => void;
}) {
  const type = getProviderType(provider);
  const { icon: Icon, accent } = TYPE_META[type];
  const ProviderIcon = type === 'llm' ? llmIcon(provider.Name) : Icon;
  const title = getProviderTitle(provider);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/40 dark:hover:bg-white/5 transition-colors group">
      {/* 默认星标 —— TTS 不设默认 */}
      {type !== 'tts' && (
        <button onClick={onSetDefault} title={isDefault ? '当前默认' : '设为默认'}
          className={`shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors ${
            isDefault ? 'text-[var(--primary-color)]' : 'text-gray-300 dark:text-gray-600 hover:text-[var(--primary-color)]'
          }`}>
          <Star className={`w-3.5 h-3.5 ${isDefault ? 'fill-current' : ''}`} />
        </button>
      )}

      {/* 类型图标 */}
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: provider.Enabled ? `${accent}18` : 'rgba(0,0,0,0.04)', border: `1px solid ${accent}20` }}>
        <ProviderIcon className="w-3.5 h-3.5" style={{ color: provider.Enabled ? accent : '#999' }} />
      </div>

      {/* 名称 + 标识 + 特点 */}
      <div className="min-w-0 w-[160px] shrink-0">
        <div className="text-[12px] font-semibold truncate">{title}</div>
        <div className="text-[10px] text-gray-400 font-mono truncate">{detail}</div>
        {desc && <div className="text-[10px] text-gray-400 truncate">{desc}</div>}
      </div>

      {/* 状态 */}
      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium border ${status.tone}`}>
        {status.label}
      </span>

      {/* 使用情况 */}
      <span className="flex-1 text-[10px] text-gray-400 truncate min-w-0">{usage}</span>

      {/* 操作按钮 - hover 显示 */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit}
          className="text-[11px] font-medium text-gray-400 hover:text-[var(--primary-color)] px-2 py-1 rounded-lg hover:bg-[var(--primary-color)]/5 transition-colors">
          编辑
        </button>
        <button onClick={onToggle}
          className={`text-[11px] font-medium px-2 py-1 rounded-lg transition-colors ${
            provider.Enabled
              ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-500/5'
              : 'text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/5'
          }`}>
          {provider.Enabled ? '停用' : '启用'}
        </button>
        <button onClick={onRemove}
          className="text-[11px] font-medium text-red-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-500/5 transition-colors">
          删除
        </button>
      </div>
    </div>
  );
}

// ── CollapsibleSection ───────────────────────────────────────────────────────

function CollapsibleSection({
  type, providers, defaultProvider, config, modelState, defaultOpen, onEdit, onToggle, onRemove, onSetDefault, onAdd,
}: {
  type: ProviderType;
  providers: AiProvider[];
  defaultProvider: AiProvider | undefined;
  config: AppConfig;
  modelState: Record<string, boolean>;
  defaultOpen: boolean;
  onEdit: (p: AiProvider) => void;
  onToggle: (p: AiProvider) => void;
  onRemove: (id: string) => void;
  onSetDefault: (p: AiProvider) => void;
  onAdd: (type: ProviderType) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { label, icon: Icon, accent } = TYPE_META[type];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <GlassCard className="border-white/60 dark:border-white/10 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <CollapsibleTrigger className="flex items-center gap-3 flex-1 min-w-0 text-left">
            <ChevronRight className={cn(
              'w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200',
              open && 'rotate-90'
            )} />
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${accent}18`, border: `1px solid ${accent}30` }}>
              <Icon className="w-4 h-4" style={{ color: accent }} />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{label}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                {providers.length} 个服务{defaultProvider && type !== 'tts' ? ` · 当前默认：${getProviderTitle(defaultProvider)}` : ''}
              </div>
            </div>
          </CollapsibleTrigger>
          <button type="button" onClick={(e) => { e.stopPropagation(); onAdd(type); }}
            className="w-7 h-7 rounded-xl bg-white/40 dark:bg-white/8 hover:bg-white/60 dark:hover:bg-white/12 border border-white/40 dark:border-white/10 flex items-center justify-center shrink-0 transition-colors"
            title={`添加${label}`}>
            <Plus className="w-3.5 h-3.5 text-gray-500" />
          </button>
        </div>
        <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2">
          {providers.length === 0 ? (
            <div className="mx-4 mb-3 rounded-2xl border border-dashed border-white/40 dark:border-white/10 px-3 py-4 text-[10px] text-gray-400 text-center">
              当前没有{label}
            </div>
          ) : (
            <div className="px-2 pb-2 space-y-0.5">
              {providers.map(provider => (
                <ProviderRow
                  key={provider.Id}
                  provider={provider}
                  isDefault={getDefaultProviderId(config, type) === provider.Id}
                  status={getProviderStatus(provider, modelState)}
                  usage={getProviderUsage(provider, config)}
                  detail={getProviderDetail(provider)}
                  desc={getProviderDesc(provider)}
                  onEdit={() => onEdit(provider)}
                  onToggle={() => onToggle(provider)}
                  onRemove={() => onRemove(provider.Id)}
                  onSetDefault={() => onSetDefault(provider)}
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </GlassCard>
    </Collapsible>
  );
}

// ── Pipeline View ────────────────────────────────────────────────────────────

function PipelineNode({
  type, defaultProvider, status, onClick, onAdd,
}: {
  type: ProviderType;
  defaultProvider: AiProvider | undefined;
  status: { label: string; tone: string } | null;
  onClick: () => void;
  onAdd: () => void;
}) {
  const { label, icon: Icon, accent } = TYPE_META[type];
  const title = defaultProvider ? getProviderTitle(defaultProvider) : '未配置';
  const detail = defaultProvider ? getProviderDetail(defaultProvider) : '点击添加服务';
  const st = status ?? { label: '未配置', tone: 'text-gray-400 bg-gray-500/10 border-gray-300/30' };

  return (
    <div className="flex flex-col items-center gap-2 shrink-0">
      {/* 节点圆 */}
      <button type="button" onClick={onClick}
        className="group relative w-[88px] h-[88px] rounded-full flex flex-col items-center justify-center gap-0.5 transition-all hover:scale-105 active:scale-95"
        style={{ background: `${accent}12`, border: `2px solid ${accent}30` }}>
        <Icon className="w-5 h-5" style={{ color: accent }} />
        <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">{label}</span>
        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${st.tone}`}>
          {st.label}
        </span>
      </button>

      {/* 节点下方信息 */}
      <div className="text-center min-w-0 w-full">
        <div className="text-[11px] font-semibold truncate">{title}</div>
        <div className="text-[10px] text-gray-400 truncate">{detail}</div>
      </div>

      {/* 添加按钮 */}
      <button type="button" onClick={onAdd}
        className="flex items-center gap-1 h-[26px] px-3 rounded-xl text-[10px] font-medium border border-dashed border-gray-300 dark:border-white/20 text-gray-400 hover:text-[var(--primary-color)] hover:border-[var(--primary-color)]/50 hover:bg-[var(--primary-color)]/5 transition-all">
        <Plus className="w-3 h-3" />
        添加{label}
      </button>
    </div>
  );
}

function PipelineArrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0 pt-2">
      <span className="text-[10px] text-gray-400 font-medium">{label}</span>
      <div className="flex items-center gap-0">
        <div className="w-10 h-px bg-gradient-to-r from-gray-300 to-gray-400 dark:from-white/20 dark:to-white/30" />
        <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
          <path d="M0,0 L10,5 L0,10 Z" fill="currentColor" className="text-gray-400 dark:text-white/30" />
        </svg>
      </div>
    </div>
  );
}

function PipelineView({
  llmProvider, asrProvider, ttsProvider, modelState, onSectionClick, onAdd,
}: {
  llmProvider: AiProvider | undefined;
  asrProvider: AiProvider | undefined;
  ttsProvider: AiProvider | undefined;
  modelState: Record<string, boolean>;
  onSectionClick: (type: ProviderType) => void;
  onAdd: (type: ProviderType) => void;
}) {
  return (
    <div className="flex items-start justify-center gap-2 py-4 flex-wrap">
      <PipelineNode
        type="asr"
        defaultProvider={asrProvider}
        status={asrProvider ? getProviderStatus(asrProvider, modelState) : null}
        onClick={() => onSectionClick('asr')}
        onAdd={() => onAdd('asr')}
      />
      <PipelineArrow label="听" />
      <PipelineNode
        type="llm"
        defaultProvider={llmProvider}
        status={llmProvider ? getProviderStatus(llmProvider, modelState) : null}
        onClick={() => onSectionClick('llm')}
        onAdd={() => onAdd('llm')}
      />
      <PipelineArrow label="想" />
      <PipelineNode
        type="tts"
        defaultProvider={ttsProvider}
        status={ttsProvider ? getProviderStatus(ttsProvider, modelState) : null}
        onClick={() => onSectionClick('tts')}
        onAdd={() => onAdd('tts')}
      />
    </div>
  );
}

// ── blank 生成 ─────────────────────────────────────────────────────────────────

function blankProvider(type: ProviderType, nth: number): AiProvider {
  if (type === 'asr') {
    const def = ASR_PROVIDERS[0];
    return { Id: `asr-${Date.now()}`, ProviderType: 'asr', Name: def.label, Model: def.value, APIUrl: def.wsUrl, TtsHttpUrl: '', APIKey: '', SystemPrompt: '', TriggerCommand: 'zh', FuzzyMatch: false, Nickname: `ASR${nth}`, Enabled: true };
  }
  if (type === 'tts') {
    return { Id: `tts-${Date.now()}`, ProviderType: 'tts', Name: 'Edge TTS（免费）', Model: 'zh-CN-XiaoxiaoNeural', APIUrl: '', TtsHttpUrl: '', APIKey: '', SystemPrompt: '', TriggerCommand: '1.0', FuzzyMatch: false, Nickname: `TTS${nth}`, Enabled: true };
  }
  const def = LLM_PROVIDERS[0];
  return { Id: `llm-${Date.now()}`, ProviderType: 'llm', Name: def.label, Model: def.model, APIUrl: def.apiUrl, TtsHttpUrl: '', APIKey: '', SystemPrompt: '', TriggerCommand: '', FuzzyMatch: false, Nickname: '', Enabled: true };
}

// ── 主组件 ─────────────────────────────────────────────────────────────────────

export function Models() {
  const [config,     setConfig]     = useState<AppConfig | null>(null);
  const [pending,    setPending]    = useState<AiProvider | null>(null);
  const [errors,     setErrors]     = useState<Record<string, boolean>>({});
  const [modelState, setModelState] = useState<Record<string, boolean>>({});
  const [sheetOpen,  setSheetOpen]  = useState(false);
  const [sheetType,  setSheetType]  = useState<ProviderType>('llm');
  const [expandedSections, setExpandedSections] = useState<Record<ProviderType, boolean>>({
    llm: true, asr: false, tts: false,
  });

  useEffect(() => {
    api.loadConfig().then(c => {
      const providers = c.AiProviders ?? [];
      const hasTts = providers.some(p => p.ProviderType === 'tts');
      if (providers.length === 0) {
        const tts = blankProvider('tts', 1);
        const asr: AiProvider = {
          Id: `asr-${Date.now() + 1}`,
          ProviderType: 'asr',
          Name: ASR_PROVIDERS[1].label,
          Model: ASR_PROVIDERS[1].value,
          APIUrl: '',
          APIKey: '',
          SystemPrompt: '',
          TriggerCommand: 'zh',
          FuzzyMatch: false,
          Nickname: 'ASR1',
          Enabled: true,
        };
        const next = resolveActiveProviders({ ...c, AiProviders: [tts, asr] });
        api.saveConfig(next).then(() => setConfig(next)).catch(console.error);
      } else if (!hasTts) {
        const tts = blankProvider('tts', 1);
        const next = resolveActiveProviders({ ...c, AiProviders: [tts, ...providers] });
        api.saveConfig(next).then(() => setConfig(next)).catch(console.error);
      } else {
        setConfig(resolveActiveProviders(c));
      }
    }).catch(console.error);
  }, []);

  useEffect(() => {
    api.checkModels()
      .then(result => setModelState(result.models ?? {}))
      .catch(() => {});
  }, []);

  // 配置加载后设置分区默认展开状态
  useEffect(() => {
    if (!config) return;
    const all = config.AiProviders ?? [];
    setExpandedSections({
      llm: all.some(p => getProviderType(p) === 'llm'),
      asr: all.some(p => getProviderType(p) === 'asr'),
      tts: all.some(p => getProviderType(p) === 'tts'),
    });
  }, [config?.AiProviders?.length]);

  const handleSectionClick = (type: ProviderType) => {
    setExpandedSections(prev => ({ ...prev, [type]: true }));
    document.getElementById(`section-${type}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleAdd = (type: ProviderType) => {
    if (!config) return;
    const count = (config.AiProviders ?? []).filter(p => (p.ProviderType || 'llm') === type).length;
    setSheetType(type);
    setPending(blankProvider(type, count + 1));
    setErrors({});
    setSheetOpen(true);
  };

  const handleEdit = (p: AiProvider) => {
    setPending({ ...p });
    setErrors({});
    setSheetType(getProviderType(p));
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!config || !pending) return;
    const errs = validateProvider(pending);
    if (Object.values(errs).some(Boolean)) { setErrors(errs); toast.error('请填写必填字段'); return; }

    // 本地 TTS 模型必须先下载才能保存
    if (pending.ProviderType === 'tts') {
      const sherpa = SHERPA_LOCAL_TTS.find(s => pending.Name.includes(s.nameKey));
      if (sherpa && !modelState[sherpa.modelId]) {
        toast.error(`请先下载 ${sherpa.desc}`, { description: '点击编辑框中的「下载模型」按钮完成下载后再保存' });
        return;
      }
    }

    let next: AppConfig;
    if (config.AiProviders.some(p => p.Id === pending.Id)) {
      next = { ...config, AiProviders: config.AiProviders.map(p => p.Id === pending.Id ? pending : p) };
    } else {
      const providers = [...config.AiProviders, pending];
      next = { ...config, AiProviders: providers };
    }
    next = resolveActiveProviders(next);
    try {
      await api.saveConfig(next);
      setConfig(next);
      toast.success('保存成功');
      setSheetOpen(false);
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
        toast.error(`请先添加另一个${TYPE_META[type].label}服务，再删除此项`);
        return;
      }
    }
    const providers = config.AiProviders.filter(p => p.Id !== id);
    const next = resolveActiveProviders({ ...config, AiProviders: providers });
    setConfig(next);
    await api.saveConfig(next).catch(() => toast.error('删除失败'));
  };

  const handleToggle = async (p: AiProvider) => {
    if (!config) return;
    const llmEnabled = config.AiProviders.filter(pp => pp.Enabled && (pp.ProviderType || 'llm') === 'llm').length;
    if (p.Enabled && (p.ProviderType || 'llm') === 'llm' && llmEnabled === 1) { toast.error('至少需要保留一个启用的大语言模型'); return; }
    const providers = config.AiProviders.map(item => item.Id === p.Id ? { ...item, Enabled: !item.Enabled } : item);
    const next = resolveActiveProviders({ ...config, AiProviders: providers });
    setConfig(next);
    await api.saveConfig(next).catch(() => toast.error('操作失败'));
  };

  const handleSetDefault = async (provider: AiProvider) => {
    if (!config) return;
    const type = getProviderType(provider);
    if (type === 'tts') return; // TTS 不设默认
    const providers = config.AiProviders.map(item => item.Id === provider.Id ? { ...item, Enabled: true } : item);
    const next = resolveActiveProviders(withDefaultProviderId({ ...config, AiProviders: providers }, type, provider.Id));
    setConfig(next);
    await api.saveConfig(next)
      .then(() => toast.success('默认服务已更新'))
      .catch(() => toast.error('更新默认服务失败'));
  };

  const setPendingField = (patch: Partial<AiProvider>) => {
    if (!pending) return;
    const next = { ...pending, ...patch };
    setPending(next);
    if (Object.keys(errors).length) setErrors(validateProvider(next));
  };

  const allProviders = config?.AiProviders ?? [];
  const llmProviders = allProviders.filter(p => getProviderType(p) === 'llm');
  const asrProviders = allProviders.filter(p => getProviderType(p) === 'asr');
  const ttsProviders = allProviders.filter(p => getProviderType(p) === 'tts');
  const enabledLlm = llmProviders.filter(p => p.Enabled);
  const enabledAsr = asrProviders.filter(p => p.Enabled);
  const enabledTts = ttsProviders.filter(p => p.Enabled);
  const currentLlm = config ? (llmProviders.find(p => p.Id === config.ActiveProviderId) ?? enabledLlm[0] ?? llmProviders[0]) : undefined;
  const currentAsr = config ? (asrProviders.find(p => p.Id === config.ActiveAsrProviderId) ?? enabledAsr[0] ?? asrProviders[0]) : undefined;
  const currentTts = config ? (ttsProviders.find(p => p.Id === config.ActiveTtsProviderId) ?? enabledTts[0] ?? ttsProviders[0]) : undefined;

  if (!config) return <div className="p-8 text-center text-gray-500">加载中...</div>;

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto">
      {/* 页头 */}
      <div className="shrink-0">
        <h1 className="text-[15px] font-semibold flex items-center gap-2">
          <Cpu className="w-4 h-4 text-[var(--primary-color)]" />
          模型管理
        </h1>
        <p className="text-[11px] text-gray-400 mt-0.5">
          已配置 {allProviders.length} 个服务模板，当前启用 {enabledLlm.length + enabledAsr.length + enabledTts.length} 个 · 本地模型按需下载
        </p>
      </div>

      {/* 管道视图 */}
      {allProviders.length > 0 ? (
        <PipelineView
          llmProvider={currentLlm}
          asrProvider={currentAsr}
          ttsProvider={currentTts}
          modelState={modelState}
          onSectionClick={handleSectionClick}
          onAdd={handleAdd}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <Cpu className="w-12 h-12 text-gray-300 dark:text-gray-600" />
          <div className="text-gray-400 text-[12px]">还没有配置任何服务</div>
          <p className="text-[10px] text-gray-400">点击下方按钮添加第一个 AI 服务</p>
          <div className="flex items-center gap-2 mt-2">
            {(['llm', 'asr', 'tts'] as ProviderType[]).map(t => {
              const { label, icon: Icon, accent } = TYPE_META[t];
              return (
                <button key={t} type="button" onClick={() => handleAdd(t)}
                  className="flex items-center gap-1.5 h-[30px] px-4 rounded-xl text-[12px] font-medium border border-dashed border-gray-300 dark:border-white/20 text-gray-500 hover:text-[var(--primary-color)] hover:border-[var(--primary-color)]/50 hover:bg-[var(--primary-color)]/5 transition-all">
                  <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 可折叠卡片列表 */}
      <div className="space-y-3 flex-1">
        {(['llm', 'asr', 'tts'] as ProviderType[]).map(type => {
          const providers = type === 'llm' ? llmProviders : type === 'asr' ? asrProviders : ttsProviders;
          const defaultP = type === 'llm' ? currentLlm : type === 'asr' ? currentAsr : currentTts;
          return (
            <div key={type} id={`section-${type}`} className="scroll-mt-4">
              <CollapsibleSection
                type={type}
                providers={providers}
                defaultProvider={defaultP}
                config={config}
                modelState={modelState}
                defaultOpen={expandedSections[type]}
                onEdit={handleEdit}
                onToggle={handleToggle}
                onRemove={handleRemove}
                onSetDefault={handleSetDefault}
                onAdd={handleAdd}
              />
            </div>
          );
        })}
      </div>

      {/* 编辑弹窗 */}
      {pending && (() => {
        const usedAsrEngines = allProviders
          .filter(p => p.ProviderType === 'asr' && p.Id !== pending.Id)
          .map(p => p.Model);
        const usedTtsNames = allProviders
          .filter(p => p.ProviderType === 'tts' && p.Id !== pending.Id)
          .map(p => p.Name);
        return (
        <Modal open={true} onClose={() => { setSheetOpen(false); setPending(null); setErrors({}); }} className="max-h-[88vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold flex items-center gap-2">
                {(() => {
                  const { icon: Icon, label } = TYPE_META[sheetType];
                  return <><Icon className="w-4 h-4" />{config.AiProviders.some(p => p.Id === pending.Id) ? '编辑' : '添加'} {label}</>;
                })()}
              </h2>
              {getProviderDesc(pending) && (
                <p className="text-[11px] text-gray-400 mt-1 truncate">{getProviderDesc(pending)}</p>
              )}
            </div>
            <ModalCloseButton onClose={() => { setSheetOpen(false); setPending(null); setErrors({}); }} className="w-8 h-8 shrink-0 ml-3" />
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {pending.ProviderType === 'asr' ? <AsrFields p={pending} set={setPendingField} usedEngines={usedAsrEngines} errors={errors} />
              : pending.ProviderType === 'tts' ? <TtsFields p={pending} set={setPendingField} usedProviders={usedTtsNames} errors={errors} modelState={modelState} />
              : <LlmFields p={pending} set={setPendingField} errors={errors} />}
          </div>
          <div className="p-5 border-t border-white/10 flex gap-2 shrink-0">
            <Button variant="default" className="flex-1 h-10" onClick={() => { setSheetOpen(false); setPending(null); setErrors({}); }}>取消</Button>
            {(() => {
              const sherpa = pending.ProviderType === 'tts'
                ? SHERPA_LOCAL_TTS.find(s => pending.Name.includes(s.nameKey))
                : null;
              const needsDownload = sherpa && !modelState[sherpa.modelId];
              return (
                <Button variant="primary" className="flex-1 h-10" onClick={handleSave}
                  disabled={!!needsDownload}
                  title={needsDownload ? `请先下载 ${sherpa!.desc}` : undefined}>
                  {needsDownload ? '请先下载模型' : '保存'}
                </Button>
              );
            })()}
          </div>
        </Modal>
        );
      })()}
    </div>
  );
}
