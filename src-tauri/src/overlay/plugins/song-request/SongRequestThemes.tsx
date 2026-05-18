import type { CSSProperties } from 'react';
import { MarqueeText } from '../../components/MarqueeText';
import { MusicInteractionSettings } from '../../runtime/types';
import { RankResponse, SongQueueItem, SongRequestVisualState } from './types';

type SongRequestView = 'playlist' | 'now-playing' | 'rank';

export interface ThemeProps {
  view: SongRequestView;
  skin: string;
  queue: SongQueueItem[];
  nowPlaying: SongQueueItem | null;
  rank: RankResponse['items'];
  visual: SongRequestVisualState;
  settings?: MusicInteractionSettings;
}

type SongCardStyle = CSSProperties & {
  '--song-card-width'?: string;
  '--song-card-height'?: string;
};

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

function QueueList({ queue, visual, showGiftTier }: Pick<ThemeProps, 'queue' | 'visual'> & { showGiftTier: boolean }) {
  return (
    <ol className="song-queue">
      {queue.slice(0, 4).map((item, index) => (
        <li
          key={item.requestId}
          data-new={visual.newRequestIds.has(item.requestId) ? '1' : '0'}
          data-tier={item.tier}
          data-show-tier={showGiftTier ? '1' : '0'}
        >
          <span>{index + 1}</span>
          <MarqueeText>{itemText(item)}</MarqueeText>
          {showGiftTier && <em>{tierLabel(item.tier)}</em>}
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

function clampSetting(value: unknown, min: number, max: number): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

function cardStyle(settings: MusicInteractionSettings | undefined): SongCardStyle | undefined {
  const width = clampSetting(settings?.Width, 240, 1200);
  const height = clampSetting(settings?.Height, 80, 720);
  if (width === undefined && height === undefined) return undefined;

  return {
    ...(width !== undefined ? { '--song-card-width': `${width}px` } : {}),
    ...(height !== undefined ? { '--song-card-height': `${height}px` } : {}),
  };
}

export function SongRequestTheme({ view, skin, queue, nowPlaying, rank, visual, settings }: ThemeProps) {
  const lead = nowPlaying || queue[0];
  const totalValue = queue.reduce((sum, item) => sum + (Number(item.creditValue) || 0), 0);
  const className = `song-card song-theme-${skin}`;
  const style = cardStyle(settings);
  const showCover = settings?.ShowCover ?? true;
  const showRequester = settings?.ShowRequester ?? true;
  const showGiftTier = settings?.ShowGiftTier ?? true;
  const showQueue = settings?.ShowQueue ?? true;
  const showTodayValue = settings?.ShowTodayValue === true;

  if (view === 'rank') {
    return (
      <section className={`${className} song-rank`} style={style}>
        <div className="song-kicker">点歌排行</div>
        <RankList rank={rank} />
      </section>
    );
  }

  if (!lead) {
    return null;
  }

  const takeover = lead.tier === 'playlist_takeover';
  const tierText = showGiftTier ? ` · ${tierLabel(lead.tier)}` : '';
  const playlistKicker = showTodayValue ? `本场点歌 ${totalValue} 电池` : '本场点歌';
  const currentCredit = showTodayValue ? ` · ${lead.creditValue || 0} 电池` : '';

  return (
    <section
      className={`${className} ${view === 'now-playing' ? 'song-now' : 'song-playlist'}`}
      style={style}
      data-tier={lead.tier}
      data-playing-changed={visual.playingChanged ? '1' : '0'}
      data-high-tier={visual.highTierRequestId ? '1' : '0'}
      data-show-cover={showCover ? '1' : '0'}
      data-show-queue={showQueue ? '1' : '0'}
    >
      {showCover && <div className="song-disc" />}
      <div className="song-main">
        <div className="song-kicker">
          {view === 'now-playing' ? '当前播放' : playlistKicker}
          {tierText}
        </div>
        <MarqueeText className="song-title">{itemText(lead)}</MarqueeText>
        {showRequester && (
          <div className="song-meta">
            {view === 'now-playing'
              ? `${lead.uname || '观众'} 点播${currentCredit}`
              : `${lead.uname || '观众'} 点播 · ${lead.status === 'playing' ? '播放中' : '排队中'}`}
          </div>
        )}
        {showGiftTier && takeover && <div className="song-takeover">本段歌单由 {lead.uname || '观众'} 包场</div>}
      </div>
      {view === 'playlist' && showQueue && <QueueList queue={queue} visual={visual} showGiftTier={showGiftTier} />}
    </section>
  );
}
