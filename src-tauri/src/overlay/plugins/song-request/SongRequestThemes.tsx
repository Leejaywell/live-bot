import { MarqueeText } from '../../components/MarqueeText';
import { RankResponse, SongQueueItem, SongRequestVisualState } from './types';

type SongRequestView = 'playlist' | 'now-playing' | 'rank';

export interface ThemeProps {
  view: SongRequestView;
  skin: string;
  queue: SongQueueItem[];
  nowPlaying: SongQueueItem | null;
  rank: RankResponse['items'];
  visual: SongRequestVisualState;
}

export function itemText(item: SongQueueItem) {
  const artists = item.artistNames ? ` - ${item.artistNames}` : '';
  return `${item.songName || '未命名歌曲'}${artists}`;
}

export function tierLabel(tier: string) {
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

function QueueList({ queue, visual }: Pick<ThemeProps, 'queue' | 'visual'>) {
  return (
    <ol className="song-queue">
      {queue.slice(0, 4).map((item, index) => (
        <li
          key={item.requestId}
          data-new={visual.newRequestIds.has(item.requestId) ? '1' : '0'}
          data-tier={item.tier}
        >
          <span>{index + 1}</span>
          <MarqueeText>{itemText(item)}</MarqueeText>
          <em>{tierLabel(item.tier)}</em>
        </li>
      ))}
    </ol>
  );
}

function RankList({ rank }: Pick<ThemeProps, 'rank'>) {
  return (
    <div className="song-rank-list">
      {rank.slice(0, 8).map((item, index) => (
        <div className="song-rank-row" key={`${item.uname || 'user'}-${index}`}>
          <span>#{index + 1}</span>
          <MarqueeText>{item.uname || '观众'}</MarqueeText>
          <strong>{item.value || 0}</strong>
        </div>
      ))}
    </div>
  );
}

export function SongRequestTheme({ view, skin, queue, nowPlaying, rank, visual }: ThemeProps) {
  const lead = nowPlaying || queue[0];
  const totalValue = queue.reduce((sum, item) => sum + (Number(item.creditValue) || 0), 0);
  const className = `song-card song-theme-${skin}`;

  if (view === 'rank') {
    return (
      <section className={`${className} song-rank`}>
        <div className="song-kicker">点歌排行</div>
        <RankList rank={rank} />
      </section>
    );
  }

  if (!lead) {
    return null;
  }

  const takeover = lead.tier === 'playlist_takeover';

  return (
    <section
      className={`${className} ${view === 'now-playing' ? 'song-now' : 'song-playlist'}`}
      data-tier={lead.tier}
      data-playing-changed={visual.playingChanged ? '1' : '0'}
      data-high-tier={visual.highTierRequestId ? '1' : '0'}
    >
      <div className="song-disc" />
      <div className="song-main">
        <div className="song-kicker">
          {view === 'now-playing' ? '当前播放' : `本场点歌 ${totalValue} 电池`} · {tierLabel(lead.tier)}
        </div>
        <MarqueeText className="song-title">{itemText(lead)}</MarqueeText>
        <div className="song-meta">
          {view === 'now-playing'
            ? `${lead.uname || '观众'} 点播 · ${lead.creditValue || 0} 电池`
            : `${lead.uname || '观众'} 点播 · ${lead.status === 'playing' ? '播放中' : '排队中'}`}
        </div>
        {takeover && <div className="song-takeover">本段歌单由 {lead.uname || '观众'} 包场</div>}
      </div>
      {view === 'playlist' && <QueueList queue={queue} visual={visual} />}
    </section>
  );
}
