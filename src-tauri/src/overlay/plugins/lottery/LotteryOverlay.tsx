import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

interface LotteryOverlayProps {
  settings: PluginSettings;
}

export function LotteryOverlay({ settings }: LotteryOverlayProps) {
  return (
    <EmptyState
      title={settings.LotteryInteraction?.Title || '幸运抽奖'}
      subtitle="抽奖状态将在这里显示"
    />
  );
}
