import { ReactNode, useEffect } from 'react';
import { DanmakuChatFrame } from './components/DanmakuChatFrame';
import { DanmakuChatView } from './plugins/danmaku/DanmakuChatView';
import { GiftEffectView } from './plugins/gift-effect/GiftEffectView';
import { GiftRankView } from './plugins/gift-rank/GiftRankView';
import { LotteryView } from './plugins/lottery/LotteryView';
import { RecentGiftsView } from './plugins/recent-gifts/RecentGiftsView';
import { SongRequestView } from './plugins/song-request/SongRequestView';
import { WishGoalView } from './plugins/wish-goal/WishGoalView';
import { resolveDanmakuChatConfig, resolveDanmakuChatRoute } from './runtime/query';
import { DanmakuChatRoute, DanmakuChatRuntimeConfig, DanmakuChatSettings, PluginSettings } from './runtime/types';
import { usePluginSettings } from './runtime/usePluginSettings';

function setCssVar(name: string, value: unknown, fallback: string) {
  document.documentElement.style.setProperty(name, value == null || value === '' ? fallback : String(value));
}

function normalizeCss(css: string | undefined): string {
  return (css || '').replace(/\s+/g, '');
}

function isLegacyDefaultCss(css: string | undefined): boolean {
  const normalized = normalizeCss(css);
  if (!normalized || normalized.length < 1500) {
    return false;
  }
  return [
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
    'body.lbfx-on.msg::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:-1;opacity:0}',
    'body.lbfx-on.msg-gift::before',
    'body.lbfx-onyt-live-chat-ticker-renderer#container{background-image:linear-gradient(90deg,rgba(255,255,255,.08)0,transparent22px,rgba(255,255,255,.08)42px);background-size:42px100%;animation:lbfxTicker1800mslinearinfinite}',
  ].every(marker => normalized.includes(marker));
}

function applyLegacyDanmakuChatCss(settings: DanmakuChatSettings | undefined) {
  let userCss = document.getElementById('user-css');
  if (!userCss) {
    userCss = document.createElement('style');
    userCss.id = 'user-css';
    document.head.appendChild(userCss);
  }
  userCss.textContent = isLegacyDefaultCss(settings?.CustomCss) ? '' : settings?.CustomCss || '';

  const cfg = settings || {};
  setCssVar('--global-scale', cfg.GlobalScale, '1');
  setCssVar('--font-scale', cfg.FontScale, '1');
  setCssVar('--event-font-size', `${cfg.MessageFontSize ?? 20}px`, '20px');
  setCssVar('--font-family', cfg.MessageFont, 'PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif');
  setCssVar('--msg-gap', `${cfg.MsgGap ?? 3}px`, '3px');
  setCssVar('--bg-color', cfg.BgColor, 'transparent');
  setCssVar('--av-size', `${cfg.AvatarSize ?? 30}px`, '30px');
  setCssVar('--av-display', cfg.ShowAvatar === false ? 'none' : 'flex', 'flex');
  setCssVar('--username-display', cfg.ShowUsername === false ? 'none' : 'inline');
  setCssVar('--username-font', cfg.UserNameFont, 'inherit');
  setCssVar('--username-font-size', `${cfg.UserNameFontSize ?? 20}px`, '20px');
  setCssVar('--username-weight', cfg.UserNameWeight, '600');
  setCssVar('--username-color', cfg.UserNameColor, '#effee3');
  setCssVar('--owner-username-color', cfg.OwnerUserNameColor, '#ff96aa');
  setCssVar('--moderator-username-color', cfg.ModeratorUserNameColor, '#e7a9ff');
  setCssVar('--member-username-color', cfg.MemberUserNameColor, '#96deff');
  setCssVar('--msg-font', cfg.MessageFont, 'inherit');
  setCssVar('--msg-font-size', `${cfg.MessageFontSize ?? 20}px`, '20px');
  setCssVar('--msg-weight', cfg.MessageWeight, '600');
  setCssVar('--msg-color', cfg.MessageColor, '#ffffff');
  setCssVar('--time-display', cfg.ShowTime ? 'inline' : 'none', 'none');
  setCssVar('--time-font', cfg.TimeFont, 'inherit');
  setCssVar('--time-font-size', `${cfg.TimeFontSize ?? 16}px`, '16px');
  setCssVar('--time-weight', cfg.TimeWeight, '400');
  setCssVar('--time-color', cfg.TimeColor, '#999');
  setCssVar('--badge-display', cfg.ShowBadges === false ? 'none' : 'inline-flex', 'inline-flex');
  setCssVar('--gift-icon-display', cfg.ShowGiftIcon ? 'block' : 'none', 'none');
  setCssVar('--msg-bg', cfg.MessageBgColor || `rgba(0,0,0,${cfg.BgOpacity ?? 0.15})`, 'rgba(0,0,0,0.15)');
  setCssVar('--owner-bg', cfg.OwnerMessageBgColor, 'rgba(255,214,0,0.18)');
  setCssVar('--mod-bg', cfg.ModeratorMessageBgColor, 'rgba(94,132,241,0.18)');
  setCssVar('--member-bg', cfg.MemberMessageBgColor, 'rgba(15,157,88,0.18)');
  setCssVar('--sc-line1-size', `${cfg.FirstLineFontSize ?? 20}px`, '20px');
  setCssVar('--sc-line1-weight', cfg.FirstLineWeight, '700');
  setCssVar('--sc-line2-size', `${cfg.SecondLineFontSize ?? 20}px`, '20px');
  setCssVar('--sc-line2-weight', cfg.SecondLineWeight, '700');
  setCssVar('--sc-content-size', `${cfg.ScContentFontSize ?? 20}px`, '20px');
  setCssVar('--sc-content-weight', cfg.ScContentWeight, '600');
  setCssVar('--fade-in', `${cfg.FadeInTime ?? 200}ms`, '200ms');
  setCssVar('--fade-out', `${cfg.FadeOutTime ?? 400}ms`, '400ms');
  setCssVar('--slide-from', cfg.Slide === false ? '0' : cfg.ReverseSlide ? '-5px' : '5px', '5px');
  setCssVar('--lbfx-i', Math.max(0.4, Math.min(1.8, cfg.EffectIntensity ?? 1)), '1');
  setCssVar('--outline-w', `${cfg.OutlineSize ?? 2}px`, '2px');
  setCssVar('--outline-c', cfg.OutlineColor, '#000');
  document.body.dataset.overlayTheme = cfg.Theme || 'classic';
  document.body.classList.toggle('lbfx-on', !!cfg.EffectsEnabled);
  document.body.classList.toggle('outline-on', !!cfg.ShowOutlines);
  document.body.classList.toggle('outline-blur', !!cfg.ShowOutlines && !!cfg.BlurryOutline);
}

function renderDanmakuChatContent(
  route: DanmakuChatRoute,
  settings: PluginSettings,
  config: DanmakuChatRuntimeConfig,
): ReactNode {
  switch (route.plugin) {
    case 'danmaku':
      return <DanmakuChatView settings={settings.DanmakuChat} />;
    case 'wish-goal':
      return <WishGoalView settings={settings} />;
    case 'lottery':
      return <LotteryView settings={settings} />;
    case 'gift-effect':
      return <GiftEffectView settings={settings} />;
    case 'recent-gifts':
      return <RecentGiftsView settings={settings} />;
    case 'gift-rank':
      return <GiftRankView settings={settings} />;
    case 'song-request':
      return <SongRequestView route={route} config={config} settings={settings.MusicInteraction} />;
  }
}

export function DanmakuChatRouter() {
  const route = resolveDanmakuChatRoute();
  const settings = usePluginSettings();
  const config = resolveDanmakuChatConfig(route, settings);

  useEffect(() => {
    applyLegacyDanmakuChatCss(settings.DanmakuChat);
  }, [settings.DanmakuChat]);

  return (
    <DanmakuChatFrame config={config} plugin={route.plugin} view={route.view}>
      {renderDanmakuChatContent(route, settings, config)}
    </DanmakuChatFrame>
  );
}
