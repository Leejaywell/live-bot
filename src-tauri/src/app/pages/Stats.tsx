import React, { useState, useEffect } from 'react';
import { GlassCard } from '../components/GlassCard';
import { api, UserGiftStat } from '../lib/api';

export function Stats() {
  const [period, setPeriod] = useState('0'); // 0 for today
  const [summary, setSummary] = useState<any>(null);
  const [giftStats, setGiftStats] = useState<any[]>([]);
  const [userGiftStats, setUserGiftStats] = useState<UserGiftStat[]>([]);

  useEffect(() => {
    loadStats();
  }, [period]);

  const loadStats = async () => {
    try {
      const days = parseInt(period);
      const [s, g, u] = await Promise.all([
        api.getStats(days),
        api.getGiftStats(days, 5),
        api.getUserGiftStats(days, 5),
      ]);
      setSummary(s);
      setGiftStats(g);
      setUserGiftStats(u);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const statItems = [
    { label: '弹幕总数', value: summary?.danmu_count || 0 },
    { label: '进场', value: summary?.entry_count || 0 },
    { label: '新增关注', value: summary?.follow_count || 0 },
    { label: '礼物总值', value: summary?.gift_value || 0, sub: '电池' },
    { label: '互动数', value: summary?.interact_count || 0 },
    { label: '最高人气', value: summary?.peak_popularity || 0 },
  ];

  return (
    <div className="p-[18px] space-y-3.5">
      <div className="flex gap-2">
        {[
          { id: '-1', label: '本场' },
          { id: '0', label: '今日' },
          { id: '7', label: '近 7 天' },
          { id: '30', label: '近 30 天' },
        ].map(p => (
          <button
            key={p.id}
            className={`px-4 py-1.5 rounded-full text-[11px] transition-colors ${
              period === p.id ? 'bg-[var(--primary-color)] text-white' : 'bg-white/40 dark:bg-white/10 hover:bg-white/60 dark:hover:bg-white/20'
            }`}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3.5">
        {statItems.map((stat, i) => (
          <GlassCard key={i} className="p-4 relative">
            <div className="text-[11px] text-gray-500 dark:text-gray-400 font-semibold tracking-wide mb-1">
              {stat.label}
            </div>
            <div className="text-[19px] font-bold mb-1">{stat.value.toLocaleString()}</div>
            <div className="text-[10px] text-gray-500">
              {stat.sub || '统计期内'}
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Gift item top 5 */}
        <GlassCard className="p-5">
          <h2 className="text-[12px] font-semibold mb-4">礼物 TOP 5</h2>
          <div className="space-y-4">
            {giftStats.length > 0 ? giftStats.map((gift, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span>{gift.name}</span>
                  <span className="text-gray-500">{gift.count}个 · {gift.value}电池</span>
                </div>
                <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--primary-color)] opacity-80"
                    style={{ width: `${(gift.value / (giftStats[0].value || 1)) * 100}%` }}
                  />
                </div>
              </div>
            )) : (
              <div className="text-gray-400 text-center py-10 italic">暂无礼物数据</div>
            )}
          </div>
        </GlassCard>

        {/* User gift value ranking */}
        <GlassCard className="p-5">
          <h2 className="text-[12px] font-semibold mb-4">观众礼物排行 TOP 5</h2>
          <div className="space-y-4">
            {userGiftStats.length > 0 ? userGiftStats.map((user, i) => (
              <div key={user.uid} className="space-y-1">
                <div className="flex justify-between text-[11px] items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-gray-400 w-4">#{i + 1}</span>
                    <span className="font-medium truncate max-w-[110px]">{user.uname}</span>
                  </div>
                  <span className="text-gray-500 shrink-0">{user.gift_count}个 · {user.gift_value}电池</span>
                </div>
                <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--primary-color)] opacity-80"
                    style={{ width: `${(user.gift_value / (userGiftStats[0].gift_value || 1)) * 100}%` }}
                  />
                </div>
              </div>
            )) : (
              <div className="text-gray-400 text-center py-10 italic">暂无礼物数据</div>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
