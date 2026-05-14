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
  AlertCircle, Cpu, Plus, X, Pencil, Trash2, FileText, ChevronDown, Loader2, CheckCircle2, Settings as SettingsIcon
} from 'lucide-react';
import { api, AppConfig, AiBot, AiProvider } from '../lib/api';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { TtsProvider, availableProviders, findVoice, TtsVoice } from '../lib/voices';
import { VoicePicker } from '../components/VoicePicker';
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

function BotEditModal({ bot, isNew, allBots, llmProviders, onSave, onClose }: any) {
  const [draft, setDraft] = useState<AiBot>({ ...bot });
  const patch = (p: Partial<AiBot>) => setDraft(prev => ({ ...prev, ...p }));
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100]">
      <GlassCard className="w-[400px] p-6 shadow-2xl border border-white/10">
        <h2 className="text-[14px] font-bold mb-4">{isNew ? '添加机器人' : '编辑机器人'}</h2>
        <div className="space-y-4">
          <Input value={draft.Nickname} onChange={e => patch({ Nickname: e.target.value })} placeholder="机器人昵称" className="w-full" />
          <select value={draft.ProviderId} onChange={e => patch({ ProviderId: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-black/5 dark:bg-white/5 border-none text-[13px]">
            <option value="">选择模型...</option>
            {llmProviders.map((p: any) => <option key={p.Id} value={p.Id}>{p.Name}</option>)}
          </select>
        </div>
        <div className="flex gap-2 mt-6">
          <Button variant="default" className="flex-1" onClick={onClose}>取消</Button>
          <Button variant="primary" className="flex-1" onClick={() => onSave(draft)}>保存</Button>
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
  const [ttsVoice,      setTtsVoice]      = useState('zh-CN-XiaoxiaoNeural');
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

  if (!config) return <div className="p-8 text-center text-gray-500 italic">正在唤醒机器人...</div>;

  return (
    <div className="h-full flex flex-col gap-4 p-5 overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4 flex-1">
          <h2 className="text-[13px] font-black text-gray-700 dark:text-gray-200">AI 机器人</h2>
          <div className="flex gap-2.5 flex-1 overflow-x-auto pb-0.5 scrollbar-none">
            {bots.map((bot, idx) => {
              const prov = (config.AiProviders ?? []).find(p => p.Id === bot.ProviderId);
              const Icon = prov ? providerIcon(prov.Name) : Bot;
              const color = BOT_COLORS[idx % BOT_COLORS.length];
              const isEnabled = bot.Enabled;
              return (
                <div key={bot.Id} className="relative group/card shrink-0" onClick={() => handleToggleBot(bot)}>
                  <div className={cn("h-[42px] px-4 rounded-[16px] flex flex-col justify-center transition-all cursor-pointer border shadow-sm", isEnabled ? "text-white border-transparent" : "bg-white/50 dark:bg-white/5 border-gray-200 dark:border-white/10 opacity-60")} style={isEnabled ? { background: color, boxShadow: `0 8px 16px -4px ${color}60` } : undefined}>
                    <div className="flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /><span className="text-[12px] font-black">{bot.Nickname}</span></div>
                    <div className="text-[9px] font-bold opacity-70">{prov ? prov.Name : '未配置'}</div>
                  </div>
                </div>
              );
            })}
            {bots.length < MAX_BOTS && (
              <button onClick={handleAddBot} className="h-[42px] px-5 rounded-[16px] border border-dashed border-gray-300 flex items-center gap-2 text-gray-400 hover:text-[var(--primary-color)] transition-all bg-black/[0.02]">
                <Plus className="w-4 h-4" /><span className="text-[12px] font-bold">添加</span>
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold text-gray-400">{bots.length === MAX_BOTS ? '已满' : `还可添加 ${MAX_BOTS - bots.length} 个`}</span>
          <Link to="/models" className="w-8 h-8 rounded-full bg-white/60 border border-gray-200 flex items-center justify-center text-gray-500 hover:text-[var(--primary-color)]"><Cpu className="w-4 h-4" /></Link>
        </div>
      </div>

      <GlassCard className="flex-1 flex flex-col overflow-hidden border-white/60 dark:border-white/10 bg-white/60 dark:bg-black/20 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-black/5 bg-white/40 shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 border border-white/40">
               <input type="checkbox" checked={sendToDanmaku} onChange={e => setSendToDanmaku(e.target.checked)} className="w-3.5 h-3.5 rounded-md accent-[var(--primary-color)]" id="reply-danmu" />
               <label htmlFor="reply-danmu" className="text-[11px] font-bold text-gray-600 cursor-pointer">AI 回复到弹幕</label>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 border border-white/40">
               <Volume2 className="w-3.5 h-3.5 text-gray-400" />
               <button onClick={() => setVoiceOpen(true)} className="flex items-center gap-1 text-[11px] font-bold text-gray-600">
                  {(() => {
                    const v = (['edge_tts','minimax_tts','volcano_engine'] as TtsProvider[]).reduce<TtsVoice | undefined>((found, p) => found ?? findVoice(p, ttsVoice), undefined);
                    return v ? `${v.name}` : (ttsVoice || '选择声音');
                  })()}
                  <ChevronDown className="w-3 h-3 opacity-50" />
               </button>
            </div>
            {firstEnabled && <span className="text-[11px] font-bold text-gray-400">默认 <span className="text-gray-600">{firstEnabled.Nickname}</span> · @昵称 指定</span>}
          </div>
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-gray-400" />
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
                <div className={cn("max-w-[85%] px-5 py-3 rounded-2xl text-[13px] shadow-sm", msg.role === 'user' ? "bg-[var(--primary-color)] text-white font-medium" : "bg-white text-gray-700 border border-black/5")}>
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
    </div>
  );
}
