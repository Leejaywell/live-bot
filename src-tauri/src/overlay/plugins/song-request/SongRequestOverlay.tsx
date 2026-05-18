import { EmptyState } from '../../components/EmptyState';
import { OverlayRoute } from '../../runtime/types';

interface SongRequestOverlayProps {
  route: OverlayRoute;
}

export function SongRequestOverlay({ route }: SongRequestOverlayProps) {
  const title = route.view === 'rank'
    ? '点歌排行'
    : route.view === 'now-playing'
      ? '当前播放'
      : '点歌歌单';

  return <EmptyState title={title} subtitle="音乐互动 overlay 已连接" />;
}
