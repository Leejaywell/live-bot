import { Bot, MessageSquare, Gift, Users, Star, TrendingUp, Radio, ShieldCheck, Clock, ChevronRight } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { Toggle } from '../components/Toggle';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, AppConfig } from '../lib/api';
import { toast } from 'sonner';

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
type AutoGroup  = { title: string; Icon: React.ElementType; mainKey?: keyof AppConfig; subs: SubToggle[]; wide?: boolean; to?: string };

const AUTO_GROUPS: AutoGroup[] = [
  {
    title: 'AI 机器人', Icon: Bot, mainKey: 'AiReplyToDanmaku', to: '/ai',
    subs: [
      { label: '新用户欢迎', key: 'NewcomerDanmuEnable' },
      { label: '关注答谢',   key: 'ThanksFocus' },
    ],
  },
  {
    title: '指定欢迎', Icon: MessageSquare, to: '/auto-reply',
    subs: [
      { label: '指定人欢迎', key: 'WelcomeSwitch' },
    ],
  },
  {
    title: '弹幕开关', Icon: Radio, wide: true,
    subs: [
      { label: '特效入场', key: 'EntryEffect' },
      { label: '礼物感谢', key: 'ThanksGift' },
      { label: 'PK 提醒',  key: 'PkNotice' },
      { label: '禁言提醒', key: 'ShowBlockMsg' },
      { label: '欢迎主播', key: 'InteractAnchor' },
      { label: '盲盒统计', key: 'BlindBoxProfitLossStat' },
    ],
  },
  {
    title: '定时任务', Icon: Clock, mainKey: 'CronDanmu', to: '/auto-reply?tab=timed',
    subs: [],
  },
  {
    title: '黑名单',  Icon: ShieldCheck, mainKey: 'DanmuFilterEnable', to: '/auto-reply?tab=blacklist',
    subs: [],
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
    const setup = async () => {
      try {
        unlisten = await api.onMonitorLog((log) => {
          const entry = parseDanmu(log);
          if (entry) setDanmus(prev => [...prev, entry].slice(-50));
        });
      } catch (err) {
        console.error('Failed to setup monitor log listener:', err);
      }
    };
    setup();

    return () => {
      if (unlisten) unlisten();
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
    { label: '本场弹幕', value: stats?.danmu_count  || 0, icon: MessageSquare },
    { label: '进场人数', value: stats?.entry_count   || 0, icon: Users },
    { label: '新增关注', value: stats?.follow_count  || 0, icon: Star },
    { label: '礼物总值', value: stats?.gift_value    || 0, sub: '电池', icon: Gift },
    { label: '互动数',   value: stats?.interact_count|| 0, icon: Users },
    { label: '人气峰值', value: stats?.peak_popularity||0, icon: TrendingUp },
  ];

  const GroupCard = ({ g }: { g: AutoGroup }) => {
    const { title, Icon, mainKey, subs, wide, to } = g;
    const mainChecked = mainKey != null && config ? !!(config as any)[mainKey] : undefined;

    return (
      <GlassCard className={`p-3.5 ${wide ? 'col-span-2' : ''}`}>
        {/* header */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md flex items-center justify-center text-white"
                 style={{ background: 'var(--primary-color)' }}>
              <Icon className="w-3.5 h-3.5" />
            </div>
            <span className="text-[12px] font-semibold">{title}</span>
          </div>
          <div className="flex items-center gap-1">
            {to && (
              <button
                onClick={() => navigate(to)}
                className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-[var(--primary-color)] transition-colors"
                title="前往设置"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
            {mainChecked != null && (
              <Toggle checked={mainChecked} onChange={v => toggleAuto(mainKey!, v)} />
            )}
          </div>
        </div>

        {/* sub-toggles */}
        {subs.length > 0 && (
          <div className={`pt-2 border-t border-black/5 dark:border-white/10 ${wide ? 'grid grid-cols-2 gap-x-6 gap-y-1.5' : 'space-y-1.5'}`}>
            {subs.map(sub => (
              <div key={sub.key} className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">{sub.label}</span>
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
    <div className="p-[18px] space-y-3.5">
      {/* stats */}
      <div className="grid grid-cols-3 gap-3.5">
        {statItems.map((stat, i) => (
          <GlassCard key={i} className="p-4 relative">
            {isMonitoring && (
              <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
                   style={{ background: 'var(--primary-color)', boxShadow: '0 0 6px var(--primary-color)' }} />
            )}
            <div className="text-[11px] text-gray-500 font-semibold tracking-wide mb-1">{stat.label}</div>
            <div className="text-[19px] font-bold mb-1">{stat.value.toLocaleString()}</div>
            <div className="text-[10px] text-gray-500">{stat.sub || '本场'}</div>
          </GlassCard>
        ))}
      </div>

      {/* auto features */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-[11px] font-bold text-gray-500 tracking-wider">自动化功能</h2>
          <div className="flex-1 h-px bg-gradient-to-r from-gray-300 dark:from-gray-700 to-transparent" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {AUTO_GROUPS.map(g => <GroupCard key={g.title} g={g} />)}
        </div>
      </div>

      {/* real-time danmu feed */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[12px] font-semibold">实时弹幕</h2>
          <button className="text-[10px] text-gray-500 hover:text-gray-700" onClick={() => setDanmus([])}>清空</button>
        </div>
        <div className="space-y-1 max-h-[110px] overflow-y-auto">
          {danmus.length === 0 && (
            <div className="text-gray-400 italic text-[11px]">
              {isMonitoring ? '等待弹幕...' : '开始获取后显示实时弹幕'}
            </div>
          )}
          {danmus.map(d => (
            <div key={d.id} className="flex items-baseline gap-1.5 text-[11px]">
              <span className="text-gray-400 font-mono shrink-0">{d.time}</span>
              <span className="font-medium shrink-0" style={{ color: 'var(--primary-color)' }}>{d.user}</span>
              <span className="text-gray-700 dark:text-gray-300">{d.content}</span>
            </div>
          ))}
          <div ref={feedEndRef} />
        </div>
      </GlassCard>
    </div>
  );
}
