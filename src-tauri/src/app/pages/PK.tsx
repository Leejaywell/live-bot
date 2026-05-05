import { ExternalLink } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { Chip } from '../components/Chip';
import { IconButton } from '../components/IconButton';
import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export function PK() {
  const [summary, setSummary] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    loadPkData();
  }, []);

  const loadPkData = async () => {
    try {
      const [s, h] = await Promise.all([
        api.getPkSummary(),
        api.getPkHistory()
      ]);
      setSummary(s);
      setHistory(h);
    } catch (err) {
      console.error('Failed to load PK data:', err);
    }
  };

  const openRoom = (roomId?: number) => {
    if (roomId) {
      api.openUrl(`https://live.bilibili.com/${roomId}`);
    }
  };

  return (
    <div className="p-[18px] space-y-3.5">
      <GlassCard className="p-5 relative overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-400 to-purple-500" />
            <div>
              <div className="font-bold">当前房间</div>
            </div>
          </div>

          <div className="text-center">
            <Chip variant={summary?.current_opponent_room_id ? "danger" : "secondary"} className="mb-2">
              {summary?.current_opponent_room_id ? "PK 中" : "未在 PK"}
            </Chip>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-bold">{summary?.current_opponent_room_id ? `对手: ${summary.current_opponent_room_id}` : '暂无对手'}</div>
            </div>
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-cyan-500" />
            {summary?.current_opponent_room_id && (
              <IconButton onClick={() => openRoom(summary.current_opponent_room_id)}>
                <ExternalLink className="w-4 h-4" />
              </IconButton>
            )}
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[12px] font-semibold">PK 历史</h2>
            <span className="text-[10px] text-gray-500">本场共 {summary?.battle_count || 0} 次</span>
          </div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {history.length > 0 ? history.map((h, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/40 dark:bg-white/5">
                <span className="text-[11px] flex-1">对手: {h.match_room_id}</span>
                <Chip variant={h.winner_room_id ? (h.winner_room_id !== h.match_room_id ? 'success' : 'danger') : 'secondary'}>
                  {h.winner_room_id ? (h.winner_room_id !== h.match_room_id ? '胜' : '负') : '平/未知'}
                </Chip>
              </div>
            )) : (
              <div className="text-gray-400 text-center py-10 italic text-[11px]">暂无 PK 历史</div>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
