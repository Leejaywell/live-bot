import React, { useState, useEffect, useRef } from 'react';
import { Bot, MessageSquare, Gift, Users, Star, TrendingUp, Radio, ShieldOff, Clock, ChevronRight, Heart } from 'lucide-react';
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
type SubToggle  = { label: string; key: keyof AppConfig };
type AutoGroup  = { title: string; Icon: React.ElementType; mainKey?: keyof AppConfig; subs: SubToggle[]; wide?: boolean; to?: string; countKey?: keyof AppConfig };

const AUTO_GROUPS: AutoGroup[] = [
  {
    title: 'AI 机器人', Icon: Bot, mainKey: 'AiReplyToDanmaku', to: '/ai',
    subs: [],
  },
  {
    title: '互动答谢', Icon: Heart, to: '/auto-reply?tab=fans',
    subs: [
      { label: '关注答谢', key: 'ThanksFocus' },
      { label: '分享答谢', key: 'ThanksShare' },
    ],
  },
  {
    title: '欢迎过滤', Icon: Star, to: '/auto-reply?tab=system',
    subs: [
      { label: '欢迎自己', key: 'InteractSelf' },
      { label: '欢迎主播', key: 'InteractAnchor' },
    ],
  },
  {
    title: '消息开关', Icon: Radio, wide: true,
    subs: [
      { label: '特效入场', key: 'EntryEffect' },
      { label: '礼物感谢', key: 'ThanksGift' },
      { label: '醒目留言', key: 'ThanksSuperChat' },
      { label: 'PK 提醒',  key: 'PkNotice' },
      { label: '禁言提醒', key: 'ShowBlockMsg' },
      { label: '盲盒统计', key: 'BlindBoxProfitLossStat' },
    ],
  },
  {
    title: '定时任务', Icon: Clock, mainKey: 'CronDanmu', to: '/auto-reply?tab=timed',
    subs: [], countKey: 'CronDanmuList',
  },
  {
    title: '黑名单',  Icon: ShieldOff, mainKey: 'DanmuFilterEnable', to: '/auto-reply?tab=filter',
    subs: [], countKey: 'PermanentBlacklistUsers',
  },
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

  const GroupCard = ({ g }: { g: AutoGroup }) => {
    const { title, Icon, mainKey, subs, wide, to, countKey } = g;
    const mainChecked = mainKey != null && config ? !!(config as any)[mainKey] : undefined;
    const count = countKey && config ? ((config as any)[countKey] as any[])?.length ?? 0 : null;

    return (
      <GlassCard hoverable className={`p-4 ${wide ? 'col-span-2' : ''} border-white/60 dark:border-white/10 overflow-hidden`}>
        {/* card accent glow */}
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
          <div className={`pt-3 border-t border-black/5 dark:border-white/5 ${wide ? 'grid grid-cols-2 gap-x-8 gap-y-2' : 'space-y-2'}`}>
            {subs.map(sub => (
              <div key={sub.key} className="flex items-center justify-between">
                <span className="text-[12px] text-gray-500 font-medium">{sub.label}</span>
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
        </div>
        <div className="grid grid-cols-2 gap-4">
          {AUTO_GROUPS.map(g => <GroupCard key={g.title} g={g} />)}
        </div>
      </div>
    </div>
  );
}
