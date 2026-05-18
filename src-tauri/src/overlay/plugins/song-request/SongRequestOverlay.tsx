import { EmptyState } from '../../components/EmptyState';
import { parseOverlayConfig } from '../../runtime/query';
import { OverlayRoute } from '../../runtime/types';
import { SongRequestTheme } from './SongRequestThemes';
import { useSongRequestData } from './useSongRequestData';

type SongRequestView = 'playlist' | 'now-playing' | 'rank';

function resolveSongSkin(skin: string) {
  switch (skin) {
    case 'idol-stage':
    case 'vinyl':
      return skin;
    case 'neon':
    default:
      return 'neon';
  }
}

export function SongRequestOverlay({ route }: { route: OverlayRoute }) {
  const config = parseOverlayConfig();
  const view = route.view as SongRequestView;
  const { queue, nowPlaying, rank, visual } = useSongRequestData(view);
  const skin = resolveSongSkin(config.skin);

  if (view === 'rank' && !rank.length) {
    return <EmptyState title="暂无点歌排行" subtitle="送礼点歌后将在这里显示" />;
  }

  if (view === 'now-playing' && !nowPlaying) {
    return <EmptyState title="暂无正在播放" subtitle="队列歌曲开始播放后将在这里显示" />;
  }

  if (view === 'playlist' && !queue.length) {
    return <EmptyState title="今日第一首歌等待点亮" subtitle="送礼点歌后将在这里显示" />;
  }

  return (
    <SongRequestTheme
      view={view}
      skin={skin}
      queue={queue}
      nowPlaying={nowPlaying}
      rank={rank}
      visual={visual}
    />
  );
}
