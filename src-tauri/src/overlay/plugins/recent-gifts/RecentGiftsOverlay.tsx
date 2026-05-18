import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

interface RecentGiftsOverlayProps {
  settings: PluginSettings;
}

export function RecentGiftsOverlay({ settings }: RecentGiftsOverlayProps) {
  return (
    <EmptyState
      title={settings.RecentGifts?.Title || '最近礼物'}
      subtitle="礼物流水将在这里显示"
    />
  );
}
