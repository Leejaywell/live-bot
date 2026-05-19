import { DanmakuChatRoute, DanmakuChatRuntimeConfig, MusicInteractionSettings, PluginSettings } from './types';
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

function normalizeMusicSkin(skin: string | undefined | null): string {
  switch (skin) {
    case 'idol-stage':
    case 'vinyl':
    case 'neon':
      return skin;
    default:
      return 'neon';
  }
}

function settingsScale(settings: MusicInteractionSettings | undefined): number {
  const scale = Number(settings?.FontScale);
  if (!Number.isFinite(scale)) return 1;
  return Math.min(2, Math.max(0.5, scale));
}

export function parseDanmakuChatConfig(search = window.location.search): DanmakuChatRuntimeConfig {
  const params = new URLSearchParams(search);
  const primaryColor = params.get('primaryColor');
  const demoMode = params.get('demo') === '1';
  return {
    skin: params.get('skin') || 'default',
    transparent: parseBoolean(params.get('transparent'), !demoMode),
    scale: parseScale(params.get('scale')),
    motion: resolveMotion(params.get('motion')),
    primaryColor: primaryColor && HEX.test(primaryColor) ? primaryColor : null,
  };
}

export function resolveDanmakuChatConfig(
  route: DanmakuChatRoute,
  settings: PluginSettings,
  search = window.location.search,
): DanmakuChatRuntimeConfig {
  const config = parseDanmakuChatConfig(search);
  if (route.plugin !== 'song-request') {
    return config;
  }

  const params = new URLSearchParams(search);
  const music = settings.MusicInteraction;
  const settingsPrimaryColor = music?.PrimaryColor;
  return {
    ...config,
    skin: params.has('skin') ? normalizeMusicSkin(config.skin) : normalizeMusicSkin(music?.Skin),
    transparent: params.has('transparent') ? config.transparent : music?.Transparent ?? config.transparent,
    scale: params.has('scale') ? config.scale : settingsScale(music),
    primaryColor: params.has('primaryColor')
      ? config.primaryColor
      : settingsPrimaryColor && HEX.test(settingsPrimaryColor)
        ? settingsPrimaryColor
        : config.primaryColor,
  };
}

export function resolveDanmakuChatRoute(pathname = window.location.pathname): DanmakuChatRoute {
  if (pathname === '/') {
    return { plugin: 'danmaku', view: 'default' };
  }
  if (pathname === '/wish-goal') {
    return { plugin: 'wish-goal', view: 'default' };
  }
  if (pathname === '/lottery') {
    return { plugin: 'lottery', view: 'default' };
  }
  if (pathname === '/gift-effect') {
    return { plugin: 'gift-effect', view: 'default' };
  }
  if (pathname === '/recent-gifts') {
    return { plugin: 'recent-gifts', view: 'default' };
  }
  if (pathname === '/gift-rank') {
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
    pathname.endsWith('/song-request/playlist')
  ) {
    return { plugin: 'song-request', view: 'dashboard' };
  }
  return { plugin: 'danmaku', view: 'default' };
}
