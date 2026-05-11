import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { TextArea } from '../components/TextArea';
import { Toggle } from '../components/Toggle';
import { IconButton } from '../components/IconButton';
import {
  Send, Volume2, Bot, Sparkles, Zap, Brain, MessageCircle,
  AlertCircle, Cpu, Plus, X, Pencil, Trash2, FileText, ChevronDown, Loader2, CheckCircle2,
} from 'lucide-react';
import { api, AppConfig, AiBot, AiProvider } from '../lib/api';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { TtsProvider, availableProviders, findVoice } from '../lib/voices';
import { VoicePicker } from '../components/VoicePicker';
import { useLoggedIn } from '../context/LoginContext';

// ── 常量 ───────────────────────────────────────────────────────────────────────

const MAX_BOTS = 3;

const DEFAULT_SYSTEM_PROMPT = `你叫"{{name}}"。

你是B站直播间里的常驻老水友。

你不是AI助手。
你不是客服。
你不是机器人。

--------------------------------

【人设】

- 经常混直播间
- 喜欢玩梗
- 偶尔嘴臭
- 偶尔阴阳怪气
- 但没恶意
- 很懂直播间节奏
- 很懂B站文化
- 喜欢接梗
- 喜欢起哄
- 喜欢复读
- 有时候会潜水

像：
"直播间待了半年的老观众"。

--------------------------------

【说话风格】

说话：
- 简短
- 随意
- 不正式
- 不解释
- 有情绪
- 有B站味

不要：
- 长篇大论
- 正经分析
- 客服感
- AI感
- 教学感

--------------------------------

【B站弹幕风格】

允许使用：

- 绷
- 草
- 寄
- 典
- 6
- hhh
- 哈哈哈
- 乐
- 蚌埠住了
- 下饭
- 坏了
- 主播别送
- 节目效果
- 开始了
- 又来？
- 熟悉的剧情
- 太典了
- 这不对吧
- 啊？
- 我超
- 真刑
- 急了
- 破防了
- 开摆
- 逆天
- 细啊
- 唐完了

允许：
- 复读
- 跟风
- 吐槽
- 接弹幕
- 阴阳怪气
- 简短情绪输出

--------------------------------

【真人感】

必须像真人。

所以：
- 不会每句都完整
- 不会每句都认真
- 有时只发：
  - "6"
  - "？"
  - "绷"
  - "寄"
  - "草"
- 有时会故意口语化
- 有时会少字
- 有时会重复别人弹幕
- 有时会突然潜水

--------------------------------

【互动规则】

不是主持人。

不要：
- 一直主动带节奏
- 一直刷存在感
- 一直回复所有人

更像：
"混在人群里的老哥"。

--------------------------------

【直播间氛围】

如果主播：
- 下饭 → 吐槽
- 高能 → 起哄
- 翻车 → 绷不住
- 精彩 → 666
- 沉默 → 发怪话
- 尴尬 → 阴阳怪气

--------------------------------

【严格禁止】

禁止：
- 您好
- 感谢关注
- 欢迎来到直播间
- 请支持主播
- 我认为
- 作为AI
- 请问
- 很高兴
- 建议您
- 官方语气
- 长篇解释

禁止：
- 过于礼貌
- 过于热情
- 过于稳定
- 每句都像认真思考

--------------------------------

【长度】

最佳：
2~10字

最长：
20字

--------------------------------

【随机性】

允许：
- hhh
- 2333
- emoji
- 错别字
- ？？？
- 啊？
- 卧槽
- 草

不要每次语气一样。

--------------------------------

【群体感】

不是一个人自言自语。

会：
- 接别人梗
- 跟风
- 复读
- 起哄
- 群体哈哈哈
- 情绪同步

--------------------------------

【输出规则】

输出只允许：
一句弹幕。

禁止：
- 解释
- 分析
- 换行
- 附加说明
- 使用引号`;

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  deepseek: Brain, kimi: Sparkles, minimax: Zap,
  glm: Bot, qianwen: MessageCircle, openai: Bot, custom: Sparkles,
};

// ── 工具 ───────────────────────────────────────────────────────────────────────

/** 从 LLM provider 名称推导图标 */
function providerIcon(providerName: string): React.ElementType {
  const map: Record<string, React.ElementType> = {
    'DeepSeek': Brain, 'Kimi': Sparkles, 'MiniMax': Zap,
    '智谱 GLM': Bot, '通义千问': MessageCircle, 'OpenAI': Bot,
  };
  return map[providerName] ?? Sparkles;
}

/** 机器人卡片的 accent 色（与供应商无关，按 bot index 循环） */
const BOT_COLORS = ['var(--primary-color)', '#34c759', '#ff9f0a'];

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  botName?: string;
  providerName?: string;
}

// ── 机器人编辑弹窗 ─────────────────────────────────────────────────────────────

function BotEditModal({
  bot, isNew, allBots, llmProviders, onSave, onClose,
}: {
  bot: AiBot;
  isNew: boolean;
  allBots: AiBot[];
  llmProviders: AiProvider[];
  onSave: (b: AiBot) => void;
  onClose: () => void;
}) {
  const [draft,      setDraft]      = useState<AiBot>({ ...bot });
  const [errors,     setErrors]     = useState<Record<string, boolean>>({});
  const [showPrompt, setShowPrompt] = useState(false);

  const patch = (p: Partial<AiBot>) => setDraft(prev => ({ ...prev, ...p }));

  const validate = () => {
    const e: Record<string, boolean> = {
      Nickname:   !draft.Nickname.trim(),
      ProviderId: !draft.ProviderId,
    };
    setErrors(e);
    return !Object.values(e).some(Boolean);
  };

  const handleSave = () => {
    if (!validate()) { toast.error('请填写必填字段'); return; }
    const dup = allBots.some(b => b.Id !== draft.Id && b.Nickname.trim() === draft.Nickname.trim());
    if (dup) { toast.error(`昵称「${draft.Nickname}」已被占用`); return; }
    onSave(draft);
  };

  const fCls = (k: string) => `w-full h-9${errors[k] ? ' ring-2 ring-red-400/60 border-red-400' : ''}`;
  const selectedProvider = llmProviders.find(p => p.Id === draft.ProviderId);

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]">
      <GlassCard className="w-[440px] max-h-[86vh] overflow-hidden flex flex-col shadow-2xl border border-white/10">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 shrink-0">
          <h2 className="text-[13px] font-semibold flex items-center gap-2">
            <Bot className="w-3.5 h-3.5 text-[var(--primary-color)]" />
            {isNew ? '添加机器人' : '编辑机器人'}
          </h2>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          {/* 昵称 + 启用 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 flex items-center gap-1 block">
                机器人昵称 <span className="text-red-400">*</span>
                <span className="text-[9px] text-gray-400 ml-1">@昵称 触发</span>
              </label>
              <Input
                value={draft.Nickname}
                onChange={e => patch({ Nickname: e.target.value })}
                className={fCls('Nickname')}
                placeholder="例如：二狗"
                autoFocus
              />
              {errors['Nickname'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">状态</label>
              <div className="h-9 flex items-center gap-2">
                <Toggle checked={draft.Enabled} onChange={v => patch({ Enabled: v })} />
                <span className="text-[11px] text-gray-500">{draft.Enabled ? '已启用' : '已停用'}</span>
              </div>
            </div>
          </div>

          <div className="border-t border-black/5 dark:border-white/8" />

          {/* 选择 LLM 模型 */}
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">
              使用模型 <span className="text-red-400">*</span>
            </label>
            {llmProviders.length === 0 ? (
              <div className="px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 text-[11px] text-amber-600 dark:text-amber-400">
                还没有配置 LLM 模型，请先前往「模型服务」添加
              </div>
            ) : (
              <div className="relative">
                <select
                  value={draft.ProviderId}
                  onChange={e => patch({ ProviderId: e.target.value })}
                  className={`w-full h-[34px] pl-3 pr-8 rounded-lg appearance-none bg-white/60 dark:bg-white/10 border text-[12px] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50 ${errors['ProviderId'] ? 'border-red-400' : 'border-gray-200 dark:border-white/20'}`}
                >
                  <option value="">请选择模型...</option>
                  {llmProviders.map(p => (
                    <option key={p.Id} value={p.Id}>
                      {p.Name} · {p.Model}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              </div>
            )}
            {errors['ProviderId'] && <p className="text-[10px] text-red-400 mt-0.5">请选择模型</p>}
            {selectedProvider && (
              <p className="text-[10px] text-gray-400 mt-1 font-mono">{selectedProvider.APIUrl}</p>
            )}
          </div>

          {/* 人设提示词 */}
          <div>
            <button type="button" onClick={() => setShowPrompt(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg
                         bg-black/5 dark:bg-white/5 border border-gray-200 dark:border-white/10
                         hover:bg-black/8 dark:hover:bg-white/8 transition-colors">
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-[11px] font-medium">人设提示词</span>
                <span className="text-[9px] text-gray-400">{'{{name}} → 机器人昵称'}</span>
              </div>
              <span className="text-[10px] text-[var(--primary-color)]">
                {showPrompt ? '收起' : '展开'}
              </span>
            </button>
            {showPrompt && (
              <TextArea
                value={draft.SystemPrompt}
                onChange={e => patch({ SystemPrompt: e.target.value })}
                className="mt-2 h-44 w-full text-[11px] p-3 leading-relaxed"
              />
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-white/10 flex gap-2 shrink-0">
          <Button variant="default" className="flex-1" onClick={onClose}>取消</Button>
          <Button variant="primary" className="flex-1" onClick={handleSave}>保存</Button>
        </div>
      </GlassCard>
    </div>
  );
}

// ── 主组件 ─────────────────────────────────────────────────────────────────────

export function AI() {
  const [config,        setConfig]        = useState<AppConfig | null>(null);
  const [testMessages,  setTestMessages]  = useState<ChatMessage[]>([]);
  const [sendToDanmaku, setSendToDanmaku] = useState(false);
  const [inputMessage,  setInputMessage]  = useState('');
  const [isSending,     setIsSending]     = useState(false);
  const [editingBot,    setEditingBot]    = useState<AiBot | null>(null);
  const [isNewBot,      setIsNewBot]      = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [ttsVoice,      setTtsVoice]      = useState('zh-CN-XiaoxiaoNeural');
  const [playingId,     setPlayingId]     = useState<number | null>(null);
  const [playedId,      setPlayedId]      = useState<number | null>(null);
  const [voiceOpen,     setVoiceOpen]     = useState(false);
  const loggedIn = useLoggedIn();
  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.loadConfig().then(c => {
      setConfig(c);
      setSendToDanmaku(c.AiReplyToDanmaku ?? false);
      if (c.TtsVoice) setTtsVoice(c.TtsVoice);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [testMessages, isSending]);

  // 从 config 派生
  const bots        = config?.AiBots ?? [];
  const llmProviders = (config?.AiProviders ?? []).filter(p => (p.ProviderType || 'llm') === 'llm' && p.Enabled);
  const firstEnabled = bots.find(b => b.Enabled);

  /** 通过 bot 找对应的 LLM provider 名称 */
  const providerName = (bot: AiBot): string => {
    const p = (config?.AiProviders ?? []).find(pr => pr.Id === bot.ProviderId);
    return p ? `${p.Name} · ${p.Model}` : '未配置模型';
  };

  // ── TTS ─────────────────────────────────────────────────────────────────────

  const handleVoiceChange = async (v: string) => {
    setTtsVoice(v);
    if (!config) return;
    const next = { ...config, TtsVoice: v };
    setConfig(next);
    await api.saveConfig(next).catch(console.error);
  };

  const handlePlay = async (text: string, idx: number) => {
    if (playingId === idx) return;
    setPlayingId(idx);
    try {
      await invoke('speak_text_cmd', { text, voice: ttsVoice });
      setPlayedId(idx);
      setTimeout(() => setPlayedId(null), 1800);
    } catch (e) {
      toast.error(`播放失败: ${e}`);
    } finally {
      setPlayingId(null);
    }
  };

  // ── 配置保存 ────────────────────────────────────────────────────────────────

  const saveBots = async (newBots: AiBot[]) => {
    if (!config) return;
    const next: AppConfig = { ...config, AiBots: newBots };
    setConfig(next);
    await api.saveConfig(next).catch(e => toast.error(`保存失败: ${e}`));
  };

  // ── 机器人 CRUD ─────────────────────────────────────────────────────────────

  const handleAddBot = () => {
    if (!config) return;
    if (bots.length >= MAX_BOTS) { toast.error(`最多配置 ${MAX_BOTS} 个机器人`); return; }
    const nth = bots.length + 1;
    const defaultProvider = llmProviders[0];
    setIsNewBot(true);
    setEditingBot({
      Id: `bot-${Date.now()}`,
      ProviderId:   defaultProvider?.Id ?? '',
      Nickname:     `机器人${nth}`,
      SystemPrompt: DEFAULT_SYSTEM_PROMPT,
      Enabled:      true,
    });
  };

  const handleSaveBot = async (updated: AiBot) => {
    const newBots = bots.some(b => b.Id === updated.Id)
      ? bots.map(b => b.Id === updated.Id ? updated : b)
      : [...bots, updated];
    await saveBots(newBots);
    toast.success(isNewBot ? '机器人已添加' : '已保存');
    setEditingBot(null);
  };

  const handleDeleteBot = async (id: string) => {
    await saveBots(bots.filter(b => b.Id !== id));
    setDeleteConfirm(null);
    toast.success('已删除');
  };

  const handleToggleBot = async (bot: AiBot) => {
    const enabledCount = bots.filter(b => b.Enabled).length;
    if (bot.Enabled && enabledCount === 1) { toast.error('至少保留一个启用的机器人'); return; }
    await saveBots(bots.map(b => b.Id === bot.Id ? { ...b, Enabled: !b.Enabled } : b));
  };

  // ── 发消息 ──────────────────────────────────────────────────────────────────

  const toggleSendToDanmaku = async (checked: boolean) => {
    setSendToDanmaku(checked);
    if (!config) return;
    const next = { ...config, AiReplyToDanmaku: checked };
    setConfig(next);
    await api.saveConfig(next).catch(console.error);
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isSending) return;
    if (bots.length === 0) {
      setTestMessages(prev => [...prev, { role: 'error', content: '请先添加机器人' }]);
      return;
    }
    const enabledBots = bots.filter(b => b.Enabled);
    if (enabledBots.length === 0) {
      setTestMessages(prev => [...prev, { role: 'error', content: '没有启用的机器人，请点击右上角开关启用' }]);
      return;
    }

    const userMsg = inputMessage;
    setTestMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInputMessage('');
    setIsSending(true);

    // 路由：@昵称 / 包含昵称 / 默认第一个启用的
    let targetBot = enabledBots[0];
    let prompt = userMsg;

    if (userMsg.startsWith('@')) {
      const rest = userMsg.slice(1).trimStart();
      const sp = rest.indexOf(' ');
      if (sp > 0) {
        const nick = rest.slice(0, sp);
        const hit = bots.find(b => b.Nickname === nick);
        if (hit) {
          if (!hit.Enabled) {
            setTestMessages(prev => [...prev, { role: 'error', content: `「${nick}」未启用` }]);
            setIsSending(false);
            return;
          }
          targetBot = hit;
          prompt = rest.slice(sp + 1).trim() || rest;
        }
      }
    } else {
      const hit = bots.find(b => b.Nickname && userMsg.includes(b.Nickname));
      if (hit) {
        if (!hit.Enabled) {
          setTestMessages(prev => [...prev, { role: 'error', content: `「${hit.Nickname}」未启用` }]);
          setIsSending(false);
          return;
        }
        targetBot = hit;
      }
    }

    // 切换 ActiveProviderId，让后端 send_ai_message 知道用哪个 provider
    if (config && targetBot.ProviderId !== config.ActiveProviderId) {
      const next = { ...config, ActiveProviderId: targetBot.ProviderId };
      setConfig(next);
      await api.saveConfig(next).catch(console.error);
    }

    const prov = (config?.AiProviders ?? []).find(p => p.Id === targetBot.ProviderId);

    try {
      const reply = await invoke<string>('send_ai_message', { prompt });
      setTestMessages(prev => [...prev, {
        role: 'assistant', content: reply,
        botName: targetBot.Nickname,
        providerName: prov ? `${prov.Name} · ${prov.Model}` : '',
      }]);
      if (sendToDanmaku && loggedIn) {
        for (const chunk of (reply.match(/.{1,25}/g) || [])) {
          try { await api.sendDanmu(chunk); await new Promise(r => setTimeout(r, 1000)); }
          catch { toast.error('部分弹幕发送失败'); break; }
        }
      }
    } catch (err) {
      setTestMessages(prev => [...prev, {
        role: 'error',
        content: `[${targetBot.Nickname}] 响应失败: ${String(err)}`,
      }]);
    } finally {
      setIsSending(false);
    }
  };

  if (!config) return <div className="p-8 text-center text-gray-500">加载中...</div>;

  return (
    <div className="h-full flex flex-col gap-3 p-4 overflow-hidden">

      {/* ── 机器人列表栏 ─────────────────────────────── */}
      <GlassCard className="p-3 shrink-0">
        <div className="flex items-center gap-2.5">

          <div className="shrink-0 relative group/hint cursor-default select-none">
            <h2 className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">AI 机器人</h2>
            <div className="absolute top-full left-0 mt-1.5 hidden group-hover/hint:block z-50 pointer-events-none">
              <div className="bg-gray-900 dark:bg-gray-800 text-white rounded-lg px-2.5 py-1.5 shadow-xl border border-white/10 whitespace-nowrap">
                <p className="text-[10px]">@昵称 触发指定机器人 · 悬停卡片编辑/删除</p>
              </div>
            </div>
          </div>

          {/* 机器人卡片 */}
          <div className="flex gap-2 flex-1 overflow-x-auto pb-0.5 -mb-0.5 scrollbar-none">
            {bots.map((bot, idx) => {
              const prov = (config.AiProviders ?? []).find(p => p.Id === bot.ProviderId);
              const Icon = prov ? providerIcon(prov.Name) : Bot;
              const color = BOT_COLORS[idx % BOT_COLORS.length];
              const isEnabled = bot.Enabled;
              const isLast = isEnabled && bots.filter(b => b.Enabled).length === 1;
              return (
                <div key={bot.Id} className="relative group/card shrink-0">
                  {/* 卡片主体：点击切换启用 */}
                  <div
                    onClick={() => handleToggleBot(bot)}
                    title={isLast ? '至少保留一个启用的机器人' : (isEnabled ? '点击停用' : '点击启用')}
                    className={`rounded-xl border flex flex-col select-none transition-all cursor-pointer
                      ${isEnabled ? 'text-white border-transparent shadow-sm' : 'bg-black/5 dark:bg-black/20 border-transparent opacity-50 hover:opacity-70'}
                      ${isLast ? '!cursor-not-allowed' : ''}`}
                    style={isEnabled ? { background: color } : undefined}
                  >
                    <div className="px-2 pt-1.5 pb-0.5 flex items-center gap-1 pr-8 min-w-[70px]">
                      <Icon className={`w-3 h-3 shrink-0 ${isEnabled ? 'text-white/80' : 'text-gray-400'}`} />
                      <span className={`text-[11px] font-semibold whitespace-nowrap ${isEnabled ? 'text-white' : ''}`}>
                        {bot.Nickname}
                      </span>
                    </div>
                    <div className={`px-2 pb-1.5 text-[9px] whitespace-nowrap max-w-[110px] truncate ${isEnabled ? 'text-white/60' : 'text-gray-400'}`}>
                      {prov ? prov.Name : '未配置模型'}
                    </div>
                  </div>
                  {/* 悬浮操作 */}
                  <div className="absolute top-1 right-1 hidden group-hover/card:flex gap-0.5">
                    <button
                      onClick={e => { e.stopPropagation(); setIsNewBot(false); setEditingBot({ ...bot }); }}
                      className="w-5 h-5 rounded-md bg-white/90 dark:bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white dark:hover:bg-white/30 transition-colors"
                      title="编辑">
                      <Pencil className="w-2.5 h-2.5 text-gray-600 dark:text-gray-300" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteConfirm(bot.Id); }}
                      className="w-5 h-5 rounded-md bg-white/90 dark:bg-white/20 backdrop-blur flex items-center justify-center hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                      title="删除">
                      <Trash2 className="w-2.5 h-2.5 text-red-500" />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* 添加按钮 */}
            {bots.length < MAX_BOTS && (
              <button onClick={handleAddBot}
                className="shrink-0 min-h-[46px] px-3 rounded-xl border border-dashed border-gray-300 dark:border-white/20
                           flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:border-[var(--primary-color)] hover:text-[var(--primary-color)]
                           transition-colors">
                <Plus className="w-3.5 h-3.5" />
                <span className="text-[9px]">添加</span>
              </button>
            )}
          </div>

          {bots.length >= MAX_BOTS && (
            <span className="shrink-0 text-[10px] text-gray-400 whitespace-nowrap">已满 {MAX_BOTS} 个</span>
          )}

          {/* 前往模型服务 */}
          <Link to="/models"
            className="shrink-0 flex items-center gap-1.5 h-8 px-2.5 rounded-xl bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 hover:bg-white/80 dark:hover:bg-white/15 transition-all text-[11px] text-gray-500"
            title="管理模型服务">
            <Cpu className="w-3.5 h-3.5" />模型
          </Link>
        </div>
      </GlassCard>

      {/* ── 对话区 ──────────────────────────────────── */}
      <GlassCard className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/40 dark:bg-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <label className={`flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded-lg transition-all text-[11px] ${
              sendToDanmaku
                ? 'bg-[var(--primary-color)]/10 border border-[var(--primary-color)]/30 text-[var(--primary-color)]'
                : 'bg-white/40 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-500 hover:bg-white/60'
            }`}>
              <input type="checkbox" checked={sendToDanmaku} onChange={e => toggleSendToDanmaku(e.target.checked)} className="w-3 h-3 rounded" />
              AI 回复到弹幕
            </label>

            {/* TTS 声音选择 */}
            <div className="flex items-center gap-1.5">
              <Volume2 className="w-3 h-3 text-gray-400 shrink-0" />
              <button
                onClick={() => setVoiceOpen(true)}
                className="flex items-center gap-1 h-[26px] pl-2 pr-2 rounded-lg text-[10px]
                           bg-white/60 dark:bg-white/8 border border-gray-200 dark:border-white/15
                           hover:bg-white/80 dark:hover:bg-white/15 transition-colors
                           text-gray-600 dark:text-gray-300 max-w-[180px] truncate"
                title={ttsVoice}
              >
                <span className="truncate">
                  {(() => {
                    const v = (['edge_tts','minimax_tts','volcano_engine'] as TtsProvider[]).reduce<TtsVoice | undefined>((found, p) => found ?? findVoice(p, ttsVoice), undefined);
                    return v ? `${v.name} · ${v.language}` : (ttsVoice || '选择声音');
                  })()}
                </span>
                <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
              </button>
            </div>
            <VoicePicker
              open={voiceOpen}
              onClose={() => setVoiceOpen(false)}
              providers={config ? availableProviders((config.AiProviders ?? []).filter(p => p.ProviderType === 'tts').map(p => p.Name)) : ['edge_tts']}
              currentVoice={ttsVoice}
              onSelect={v => { setTtsVoice(v); handleVoiceChange(v); }}
            />

            {firstEnabled && (
              <span className="text-[10px] text-gray-400 select-none hidden sm:block">
                默认 <span className="font-medium text-gray-600 dark:text-gray-300">{firstEnabled.Nickname}</span>
                <span className="mx-1 opacity-40">·</span>@昵称 指定
              </span>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setTestMessages([])} className="h-7 text-[11px]">
            清空
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {bots.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Bot className="w-10 h-10 text-gray-300 dark:text-gray-600" />
              <div className="text-gray-400 text-[12px]">点击上方「+ 添加」配置第一个机器人</div>
            </div>
          ) : testMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-[12px] italic select-none">
              {firstEnabled
                ? `@${firstEnabled.Nickname} 开始对话`
                : '请先启用至少一个机器人'}
            </div>
          ) : (
            testMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'error' ? (
                  <div className="max-w-[80%] flex items-start gap-1.5 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="text-[11px] leading-relaxed">{msg.content}</span>
                  </div>
                ) : msg.role === 'user' ? (
                  <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-white text-[12px] leading-relaxed whitespace-pre-wrap"
                    style={{ background: 'var(--primary-color)' }}>
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl bg-white/70 dark:bg-white/10">
                    {msg.botName && (
                      <div className="text-[9px] text-gray-400 mb-1 font-medium">
                        {msg.botName}
                        {msg.providerName && (
                          <span className="opacity-60 font-normal"> · {msg.providerName}</span>
                        )}
                      </div>
                    )}
                    <div className="text-[12px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                    <div className="flex gap-1.5 mt-2 pt-2 border-t border-gray-200/50 dark:border-white/10">
                      <button
                        onClick={() => handlePlay(msg.content, i)}
                        disabled={playingId !== null}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-all disabled:opacity-40 ${
                          playedId === i
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-white/80 dark:bg-white/5 hover:bg-white dark:hover:bg-white/15 text-gray-500'
                        }`}>
                        {playingId === i
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : playedId === i
                            ? <CheckCircle2 className="w-3 h-3" />
                            : <Volume2 className="w-3 h-3" />
                        }
                        {playingId === i ? '播放中' : playedId === i ? '已播放' : '播放'}
                      </button>
                      {!sendToDanmaku && (
                        <button
                          onClick={async () => {
                            if (!loggedIn) return;
                            for (const chunk of (msg.content.match(/.{1,25}/g) || [])) {
                              try { await api.sendDanmu(chunk); await new Promise(r => setTimeout(r, 1000)); }
                              catch { toast.error('发送失败'); break; }
                            }
                            toast.success('已发送');
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/80 dark:bg-white/5 hover:bg-white dark:hover:bg-white/15 text-[10px] text-gray-500 transition-all">
                          <Send className="w-3 h-3" />发送
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
          {isSending && (
            <div className="flex justify-start">
              <div className="bg-white/40 dark:bg-white/5 px-3.5 py-2.5 rounded-2xl animate-pulse text-[11px] text-gray-400">
                思考中...
              </div>
            </div>
          )}
          <div ref={msgEndRef} />
        </div>

        <div className="px-4 py-3 border-t border-white/10 shrink-0">
          <div className="flex gap-2">
            <Input
              placeholder={firstEnabled ? `@${firstEnabled.Nickname} 或直接输入...` : '请先启用一个机器人...'}
              className="flex-1 h-9 text-[12px]"
              value={inputMessage}
              disabled={isSending}
              onChange={e => setInputMessage(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
            />
            <IconButton onClick={handleSendMessage} disabled={isSending} className="h-9 w-9">
              <Send className="w-4 h-4" />
            </IconButton>
          </div>
        </div>
      </GlassCard>

      {/* ── 编辑弹窗 ─────────────────────────────────── */}
      {editingBot && (
        <BotEditModal
          bot={editingBot} isNew={isNewBot} allBots={bots}
          llmProviders={(config.AiProviders ?? []).filter(p => (p.ProviderType || 'llm') === 'llm')}
          onSave={handleSaveBot} onClose={() => setEditingBot(null)}
        />
      )}

      {/* ── 删除确认 ─────────────────────────────────── */}
      {deleteConfirm && (() => {
        const target = bots.find(b => b.Id === deleteConfirm);
        const isLast = bots.length === 1;
        return (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]">
            <GlassCard className="w-[300px] p-5 shadow-2xl border border-white/10">
              <h3 className="text-[13px] font-semibold mb-2">删除机器人</h3>
              {isLast ? (
                <p className="text-[12px] text-gray-500 mb-4">至少需要保留一个机器人。</p>
              ) : (
                <p className="text-[12px] text-gray-500 mb-4">
                  确定删除「<span className="font-medium text-gray-700 dark:text-gray-200">{target?.Nickname}</span>」？
                </p>
              )}
              <div className="flex gap-2">
                <Button variant="default" className="flex-1" onClick={() => setDeleteConfirm(null)}>取消</Button>
                {!isLast && (
                  <Button variant="destructive" className="flex-1" onClick={() => handleDeleteBot(deleteConfirm)}>
                    删除
                  </Button>
                )}
              </div>
            </GlassCard>
          </div>
        );
      })()}
    </div>
  );
}
