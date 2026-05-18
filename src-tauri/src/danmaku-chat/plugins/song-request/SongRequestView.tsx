import { EmptyState } from '../../components/EmptyState';
import { DanmakuChatRoute, DanmakuChatRuntimeConfig, MusicInteractionSettings } from '../../runtime/types';
import { SongRequestTheme } from './SongRequestThemes';
import { useSongRequestData } from './useSongRequestData';

type SongRequestView = 'dashboard' | 'playlist' | 'now-playing' | 'rank';

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

export function SongRequestView({
  route,
  config,
  settings,
}: {
  route: DanmakuChatRoute;
  config: DanmakuChatRuntimeConfig;
  settings?: MusicInteractionSettings;
}) {
  const view = route.view as SongRequestView;
  const { queue, nowPlaying, rank, visual } = useSongRequestData(view);
  const skin = resolveSongSkin(config.skin);

  if (settings?.Enabled === false) {
    return <EmptyState title="音乐互动" subtitle="点歌未启用" />;
  }

  if (
    view === 'dashboard'
    && settings?.ShowNowPlayingPanel === false
    && settings?.ShowQueuePanel === false
    && settings?.ShowRankPanel === false
  ) {
    return <EmptyState title="音乐互动" subtitle="所有面板已关闭" />;
  }

  if (view === 'dashboard' && !queue.length && !rank.length) {
    return <EmptyState title="今日第一首歌等待点亮" subtitle="送礼点歌后将在这里显示" />;
  }

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
      settings={settings}
    />
  );
}
