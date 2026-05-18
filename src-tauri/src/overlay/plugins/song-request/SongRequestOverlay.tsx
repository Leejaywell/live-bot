import { EmptyState } from '../../components/EmptyState';
import { MarqueeText } from '../../components/MarqueeText';
import { OverlayRoute } from '../../runtime/types';
import { SongQueueItem } from './types';
import { useSongRequestData } from './useSongRequestData';

function itemText(item: SongQueueItem) {
  const artists = item.artistNames ? ` - ${item.artistNames}` : '';
  return `${item.songName || '未命名歌曲'}${artists}`;
}

function tierLabel(tier: string) {
  switch (tier) {
    case 'jump_queue':
      return '插队';
    case 'exclusive':
      return '专属';
    case 'playlist_takeover':
      return '包场';
    case 'priority':
      return '优先';
    default:
      return '普通';
  }
}

export function SongRequestOverlay({ route }: { route: OverlayRoute }) {
  const { queue, nowPlaying, rank, visual } = useSongRequestData(route.view as 'playlist' | 'now-playing' | 'rank');

  if (route.view === 'rank') {
    if (!rank.length) return <EmptyState title="暂无点歌排行" subtitle="送礼点歌后将在这里显示" />;
    return (
      <section className="song-card song-rank">
        <div className="song-kicker">点歌排行</div>
        {rank.slice(0, 8).map((item, index) => (
          <div className="song-rank-row" key={`${item.uname || 'user'}-${index}`}>
            <span>#{index + 1}</span>
            <MarqueeText>{item.uname || '观众'}</MarqueeText>
            <strong>{item.value || 0}</strong>
          </div>
        ))}
      </section>
    );
  }

  if (route.view === 'now-playing') {
    if (!nowPlaying) return <EmptyState title="暂无正在播放" subtitle="队列歌曲开始播放后将在这里显示" />;
    return (
      <section className="song-card song-now" data-tier={nowPlaying.tier} data-playing-changed={visual.playingChanged ? '1' : '0'}>
        <div className="song-disc" />
        <div className="song-main">
          <div className="song-kicker">当前播放 · {tierLabel(nowPlaying.tier)}</div>
          <MarqueeText className="song-title">{itemText(nowPlaying)}</MarqueeText>
          <div className="song-meta">{nowPlaying.uname || '观众'} 点播 · {nowPlaying.creditValue || 0} 电池</div>
        </div>
      </section>
    );
  }

  if (!queue.length) return <EmptyState title="今日第一首歌等待点亮" subtitle="送礼点歌后将在这里显示" />;

  const lead = nowPlaying || queue[0];
  const totalValue = queue.reduce((sum, item) => sum + (Number(item.creditValue) || 0), 0);

  return (
    <section className="song-card song-playlist" data-tier={lead.tier} data-high-tier={visual.highTierRequestId ? '1' : '0'}>
      <div className="song-main">
        <div className="song-kicker">本场点歌 {totalValue} 电池 · {tierLabel(lead.tier)}</div>
        <MarqueeText className="song-title">{itemText(lead)}</MarqueeText>
        <div className="song-meta">{lead.uname || '观众'} 点播 · {lead.status === 'playing' ? '播放中' : '排队中'}</div>
      </div>
      <ol className="song-queue">
        {queue.slice(0, 4).map((item, index) => (
          <li key={item.requestId} data-new={visual.newRequestIds.has(item.requestId) ? '1' : '0'} data-tier={item.tier}>
            <span>{index + 1}</span>
            <MarqueeText>{itemText(item)}</MarqueeText>
            <em>{tierLabel(item.tier)}</em>
          </li>
        ))}
      </ol>
    </section>
  );
}
