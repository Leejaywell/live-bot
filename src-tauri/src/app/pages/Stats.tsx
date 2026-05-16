import React, { useState, useEffect } from 'react';
import { GlassCard } from '../components/GlassCard';
import { api, UserGiftStat } from '../lib/api';
import { TrendingUp, TrendingDown, Wallet, Medal } from 'lucide-react';

export function Stats() {
  const [period, setPeriod] = useState('0'); // 0 for today
  const [summary, setSummary] = useState<any>(null);
  const [giftStats, setGiftStats] = useState<any[]>([]);
  const [userGiftStats, setUserGiftStats] = useState<UserGiftStat[]>([]);
  const [blindBoxHistory, setBlindBoxHistory] = useState<[string, number][]>([]);

  useEffect(() => {
    loadStats();
  }, [period]);

  const loadStats = async () => {
    try {
      const days = parseInt(period);
      const [s, g, u, b] = await Promise.all([
        api.getStats(days),
        api.getGiftStats(days, 5),
        api.getUserGiftStats(days, 5),
        api.getBlindBoxStats(days === -1 ? 0 : days),
      ]);
      setSummary(s);
      setGiftStats(g);
      setUserGiftStats(u);
      setBlindBoxHistory(b);
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
          <h2 className="text-[12px] font-semibold mb-4">观众贡献排行 TOP 5</h2>
          <div className="space-y-4">
            {userGiftStats.length > 0 ? userGiftStats.map((user, i) => (
              <div key={user.uid} className="space-y-1">
                <div className="flex justify-between text-[11px] items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-gray-400 w-4">#{i + 1}</span>
                    <div className="flex flex-col">
                      <span className="font-bold truncate max-w-[110px]">{user.uname}</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {user.wealth_level && user.wealth_level > 0 && (
                          <span className="px-1 py-0.5 rounded-[4px] bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[8px] font-black border border-amber-200 dark:border-amber-500/30 flex items-center gap-0.5">
                            <Wallet className="w-2 h-2" />
                            {user.wealth_level}
                          </span>
                        )}
                        {user.medal_name && (
                          <span className="px-1 py-0.5 rounded-[4px] bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-[8px] font-black border border-blue-200 dark:border-blue-500/30 flex items-center gap-0.5">
                            <Medal className="w-2 h-2" />
                            {user.medal_name}{user.medal_level}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200">{user.gift_value} 电池</div>
                    <div className="text-[9px] text-gray-400">{user.gift_count} 个礼物</div>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mt-1">
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

      {/* Blind Box Stats Chart */}
      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-[12px] font-semibold">盲盒盈亏统计</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">按天统计盲盒礼物的产出价值与成本差额</p>
          </div>
          {blindBoxHistory.length > 0 && (
            <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold ${
              blindBoxHistory.reduce((a, b) => a + b[1], 0) >= 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
            }`}>
              {blindBoxHistory.reduce((a, b) => a + b[1], 0) >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              总计: {blindBoxHistory.reduce((a, b) => a + b[1], 0).toLocaleString()} 电池
            </div>
          )}
        </div>
        
        <div className="h-[200px] flex items-end gap-2 px-2">
          {blindBoxHistory.length > 0 ? (
            blindBoxHistory.map(([day, val], i) => {
              const max = Math.max(...blindBoxHistory.map(h => Math.abs(h[1])), 1);
              const height = (Math.abs(val) / max) * 100;
              return (
                <div key={day} className="flex-1 flex flex-col items-center group relative">
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap">
                    {day}: {val > 0 ? '+' : ''}{val}
                  </div>
                  <div className="w-full flex flex-col items-center justify-center h-[160px] relative">
                    {/* Zero line */}
                    <div className="absolute w-full h-px bg-gray-200 dark:bg-white/10 top-1/2" />
                    
                    {val >= 0 ? (
                      <div 
                        className="w-full max-w-[32px] bg-green-500/60 hover:bg-green-500 rounded-t-sm transition-all"
                        style={{ height: `${height / 2}%`, marginBottom: '80px' }}
                      />
                    ) : (
                      <div 
                        className="w-full max-w-[32px] bg-red-500/60 hover:bg-red-500 rounded-b-sm transition-all"
                        style={{ height: `${height / 2}%`, marginTop: '80px' }}
                      />
                    )}
                  </div>
                  <span className="text-[8px] text-gray-400 mt-2 rotate-45 origin-left truncate w-8">{day.slice(5)}</span>
                </div>
              );
            })
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-[11px] italic opacity-50">
              统计期内无盲盒数据
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
