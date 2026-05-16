import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { TextArea } from '../components/TextArea';
import { Toggle } from '../components/Toggle';
import { IconButton } from '../components/IconButton';
import {
  Send, Volume2, Bot, Sparkles, Zap, Brain, MessageCircle,
  AlertCircle, Cpu, Plus, X, Pencil, ChevronDown, Settings as SettingsIcon, Copy, Check
} from 'lucide-react';
import { api, AppConfig, AiBot, AiProvider } from '../lib/api';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { TtsProvider, availableProviders, findVoice, TtsVoice } from '../lib/voices';
import { VoicePicker } from '../components/VoicePicker';
import { Modal, ModalCloseButton } from '../components/Modal';
import { useLoggedIn } from '../context/LoginContext';
import { cn } from '../lib/utils';

// ── 常量 ───────────────────────────────────────────────────────────────────────

const MAX_BOTS = 5;

const DEFAULT_SYSTEM_PROMPT = `你叫"{{name}}"。你是B站直播间里的常驻老水友。`;

const BOT_COLORS = ['#4b8eff', '#34c759', '#ff9f0a', '#af52de', '#ff2d55'];

function providerIcon(providerName: string): React.ElementType {
  const map: Record<string, React.ElementType> = {
    'DeepSeek': Brain, 'Kimi': Sparkles, 'MiniMax': Zap,
    '智谱 GLM': Bot, '通义千问': MessageCircle, 'OpenAI': Bot,
  };
  return map[providerName] ?? Sparkles;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  botName?: string;
  providerName?: string;
}

// ── 机器人编辑弹窗 ─────────────────────────────────────────────────────────────

function BotEditModal({ bot, isNew, llmProviders, existingBots, onSave, onClose }: any) {
  const [draft, setDraft] = useState<AiBot>({ ...bot });
  const patch = (p: Partial<AiBot>) => setDraft(prev => ({ ...prev, ...p }));

  const trimmed = draft.Nickname.trim();
  const nameError = !trimmed
    ? '名称不能为空'
    : (existingBots as AiBot[]).some(b => b.Id !== draft.Id && b.Nickname.trim() === trimmed)
    ? '已有同名机器人'
    : '';
  const providerError = !draft.ProviderId ? '请选择 LLM 供应商' : '';

  return (
    <Modal open={true} onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 dark:border-white/10 shrink-0">
        <div>
          <h2 className="text-[14px] font-bold">{isNew ? '添加机器人' : '编辑机器人'}</h2>
          <p className="text-[10px] text-gray-400 mt-0.5">配置机器人名称和语言模型</p>
        </div>
        <ModalCloseButton onClose={onClose} />
      </div>
      {/* Body */}
      <div className="p-6 space-y-4">
        <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">机器人名称</label>
          <Input
            value={draft.Nickname}
            onChange={e => patch({ Nickname: e.target.value })}
            placeholder="例如：二狗、AI助手"
            className={cn("w-full h-10", nameError && "border-red-400 focus:ring-red-400/50")}
          />
          {nameError && <p className="text-[10px] text-red-500 mt-1">{nameError}</p>}
        </div>
        <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">LLM 供应商</label>
          <div className="relative">
            <select
              value={draft.ProviderId}
              onChange={e => patch({ ProviderId: e.target.value })}
              className={cn("w-full h-10 pl-3 pr-8 rounded-xl appearance-none bg-white/60 dark:bg-white/10 border text-[13px] focus:outline-none focus:ring-2", providerError ? "border-red-400 focus:ring-red-400/50" : "border-gray-200 dark:border-white/20 focus:ring-[var(--primary-color)]/50")}
            >
              <option value="">-- 选择 LLM 供应商 --</option>
              {llmProviders.map((p: any) => <option key={p.Id} value={p.Id}>{p.Name}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          {llmProviders.length === 0
            ? <p className="text-[10px] text-amber-500 mt-1">请先在「模型服务」页添加 LLM 供应商</p>
            : providerError && <p className="text-[10px] text-red-500 mt-1">{providerError}</p>
          }
        </div>
      </div>
      {/* Footer */}
      <div className="flex gap-2 px-6 pb-6">
        <Button variant="default" className="flex-1" onClick={onClose}>取消</Button>
        <Button variant="primary" className="flex-1" disabled={!!nameError || !!providerError} onClick={() => onSave({ ...draft, Nickname: trimmed })}>
          {isNew ? '添加' : '保存'}
        </Button>
      </div>
    </Modal>
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
  const [ttsVoice,      setTtsVoice]      = useState('zh-CN-XiaoxiaoNeural');
  const [ttsProviderId, setTtsProviderId] = useState('');
  const [voiceOpen,     setVoiceOpen]     = useState(false);
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [promptDraft,   setPromptDraft]   = useState('');
  const [copiedIdx,     setCopiedIdx]     = useState<number | null>(null);
  const loggedIn = useLoggedIn();
  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.loadConfig().then(c => {
      setConfig(c);
      setSendToDanmaku(c.AiReplyToDanmaku ?? false);
      if (c.TtsVoice) setTtsVoice(c.TtsVoice);
      setPromptDraft(c.AiAssistantPrompt ?? '');
      const ttsProviders = (c.AiProviders ?? []).filter(p => p.ProviderType === 'tts' && p.Enabled);
      const saved = c.ActiveTtsProviderId && ttsProviders.find(p => p.Id === c.ActiveTtsProviderId);
      setTtsProviderId(saved ? c.ActiveTtsProviderId : (ttsProviders[0]?.Id ?? ''));
    }).catch(console.error);
  }, []);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [testMessages, isSending]);

  const bots = config?.AiBots ?? [];
  const firstEnabled = bots.find(b => b.Enabled);

  const handleToggleBot = async (bot: AiBot) => {
    if (!config) return;
    const next: AppConfig = { ...config, AiBots: bots.map(b => b.Id === bot.Id ? { ...b, Enabled: !b.Enabled } : b) };
    setConfig(next);
    await api.saveConfig(next);
  };

  const handleAddBot = () => {
    if (!config) return;
    setIsNewBot(true);
    setEditingBot({ Id: `bot-${Date.now()}`, ProviderId: '', Nickname: `机器人${bots.length + 1}`, SystemPrompt: DEFAULT_SYSTEM_PROMPT, Enabled: true });
  };

  const handleSaveBot = async (draft: AiBot) => {
    if (!config) return;
    const next: AppConfig = isNewBot
      ? { ...config, AiBots: [...bots, draft] }
      : { ...config, AiBots: bots.map(b => b.Id === draft.Id ? draft : b) };
    setConfig(next);
    await api.saveConfig(next);
    setEditingBot(null);
    setIsNewBot(false);
  };

  const handleEditBot = (bot: AiBot, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsNewBot(false);
    setEditingBot({ ...bot });
  };

  const handleRemoveBot = async (bot: AiBot, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!config) return;
    const next = { ...config, AiBots: bots.filter(b => b.Id !== bot.Id) };
    setConfig(next);
    await api.saveConfig(next);
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isSending || !firstEnabled) return;
    const userMsg = inputMessage;
    setTestMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInputMessage('');
    setIsSending(true);
    try {
      const reply = await invoke<string>('send_ai_message', { prompt: userMsg });
      setTestMessages(prev => [...prev, { role: 'assistant', content: reply, botName: firstEnabled.Nickname }]);
    } catch (err) {
      setTestMessages(prev => [...prev, { role: 'error', content: String(err) }]);
    } finally {
      setIsSending(false);
    }
  };

  const handleDanmakuReplyToggle = async (checked: boolean) => {
    if (!config) return;
    const next = { ...config, AiReplyToDanmaku: checked };
    setSendToDanmaku(checked);
    setConfig(next);
    try {
      await api.saveConfig(next);
    } catch (err) {
      toast.error(`保存失败: ${err}`);
      setSendToDanmaku(config.AiReplyToDanmaku ?? false);
      setConfig(config);
    }
  };

  if (!config) return <div className="p-8 text-center text-gray-500 italic">正在唤醒机器人...</div>;

  return (
    <div className="h-full flex flex-col gap-4 p-5 overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4 flex-1">
          <div className="flex gap-2.5 flex-1 overflow-x-auto pb-0.5 scrollbar-none">
            {bots.map((bot, idx) => {
              const prov = (config.AiProviders ?? []).find(p => p.Id === bot.ProviderId);
              const Icon = prov ? providerIcon(prov.Name) : Bot;
              const color = BOT_COLORS[idx % BOT_COLORS.length];
              const isEnabled = bot.Enabled;
              return (
                <div key={bot.Id} className="relative group/card shrink-0">
                  {/* Hover actions — edit & remove */}
                  <div className="absolute -top-2 right-0.5 flex gap-0.5 opacity-0 group-hover/card:opacity-100 transition-all z-10 pointer-events-none group-hover/card:pointer-events-auto">
                    <button
                      onClick={e => handleEditBot(bot, e)}
                      className="w-[18px] h-[18px] rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/20 shadow flex items-center justify-center hover:bg-[var(--primary-color)] hover:border-transparent hover:text-white transition-all"
                    >
                      <Pencil className="w-2 h-2" />
                    </button>
                    <button
                      onClick={e => handleRemoveBot(bot, e)}
                      className="w-[18px] h-[18px] rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/20 shadow flex items-center justify-center hover:bg-red-500 hover:border-transparent hover:text-white transition-all"
                    >
                      <X className="w-2 h-2" />
                    </button>
                  </div>
                  <div
                    className={cn("h-[54px] px-5 rounded-[18px] flex flex-col justify-center transition-all cursor-pointer border shadow-sm", isEnabled ? "text-white border-transparent" : "bg-white/50 dark:bg-white/5 border-gray-200 dark:border-white/10 opacity-60")}
                    style={isEnabled ? { background: color, boxShadow: `0 8px 18px -4px ${color}65` } : undefined}
                    onClick={() => handleToggleBot(bot)}
                  >
                    <div className="flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /><span className="text-[13px] font-black">{bot.Nickname}</span></div>
                    <div className="text-[10px] font-bold opacity-70">{prov ? prov.Name : '未配置'}</div>
                  </div>
                </div>
              );
            })}
            {bots.length < MAX_BOTS && (() => {
              const hasLlm = (config.AiProviders ?? []).some(p => p.ProviderType === 'llm' && p.Enabled);
              return hasLlm ? (
                <button onClick={handleAddBot} className="h-[54px] px-6 rounded-[18px] border border-dashed border-gray-300 flex items-center gap-2 text-gray-400 hover:text-[var(--primary-color)] hover:border-[var(--primary-color)]/40 transition-all bg-black/[0.02]">
                  <Plus className="w-4 h-4" /><span className="text-[12px] font-bold">添加</span>
                </button>
              ) : (
                <Link to="/models" className="h-[54px] px-5 rounded-[18px] border border-dashed border-amber-300/60 flex items-center gap-2 text-amber-500/80 bg-amber-50/60 dark:bg-amber-500/5 cursor-pointer hover:border-amber-400 hover:text-amber-600 transition-all">
                  <AlertCircle className="w-4 h-4 shrink-0" /><span className="text-[12px] font-bold whitespace-nowrap">未配置 LLM</span>
                </Link>
              );
            })()}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold text-gray-400">{bots.length === MAX_BOTS ? '已达上限' : `还可添加 ${MAX_BOTS - bots.length} 个机器人`}</span>
          <Link to="/models" className="w-8 h-8 rounded-full bg-white/60 border border-gray-200 flex items-center justify-center text-gray-500 hover:text-[var(--primary-color)]"><Cpu className="w-4 h-4" /></Link>
        </div>
      </div>

      <GlassCard className="flex-1 flex flex-col overflow-hidden border-white/60 dark:border-white/10 bg-white/60 dark:bg-black/20 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-black/5 bg-white/40 shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 border border-white/40">
               <input type="checkbox" checked={sendToDanmaku} onChange={e => handleDanmakuReplyToggle(e.target.checked)} className="w-3.5 h-3.5 rounded-md accent-[var(--primary-color)]" id="reply-danmu" />
               <label htmlFor="reply-danmu" className="text-[11px] font-bold text-gray-600 cursor-pointer">将回复发送到弹幕</label>
            </div>
            {(() => {
              const ttsProviders = (config?.AiProviders ?? []).filter(p => p.ProviderType === 'tts' && p.Enabled);
              if (ttsProviders.length === 0) return null;
              const curProv = ttsProviders.find(p => p.Id === ttsProviderId) ?? ttsProviders[0];
              const v = (['edge_tts','minimax_tts','volcano_engine'] as TtsProvider[]).reduce<TtsVoice | undefined>((found, p) => found ?? findVoice(p, ttsVoice), undefined);
              return (
                <button
                  onClick={() => setVoiceOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/80 border border-white/40 text-[11px] font-bold text-gray-600 hover:bg-white transition-colors"
                >
                  <Volume2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  {v ? v.name : (ttsVoice || '选声音')}
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
              );
            })()}
            {firstEnabled && <span className="text-[11px] font-bold text-gray-400">默认使用 <span className="text-gray-600">{firstEnabled.Nickname}</span>，可用 @名字 切换</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setPromptDraft(config?.AiAssistantPrompt ?? ''); setSettingsOpen(true); }} className="w-8 h-8 rounded-full hover:bg-white/60 flex items-center justify-center transition-colors" title="AI 助手提示词">
              <SettingsIcon className="w-4 h-4 text-gray-400 hover:text-[var(--primary-color)]" />
            </button>
            <button onClick={() => setTestMessages([])} className="h-8 px-4 rounded-full border border-gray-200 text-[11px] font-bold text-gray-500 hover:bg-white/60">清空对话</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-none">
          {testMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 opacity-30">
              <span className="text-[14px] font-black tracking-widest text-gray-500">@{firstEnabled?.Nickname || '机器人'} 开始对话</span>
            </div>
          ) : (
            testMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={cn("relative max-w-[85%] px-5 py-3 rounded-2xl text-[13px] shadow-sm group/msg", msg.role === 'user' ? "bg-[var(--primary-color)] text-white font-medium" : "bg-white text-gray-700 border border-black/5")}>
                  {msg.role === 'assistant' && (
                    <button
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center opacity-0 group-hover/msg:opacity-100 transition-opacity hover:bg-gray-50"
                      onClick={() => {
                        navigator.clipboard.writeText(msg.content);
                        setCopiedIdx(i);
                        setTimeout(() => setCopiedIdx(c => c === i ? null : c), 1500);
                      }}
                      title="复制回复"
                    >
                      {copiedIdx === i ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-gray-400" />}
                    </button>
                  )}
                  {msg.botName && <div className="text-[10px] font-black uppercase mb-1 opacity-60">{msg.botName}</div>}
                  {msg.content}
                </div>
              </div>
            ))
          )}
          {isSending && <div className="flex justify-start animate-pulse italic text-gray-400 text-[12px] font-bold">思考中...</div>}
          <div ref={msgEndRef} />
        </div>

        <div className="px-6 py-4 border-t border-black/5 shrink-0 bg-white/40">
          <div className="relative">
            <Input placeholder="输入消息..." className="w-full h-[52px] px-6 pr-14 rounded-[26px] bg-white border-transparent shadow-lg text-[14px] font-medium" value={inputMessage} disabled={isSending} onChange={e => setInputMessage(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSendMessage(); }} />
            <button onClick={handleSendMessage} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[var(--primary-color)] text-white flex items-center justify-center shadow-lg"><Send className="w-5 h-5" /></button>
          </div>
        </div>
      </GlassCard>

      <VoicePicker open={voiceOpen} onClose={() => setVoiceOpen(false)} providers={config ? availableProviders((config.AiProviders ?? []).filter(p => p.ProviderType === 'tts' && p.Enabled).map(p => p.Name)) : ['edge_tts']} currentVoice={ttsVoice} onSelect={v => { setTtsVoice(v); setConfig({ ...config!, TtsVoice: v }); api.saveConfig({ ...config!, TtsVoice: v }); }} />

      {editingBot && (
        <BotEditModal
          bot={editingBot}
          isNew={isNewBot}
          llmProviders={(config?.AiProviders ?? []).filter((p: AiProvider) => p.ProviderType === 'llm' && p.Enabled)}
          existingBots={bots}
          onSave={handleSaveBot}
          onClose={() => { setEditingBot(null); setIsNewBot(false); }}
        />
      )}

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} className="max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <h2 className="text-[14px] font-bold">AI 助手提示词</h2>
          <ModalCloseButton onClose={() => setSettingsOpen(false)} />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-2">
          <label className="text-[11px] text-gray-500 block">AI 界面聊天使用的系统提示词（与直播间 AI 机器人人设独立）</label>
          <textarea
            className="w-full h-64 px-3 py-2.5 rounded-xl bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50 resize-none"
            value={promptDraft}
            onChange={e => setPromptDraft(e.target.value)}
            placeholder="例如：你是一个助理，请简洁专业地回答问题..."
          />
        </div>
        <div className="flex gap-2 px-6 pb-6 shrink-0">
          <Button variant="primary" className="flex-1" onClick={async () => {
            if (!config) return;
            const next = { ...config, AiAssistantPrompt: promptDraft };
            try {
              await api.saveConfig(next);
              setConfig(next);
              toast.success('保存成功');
              setSettingsOpen(false);
            } catch (err) {
              toast.error(`保存失败: ${err}`);
            }
          }}>保存提示词</Button>
        </div>
      </Modal>
    </div>
  );
}
