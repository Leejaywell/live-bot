import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Bot, MessageSquare, Gift, Users, Star, TrendingUp,
  ShieldOff, Clock, ChevronRight, Heart,
  Bell, Headphones, BarChart2, AlertCircle, Radio, CheckCircle2, TimerReset,
} from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { Toggle } from '../components/Toggle';
import { useNavigate } from 'react-router-dom';
import { api, AppConfig, type AiProvider } from '../lib/api';
import { toast } from 'sonner';
import { useConfig } from '../context/ConfigContext';
import { useRoom } from '../context/RoomContext';

function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    const dur = 800;
    const t0 = performance.now();
    cancelAnimationFrame(rafRef.current);
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = Math.round(from + (to - from) * eased);
      setDisplay(cur);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <>{display.toLocaleString()}</>;
}

type SubToggle = { label: string; key?: keyof AppConfig; sessionKey?: string };
type AutoGroup = {
  title: string;
  Icon: React.ElementType;
  mainKey?: keyof AppConfig;
  mainSessionKey?: string;
  subs: SubToggle[];
  to?: string;
  countKey?: keyof AppConfig;
  aiCard?: boolean;
};

type StatusTone = 'active' | 'warning' | 'muted';

type GroupMeta = {
  status: string;
  tone: StatusTone;
  metrics: string[];
  hints?: string[];
  count?: number | null;
};

const AUTO_GROUPS: AutoGroup[] = [
  {
    title: 'AI 机器人',
    Icon: Bot,
    mainKey: 'AiReplyToDanmaku',
    to: '/ai',
    subs: [],
    aiCard: true,
  },
  {
    title: '观众互动',
    Icon: Heart,
    to: '/auto-reply?tab=fans',
    subs: [
      { label: '播报弹幕', sessionKey: 'danmuAnnounce' },
      { label: '关注答谢', key: 'ThanksFocus' },
      { label: '分享答谢', key: 'ThanksShare' },
      { label: '礼物感谢', key: 'ThanksGift' },
      { label: '礼物汇总', key: 'GiftSummaryThanks' },
      { label: '礼物 @ 用户', key: 'ThanksGiftUseAt' },
    ],
  },
  {
    title: '语音陪伴',
    Icon: Headphones,
    mainKey: 'VadEnabled',
    to: '/voice',
    subs: [
      { label: '语音播报（可选）', key: 'TtsEnabled' },
    ],
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
    title: '消息通知',
    Icon: Bell,
    subs: [
      { label: '特效入场', key: 'EntryEffect' },
      { label: 'PK 提醒',  key: 'PkNotice' },
      { label: '禁言提醒', key: 'ShowBlockMsg' },
    ],
  },
  {
    title: '消息记录',
    Icon: BarChart2,
    subs: [
      { label: '盲盒统计', key: 'BlindBoxProfitLossStat' },
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

const ALL_TOGGLE_KEYS: (keyof AppConfig)[] = [
  'AiReplyToDanmaku',
  'GeneralWelcomeEnabled', 'InteractSelf', 'InteractAnchor',
  'ThanksFocus', 'ThanksShare', 'ThanksGift', 'GiftSummaryThanks', 'ThanksGiftUseAt',
  'EntryEffect', 'PkNotice', 'ShowBlockMsg',
  'TtsEnabled', 'VadEnabled',
  'BlindBoxProfitLossStat',
  'CronDanmu', 'DanmuFilterEnable',
];

function cronToNatural(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 6 && parts[0].startsWith('*/')) return `每 ${parts[0].slice(2)} 秒`;
  if (parts.length >= 5 && parts[0].startsWith('*/')) return `每 ${parts[0].slice(2)} 分钟`;
  if (parts.length >= 5) {
    const [m, h, d, mo, w] = parts;
    if (h === '*' && d === '*' && mo === '*' && w === '*') return `每小时第 ${m} 分`;
    if (m !== '*' && h !== '*' && d === '*' && mo === '*' && w === '*') return `每天 ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  }
  return cron;
}

function getNextCronRun(cron: string, now = new Date()): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 6 && parts[0].startsWith('*/')) {
    const step = Number(parts[0].slice(2));
    if (!Number.isFinite(step) || step <= 0) return null;
    return new Date(now.getTime() + step * 1000);
  }
  if (parts.length === 5 && parts[0].startsWith('*/')) {
    const step = Number(parts[0].slice(2));
    if (!Number.isFinite(step) || step <= 0) return null;
    return new Date(now.getTime() + step * 60 * 1000);
  }
  if (parts.length >= 5) {
    const [m, h, d, mo, w] = parts;
    if (m !== '*' && h !== '*' && d === '*' && mo === '*' && w === '*') {
      const minute = Number(m);
      const hour = Number(h);
      if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;
      const next = new Date(now);
      next.setSeconds(0, 0);
      next.setHours(hour, minute, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }
    if (m !== '*' && h === '*' && d === '*' && mo === '*' && w === '*') {
      const minute = Number(m);
      if (!Number.isFinite(minute)) return null;
      const next = new Date(now);
      next.setSeconds(0, 0);
      next.setMinutes(minute, 0, 0);
      if (next <= now) next.setHours(next.getHours() + 1);
      return next;
    }
  }
  return null;
}

function formatRelativeTime(target: Date | null, now = new Date()): string {
  if (!target) return '时间未知';
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return '即将执行';
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return '1 分钟内';
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (hours < 24) return remainMinutes > 0 ? `${hours} 小时 ${remainMinutes} 分后` : `${hours} 小时后`;
  const days = Math.floor(hours / 24);
  return `${days} 天后`;
}

function getConfiguredFilterCount(config: AppConfig) {
  return (
    (config.PermanentBlacklistUsers?.length ?? 0)
    + (config.PermanentBlacklistNames?.length ?? 0)
    + (config.DanmuFilterWords?.length ?? 0)
  );
}

function getEnabledSubCount(config: AppConfig, subs: SubToggle[]) {
  return subs.filter((sub) => Boolean(config[sub.key])).length;
}

function getEnabledAiBots(config: AppConfig) {
  return config.AiBots?.filter((bot) => bot.Enabled) ?? [];
}

function getEnabledTtsProviders(config: AppConfig): AiProvider[] {
  return (config.AiProviders ?? []).filter((provider) => provider.ProviderType === 'tts' && provider.Enabled);
}

function getEnabledAsrProviders(config: AppConfig): AiProvider[] {
  return (config.AiProviders ?? []).filter((provider) => provider.ProviderType === 'asr' && provider.Enabled);
}

function getGroupMeta(group: AutoGroup, config: AppConfig, opts: { connected: boolean; isMonitoring: boolean; sessionValues: Record<string, boolean> }): GroupMeta {
  const { connected, isMonitoring } = opts;
  const baseCount = group.countKey ? (((config as unknown as Record<string, unknown>)[group.countKey] as unknown[])?.length ?? 0) : null;

  if (group.aiCard) {
    const bots = getEnabledAiBots(config);
    const enabled = Boolean(config.AiReplyToDanmaku);
    if (bots.length === 0) {
      return {
        status: '待配置机器人',
        tone: 'warning',
        metrics: ['未启用任何 AI 机器人', connected ? '直播间已连接' : '未连接直播间'],
        hints: ['进入智能助手配置机器人和提示词'],
      };
    }
    return {
      status: !enabled ? '已关闭' : !connected ? '待连接直播间' : !isMonitoring ? '待启动监听' : '运行就绪',
      tone: enabled && connected && isMonitoring ? 'active' : enabled ? 'warning' : 'muted',
      metrics: [
        `激活机器人：${bots.map((bot) => bot.Nickname).join(' / ')}`,
        enabled ? '已接入直播概览自动化链路' : '已停止弹幕自动对话',
      ],
      hints: connected && isMonitoring ? ['弹幕触发时可直接参与回复'] : ['需要连接直播间并启动监听'],
    };
  }

  if (group.title === '欢迎问候') {
    const welcomeCount = (config.GeneralWelcomeMsgs?.length ?? 0) + (config.SpecialWelcomeList?.length ?? 0);
    const subEnabled = getEnabledSubCount(config, group.subs);
    const enabled = Boolean(config.GeneralWelcomeEnabled);
    return {
      status: !enabled ? '已关闭' : !connected ? '待连接直播间' : !isMonitoring ? '待启动监听' : '运行中',
      tone: enabled && connected && isMonitoring ? 'active' : enabled ? 'warning' : 'muted',
      metrics: [
        `模板 ${welcomeCount} 条`,
        `入场策略 ${subEnabled}/${group.subs.length} 已启用`,
      ],
      hints: welcomeCount === 0 ? ['已开启但暂无欢迎模板'] : undefined,
    };
  }

  if (group.title === '观众互动') {
    const giftTemplates = Object.keys(config.GiftThanksTemplates ?? {}).length;
    const aliasCount = Object.keys(config.GiftAliases ?? {}).length;
    const configEnabledCount = getEnabledSubCount(config, group.subs);
    const announceEnabled = opts.sessionValues['danmuAnnounce'] ?? false;
    const enabledCount = configEnabledCount + (announceEnabled ? 1 : 0);
    return {
      status: enabledCount === 0 ? '未启用' : !connected ? '待连接直播间' : !isMonitoring ? '待启动监听' : '运行中',
      tone: enabledCount > 0 && connected && isMonitoring ? 'active' : enabledCount > 0 ? 'warning' : 'muted',
      metrics: [
        `已启用 ${enabledCount}/${group.subs.length} 项`,
        `礼物模板 ${giftTemplates} 条，别名 ${aliasCount} 个${announceEnabled ? '，弹幕播报已开' : ''}`,
      ],
    };
  }

  if (group.title === '消息通知') {
    const notifyKeys: (keyof AppConfig)[] = ['EntryEffect', 'PkNotice', 'ShowBlockMsg'];
    const notifyEnabled = notifyKeys.filter(k => Boolean(config[k])).length;
    return {
      status: notifyEnabled === 0 ? '未启用' : !connected ? '待连接直播间' : !isMonitoring ? '待启动监听' : '运行中',
      tone: notifyEnabled > 0 && connected && isMonitoring ? 'active' : notifyEnabled > 0 ? 'warning' : 'muted',
      metrics: [
        `已启用 ${notifyEnabled}/${notifyKeys.length} 项`,
        '特效入场、PK 提醒、禁言通知',
      ],
    };
  }

  if (group.title === '消息记录') {
    const recordKeys: (keyof AppConfig)[] = ['BlindBoxProfitLossStat'];
    const recordEnabled = recordKeys.filter(k => Boolean(config[k])).length;
    return {
      status: recordEnabled === 0 ? '未启用' : !isMonitoring ? '待启动监听' : '记录中',
      tone: recordEnabled > 0 && isMonitoring ? 'active' : recordEnabled > 0 ? 'warning' : 'muted',
      metrics: [
        `已启用 ${recordEnabled}/${recordKeys.length} 项`,
        '盲盒盈亏、弹幕次数持续沉淀',
      ],
    };
  }

  if (group.title === '语音陪伴') {
    const ttsEnabled = Boolean(config.TtsEnabled);
    const vadEnabled = Boolean(config.VadEnabled);
    const asrProviders = getEnabledAsrProviders(config);
    const ttsProviders = getEnabledTtsProviders(config);
    const hasAsr = asrProviders.length > 0 || Boolean(config.AsrUrl);
    return {
      status: !vadEnabled
        ? '话筒已关闭'
        : !hasAsr
        ? '缺少语音转文字服务'
        : !connected
        ? '待连接直播间'
        : !isMonitoring
        ? '待启动监听'
        : '话筒运行中',
      tone: vadEnabled && hasAsr && connected && isMonitoring ? 'active' : vadEnabled ? 'warning' : 'muted',
      metrics: [
        hasAsr
          ? `语音转文字已就绪${asrProviders.length > 0 ? `，ASR 提供商 ${asrProviders.length} 个` : '，使用旧版 ASR 地址'}`
          : '缺少语音转文字服务，请先配置 ASR',
        ttsEnabled
          ? `语音播报已开启${ttsProviders.length > 0 ? `，TTS 提供商 ${ttsProviders.length} 个` : '，当前没有可用 TTS 提供商'}`
          : '语音播报未开启，这不会影响语音陪伴',
      ],
      hints: [
        ...(!hasAsr ? ['请先在模型服务中配置可用 ASR'] : []),
        ...(ttsEnabled && ttsProviders.length === 0 ? ['已开启语音合成但没有可用 TTS 提供商'] : []),
      ],
    };
  }

  if (group.title === '定时任务') {
    const enabled = Boolean(config.CronDanmu);
    const tasks = config.CronDanmuList ?? [];
    const firstTask = tasks[0];
    const nextRun = firstTask?.Cron ? getNextCronRun(firstTask.Cron) : null;
    return {
      status: !enabled ? '已关闭' : tasks.length === 0 ? '待添加任务' : !connected ? '待连接直播间' : !isMonitoring ? '待启动监听' : '运行中',
      tone: enabled && tasks.length > 0 && connected && isMonitoring ? 'active' : enabled ? 'warning' : 'muted',
      count: tasks.length,
      metrics: [
        tasks.length > 0 ? `已配置 ${tasks.length} 条任务` : '暂无定时任务',
        tasks.length > 0 ? `最近规则 ${cronToNatural(firstTask.Cron)}` : '前往详情页添加执行规则',
      ],
      hints: tasks.length > 0 ? [`下次预计 ${formatRelativeTime(nextRun)}`] : undefined,
    };
  }

  if (group.title === '内容过滤') {
    const enabled = Boolean(config.DanmuFilterEnable);
    const totalFilters = getConfiguredFilterCount(config);
    return {
      status: !enabled ? '已关闭' : totalFilters === 0 ? '待补规则' : !connected ? '待连接直播间' : !isMonitoring ? '待启动监听' : '运行中',
      tone: enabled && totalFilters > 0 && connected && isMonitoring ? 'active' : enabled ? 'warning' : 'muted',
      count: totalFilters,
      metrics: [
        `规则 ${totalFilters} 条`,
        `UID ${config.PermanentBlacklistUsers.length} / 昵称 ${config.PermanentBlacklistNames.length} / 关键词 ${config.DanmuFilterWords.length}`,
      ],
      hints: enabled && totalFilters === 0 ? ['已开启过滤，但还没有任何过滤规则'] : undefined,
    };
  }

  const enabled = group.mainKey ? Boolean(config[group.mainKey]) : getEnabledSubCount(config, group.subs) > 0;
  return {
    status: enabled ? '运行中' : '未启用',
    tone: enabled ? 'active' : 'muted',
    metrics: [],
    count: baseCount,
  };
}

function StatusPill({ tone, text }: { tone: StatusTone; text: string }) {
  const classes =
    tone === 'active'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
      : tone === 'warning'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
      : 'bg-black/5 dark:bg-white/5 text-gray-500 dark:text-gray-400 border-black/8 dark:border-white/8';

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black leading-none ${classes}`}>
      {text}
    </span>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { config, updateConfig } = useConfig();
  const { connected } = useRoom();
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [sessionValues, setSessionValues] = useState<Record<string, boolean>>(() => ({
    danmuAnnounce: sessionStorage.getItem('danmuAnnounce') === 'true',
  }));

  const updateSessionValue = (key: string, value: boolean) => {
    sessionStorage.setItem(key, String(value));
    setSessionValues(prev => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    refreshStats();
    const interval = setInterval(refreshStats, 5000);

    let unlistenStats: (() => void) | undefined;
    const setup = async () => {
      try {
        unlistenStats = await api.onSessionSummary((summary) => {
          setStats(summary);
        });
      } catch (err) {
        console.error('Failed to setup monitor listeners:', err);
      }
    };
    setup();

    return () => {
      unlistenStats?.();
      clearInterval(interval);
    };
  }, []);

  const refreshStats = async () => {
    try {
      const monitoring = await api.getMonitorStatus();
      setIsMonitoring(monitoring);
      if (monitoring) setStats(await api.getStats(-1));
    } catch {
      // silent
    }
  };

  const toggleAuto = async (key: keyof AppConfig, value: boolean) => {
    if (!config) return;
    try {
      await updateConfig({ [key]: value } as Partial<AppConfig>);
    } catch (err) {
      toast.error(`更新失败: ${err}`);
    }
  };

  const toggleGroupSub = async (group: AutoGroup, sub: SubToggle, value: boolean) => {
    if (sub.sessionKey != null) {
      updateSessionValue(sub.sessionKey, value);
      return;
    }

    await toggleAuto(sub.key!, value);
  };

  const statItems = [
    { label: '本场弹幕', value: stats?.danmu_count || 0, icon: MessageSquare, color: '#4b8eff' },
    { label: '进场人数', value: stats?.entry_count || 0, icon: Users, color: '#34c759' },
    { label: '新增关注', value: stats?.follow_count || 0, icon: Star, color: '#af52de' },
    { label: '礼物总值', value: stats?.gift_value || 0, sub: '电池', icon: Gift, color: '#ff9500' },
    { label: '互动数', value: stats?.interact_count || 0, icon: Users, color: '#ff2d55' },
    { label: '人气峰值', value: stats?.peak_popularity || 0, icon: TrendingUp, color: '#007aff' },
  ];

  const enabledCount = config
    ? ALL_TOGGLE_KEYS.filter((key) => Boolean(config[key])).length
    : 0;

  const automationSummary = useMemo(() => {
    if (!config) return null;

    const enabledBots = getEnabledAiBots(config).length;
    const activeTimedTasks = config.CronDanmu ? config.CronDanmuList?.length ?? 0 : 0;
    const nextTaskCron = config.CronDanmuList?.[0]?.Cron;
    const nextTaskRun = nextTaskCron ? getNextCronRun(nextTaskCron) : null;
    const blockedCount = [
      config.GeneralWelcomeEnabled,
      config.ThanksFocus || config.ThanksShare || config.ThanksGift || config.GiftSummaryThanks || config.ThanksGiftUseAt,
      config.EntryEffect || config.PkNotice || config.ShowBlockMsg,
      config.TtsEnabled,
      config.CronDanmu && (config.CronDanmuList?.length ?? 0) > 0,
      config.DanmuFilterEnable && getConfiguredFilterCount(config) > 0,
    ].filter(Boolean).length > 0 && (!connected || !isMonitoring);

    return [
      {
        label: '直播间连接',
        value: connected ? '已连接' : '未连接',
        hint: connected ? '自动化具备执行前提' : '多数自动化仍在等待连接',
        icon: CheckCircle2,
        tone: connected ? 'active' : 'warning',
      },
      {
        label: '监听状态',
        value: isMonitoring ? '运行中' : '未启动',
        hint: isMonitoring ? '实时事件会立即进入自动化链路' : '已启用规则暂不会触发',
        icon: Radio,
        tone: isMonitoring ? 'active' : 'warning',
      },
      {
        label: '自动化覆盖',
        value: `${enabledCount}/${ALL_TOGGLE_KEYS.length}`,
        hint: `${enabledBots} 个 AI 机器人，${getConfiguredFilterCount(config)} 条过滤规则`,
        icon: Bot,
        tone: enabledCount > 0 ? 'active' : 'muted',
      },
      {
        label: '定时任务',
        value: activeTimedTasks > 0 ? `${activeTimedTasks} 条` : '暂无',
        hint: activeTimedTasks > 0 ? `下次 ${formatRelativeTime(nextTaskRun)}` : '添加后可自动定时发言',
        icon: TimerReset,
        tone: activeTimedTasks > 0 && connected && isMonitoring ? 'active' : activeTimedTasks > 0 || blockedCount ? 'warning' : 'muted',
      },
    ];
  }, [config, connected, isMonitoring, enabledCount]);

  const GroupCard = ({ g }: { g: AutoGroup }) => {
    if (!config) return null;

    const { title, Icon, mainKey, mainSessionKey, subs, to, aiCard } = g;
    const mainChecked = mainSessionKey != null
      ? (sessionValues[mainSessionKey] ?? false)
      : mainKey != null
      ? Boolean(config[mainKey])
      : undefined;
    const meta = getGroupMeta(g, config, { connected, isMonitoring, sessionValues });
    return (
      <GlassCard hoverable className="p-4 border-white/60 dark:border-white/10 overflow-hidden">
        <div
          className="absolute -top-8 -right-8 w-28 h-28 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(var(--primary-rgb),0.10) 0%, transparent 70%)' }}
        />

        <div className={`flex items-center justify-between ${subs.length > 0 || meta.metrics.length > 0 || meta.hints?.length ? 'mb-4' : ''}`}>
          <div className="min-w-0 flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center shadow-sm shrink-0"
              style={{ background: 'rgba(var(--primary-rgb), 0.12)', color: 'var(--primary-color)' }}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold tracking-tight">{title}</span>
                {typeof meta.count === 'number' && meta.count > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-[var(--primary-color)]/10 text-[var(--primary-color)] border border-[var(--primary-color)]/20 leading-none">
                    {meta.count}
                  </span>
                )}
              </div>
              <div className="mt-1">
                <StatusPill tone={meta.tone} text={meta.status} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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
              <Toggle
                checked={mainChecked}
                onChange={(v) => mainSessionKey != null
                  ? updateSessionValue(mainSessionKey, v)
                  : toggleAuto(mainKey!, v)}
              />
            )}
          </div>
        </div>

        {(meta.metrics.length > 0 || meta.hints?.length) && (
          <div className="pt-3 border-t border-black/5 dark:border-white/5 space-y-2.5">
            {meta.metrics.map((metric) => (
              <div key={metric} className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
                {metric}
              </div>
            ))}

            {meta.hints?.map((hint) => (
              <div
                key={hint}
                className="flex items-start gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium"
              >
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{hint}</span>
              </div>
            ))}
          </div>
        )}

        {subs.length > 0 && (
          <div className="pt-3 mt-3 border-t border-black/5 dark:border-white/5 space-y-2.5">
            {subs.map((sub) => (
              <div key={sub.key ?? sub.sessionKey} className="flex items-center justify-between">
                <span className="text-[12px] text-gray-500 dark:text-gray-400 font-medium">{sub.label}</span>
                <Toggle
                  checked={sub.sessionKey != null ? (sessionValues[sub.sessionKey] ?? false) : Boolean(config[sub.key!])}
                  onChange={(v) => toggleGroupSub(g, sub, v)}
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
      <div className="grid grid-cols-3 gap-4">
        {statItems.map((stat, i) => (
          <GlassCard key={i} hoverable className="p-5 relative border-white/60 dark:border-white/10">
            <div
              className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full"
              style={{ background: stat.color, boxShadow: `0 0 8px ${stat.color}` }}
            />
            <div className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-2">{stat.label}</div>
            <div className="text-[24px] font-black tracking-tight leading-none mb-1"><CountUp value={stat.value} /></div>
            <div className="text-[10px] text-gray-400 font-bold">{stat.sub || '本场'}</div>
          </GlassCard>
        ))}
      </div>

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

        {automationSummary && (
          <div className="grid grid-cols-4 gap-3">
            {automationSummary.map((item) => {
              const Icon = item.icon;
              const toneClass =
                item.tone === 'active'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : item.tone === 'warning'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-500 dark:text-gray-400';

              return (
                <GlassCard key={item.label} className="p-4 border-white/50 dark:border-white/10">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{item.label}</div>
                      <div className="mt-2 text-[18px] font-black tracking-tight">{item.value}</div>
                      <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400 leading-4">{item.hint}</div>
                    </div>
                    <Icon className={`h-4 w-4 shrink-0 ${toneClass}`} />
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )}

        {!isMonitoring && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/8 border border-amber-500/20 text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[11px] font-bold">监听未启动，已启用自动化会在开启监听后开始工作</span>
          </div>
        )}

        {!connected && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-500/8 border border-sky-500/20 text-sky-600 dark:text-sky-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[11px] font-bold">直播间尚未连接，欢迎、感谢、过滤、定时任务等能力都在等待房间上下文</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {config && AUTO_GROUPS.map((group) => <GroupCard key={group.title} g={group} />)}
        </div>
      </div>
    </div>
  );
}
