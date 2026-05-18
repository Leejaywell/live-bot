import { EmptyState } from './components/EmptyState';
import { OverlayFrame } from './components/OverlayFrame';
import { parseOverlayConfig, resolveOverlayRoute } from './runtime/query';

export function OverlayRouter() {
  const config = parseOverlayConfig();
  const route = resolveOverlayRoute();
  return (
    <OverlayFrame config={config} plugin={route.plugin} view={route.view}>
      <EmptyState title="React OBS Overlay" subtitle={`${route.plugin} / ${route.view}`} />
    </OverlayFrame>
  );
}
