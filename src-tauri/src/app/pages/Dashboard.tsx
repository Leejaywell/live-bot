import { Play, MessageSquare, Gift, Users, Star, TrendingUp, StopCircle } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Toggle } from '../components/Toggle';
import { useState, useEffect } from 'react';
import { api, AppConfig } from '../lib/api';
import { toast } from 'sonner';

export function Dashboard() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    loadData();
    const interval = setInterval(refreshStats, 5000);
    
    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      unlisten = await api.onMonitorLog((log) => {
        setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: log }].slice(-6));
      });
    };
    setupListener();

    return () => {
      clearInterval(interval);
      if (unlisten) unlisten();
    };
  }, []);

  const loadData = async () => {
    try {
      const [c, m] = await Promise.all([
        api.loadConfig(),
        api.getMonitorStatus(),
      ]);
      setConfig(c);
      setIsMonitoring(m);
      refreshStats();
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  };

  const refreshStats = async () => {
    try {
      const isM = await api.getMonitorStatus();
      setIsMonitoring(isM);
      if (isM) {
        const s = await api.getStats(-1);
        setStats(s);
      }
    } catch (err) {
      // Don't toast on background refresh
    }
  };

  const toggleMonitor = async () => {
    try {
      if (isMonitoring) {
        await api.stopMonitor();
        setIsMonitoring(false);
        toast.success('已停止监听');
      } else {
        await api.startMonitor();
        setIsMonitoring(true);
        toast.success('已开始监听');
      }
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const toggleAuto = async (key: keyof AppConfig, value: boolean) => {
    if (!config) return;
    try {
      const newConfig = { ...config, [key]: value };
      await api.saveConfig(newConfig);
      setConfig(newConfig);
      toast.success('配置已更新');
    } catch (err) {
      toast.error(`更新失败: ${err}`);
    }
  };

  const statItems = [
    { label: '本场弹幕', value: stats?.danmu_count || 0, icon: MessageSquare },
    { label: '进场人数', value: stats?.entry_count || 0, icon: Users },
    { label: '新增关注', value: stats?.follow_count || 0, icon: Star },
    { label: '礼物总值', value: stats?.gift_value || 0, sub: '电池', icon: Gift },
    { label: '互动数', value: stats?.interact_count || 0, icon: Users },
    { label: '人气峰值', value: stats?.peak_popularity || 0, icon: TrendingUp },
  ];

  const autoCards = [
    { icon: Users, title: '自动欢迎', desc: '新观众进入直播间时发送欢迎语', key: 'WelcomeSwitch' },
    { icon: MessageSquare, title: '关键词回复', desc: '弹幕命中关键词自动回复', key: 'KeywordReply' },
    { icon: Gift, title: '礼物答谢', desc: '收到礼物自动答谢，支持聚合', key: 'ThanksGift' },
    { icon: MessageSquare, title: '新用户提醒', desc: '欢迎新进直播间的朋友', key: 'NewcomerDanmuEnable' },
    { icon: TrendingUp, title: '抽签', desc: '弹幕发起抽签，自动随机结果', key: 'DrawByLot' },
    { icon: MessageSquare, title: '弹幕过滤', desc: '屏蔽敏感词、刷屏、风险弹幕', key: 'DanmuFilterEnable' },
  ];

  return (
    <div className="p-[18px] space-y-3.5">
      <div className="flex items-center justify-between">
        <h1 className="text-[17px] font-bold">
          {isMonitoring ? `正在监听房间: ${config?.RoomId}` : '欢迎使用花花直播姬'}
        </h1>
        <div className={`flex items-center gap-2 text-[12px] ${isMonitoring ? 'text-green-500' : 'text-gray-400'}`}>
          <div className={`w-2 h-2 rounded-full ${isMonitoring ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          {isMonitoring ? '监听中' : '已停止'}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3.5">
        {statItems.map((stat, i) => (
          <GlassCard key={i} className="p-4 relative">
            {isMonitoring && <div className="absolute top-0 right-3 w-2 h-2 rounded-full" style={{ background: 'var(--primary-color)', boxShadow: '0 0 8px var(--primary-color)' }} />}
            <div className="text-[11px] text-gray-500 dark:text-gray-400 font-semibold tracking-wide mb-1">
              {stat.label}
            </div>
            <div className="text-[19px] font-bold mb-1">{stat.value.toLocaleString()}</div>
            <div className="text-[10px] text-gray-500">
              {stat.sub || '本场'}
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant={isMonitoring ? 'default' : 'primary'} onClick={toggleMonitor}>
          {isMonitoring ? (
            <>
              <StopCircle className="w-3.5 h-3.5 mr-1" />
              停止监听
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 mr-1" />
              开始监听
            </>
          )}
        </Button>
        <Button onClick={loadData}>刷新数据</Button>
      </div>

      <div>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-[11px] font-bold text-gray-500 tracking-wider">自动化功能</h2>
          <div className="flex-1 h-px bg-gradient-to-r from-gray-300 dark:from-gray-700 to-transparent" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {autoCards.map((card, i) => {
            const Icon = card.icon;
            const checked = config ? !!(config as any)[card.key] : false;
            return (
              <GlassCard key={i} className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white"
                    style={{ background: `radial-gradient(circle, var(--primary-color), color-mix(in srgb, var(--primary-color) 80%, black))` }}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <Toggle
                    checked={checked}
                    onChange={(checked) => toggleAuto(card.key as any, checked)}
                  />
                </div>
                <div className="text-[12px] font-semibold mb-1">{card.title}</div>
                <div className="text-[10px] text-gray-500">{card.desc}</div>
              </GlassCard>
            );
          })}
        </div>
      </div>

      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[12px] font-semibold">实时日志</h2>
          <button className="text-[10px] text-gray-500 hover:text-gray-700" onClick={() => setLogs([])}>清空</button>
        </div>
        <div className="space-y-1 font-mono text-[11px] max-h-[120px] overflow-y-auto">
          {logs.map((log, i) => (
            <div key={i} className="text-gray-700 dark:text-gray-300">
              [{log.time}] {log.msg}
            </div>
          ))}
          {logs.length === 0 && <div className="text-gray-400 italic">暂无日志...</div>}
        </div>
      </GlassCard>
    </div>
  );
}
