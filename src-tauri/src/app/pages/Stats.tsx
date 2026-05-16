import React, { useState, useEffect, useRef } from 'react';
import { Download, TrendingUp, TrendingDown, Wallet, Medal } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { api, UserGiftStat } from '../lib/api';

// ─── Donut Chart ─────────────────────────────────────────────────────────────

interface DonutSlice { label: string; value: number; color: string }

function DonutChart({ slices, total }: { slices: DonutSlice[]; total: number }) {
  const r = 52;
  const strokeWidth = 20;
  const circ = 2 * Math.PI * r;
  const [hovered, setHovered] = useState<number | null>(null);

  if (total === 0) {
    return (
      <div className="flex items-center justify-center w-full h-[160px] text-[11px] text-gray-400 italic">
        暂无数据
      </div>
    );
  }

  let offset = 0;
  const segments = slices.map((s, i) => {
    const pct = s.value / total;
    const seg = { ...s, pct, offset, i };
    offset += pct;
    return seg;
  });

  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0 w-[140px] h-[140px]">
        <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
          <circle cx="80" cy="80" r={r} fill="none" stroke="currentColor"
            strokeWidth={strokeWidth} className="text-black/5 dark:text-white/5" />
          {segments.map((seg) => (
            <circle
              key={seg.i}
              cx="80" cy="80" r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={hovered === seg.i ? strokeWidth + 4 : strokeWidth}
              strokeDasharray={`${seg.pct * circ} ${circ}`}
              strokeDashoffset={-seg.offset * circ}
              strokeLinecap="butt"
              style={{ opacity: hovered === null || hovered === seg.i ? 0.85 : 0.35, transition: 'all 0.2s' }}
              onMouseEnter={() => setHovered(seg.i)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[15px] font-black text-gray-700 dark:text-gray-200">
            {hovered !== null ? slices[hovered].value.toLocaleString() : total.toLocaleString()}
          </span>
          <span className="text-[9px] text-gray-400 font-bold mt-0.5">
            {hovered !== null ? slices[hovered].label : '总互动'}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2 min-w-0">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{ opacity: hovered === null || hovered === i ? 1 : 0.4, transition: 'opacity 0.15s', cursor: 'default' }}
          >
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-gray-600 dark:text-gray-300 font-bold">{s.label}</span>
            <span className="text-gray-400 ml-auto pl-3 font-mono">{s.value.toLocaleString()}</span>
            <span className="text-gray-300 w-10 text-right font-bold text-[10px]">
              {total > 0 ? `${((s.value / total) * 100).toFixed(1)}%` : '-'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Trend Chart ─────────────────────────────────────────────────────────────

type DailyStats = { date: string; danmu_count: number; entry_count: number; gift_count: number; follow_count: number };

type TrendMetric = { key: keyof DailyStats; label: string; color: string };

const TREND_METRICS: TrendMetric[] = [
  { key: 'danmu_count',  label: '弹幕', color: '#6366f1' },
  { key: 'entry_count',  label: '进场', color: '#22c55e' },
  { key: 'gift_count',   label: '礼物', color: '#f59e0b' },
  { key: 'follow_count', label: '关注', color: '#a855f7' },
];

function TrendChart({ data }: { data: DailyStats[] }) {
  const [active, setActive] = useState<Set<string>>(new Set(['danmu_count', 'entry_count']));
  const [tooltip, setTooltip] = useState<{ x: number; y: number; idx: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-gray-400 italic">
        暂无每日数据
      </div>
    );
  }

  const W = 500, H = 120, PAD_LEFT = 30, PAD_BOTTOM = 20, PAD_TOP = 8;
  const chartW = W - PAD_LEFT;
  const chartH = H - PAD_BOTTOM - PAD_TOP;

  const activeMetrics = TREND_METRICS.filter(m => active.has(m.key));
  const maxVal = Math.max(...data.flatMap(d => activeMetrics.map(m => d[m.key] as number)), 1);

  const xScale = (i: number) => PAD_LEFT + (i / Math.max(data.length - 1, 1)) * chartW;
  const yScale = (v: number) => PAD_TOP + chartH - (v / maxVal) * chartH;

  const toggleMetric = (key: string) => {
    setActive(prev => {
      const next = new Set(prev);
      if (next.has(key) && next.size === 1) return next;
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div>
      {/* Metric toggles */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {TREND_METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => toggleMetric(m.key)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all"
            style={{
              background: active.has(m.key) ? `${m.color}20` : 'transparent',
              borderColor: active.has(m.key) ? `${m.color}60` : 'rgba(0,0,0,0.1)',
              color: active.has(m.key) ? m.color : '#9ca3af',
            }}
          >
            <div className="w-2 h-2 rounded-full" style={{ background: active.has(m.key) ? m.color : '#d1d5db' }} />
            {m.label}
          </button>
        ))}
      </div>

      {/* SVG Chart */}
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 160 }}
          onMouseLeave={() => setTooltip(null)}
          onMouseMove={(e) => {
            if (!svgRef.current) return;
            const rect = svgRef.current.getBoundingClientRect();
            const xRatio = (e.clientX - rect.left) / rect.width;
            const xPx = xRatio * W;
            const nearest = Math.round(((xPx - PAD_LEFT) / chartW) * (data.length - 1));
            const idx = Math.max(0, Math.min(data.length - 1, nearest));
            setTooltip({ x: xScale(idx), y: 0, idx });
          }}
        >
          <defs>
            {activeMetrics.map(m => (
              <linearGradient key={m.key} id={`grad-${m.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={m.color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={m.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>

          {/* Y-axis grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => {
            const y = yScale(maxVal * pct);
            return (
              <g key={pct}>
                <line x1={PAD_LEFT} y1={y} x2={W} y2={y}
                  stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
                <text x={PAD_LEFT - 4} y={y + 3.5} textAnchor="end"
                  fill="currentColor" fillOpacity="0.3" fontSize="8">
                  {Math.round(maxVal * pct)}
                </text>
              </g>
            );
          })}

          {/* Area + Line per metric */}
          {activeMetrics.map(m => {
            const pts = data.map((d, i) => ({ x: xScale(i), y: yScale(d[m.key] as number) }));
            const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
            const areaPath = `${linePath} L${pts[pts.length - 1].x},${yScale(0)} L${pts[0].x},${yScale(0)} Z`;
            return (
              <g key={m.key}>
                <path d={areaPath} fill={`url(#grad-${m.key})`} />
                <path d={linePath} fill="none" stroke={m.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={tooltip?.idx === i ? 4 : 2}
                    fill={m.color} opacity={tooltip?.idx === i ? 1 : 0.5}
                    style={{ transition: 'r 0.1s' }} />
                ))}
              </g>
            );
          })}

          {/* Tooltip vertical line */}
          {tooltip && (
            <line x1={tooltip.x} y1={PAD_TOP} x2={tooltip.x} y2={H - PAD_BOTTOM}
              stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="3 2" />
          )}

          {/* X-axis labels */}
          {data.map((d, i) => {
            if (data.length > 14 && i % 3 !== 0) return null;
            if (data.length > 7 && data.length <= 14 && i % 2 !== 0) return null;
            return (
              <text key={i} x={xScale(i)} y={H - 4} textAnchor="middle"
                fill="currentColor" fillOpacity="0.35" fontSize="8">
                {d.date.slice(5)}
              </text>
            );
          })}
        </svg>

        {/* Floating tooltip */}
        {tooltip !== null && (
          <div
            className="absolute top-0 pointer-events-none z-10 bg-black/80 backdrop-blur-sm text-white rounded-lg px-3 py-2 text-[10px] shadow-xl border border-white/10"
            style={{ left: `${(tooltip.x / W) * 100}%`, transform: 'translateX(-50%)' }}
          >
            <div className="font-bold mb-1">{data[tooltip.idx].date}</div>
            {activeMetrics.map(m => (
              <div key={m.key} className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />
                <span style={{ color: m.color }}>{m.label}</span>
                <span className="ml-1 font-mono">{(data[tooltip.idx][m.key] as number).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Stats() {
  const [period, setPeriod] = useState('0');
  const [summary, setSummary] = useState<any>(null);
  const [giftStats, setGiftStats] = useState<any[]>([]);
  const [userGiftStats, setUserGiftStats] = useState<UserGiftStat[]>([]);
  const [blindBoxHistory, setBlindBoxHistory] = useState<[string, number][]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadStats();
  }, [period]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const days = parseInt(period);
      const [s, g, u, b, d] = await Promise.all([
        api.getStats(days),
        api.getGiftStats(days, 5),
        api.getUserGiftStats(days, 5),
        api.getBlindBoxStats(days === -1 ? 0 : days),
        api.getDailyStats(days),
      ]);
      setSummary(s);
      setGiftStats(g);
      setUserGiftStats(u);
      setBlindBoxHistory(b);
      setDailyStats(d);
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const periodLabel = { '-1': '本场', '0': '今日', '7': '近7天', '30': '近30天' }[period] ?? period;
    const rows: string[][] = [
      ['指标', '数值'],
      ['弹幕总数', String(summary?.danmu_count ?? 0)],
      ['进场人数', String(summary?.entry_count ?? 0)],
      ['新增关注', String(summary?.follow_count ?? 0)],
      ['礼物总值(电池)', String(summary?.gift_value ?? 0)],
      ['互动数', String(summary?.interact_count ?? 0)],
      ['最高人气', String(summary?.peak_popularity ?? 0)],
      [],
      ['礼物名', '数量', '电池价值'],
      ...giftStats.map(g => [g.name, String(g.count), String(g.value)]),
      [],
      ['排名', '用户名', 'UID', '礼物数', '礼物价值(电池)'],
      ...userGiftStats.map((u, i) => [String(i + 1), u.uname, String(u.uid), String(u.gift_count), String(u.gift_value)]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `直播数据_${periodLabel}_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statItems = [
    { label: '弹幕总数', value: summary?.danmu_count || 0 },
    { label: '进场', value: summary?.entry_count || 0 },
    { label: '新增关注', value: summary?.follow_count || 0 },
    { label: '礼物总值', value: summary?.gift_value || 0, sub: '电池' },
    { label: '互动数', value: summary?.interact_count || 0 },
    { label: '最高人气', value: summary?.peak_popularity || 0 },
  ];

  const donutTotal = (summary?.danmu_count || 0) + (summary?.entry_count || 0)
    + (summary?.follow_count || 0) + (summary?.share_count || 0) + (summary?.guard_buy_count || 0);
  const donutSlices: DonutSlice[] = [
    { label: '弹幕', value: summary?.danmu_count || 0, color: '#6366f1' },
    { label: '进场', value: summary?.entry_count || 0, color: '#22c55e' },
    { label: '关注/分享', value: (summary?.follow_count || 0) + (summary?.share_count || 0), color: '#a855f7' },
    { label: '大航海', value: summary?.guard_buy_count || 0, color: '#f59e0b' },
  ];

  const showTrend = parseInt(period) >= 7;

  return (
    <div className="p-[18px] space-y-3.5">
      {/* Period selector + export */}
      <div className="flex items-center justify-between">
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
        <button
          onClick={exportCsv}
          disabled={loading || !summary}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold bg-white/40 dark:bg-white/10 hover:bg-white/60 dark:hover:bg-white/20 transition-colors disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" />
          导出 CSV
        </button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3.5">
        {statItems.map((stat, i) => (
          <GlassCard key={i} className="p-4 relative overflow-hidden">
            {loading && <div className="absolute inset-0 bg-white/60 dark:bg-black/20 animate-pulse rounded-inherit" />}
            <div className="text-[11px] text-gray-500 dark:text-gray-400 font-semibold tracking-wide mb-1">
              {stat.label}
            </div>
            <div className="text-[19px] font-bold mb-1">{stat.value.toLocaleString()}</div>
            <div className="text-[10px] text-gray-500">{stat.sub || '统计期内'}</div>
          </GlassCard>
        ))}
      </div>

      {/* Donut + Trend row */}
      <div className={`grid gap-4 ${showTrend ? 'grid-cols-1 md:grid-cols-[auto_1fr]' : 'grid-cols-1'}`}>
        {/* Interaction breakdown donut */}
        <GlassCard className="p-5">
          <h2 className="text-[12px] font-semibold mb-4">互动类型分布</h2>
          <DonutChart slices={donutSlices} total={donutTotal} />
        </GlassCard>

        {/* Trend chart — only shown for 7/30 day periods */}
        {showTrend && (
          <GlassCard className="p-5">
            <h2 className="text-[12px] font-semibold mb-4">每日互动趋势</h2>
            <TrendChart data={dailyStats} />
          </GlassCard>
        )}
      </div>

      {/* Gift top 5 + User ranking */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        <GlassCard className="p-5">
          <h2 className="text-[12px] font-semibold mb-4">观众贡献排行 TOP 5</h2>
          <div className="space-y-4">
            {userGiftStats.length > 0 ? userGiftStats.map((user, i) => (
              <div key={user.uid} className="space-y-1">
                <div className="flex justify-between text-[11px] items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-gray-400 w-4">#{i + 1}</span>
                    <div className="flex flex-col">
                      <span className="font-bold truncate max-w-[110px]" title={user.uname}>{user.uname}</span>
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

      {/* Blind Box Stats */}
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
            blindBoxHistory.map(([day, val]) => {
              const max = Math.max(...blindBoxHistory.map(h => Math.abs(h[1])), 1);
              const height = (Math.abs(val) / max) * 100;
              return (
                <div key={day} className="flex-1 flex flex-col items-center group relative">
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap">
                    {day}: {val > 0 ? '+' : ''}{val}
                  </div>
                  <div className="w-full flex flex-col items-center justify-center h-[160px] relative">
                    <div className="absolute w-full h-px bg-gray-200 dark:bg-white/10 top-1/2" />
                    {val >= 0 ? (
                      <div className="w-full max-w-[32px] bg-green-500/60 hover:bg-green-500 rounded-t-sm transition-all"
                        style={{ height: `${height / 2}%`, marginBottom: '80px' }} />
                    ) : (
                      <div className="w-full max-w-[32px] bg-red-500/60 hover:bg-red-500 rounded-b-sm transition-all"
                        style={{ height: `${height / 2}%`, marginTop: '80px' }} />
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
