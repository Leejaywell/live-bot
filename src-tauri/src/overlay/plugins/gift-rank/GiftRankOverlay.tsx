import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

interface GiftRankOverlayProps {
  settings: PluginSettings;
}

export function GiftRankOverlay({ settings }: GiftRankOverlayProps) {
  return (
    <EmptyState
      title={settings.GiftRank?.Title || '礼物排行'}
      subtitle="贡献榜将在这里显示"
    />
  );
}
