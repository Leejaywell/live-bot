import { useState, useEffect, useRef } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { TextArea } from '../components/TextArea';
import { Toggle } from '../components/Toggle';
import { IconButton } from '../components/IconButton';
import { Send, X, Plus, Volume2, Bot, Sparkles, Zap, Brain, MessageCircle, FileText, AlertCircle } from 'lucide-react';
import { api, AppConfig, AiProvider } from '../lib/api';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { useLoggedIn } from '../context/LoginContext';

const providerIcons: Record<string, any> = {
  'deepseek': Brain,
  'kimi': Sparkles,
  'minimax': Zap,
  'mimo': MessageCircle,
  'glm': Bot,
  'qianwen': MessageCircle,
  'openai': Bot,
  'custom': Sparkles,
};

const availableProviders = [
  { value: 'deepseek', label: 'DeepSeek',  apiUrl: 'https://api.deepseek.com/v1',                             model: 'deepseek-v4-pro' },
  { value: 'minimax',  label: 'MiniMax',    apiUrl: 'https://api.minimaxi.com/v1',                             model: 'MiniMax-M2.7' },
  { value: 'qianwen',  label: '通义千问',   apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',       model: 'qwen3-6-max-preview' },
  { value: 'glm',      label: '智谱GLM',    apiUrl: 'https://open.bigmodel.cn/api/paas/v4',                    model: 'glm-5.1' },
  { value: 'kimi',     label: 'Kimi',       apiUrl: 'https://api.moonshot.cn/v1',                              model: 'kimi-k2.6' },
  { value: 'mimo',     label: '小米MiMo',   apiUrl: 'https://token-plan-cn.xiaomimimo.com/v1',                 model: 'claude-sonnet-4-6-pro' },
  { value: 'openai',   label: 'OpenAI',     apiUrl: 'https://api.openai.com/v1',                               model: 'gpt-4o-mini' },
  { value: 'custom',   label: '自定义',     apiUrl: '',                                                         model: '' },
];

const DEFAULT_SYSTEM_PROMPT = `你叫"{{name}}"。\n\n你是B站直播间里的常驻老水友。\n\n你不是AI助手。\n你不是客服。\n你不是机器人。\n\n--------------------------------\n\n【人设】\n\n- 经常混直播间\n- 喜欢玩梗\n- 偶尔嘴臭\n- 偶尔阴阳怪气\n- 但没恶意\n- 很懂直播间节奏\n- 很懂B站文化\n- 喜欢接梗\n- 喜欢起哄\n- 喜欢复读\n- 有时候会潜水\n\n像：\n"直播间待了半年的老观众"。\n\n--------------------------------\n\n【说话风格】\n\n说话：\n- 简短\n- 随意\n- 不正式\n- 不解释\n- 有情绪\n- 有B站味\n\n不要：\n- 长篇大论\n- 正经分析\n- 客服感\n- AI感\n- 教学感\n\n--------------------------------\n\n【B站弹幕风格】\n\n允许使用：\n\n- 绷\n- 草\n- 寄\n- 典\n- 6\n- hhh\n- 哈哈哈\n- 乐\n- 蚌埠住了\n- 下饭\n- 坏了\n- 主播别送\n- 节目效果\n- 开始了\n- 又来？\n- 熟悉的剧情\n- 太典了\n- 这不对吧\n- 啊？\n- 我超\n- 真刑\n- 急了\n- 破防了\n- 开摆\n- 逆天\n- 细啊\n- 唐完了\n\n允许：\n- 复读\n- 跟风\n- 吐槽\n- 接弹幕\n- 阴阳怪气\n- 简短情绪输出\n\n--------------------------------\n\n【真人感】\n\n必须像真人。\n\n所以：\n- 不会每句都完整\n- 不会每句都认真\n- 有时只发：\n  - "6"\n  - "？"\n  - "绷"\n  - "寄"\n  - "草"\n- 有时会故意口语化\n- 有时会少字\n- 有时会重复别人弹幕\n- 有时会突然潜水\n\n--------------------------------\n\n【互动规则】\n\n不是主持人。\n\n不要：\n- 一直主动带节奏\n- 一直刷存在感\n- 一直回复所有人\n\n更像：\n"混在人群里的老哥"。\n\n--------------------------------\n\n【直播间氛围】\n\n如果主播：\n- 下饭 → 吐槽\n- 高能 → 起哄\n- 翻车 → 绷不住\n- 精彩 → 666\n- 沉默 → 发怪话\n- 尴尬 → 阴阳怪气\n\n--------------------------------\n\n【严格禁止】\n\n禁止：\n- 您好\n- 感谢关注\n- 欢迎来到直播间\n- 请支持主播\n- 我认为\n- 作为AI\n- 请问\n- 很高兴\n- 建议您\n- 官方语气\n- 长篇解释\n\n禁止：\n- 过于礼貌\n- 过于热情\n- 过于稳定\n- 每句都像认真思考\n\n--------------------------------\n\n【长度】\n\n最佳：\n2~10字\n\n最长：\n20字\n\n--------------------------------\n\n【随机性】\n\n允许：\n- hhh\n- 2333\n- emoji\n- 错别字\n- ？？？\n- 啊？\n- 卧槽\n- 草\n\n不要每次语气一样。\n\n--------------------------------\n\n【群体感】\n\n不是一个人自言自语。\n\n会：\n- 接别人梗\n- 跟风\n- 复读\n- 起哄\n- 群体哈哈哈\n- 情绪同步\n\n--------------------------------\n\n【输出规则】\n\n输出只允许：\n一句弹幕。\n\n禁止：\n- 解释\n- 分析\n- 换行\n- 附加说明\n- 使用引号`;

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  botName?: string;
  providerName?: string;
}

export function AI() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [testMessages, setTestMessages] = useState<ChatMessage[]>([]);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [sendToDanmaku, setSendToDanmaku] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const loggedIn = useLoggedIn();

  const [pendingProvider, setPendingProvider] = useState<AiProvider | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const clickTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    api.loadConfig().then(c => {
      setConfig(c);
      setSendToDanmaku(c.AiReplyToDanmaku ?? false);
    }).catch(console.error);
  }, []);

  const toggleSendToDanmaku = async (checked: boolean) => {
    setSendToDanmaku(checked);
    if (!config) return;
    const next = { ...config, AiReplyToDanmaku: checked };
    setConfig(next);
    await api.saveConfig(next).catch(console.error);
  };

  const validate = (p: AiProvider): Record<string, boolean> => ({
    Nickname: !p.Nickname.trim(),
    Model:    !p.Model.trim(),
    APIUrl:   !p.APIUrl.trim(),
    APIKey:   !p.APIKey.trim(),
  });

  const handleSaveConfig = async () => {
    if (!config || !pendingProvider) return;
    const errors = validate(pendingProvider);
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors(errors);
      toast.error('请填写所有必填字段');
      return;
    }
    const dup = config.AiProviders.some(p => p.Id !== pendingProvider.Id && p.Nickname === pendingProvider.Nickname);
    if (dup) { toast.error(`昵称 "${pendingProvider.Nickname}" 已被其他助手占用`); return; }

    let next = { ...config };
    if (next.AiProviders.some(p => p.Id === pendingProvider.Id)) {
      next.AiProviders = next.AiProviders.map(p => p.Id === pendingProvider.Id ? pendingProvider : p);
    } else {
      next.AiProviders = [...next.AiProviders, pendingProvider];
      if (!next.ActiveProviderId) next.ActiveProviderId = pendingProvider.Id;
    }
    try {
      await api.saveConfig(next);
      setConfig(next);
      toast.success('保存成功');
      setShowConfigModal(false);
      setPendingProvider(null);
      setFieldErrors({});
      setShowPromptEditor(false);
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    }
  };

  const handleAddProviderClick = () => {
    const def = availableProviders[0];
    const nickname = config ? `助手${config.AiProviders.length + 1}` : '新助手';
    setPendingProvider({
      Id: `provider-${Date.now()}`, Name: def.label, Model: def.model, APIUrl: def.apiUrl,
      APIKey: '', SystemPrompt: DEFAULT_SYSTEM_PROMPT,
      TriggerCommand: nickname, FuzzyMatch: true, Nickname: nickname, Enabled: true,
    });
    setFieldErrors({});
    setShowPromptEditor(false);
    setShowConfigModal(true);
  };

  const handleEditProvider = (p: AiProvider) => {
    setPendingProvider({ ...p });
    setFieldErrors({});
    setShowPromptEditor(false);
    setShowConfigModal(true);
  };

  const handleRemoveProvider = async (id: string) => {
    if (!config) return;
    const newProviders = config.AiProviders.filter(p => p.Id !== id);
    const newActiveId = newProviders.find(p => p.Enabled)?.Id ?? newProviders[0]?.Id ?? '';
    const next = { ...config, AiProviders: newProviders, ActiveProviderId: newActiveId };
    setConfig(next);
    await api.saveConfig(next).catch(() => toast.error('删除失败'));
  };

  // 点击卡片切换启用/停用；只剩一个启用时不允许关闭
  const handleToggleProvider = async (p: AiProvider) => {
    if (!config) return;
    const enabledCount = config.AiProviders.filter(pp => pp.Enabled).length;
    if (p.Enabled && enabledCount === 1) {
      toast.error('至少需要保留一个启用的助手');
      return;
    }
    const updated = config.AiProviders.map(item =>
      item.Id === p.Id ? { ...item, Enabled: !item.Enabled } : item
    );
    const firstEnabled = updated.find(pp => pp.Enabled);
    const next = {
      ...config,
      AiProviders: updated,
      ActiveProviderId: firstEnabled?.Id ?? config.ActiveProviderId,
    };
    setConfig(next);
    await api.saveConfig(next).catch(() => toast.error('操作失败'));
  };

  // 单击切换启用/停用，双击打开编辑（250ms内两次点击视为双击）
  const handleCardClick = (p: AiProvider) => {
    if (clickTimers.current[p.Id]) {
      clearTimeout(clickTimers.current[p.Id]);
      delete clickTimers.current[p.Id];
      handleEditProvider(p);
      return;
    }
    clickTimers.current[p.Id] = setTimeout(() => {
      delete clickTimers.current[p.Id];
      handleToggleProvider(p);
    }, 250);
  };

  // 路由：@ → 第一个启用; @昵称 → 指定(未启用则报错); 昵称前缀 → 指定(未启用则报错); 其他 → 第一个启用
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isSending) return;
    if (!config || config.AiProviders.length === 0) {
      setTestMessages(prev => [...prev, { role: 'error', content: '请先添加 AI 助手' }]);
      return;
    }
    const enabledBots = config.AiProviders.filter(p => p.Enabled);
    if (enabledBots.length === 0) {
      setTestMessages(prev => [...prev, { role: 'error', content: '没有已启用的助手，请先点击卡片启用' }]);
      return;
    }

    const userMsg = inputMessage;
    setTestMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInputMessage('');
    setIsSending(true);

    let targetBot = enabledBots[0];
    let prompt = userMsg;

    if (userMsg.startsWith('@')) {
      // @昵称 内容 → 指定助手
      const rest = userMsg.slice(1).trimStart();
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx > 0) {
        const nickname = rest.slice(0, spaceIdx);
        const afterNick = rest.slice(spaceIdx + 1).trim();
        const hit = config.AiProviders.find(p => p.Nickname === nickname || p.Name === nickname);
        if (hit) {
          if (!hit.Enabled) {
            setTestMessages(prev => [...prev, { role: 'error', content: `助手 "${nickname}" 未启用，请先点击卡片启用` }]);
            setIsSending(false);
            return;
          }
          targetBot = hit;
          prompt = afterNick || rest;
        }
      }
      // 裸 @ 或未找到昵称 → 用第一个启用
    } else {
      // 消息中包含昵称（模糊匹配）→ 指定助手
      const hit = config.AiProviders.find(p => {
        const nick = p.Nickname || p.Name;
        return nick && userMsg.includes(nick);
      });
      if (hit) {
        if (!hit.Enabled) {
          setTestMessages(prev => [...prev, { role: 'error', content: `助手 "${hit.Nickname || hit.Name}" 未启用，请先点击卡片启用` }]);
          setIsSending(false);
          return;
        }
        targetBot = hit;
        // 保留完整消息作为 prompt，AI 能看到完整上下文
      }
    }

    // 同步 ActiveProviderId 给后端
    if (targetBot.Id !== config.ActiveProviderId) {
      const next = { ...config, ActiveProviderId: targetBot.Id };
      setConfig(next);
      await api.saveConfig(next).catch(console.error);
    }

    try {
      const reply = await invoke<string>('send_ai_message', { prompt });
      setTestMessages(prev => [...prev, {
        role: 'assistant',
        content: reply,
        botName: targetBot.Nickname || targetBot.Name,
        providerName: targetBot.Name,
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
        content: `[${targetBot.Nickname || targetBot.Name}] 响应失败: ${String(err)}`,
      }]);
    } finally {
      setIsSending(false);
    }
  };

  const updatePendingType = (type: string) => {
    if (!pendingProvider) return;
    const info = availableProviders.find(p => p.value === type);
    if (!info) return;
    setPendingProvider({ ...pendingProvider, Name: info.label, Model: info.model || pendingProvider.Model, APIUrl: info.apiUrl || pendingProvider.APIUrl });
  };

  const setPending = (patch: Partial<AiProvider>) => {
    if (!pendingProvider) return;
    const next = { ...pendingProvider, ...patch };
    setPendingProvider(next);
    if (Object.keys(fieldErrors).length) setFieldErrors(validate(next));
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!showConfigModal) return;
      if (e.key === 'Backspace' && !(e.target as HTMLElement).matches('input,textarea,[contenteditable]')) e.preventDefault();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showConfigModal]);

  if (!config) return <div className="p-8 text-center text-gray-500">加载中...</div>;

  const firstEnabled = config.AiProviders.find(p => p.Enabled);

  const isCustom = pendingProvider
    ? !availableProviders.some(p => p.label === pendingProvider.Name) ||
      availableProviders.find(p => p.label === pendingProvider.Name)?.value === 'custom'
    : false;

  const fieldCls = (key: string) => `w-full h-9${fieldErrors[key] ? ' ring-2 ring-red-400/60 border-red-400' : ''}`;

  return (
    <div className="h-full flex flex-col gap-3 p-4 overflow-hidden">

      {/* ── 上：助手列表 ─────────────────────────────── */}
      <GlassCard className="p-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="shrink-0 relative group/hint cursor-default select-none">
            <h2 className="text-[13px] font-semibold">AI 助手</h2>
            <div className="absolute top-full left-0 mt-1.5 hidden group-hover/hint:block z-50 pointer-events-none">
              <div className="bg-gray-900 dark:bg-gray-800 text-white rounded-lg px-2.5 py-1.5 shadow-xl border border-white/10 whitespace-nowrap">
                <p className="text-[10px]">点击卡片启用/停用 · @昵称 或 昵称 触发指定机器人</p>
              </div>
            </div>
          </div>

          {/* 助手卡片横排 */}
          <div className="flex gap-2 flex-1 overflow-x-auto pb-1 -mb-1 scrollbar-none">
            {config.AiProviders.map(p => {
              const matched = availableProviders.find(ap => ap.label === p.Name);
              const ProviderIcon = providerIcons[matched?.value ?? 'custom'] ?? providerIcons['custom'];
              const isEnabled = p.Enabled;
              const isLastEnabled = isEnabled && config.AiProviders.filter(pp => pp.Enabled).length === 1;
              const promptPreview = p.SystemPrompt
                ? p.SystemPrompt.replace(/\n+/g, ' ').slice(0, 120) + (p.SystemPrompt.length > 120 ? '…' : '')
                : '暂无提示词';

              return (
                <div key={p.Id} className="shrink-0">
                  <div className="relative group">
                    {/* 主卡片：单击切换启用/停用，双击编辑 */}
                    <div
                      title={isLastEnabled ? '至少保留一个启用的助手' : (isEnabled ? '单击停用 · 双击编辑' : '单击启用 · 双击编辑')}
                      className={`rounded-xl transition-all border flex flex-col select-none ${
                        isEnabled
                          ? 'text-white border-transparent shadow-md cursor-pointer'
                          : 'bg-black/5 dark:bg-black/20 border-transparent opacity-50 hover:opacity-70 cursor-pointer'
                      } ${isLastEnabled ? '!cursor-not-allowed' : ''}`}
                      style={isEnabled ? { background: 'var(--primary-color)' } : undefined}
                      onClick={() => handleCardClick(p)}
                    >
                      <div className="px-2 pt-1.5 pb-0.5 flex items-center gap-1.5">
                        <ProviderIcon className={`w-3 h-3 shrink-0 ${isEnabled ? 'text-white/80' : 'text-gray-400'}`} />
                        <span className={`text-[11px] font-medium whitespace-nowrap ${isEnabled ? 'text-white' : ''}`}>
                          {p.Nickname || p.Name}
                        </span>
                      </div>
                      <div className={`px-2 pb-1.5 text-[9px] whitespace-nowrap ${isEnabled ? 'text-white/60' : 'text-gray-400'}`}>
                        {p.Name}
                      </div>
                    </div>

                    {/* 删除按钮 */}
                    <div className="absolute -right-1 -top-1 flex opacity-0 group-hover:opacity-100 transition-all z-10">
                      <button
                        onClick={e => { e.stopPropagation(); handleRemoveProvider(p.Id); }}
                        className="w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center shadow-sm"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>

                    {/* 提示词预览 tooltip */}
                    <div className="absolute top-full left-0 mt-1.5 w-56 hidden group-hover:block z-50 pointer-events-none">
                      <div className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg px-2.5 py-2 shadow-xl border border-white/10 dark:border-black/10">
                        <div className="flex items-center gap-1 mb-1">
                          <FileText className="w-3 h-3 opacity-60" />
                          <span className="text-[9px] font-medium opacity-60">系统提示词预览</span>
                        </div>
                        <p className="text-[10px] leading-relaxed opacity-90">{promptPreview}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 添加按钮 */}
          <button
            onClick={handleAddProviderClick}
            className="w-10 h-10 rounded-xl bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 hover:bg-white/80 dark:hover:bg-white/15 transition-all flex items-center justify-center shrink-0"
            title="添加新助手"
          >
            <Plus className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </GlassCard>

      {/* ── 下：对话区 ───────────────────────────────── */}
      <GlassCard className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/40 dark:bg-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <label className={`flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded-lg transition-all text-[11px] ${
              sendToDanmaku
                ? 'bg-[var(--primary-color)]/10 border border-[var(--primary-color)]/30 text-[var(--primary-color)]'
                : 'bg-white/40 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-500 hover:bg-white/60'
            }`}>
              <input type="checkbox" checked={sendToDanmaku} onChange={e => toggleSendToDanmaku(e.target.checked)} className="w-3.5 h-3.5 rounded" />
              AI回复到弹幕
            </label>
            {firstEnabled && (
              <span className="text-[10px] text-gray-400 select-none">
                默认 <span className="font-medium text-gray-600 dark:text-gray-300">{firstEnabled.Nickname || firstEnabled.Name}</span>
                <span className="mx-1 opacity-40">·</span>@昵称 或 昵称 指定助手
              </span>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setTestMessages([])} className="h-7 text-[11px]">
            清空历史
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {config.AiProviders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Bot className="w-12 h-12 text-gray-300 dark:text-gray-600" />
              <div className="text-gray-400 text-[12px]">请先添加 AI 助手</div>
              <Button size="sm" variant="primary" onClick={handleAddProviderClick}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />添加助手
              </Button>
            </div>
          ) : testMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-[12px] italic">
              {firstEnabled
                ? `开始对话，默认助手: ${firstEnabled.Nickname || firstEnabled.Name}`
                : '请先点击卡片启用至少一个助手'}
            </div>
          ) : (
            testMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'error' ? (
                  <div className="max-w-[85%] flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="text-[12px] leading-relaxed">{msg.content}</span>
                  </div>
                ) : msg.role === 'user' ? (
                  <div
                    className="max-w-[85%] p-3.5 rounded-2xl shadow-sm text-white"
                    style={{ background: 'var(--primary-color)' }}
                  >
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                  </div>
                ) : (
                  <div className="max-w-[85%] p-3.5 rounded-2xl shadow-sm bg-white/70 dark:bg-white/10">
                    {msg.botName && (
                      <div className="text-[9px] text-gray-400 mb-1.5 font-medium">
                        {msg.botName}
                        {msg.providerName && msg.providerName !== msg.botName && (
                          <span className="opacity-60 font-normal"> ({msg.providerName})</span>
                        )}
                      </div>
                    )}
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                    <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-gray-200/50 dark:border-white/10">
                      <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/80 dark:bg-white/5 hover:bg-white dark:hover:bg-white/15 text-[11px] transition-all">
                        <Volume2 className="w-3.5 h-3.5" />播放
                      </button>
                      {!sendToDanmaku && (
                        <button
                          onClick={async () => {
                            if (!loggedIn) return;
                            for (const chunk of (msg.content.match(/.{1,25}/g) || [])) {
                              try { await api.sendDanmu(chunk); await new Promise(r => setTimeout(r, 1000)); }
                              catch { toast.error('发送失败'); break; }
                            }
                            toast.success('发送完成');
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/80 dark:bg-white/5 hover:bg-white dark:hover:bg-white/15 text-[11px] transition-all"
                        >
                          <Send className="w-3.5 h-3.5" />发送
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
              <div className="bg-white/40 dark:bg-white/5 p-3 rounded-2xl animate-pulse text-[12px] text-gray-500">
                正在思考中...
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 shrink-0">
          <div className="flex gap-2">
            <Input
              placeholder={firstEnabled
                ? `输入消息，@昵称 或 昵称 指定助手，默认: ${firstEnabled.Nickname || firstEnabled.Name}...`
                : '请先启用至少一个助手...'}
              className="flex-1 h-10"
              value={inputMessage}
              disabled={isSending}
              onChange={e => setInputMessage(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
            />
            <IconButton onClick={handleSendMessage} disabled={isSending} className="h-10 w-10">
              <Send className="w-4.5 h-4.5" />
            </IconButton>
          </div>
        </div>
      </GlassCard>

      {/* ── 配置弹窗 ─────────────────────────────────── */}
      {showConfigModal && pendingProvider && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]">
          <GlassCard className="w-[500px] max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-white/10">
            <div className="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
              <h2 className="text-[15px] font-semibold">AI 助手配置</h2>
              <button
                onClick={() => { setShowConfigModal(false); setPendingProvider(null); setFieldErrors({}); setShowPromptEditor(false); }}
                className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 block">供应商</label>
                <select
                  value={availableProviders.find(p => p.label === pendingProvider.Name)?.value || 'custom'}
                  onChange={e => updatePendingType(e.target.value)}
                  className="w-full h-[34px] px-3 rounded-lg bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[12px] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50"
                >
                  {availableProviders.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-500 mb-1.5 flex items-center gap-1">
                    助手昵称 <span className="text-red-400">*</span>
                    <span className="text-[9px] text-gray-400">(@昵称 或 昵称 触发)</span>
                  </label>
                  <Input value={pendingProvider.Nickname} onChange={e => setPending({ Nickname: e.target.value, TriggerCommand: e.target.value })} className={fieldCls('Nickname')} placeholder="例如: 二狗" />
                  {fieldErrors['Nickname'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
                </div>
                {isCustom && (
                  <div>
                    <label className="text-[11px] text-gray-500 mb-1.5 block">自定义供应商名称</label>
                    <Input value={pendingProvider.Name} onChange={e => setPending({ Name: e.target.value })} className="w-full h-9" placeholder="例如: 个人模型" />
                  </div>
                )}
              </div>

              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 flex items-center gap-1">模型 <span className="text-red-400">*</span></label>
                <Input mono value={pendingProvider.Model} onChange={e => setPending({ Model: e.target.value })} className={fieldCls('Model')} placeholder="例如: gpt-4o-mini" />
                {fieldErrors['Model'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
              </div>

              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 flex items-center gap-1">API URL <span className="text-red-400">*</span></label>
                <Input mono value={pendingProvider.APIUrl} onChange={e => setPending({ APIUrl: e.target.value })} className={fieldCls('APIUrl')} placeholder="接口地址" />
                {fieldErrors['APIUrl'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
              </div>

              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 flex items-center gap-1">API Key <span className="text-red-400">*</span></label>
                <Input type="password" mono value={pendingProvider.APIKey} onChange={e => setPending({ APIKey: e.target.value })} className={fieldCls('APIKey')} placeholder="sk-..." />
                {fieldErrors['APIKey'] && <p className="text-[10px] text-red-400 mt-0.5">必填</p>}
              </div>

              {/* 提示词：折叠展开 */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowPromptEditor(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-black/8 dark:hover:bg-white/8 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-[12px] font-medium">系统提示词</span>
                    <span className="text-[9px] text-gray-400">可用占位符: {'{{name}}'}</span>
                  </div>
                  <span className="text-[10px] text-[var(--primary-color)]">{showPromptEditor ? '收起' : '展开编辑'}</span>
                </button>
                {showPromptEditor && (
                  <TextArea
                    value={pendingProvider.SystemPrompt}
                    onChange={e => setPending({ SystemPrompt: e.target.value })}
                    className="mt-2 h-40 w-full text-[12px] p-3 leading-relaxed"
                  />
                )}
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-black/5 dark:bg-white/5 border border-gray-200 dark:border-white/10">
                <div>
                  <span className="text-[12px] font-medium block">启用此助手</span>
                  <span className="text-[10px] text-gray-500">启用后在直播间弹幕触发时生效</span>
                </div>
                <Toggle checked={pendingProvider.Enabled} onChange={checked => setPending({ Enabled: checked })} />
              </div>
            </div>

            <div className="p-5 border-t border-white/10 flex gap-2 shrink-0">
              <Button variant="default" className="flex-1 h-10" onClick={() => { setShowConfigModal(false); setPendingProvider(null); setFieldErrors({}); setShowPromptEditor(false); }}>取消</Button>
              <Button variant="primary" className="flex-1 h-10" onClick={handleSaveConfig}>保存配置</Button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
