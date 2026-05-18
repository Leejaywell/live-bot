import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

interface WishGoalOverlayProps {
  settings: PluginSettings;
}

export function WishGoalOverlay({ settings }: WishGoalOverlayProps) {
  return (
    <EmptyState
      title={settings.WishGoal?.Title || '今日心愿目标'}
      subtitle="心愿进度将在这里显示"
    />
  );
}
