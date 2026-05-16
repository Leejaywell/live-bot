import React, { useState, useEffect, useRef } from 'react';
import {
  Bot, MessageSquare, Gift, Users, Star, TrendingUp,
  ShieldOff, Clock, ChevronRight, Heart,
  Bell, Mic, BarChart2, AlertCircle,
} from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { Toggle } from '../components/Toggle';
import { useNavigate } from 'react-router-dom';
import { api, AppConfig } from '../lib/api';
import { toast } from 'sonner';

// ── Count-up animation ────────────────────────────────────────────────────────
function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef  = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const to   = value;
    const dur  = 800;
    const t0   = performance.now();
    cancelAnimationFrame(rafRef.current);
    const tick = (now: number) => {
      const p     = Math.min((now - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur   = Math.round(from + (to - from) * eased);
      setDisplay(cur);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <>{display.toLocaleString()}</>;
}

// ── Danmu feed ────────────────────────────────────────────────────────────────
interface DanmuEntry { id: number; user: string; content: string; time: string }
let _danmuId = 0;
function parseDanmu(text: string): DanmuEntry | null {
  if (!text.startsWith('弹幕 ')) return null;
  const rest = text.slice(3);
  const idx = rest.indexOf(': ');
  if (idx < 0) return null;
  return {
    id: _danmuId++,
    user: rest.slice(0, idx),
    content: rest.slice(idx + 2),
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

// ── Auto-feature groups ───────────────────────────────────────────────────────
type SubToggle = { label: string; key: keyof AppConfig };
type AutoGroup = {
  title: string;
  Icon: React.ElementType;
  mainKey?: keyof AppConfig;
  subs: SubToggle[];
  to?: string;
  countKey?: keyof AppConfig;
  aiCard?: boolean;
};

const AUTO_GROUPS: AutoGroup[] = [
  {
    title: 'AI 机器人',
    Icon: Bot,
    to: '/ai',
    subs: [],
    aiCard: true,
  },
  {
    title: '欢迎问候',
    Icon: MessageSquare,
    mainKey: 'GeneralWelcomeEnabled',
    to: '/auto-reply?tab=welcome',
    subs: [
      { label: '欢迎自己入场', key: 'InteractSelf' },
      { label: '欢迎主播入场', key: 'InteractAnchor' },
    ],
  },
  {
    title: '互动感谢',
    Icon: Heart,
    to: '/auto-reply?tab=fans',
    subs: [
      { label: '关注答谢',   key: 'ThanksFocus' },
      { label: '分享答谢',   key: 'ThanksShare' },
      { label: '礼物感谢',   key: 'ThanksGift' },
      { label: '礼物汇总',   key: 'GiftSummaryThanks' },
      { label: '礼物 @ 用户', key: 'ThanksGiftUseAt' },
    ],
  },
  {
    title: '消息通知',
    Icon: Bell,
    subs: [
      { label: '特效入场', key: 'EntryEffect' },
      { label: 'PK 提醒',  key: 'PkNotice' },
      { label: '禁言提醒', key: 'ShowBlockMsg' },
    ],
  },
  {
    title: '语音播报',
    Icon: Mic,
    mainKey: 'TtsEnabled',
    to: '/voice',
    subs: [
      { label: '语音识别', key: 'VadEnabled' },
    ],
  },
  {
    title: '数据记录',
    Icon: BarChart2,
    subs: [
      { label: '盲盒统计', key: 'BlindBoxProfitLossStat' },
      { label: '弹幕计数', key: 'DanmuCntEnable' },
    ],
  },
  {
    title: '定时任务',
    Icon: Clock,
    mainKey: 'CronDanmu',
    to: '/auto-reply?tab=timed',
    subs: [],
    countKey: 'CronDanmuList',
  },
  {
    title: '内容过滤',
    Icon: ShieldOff,
    mainKey: 'DanmuFilterEnable',
    to: '/auto-reply?tab=filter',
    subs: [],
    countKey: 'PermanentBlacklistUsers',
  },
];

// All boolean toggle keys, used for "已启用 X / Y 项" counter
const ALL_TOGGLE_KEYS: (keyof AppConfig)[] = [
  'GeneralWelcomeEnabled', 'InteractSelf', 'InteractAnchor',
  'ThanksFocus', 'ThanksShare', 'ThanksGift', 'GiftSummaryThanks', 'ThanksGiftUseAt',
  'EntryEffect', 'PkNotice', 'ShowBlockMsg',
  'TtsEnabled', 'VadEnabled',
  'BlindBoxProfitLossStat', 'DanmuCntEnable',
  'CronDanmu', 'DanmuFilterEnable',
];

// ── Component ─────────────────────────────────────────────────────────────────
export function Dashboard() {
  const navigate = useNavigate();
  const [config, setConfig]       = useState<AppConfig | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [stats, setStats]         = useState<any>(null);
  const [danmus, setDanmus]       = useState<DanmuEntry[]>([]);
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(refreshStats, 5000);

    let unlisten: (() => void) | undefined;
    let unlistenStats: (() => void) | undefined;
    const setup = async () => {
      try {
        unlisten = await api.onMonitorLog((log) => {
          const entry = parseDanmu(log);
          if (entry) setDanmus(prev => [...prev, entry].slice(-50));
        });
        unlistenStats = await api.onSessionSummary((summary) => {
          setStats(summary);
        });
      } catch (err) {
        console.error('Failed to setup monitor listeners:', err);
      }
    };
    setup();

    return () => {
      if (unlisten) unlisten();
      if (unlistenStats) unlistenStats();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [danmus]);

  const loadData = async () => {
    try {
      const [c, m] = await Promise.all([api.loadConfig(), api.getMonitorStatus()]);
      setConfig(c);
      setIsMonitoring(m);
      refreshStats();
    } catch (err) {
      console.error(err);
    }
  };

  const refreshStats = async () => {
    try {
      const m = await api.getMonitorStatus();
      setIsMonitoring(m);
      if (m) setStats(await api.getStats(-1));
    } catch { /* silent */ }
  };

  const toggleAuto = async (key: keyof AppConfig, value: boolean) => {
    if (!config) return;
    try {
      const next = { ...config, [key]: value };
      await api.saveConfig(next);
      setConfig(next);
    } catch (err) {
      toast.error(`更新失败: ${err}`);
    }
  };

  const statItems = [
    { label: '本场弹幕', value: stats?.danmu_count  || 0, icon: MessageSquare, color: '#4b8eff' },
    { label: '进场人数', value: stats?.entry_count   || 0, icon: Users,         color: '#34c759' },
    { label: '新增关注', value: stats?.follow_count  || 0, icon: Star,          color: '#af52de' },
    { label: '礼物总值', value: stats?.gift_value    || 0, sub: '电池', icon: Gift, color: '#ff9500' },
    { label: '互动数',   value: stats?.interact_count|| 0, icon: Users,         color: '#ff2d55' },
    { label: '人气峰值', value: stats?.peak_popularity||0, icon: TrendingUp,     color: '#007aff' },
  ];

  const enabledCount = config
    ? ALL_TOGGLE_KEYS.filter(k => !!(config as any)[k]).length
    : 0;

  const GroupCard = ({ g }: { g: AutoGroup }) => {
    const { title, Icon, mainKey, subs, to, countKey, aiCard } = g;
    const mainChecked = mainKey != null && config ? !!(config as any)[mainKey] : undefined;
    const count = countKey && config ? ((config as any)[countKey] as any[])?.length ?? 0 : null;

    // AI card — info-only, shows active bot name
    if (aiCard) {
      const activeBots = config?.AiBots?.filter(b => b.Enabled) ?? [];
      const botInfo = activeBots.length > 0
        ? `${activeBots[0].Nickname}${activeBots.length > 1 ? ` 等 ${activeBots.length} 个` : ''}`
        : '未配置';
      return (
        <GlassCard hoverable className="p-4 border-white/60 dark:border-white/10 overflow-hidden">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full pointer-events-none"
               style={{ background: 'radial-gradient(circle, rgba(var(--primary-rgb),0.10) 0%, transparent 70%)' }} />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shadow-sm"
                   style={{ background: 'rgba(var(--primary-rgb), 0.12)', color: 'var(--primary-color)' }}>
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[13px] font-bold tracking-tight">{title}</span>
                <p className="text-[10px] text-gray-400 mt-0.5">{botInfo}</p>
              </div>
            </div>
            {to && (
              <button
                onClick={() => navigate(to)}
                className="w-7 h-7 rounded-lg flex items-center justify-center border transition-all active:scale-95
                           border-[var(--primary-color)]/25 text-[var(--primary-color)] bg-[var(--primary-color)]/6
                           hover:bg-[var(--primary-color)]/18 hover:border-[var(--primary-color)]/50"
                title="前往设置"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
          {activeBots.length > 0 && (
            <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5 flex gap-1.5 flex-wrap">
              {activeBots.slice(0, 3).map(b => (
                <span key={b.Id} className="px-2 py-0.5 rounded-full text-[9px] font-black bg-[var(--primary-color)]/10 text-[var(--primary-color)] border border-[var(--primary-color)]/20">
                  {b.Nickname}
                </span>
              ))}
            </div>
          )}
        </GlassCard>
      );
    }

    return (
      <GlassCard hoverable className="p-4 border-white/60 dark:border-white/10 overflow-hidden">
        <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full pointer-events-none"
             style={{ background: 'radial-gradient(circle, rgba(var(--primary-rgb),0.10) 0%, transparent 70%)' }} />

        {/* header */}
        <div className={`flex items-center justify-between ${subs.length > 0 ? 'mb-4' : ''}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shadow-sm"
                 style={{ background: 'rgba(var(--primary-rgb), 0.12)', color: 'var(--primary-color)' }}>
              <Icon className="w-4 h-4" />
            </div>
            <span className="text-[13px] font-bold tracking-tight">{title}</span>
            {count !== null && count > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-[var(--primary-color)]/10 text-[var(--primary-color)] border border-[var(--primary-color)]/20 leading-none">
                {count}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {to && (
              <button
                onClick={() => navigate(to)}
                className="w-7 h-7 rounded-lg flex items-center justify-center border transition-all active:scale-95
                           border-[var(--primary-color)]/25 text-[var(--primary-color)] bg-[var(--primary-color)]/6
                           hover:bg-[var(--primary-color)]/18 hover:border-[var(--primary-color)]/50"
                title="前往设置"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            {mainChecked != null && (
              <Toggle checked={mainChecked} onChange={v => toggleAuto(mainKey!, v)} />
            )}
          </div>
        </div>

        {/* sub-toggles */}
        {subs.length > 0 && (
          <div className="pt-3 border-t border-black/5 dark:border-white/5 space-y-2.5">
            {subs.map(sub => (
              <div key={sub.key} className="flex items-center justify-between">
                <span className="text-[12px] text-gray-500 dark:text-gray-400 font-medium">{sub.label}</span>
                <Toggle
                  checked={config ? !!(config as any)[sub.key] : false}
                  onChange={v => toggleAuto(sub.key, v)}
                />
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    );
  };

  return (
    <div className="p-5 space-y-5 h-full overflow-y-auto scrollbar-none">
      {/* stats */}
      <div className="grid grid-cols-3 gap-4">
        {statItems.map((stat, i) => (
          <GlassCard key={i} hoverable className="p-5 relative border-white/60 dark:border-white/10">
            <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full"
                 style={{ background: stat.color, boxShadow: `0 0 8px ${stat.color}` }} />
            <div className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-2">{stat.label}</div>
            <div className="text-[24px] font-black tracking-tight leading-none mb-1"><CountUp value={stat.value} /></div>
            <div className="text-[10px] text-gray-400 font-bold">{stat.sub || '本场'}</div>
          </GlassCard>
        ))}
      </div>

      {/* auto features */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[12px] font-black text-gray-400 uppercase tracking-widest">自动化功能</h2>
          <div className="flex-1 h-px bg-black/5 dark:bg-white/5" />
          {config && (
            <span className="text-[10px] font-bold text-gray-400">
              已启用 <span className="text-[var(--primary-color)]">{enabledCount}</span> / {ALL_TOGGLE_KEYS.length} 项
            </span>
          )}
        </div>

        {!isMonitoring && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/8 border border-amber-500/20 text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[11px] font-bold">监听未启动 — 设置保存后，开启监听时生效</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {AUTO_GROUPS.map(g => <GroupCard key={g.title} g={g} />)}
        </div>
      </div>
    </div>
  );
}
