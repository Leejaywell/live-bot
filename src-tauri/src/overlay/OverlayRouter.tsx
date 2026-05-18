import { ReactNode } from 'react';
import { OverlayFrame } from './components/OverlayFrame';
import { DanmakuOverlay } from './plugins/danmaku/DanmakuOverlay';
import { GiftEffectOverlay } from './plugins/gift-effect/GiftEffectOverlay';
import { GiftRankOverlay } from './plugins/gift-rank/GiftRankOverlay';
import { LotteryOverlay } from './plugins/lottery/LotteryOverlay';
import { RecentGiftsOverlay } from './plugins/recent-gifts/RecentGiftsOverlay';
import { SongRequestOverlay } from './plugins/song-request/SongRequestOverlay';
import { WishGoalOverlay } from './plugins/wish-goal/WishGoalOverlay';
import { resolveOverlayConfig, resolveOverlayRoute } from './runtime/query';
import { OverlayRoute, OverlayRuntimeConfig, PluginSettings } from './runtime/types';
import { usePluginSettings } from './runtime/usePluginSettings';

function renderOverlayContent(
  route: OverlayRoute,
  settings: PluginSettings,
  config: OverlayRuntimeConfig,
): ReactNode {
  switch (route.plugin) {
    case 'danmaku':
      return <DanmakuOverlay />;
    case 'wish-goal':
      return <WishGoalOverlay settings={settings} />;
    case 'lottery':
      return <LotteryOverlay settings={settings} />;
    case 'gift-effect':
      return <GiftEffectOverlay settings={settings} />;
    case 'recent-gifts':
      return <RecentGiftsOverlay settings={settings} />;
    case 'gift-rank':
      return <GiftRankOverlay settings={settings} />;
    case 'song-request':
      return <SongRequestOverlay route={route} config={config} settings={settings.MusicInteraction} />;
  }
}

export function OverlayRouter() {
  const route = resolveOverlayRoute();
  const settings = usePluginSettings();
  const config = resolveOverlayConfig(route, settings);

  return (
    <OverlayFrame config={config} plugin={route.plugin} view={route.view}>
      {renderOverlayContent(route, settings, config)}
    </OverlayFrame>
  );
}
