import { OverlayRuntimeConfig, OverlayRoute } from './types';
import { resolveMotion } from './motion';

const HEX = /^#[0-9a-fA-F]{6}$/;

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function parseScale(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(2, Math.max(0.5, parsed));
}

export function parseOverlayConfig(search = window.location.search): OverlayRuntimeConfig {
  const params = new URLSearchParams(search);
  const primaryColor = params.get('primaryColor');
  return {
    skin: params.get('skin') || 'default',
    transparent: parseBoolean(params.get('transparent'), true),
    scale: parseScale(params.get('scale')),
    motion: resolveMotion(params.get('motion')),
    primaryColor: primaryColor && HEX.test(primaryColor) ? primaryColor : null,
  };
}

export function resolveOverlayRoute(pathname = window.location.pathname): OverlayRoute {
  if (pathname === '/' || pathname === '/overlay/danmaku') {
    return { plugin: 'danmaku', view: 'default' };
  }
  if (pathname === '/wish-goal' || pathname === '/overlay/wish-goal') {
    return { plugin: 'wish-goal', view: 'default' };
  }
  if (pathname === '/lottery' || pathname === '/overlay/lottery') {
    return { plugin: 'lottery', view: 'default' };
  }
  if (pathname === '/gift-effect' || pathname === '/overlay/gift-effect') {
    return { plugin: 'gift-effect', view: 'default' };
  }
  if (pathname === '/recent-gifts' || pathname === '/overlay/recent-gifts') {
    return { plugin: 'recent-gifts', view: 'default' };
  }
  if (pathname === '/gift-rank' || pathname === '/overlay/gift-rank') {
    return { plugin: 'gift-rank', view: 'default' };
  }
  if (pathname.endsWith('/song-request/now-playing')) {
    return { plugin: 'song-request', view: 'now-playing' };
  }
  if (pathname.endsWith('/song-request/rank')) {
    return { plugin: 'song-request', view: 'rank' };
  }
  if (
    pathname === '/song-request' ||
    pathname === '/overlay/song-request' ||
    pathname.endsWith('/song-request/playlist')
  ) {
    return { plugin: 'song-request', view: 'playlist' };
  }
  return { plugin: 'danmaku', view: 'default' };
}
