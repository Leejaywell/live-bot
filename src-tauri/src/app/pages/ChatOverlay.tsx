import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { api, OverlayConfig } from '../lib/api';
import { hexToRgb, visualThemes, type VisualThemeId } from '../context/ThemeContext';

// ─── Theme sync (settings panel only) ────────────────────────────────────────

function applyStoredTheme() {
  try {
    const stored = JSON.parse(localStorage.getItem('streamix-theme-v1') || '{}');
    const root = document.documentElement;
    const activeTheme = visualThemes[stored.visualTheme as VisualThemeId] ?? visualThemes['mountain-parallax'];
    const isDark = stored.theme === 'dark';
    const primaryColor = stored.primaryColor ?? activeTheme.primary;
    const accentColor = activeTheme.accent;
    const primaryRgb = hexToRgb(primaryColor);
    const accentRgb = hexToRgb(accentColor);
    const rgba = (hex: string, alpha: number) => {
      const rgb = hexToRgb(hex);
      return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : `rgba(75, 142, 255, ${alpha})`;
    };

    root.classList.toggle('dark', isDark);
    root.style.setProperty('--primary-color', primaryColor);
    root.style.setProperty('--accent-color', accentColor);
    root.style.setProperty('--background', isDark ? activeTheme.backgroundDark : activeTheme.backgroundLight);
    root.style.setProperty('--foreground', isDark ? '#f6f7fb' : '#1b2233');
    root.style.setProperty('--glass-blur', `${stored.blur ?? 18}px`);
    root.style.setProperty('--surface-bg', isDark ? activeTheme.surfaceDark : activeTheme.surfaceLight);
    root.style.setProperty('--surface-border', isDark ? activeTheme.surfaceBorderDark : activeTheme.surfaceBorderLight);
    root.style.setProperty('--surface-shadow', isDark ? '0 16px 40px rgba(0, 0, 0, 0.30)' : '0 10px 32px rgba(24, 36, 80, 0.08)');
    root.style.setProperty('--topbar-bg', isDark ? activeTheme.topbarDark : activeTheme.topbarLight);
    root.style.setProperty('--topbar-border', isDark ? activeTheme.topbarBorderDark : activeTheme.topbarBorderLight);
    root.style.setProperty('--sidebar-bg', isDark ? activeTheme.sidebarDark : activeTheme.sidebarLight);
    root.style.setProperty('--sidebar-border', isDark ? activeTheme.sidebarBorderDark : activeTheme.sidebarBorderLight);
    root.style.setProperty('--control-bg', isDark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(255, 255, 255, 0.70)');
    root.style.setProperty('--control-border', isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(150, 170, 210, 0.22)');
    root.style.setProperty('--control-text', isDark ? '#eef2ff' : '#35405e');
    root.style.setProperty('--muted-text', isDark ? '#a4adbf' : '#71809e');
    root.style.setProperty('--card-bg', isDark ? activeTheme.surfaceDark : activeTheme.surfaceLight);
    root.style.setProperty('--card-border', isDark ? activeTheme.surfaceBorderDark : activeTheme.surfaceBorderLight);
    root.style.setProperty('--button-default-hover', isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.88)');
    root.style.setProperty('--button-ghost-hover', isDark ? 'rgba(255, 255, 255, 0.10)' : rgba(primaryColor, 0.08));
    if (primaryRgb) {
      root.style.setProperty('--primary-rgb', `${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}`);
    }
    if (accentRgb) {
      root.style.setProperty('--accent-rgb', `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`);
    }
  } catch {}
}

// ─── Default config (mirrors Rust OverlayConfig::default) ────────────────────

const DEFAULT_CUSTOM_CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg-color,transparent);height:100%;overflow:hidden;
  font-family:var(--font-family,"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif)}
#app{height:100%;display:flex;flex-direction:column;
  padding:4px 6px 8px;
  gap:var(--msg-gap,3px);
  overflow-y:auto;overflow-x:hidden;scrollbar-width:none;
  transform-origin:top left;
  transform:scale(var(--global-scale,1))}
#app::-webkit-scrollbar{display:none}
.spacer{flex:1 0 0}

@keyframes msgIn{from{opacity:0;transform:translateY(var(--slide-from,5px))}to{opacity:1;transform:translateY(0)}}
@keyframes msgOut{from{opacity:1}to{opacity:0;transform:translateY(-4px)}}
@keyframes lbfxSweep{from{transform:translateX(-120%) skewX(-16deg)}to{transform:translateX(260%) skewX(-16deg)}}
@keyframes lbfxGlow{0%,100%{filter:brightness(1)}50%{filter:brightness(1.16)}}
@keyframes lbfxRise{0%{opacity:0;transform:translateY(8px) scale(.98)}65%{opacity:1;transform:translateY(-1px) scale(1)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes lbfxTicker{from{background-position:0 0}to{background-position:42px 0}}

.msg{display:flex;align-items:flex-start;gap:7px;
  padding:5px 8px;border-radius:6px;flex-shrink:0;
  word-break:break-all;line-height:1.5;
  font-size:calc(var(--msg-font-size,13px) * var(--font-scale,1))}
.msg.anim-in{animation:msgIn var(--fade-in,200ms) ease}
.msg.anim-out{animation:msgOut var(--fade-out,400ms) ease forwards}

body.lbfx-on .msg{position:relative;isolation:isolate;text-shadow:0 1px 2px rgba(0,0,0,.95)}
body.lbfx-on .msg.anim-in{animation:lbfxRise var(--fade-in,200ms) ease-out}
body.lbfx-on .msg-danmu,
body.lbfx-on .msg-danmu[data-id="owner"],
body.lbfx-on .msg-danmu[data-id="moderator"],
body.lbfx-on .msg-danmu[data-id="member"]{background:transparent}
body.lbfx-on .uname{color:#effee3}
body.lbfx-on .msg[blc-guard-level="1"] .uname,
body.lbfx-on .msg[data-id="member"] .uname{color:#96deff}
body.lbfx-on .msg[blc-guard-level="2"] .uname,
body.lbfx-on .msg[data-id="moderator"] .uname{color:#e7a9ff}
body.lbfx-on .msg[blc-guard-level="3"] .uname,
body.lbfx-on .msg[data-id="owner"] .uname{color:#ff96aa}
body.lbfx-on .dtext,
body.lbfx-on .sc-body,
body.lbfx-on .msg-gift #message{color:#fff}
body.lbfx-on .msg::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:-1;opacity:0}
body.lbfx-on .msg-gift,
body.lbfx-on .msg-guard,
body.lbfx-on .msg-sc{overflow:hidden}
body.lbfx-on .msg-gift::before,
body.lbfx-on .msg-guard::before,
body.lbfx-on .msg-sc::before{content:"";position:absolute;top:0;bottom:0;left:0;width:34%;pointer-events:none;z-index:2;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,calc(.16 * var(--lbfx-i,1))),transparent);
  transform:translateX(-120%) skewX(-16deg);animation:lbfxSweep calc(2600ms / var(--lbfx-i,1)) ease-out 1}
body.lbfx-on .msg-gift{background:rgba(233,30,99,.2);border-left-color:#e91e63}
body.lbfx-on .msg-gift .gname,
body.lbfx-on .msg-gift .gcnt{color:#ffc107}
body.lbfx-on .msg-gift::after{opacity:1;box-shadow:inset 0 0 0 1px rgba(233,30,99,.14)}
body.lbfx-on .msg-guard::after{opacity:1;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);animation:lbfxGlow 2600ms ease-in-out infinite}
body.lbfx-on .msg-sc{background:rgba(255,152,0,.2);border-left:3px solid #ff9800;border-radius:6px}
body.lbfx-on .msg-sc .sc-head{background:transparent!important;padding-bottom:0}
body.lbfx-on .msg-sc .sc-body{background:transparent;border-radius:0;padding-top:2px}
body.lbfx-on .msg-sc::after{opacity:1;box-shadow:inset 0 0 0 1px rgba(255,152,0,.12);animation:lbfxGlow 2200ms ease-in-out infinite}
body.lbfx-on yt-live-chat-ticker-renderer #container{background-image:linear-gradient(90deg,rgba(255,255,255,.08) 0,transparent 22px,rgba(255,255,255,.08) 42px);background-size:42px 100%;animation:lbfxTicker 1800ms linear infinite}

.av{width:var(--av-size,24px);height:var(--av-size,24px);border-radius:50%;
  flex-shrink:0;object-fit:cover;
  display:var(--av-display,flex);
  align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff}

.tm{flex-shrink:0;
  font-family:var(--time-font,inherit);
  font-size:calc(var(--time-font-size,12px) * var(--font-scale,1));
  font-weight:var(--time-weight,400);
  color:var(--time-color,#999);
  display:var(--time-display,none);
  margin-right:2px;align-self:center}

.uname{flex-shrink:0;
  font-family:var(--username-font,inherit);
  font-size:calc(var(--username-font-size,13px) * var(--font-scale,1));
  font-weight:var(--username-weight,600);
  display:var(--username-display,inline)}

.idbadge{flex-shrink:0;font-size:10px;font-weight:700;padding:1px 5px;
  border-radius:4px;align-self:center;
  display:var(--badge-display,inline-flex);align-items:center;gap:2px}

.msg-danmu{background:var(--msg-bg,rgba(0,0,0,.72))}
.msg-danmu[data-id="owner"]{background:var(--owner-bg,rgba(255,214,0,.18))}
.msg-danmu[data-id="moderator"]{background:var(--mod-bg,rgba(94,132,241,.18))}
.msg-danmu[data-id="member"]{background:var(--member-bg,rgba(15,157,88,.18))}
.dtext{font-family:var(--msg-font,inherit);
  font-weight:var(--msg-weight,600);
  color:var(--msg-color,#e8e8e8)}

.outline-on .uname,.outline-on .dtext,.outline-on .tm,
.outline-on .gname,.outline-on .gcnt,.outline-on .glabel,
.outline-on .sc-uname,.outline-on .sc-price,.outline-on .sc-body{
  text-shadow:
    calc(var(--outline-w,2px) * -1) calc(var(--outline-w,2px) * -1) 0 var(--outline-c,#000),
    var(--outline-w,2px) calc(var(--outline-w,2px) * -1) 0 var(--outline-c,#000),
    calc(var(--outline-w,2px) * -1) var(--outline-w,2px) 0 var(--outline-c,#000),
    var(--outline-w,2px) var(--outline-w,2px) 0 var(--outline-c,#000)}
.outline-blur .uname,.outline-blur .dtext,.outline-blur .tm,
.outline-blur .gname,.outline-blur .gcnt,.outline-blur .glabel,
.outline-blur .sc-uname,.outline-blur .sc-price,.outline-blur .sc-body{
  text-shadow:0 0 var(--outline-w,2px) var(--outline-c,#000),
              0 0 calc(var(--outline-w,2px) * 2) var(--outline-c,#000)}

.msg-gift{background:var(--msg-bg,rgba(0,0,0,.72));border-left:3px solid #ffa500;align-items:center;gap:5px}
.gift-icon{width:calc(var(--av-size,24px) * .9);height:calc(var(--av-size,24px) * .9);object-fit:contain;flex-shrink:0;
  display:var(--gift-icon-display,none);filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
.gname{color:#ffa500;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gcnt{color:#ffa500;font-weight:800;flex-shrink:0}

.msg-guard{align-items:center;gap:5px}
.gbadge{font-weight:700;flex-shrink:0}
.glabel{font-weight:800;flex-shrink:0}

.msg-sc{flex-direction:column;gap:0;padding:0;background:none;align-items:stretch}
.sc-head{display:flex;align-items:center;justify-content:space-between;
  padding:5px 8px;border-radius:6px 6px 0 0;gap:6px}
.sc-uname{font-weight:700;color:#fff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:calc(var(--sc-line1-size,15px) * var(--font-scale,1));
  font-weight:var(--sc-line1-weight,700)}
.sc-price{font-weight:800;flex-shrink:0;
  font-size:calc(var(--sc-line2-size,13px) * var(--font-scale,1));
  font-weight:var(--sc-line2-weight,700)}
.sc-body{padding:6px 8px;background:rgba(0,0,0,.82);border-radius:0 0 6px 6px;color:#e8e8e8;
  font-size:calc(var(--sc-content-size,13px) * var(--font-scale,1));
  font-weight:var(--sc-content-weight,600)}`;

const DEFAULT_CFG: OverlayConfig = {
  Port: 12450, MaxMsgs: 50, MsgGap: 3, Theme: 'classic', CustomCss: DEFAULT_CUSTOM_CSS,
  GlobalScale: 1, FontScale: 1,
  ShowAvatar: true, AvatarSize: 24,
  ShowUsername: true, UserNameFont: 'PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif',
  UserNameFontSize: 13, UserNameWeight: 600,
  UserNameColor: '#effee3',
  OwnerUserNameColor: '#ff96aa', ModeratorUserNameColor: '#e7a9ff', MemberUserNameColor: '#96deff',
  ShowBadges: true,
  MessageFont: 'PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif',
  MessageFontSize: 13, MessageWeight: 600, MessageColor: '#ffffff',
  ShowTime: false, TimeFont: 'inherit', TimeFontSize: 12, TimeWeight: 400, TimeColor: '#999999',
  BgColor: 'rgba(0,0,0,0)', BgOpacity: 0.15,
  MessageBgColor: 'transparent',
  OwnerMessageBgColor: 'rgba(255,214,0,0.18)',
  ModeratorMessageBgColor: 'rgba(94,132,241,0.18)',
  MemberMessageBgColor: 'rgba(15,157,88,0.18)',
  ShowGift: true, GiftMinCost: 0, ShowGiftIcon: false, ShowGuard: true, ShowSc: true, ScMinCost: 0,
  FirstLineFontSize: 15, FirstLineWeight: 700,
  SecondLineFontSize: 13, SecondLineWeight: 700,
  ScContentFontSize: 13, ScContentWeight: 600,
  AnimateIn: true, FadeInTime: 200, AnimateOut: false, FadeOutTime: 400, AnimateOutWaitTime: 30,
  Slide: true, ReverseSlide: false,
  EffectsEnabled: true, EffectIntensity: 1,
  ShowOutlines: false, OutlineSize: 2, OutlineColor: '#000000', BlurryOutline: false,
};

type OverlayThemeId = 'classic' | 'glass' | 'contrast' | 'compact' | 'gift' | 'minimal';

const OVERLAY_THEMES: {
  id: OverlayThemeId;
  name: string;
  hint: string;
  patch: Partial<OverlayConfig>;
}[] = [
  {
    id: 'classic',
    name: '经典流光',
    hint: '均衡的头像、昵称和消息层级，接近当前默认效果。',
    patch: {
      MsgGap: 3, FontScale: 1, AvatarSize: 24, ShowAvatar: true, ShowUsername: true, ShowBadges: true,
      MessageFontSize: 13, MessageWeight: 600, MessageColor: '#ffffff',
      UserNameFontSize: 13, UserNameWeight: 600, UserNameColor: '#effee3',
      OwnerUserNameColor: '#ff96aa', ModeratorUserNameColor: '#e7a9ff', MemberUserNameColor: '#96deff',
      MessageBgColor: 'transparent', OwnerMessageBgColor: 'rgba(255,214,0,0.18)',
      ModeratorMessageBgColor: 'rgba(94,132,241,0.18)', MemberMessageBgColor: 'rgba(15,157,88,0.18)',
      ShowOutlines: false, BlurryOutline: false, EffectsEnabled: true, EffectIntensity: 1,
      AnimateIn: true, FadeInTime: 200, Slide: true, ReverseSlide: false,
    },
  },
  {
    id: 'glass',
    name: '清透玻璃',
    hint: '减少背景遮挡，保留轻量阴影和透明质感。',
    patch: {
      MsgGap: 4, FontScale: 1, AvatarSize: 24, ShowAvatar: true, ShowUsername: true, ShowBadges: true,
      MessageFontSize: 13, MessageWeight: 600, MessageColor: '#ffffff',
      UserNameFontSize: 13, UserNameWeight: 600, UserNameColor: '#f3fff4',
      OwnerUserNameColor: '#ffb3c1', ModeratorUserNameColor: '#d8b4fe', MemberUserNameColor: '#93c5fd',
      MessageBgColor: 'rgba(12,18,28,0.18)', OwnerMessageBgColor: 'rgba(255,214,0,0.12)',
      ModeratorMessageBgColor: 'rgba(94,132,241,0.12)', MemberMessageBgColor: 'rgba(15,157,88,0.10)',
      ShowOutlines: false, BlurryOutline: false, EffectsEnabled: true, EffectIntensity: 0.8,
      AnimateIn: true, FadeInTime: 220, Slide: true, ReverseSlide: false,
    },
  },
  {
    id: 'contrast',
    name: '强光可读',
    hint: '强化描边和投影，适合亮色、复杂画面。',
    patch: {
      MsgGap: 4, FontScale: 1.04, AvatarSize: 25, ShowAvatar: true, ShowUsername: true, ShowBadges: true,
      MessageFontSize: 14, MessageWeight: 700, MessageColor: '#ffffff',
      UserNameFontSize: 13, UserNameWeight: 800, UserNameColor: '#ffffff',
      OwnerUserNameColor: '#ffd166', ModeratorUserNameColor: '#f0abfc', MemberUserNameColor: '#93c5fd',
      MessageBgColor: 'rgba(0,0,0,0.34)', OwnerMessageBgColor: 'rgba(90,60,0,0.36)',
      ModeratorMessageBgColor: 'rgba(34,42,112,0.36)', MemberMessageBgColor: 'rgba(0,76,58,0.34)',
      ShowOutlines: true, OutlineSize: 2, OutlineColor: '#000000', BlurryOutline: true,
      EffectsEnabled: true, EffectIntensity: 1.05, AnimateIn: true, FadeInTime: 180, Slide: true, ReverseSlide: false,
    },
  },
  {
    id: 'compact',
    name: '密集弹幕',
    hint: '压缩间距和字号，适合高弹幕密度直播间。',
    patch: {
      MsgGap: 1, FontScale: 0.92, AvatarSize: 20, ShowAvatar: true, ShowUsername: true, ShowBadges: false,
      MessageFontSize: 12, MessageWeight: 600, MessageColor: '#ffffff',
      UserNameFontSize: 12, UserNameWeight: 600, UserNameColor: '#effee3',
      OwnerUserNameColor: '#ff96aa', ModeratorUserNameColor: '#e7a9ff', MemberUserNameColor: '#96deff',
      MessageBgColor: 'transparent', OwnerMessageBgColor: 'rgba(255,214,0,0.12)',
      ModeratorMessageBgColor: 'rgba(94,132,241,0.12)', MemberMessageBgColor: 'rgba(15,157,88,0.10)',
      ShowOutlines: false, BlurryOutline: false, EffectsEnabled: true, EffectIntensity: 0.7,
      AnimateIn: true, FadeInTime: 140, Slide: true, ReverseSlide: false,
    },
  },
  {
    id: 'gift',
    name: '礼物高亮',
    hint: '普通弹幕低调，礼物、舰长和醒目留言更突出。',
    patch: {
      MsgGap: 4, FontScale: 1, AvatarSize: 25, ShowAvatar: true, ShowUsername: true, ShowBadges: true,
      MessageFontSize: 13, MessageWeight: 600, MessageColor: '#ffffff',
      UserNameFontSize: 13, UserNameWeight: 700, UserNameColor: '#e7f8ef',
      OwnerUserNameColor: '#ff96aa', ModeratorUserNameColor: '#e7a9ff', MemberUserNameColor: '#96deff',
      MessageBgColor: 'transparent', OwnerMessageBgColor: 'rgba(255,214,0,0.16)',
      ModeratorMessageBgColor: 'rgba(94,132,241,0.14)', MemberMessageBgColor: 'rgba(15,157,88,0.13)',
      ShowGiftIcon: true, ShowOutlines: false, BlurryOutline: false, EffectsEnabled: true, EffectIntensity: 1.35,
      AnimateIn: true, FadeInTime: 180, Slide: true, ReverseSlide: false,
    },
  },
  {
    id: 'minimal',
    name: '极简文字',
    hint: '减少装饰和动画，更接近传统弹幕样式。',
    patch: {
      MsgGap: 2, FontScale: 1, AvatarSize: 22, ShowAvatar: false, ShowUsername: true, ShowBadges: false,
      MessageFontSize: 13, MessageWeight: 600, MessageColor: '#ffffff',
      UserNameFontSize: 13, UserNameWeight: 600, UserNameColor: '#f2f2f2',
      OwnerUserNameColor: '#ffd166', ModeratorUserNameColor: '#d8b4fe', MemberUserNameColor: '#93c5fd',
      MessageBgColor: 'transparent', OwnerMessageBgColor: 'transparent',
      ModeratorMessageBgColor: 'transparent', MemberMessageBgColor: 'transparent',
      ShowOutlines: true, OutlineSize: 2, OutlineColor: '#000000', BlurryOutline: true,
      EffectsEnabled: false, EffectIntensity: 1, AnimateIn: true, FadeInTime: 120, Slide: false, ReverseSlide: false,
    },
  },
];

// ─── Sample messages (with identity) ─────────────────────────────────────────

type Identity = 'normal' | 'owner' | 'moderator' | 'member';
type MsgType = 'system' | 'interact' | 'like' | 'danmu' | 'gift' | 'guard' | 'sc' | 'entry';
interface BaseMsg { id: number; type: MsgType; user: string; uid: number; identity: Identity }
interface SystemMsg extends BaseMsg { type: 'system'; text: string }
interface InteractMsg extends BaseMsg { type: 'interact'; action: string }
interface LikeMsg extends BaseMsg { type: 'like'; text: string }
interface DanmuMsg extends BaseMsg { type: 'danmu'; text: string }
interface GiftMsg  extends BaseMsg { type: 'gift'; gift: string; count: number; price: number; icon?: string }
interface GuardMsg extends BaseMsg { type: 'guard'; gift: string }
interface ScMsg    extends BaseMsg { type: 'sc'; text: string; price: number }
interface EntryMsg extends BaseMsg { type: 'entry'; text: string }
type ChatMsg = SystemMsg | InteractMsg | LikeMsg | DanmuMsg | GiftMsg | GuardMsg | ScMsg | EntryMsg;

const SAMPLES: ChatMsg[] = [
  { id: 1,  type: 'system',   user: '系统',       uid: 0,  identity: 'normal',    text: '弹幕服务已连接，等待直播间事件' },
  { id: 2,  type: 'interact', user: '星河来客',   uid: 11, identity: 'normal',    action: '进入直播间' },
  { id: 3,  type: 'danmu',    user: '白桃汽水',   uid: 12, identity: 'normal',    text: '刚进来就看到名场面了' },
  { id: 4,  type: 'like',     user: '小手一点',   uid: 13, identity: 'normal',    text: '点亮了 18 次点赞' },
  { id: 5,  type: 'danmu',    user: '巡场房管',   uid: 14, identity: 'moderator', text: '新来的朋友可以先点个关注' },
  { id: 6,  type: 'gift',     user: '柠檬不酸',   uid: 15, identity: 'normal',    gift: '小花花', count: 9, price: 1, icon: 'flower' },
  { id: 7,  type: 'danmu',    user: '风铃舰长',   uid: 16, identity: 'member',    text: '这段可以切片，节目效果拉满' },
  { id: 8,  type: 'entry',    user: '夜航船长',   uid: 17, identity: 'member',    text: '夜航船长 带着舰队入场' },
  { id: 9,  type: 'guard',    user: '蓝鲸同学',   uid: 18, identity: 'member',    gift: '舰长' },
  { id: 10, type: 'gift',     user: '橘子糖罐',   uid: 19, identity: 'normal',    gift: '能量电池', count: 3, price: 15, icon: 'battery' },
  { id: 11, type: 'sc',       user: '会飞的便签', uid: 20, identity: 'normal',    text: '这个方案可以，主播展开讲讲后面的配置思路', price: 50 },
  { id: 12, type: 'guard',    user: '山海提督',   uid: 21, identity: 'member',    gift: '提督' },
  { id: 13, type: 'sc',       user: '金色麦克风', uid: 22, identity: 'member',    text: '辛苦了，今天这场信息量很足，留个醒目留言做标记', price: 138 },
  { id: 14, type: 'danmu',    user: '主播',       uid: 99, identity: 'owner',     text: '感谢大家，下一段我们看实机效果' },
];

// ─── Palette helpers ─────────────────────────────────────────────────────────

const UC = ['#ff7eb3','#7ec8ff','#7affb2','#ffd17e','#c07eff','#ff9d7e','#7effee'];
const uc = (uid: number) => UC[Math.abs(uid) % UC.length];
const scColor = (p: number) => p >= 500 ? '#ff4444' : p >= 100 ? '#ff8800' : p >= 30 ? '#ffb300' : '#f5c842';
const GUARD: Record<string, { color: string; bg: string; label: string }> = {
  '总督': { color: '#c084fc', bg: 'rgba(192,132,252,0.18)', label: '👑 总督' },
  '提督': { color: '#60a5fa', bg: 'rgba(96,165,250,0.16)',  label: '⭐ 提督' },
  '舰长': { color: '#34d399', bg: 'rgba(52,211,153,0.14)',  label: '⚓ 舰长' },
};

function identityNameColor(cfg: OverlayConfig, id: Identity): string {
  if (id === 'owner')     return cfg.OwnerUserNameColor;
  if (id === 'moderator') return cfg.ModeratorUserNameColor;
  if (id === 'member')    return cfg.MemberUserNameColor;
  return cfg.UserNameColor;
}
function identityBg(cfg: OverlayConfig, id: Identity): string {
  if (id === 'owner')     return cfg.OwnerMessageBgColor;
  if (id === 'moderator') return cfg.ModeratorMessageBgColor;
  if (id === 'member')    return cfg.MemberMessageBgColor;
  return cfg.MessageBgColor || `rgba(0,0,0,${cfg.BgOpacity})`;
}

// ─── Preview message renderers ───────────────────────────────────────────────

function Avatar({ uid, user, size }: { uid: number; user: string; size: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.max(8, size * 0.4), fontWeight: 700, color: '#fff',
      background: uc(uid),
    }}>{(user || '?')[0]}</div>
  );
}

function PreviewGiftIcon({ kind, size }: { kind?: string; size: number }) {
  const isBattery = kind === 'battery';
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: isBattery ? 6 : '50%',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: Math.max(10, size * 0.55),
        fontWeight: 800,
        background: isBattery
          ? 'linear-gradient(135deg,#38bdf8,#2563eb)'
          : 'linear-gradient(135deg,#fb7185,#f59e0b)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
      }}
    >
      {isBattery ? '⚡' : '✦'}
    </span>
  );
}

function outlineStyle(cfg: OverlayConfig): React.CSSProperties {
  if (!cfg.ShowOutlines) return {};
  const w = cfg.OutlineSize, c = cfg.OutlineColor;
  return cfg.BlurryOutline
    ? { textShadow: `0 0 ${w}px ${c}, 0 0 ${w * 2}px ${c}` }
    : { textShadow: `-${w}px -${w}px 0 ${c}, ${w}px -${w}px 0 ${c}, -${w}px ${w}px 0 ${c}, ${w}px ${w}px 0 ${c}` };
}

function animStyle(cfg: OverlayConfig): React.CSSProperties {
  return cfg.AnimateIn ? { animation: `msgIn ${cfg.FadeInTime}ms ease` } : {};
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function TimeSpan({ cfg }: { cfg: OverlayConfig }) {
  if (!cfg.ShowTime) return null;
  return (
    <span style={{
      flexShrink: 0,
      fontSize: cfg.TimeFontSize * cfg.FontScale,
      fontWeight: cfg.TimeWeight, color: cfg.TimeColor,
      alignSelf: 'center', marginRight: 2,
      ...outlineStyle(cfg),
    }}>{nowTime()}</span>
  );
}

function NoticeItem({ msg, cfg, tone }: { msg: SystemMsg | InteractMsg | LikeMsg | EntryMsg; cfg: OverlayConfig; tone: 'system' | 'interact' | 'like' | 'entry' }) {
  const toneMap = {
    system: { fg: '#a7b7d8', bg: 'rgba(77, 91, 125, 0.28)', label: '系统' },
    interact: { fg: '#7dd3fc', bg: 'rgba(14, 165, 233, 0.16)', label: '互动' },
    like: { fg: '#fb7185', bg: 'rgba(244, 63, 94, 0.14)', label: '点赞' },
    entry: { fg: '#c084fc', bg: 'rgba(168, 85, 247, 0.16)', label: '进场' },
  }[tone];
  const text = msg.type === 'interact' ? `${msg.user} ${msg.action}` : msg.type === 'system' ? msg.text : `${msg.user}：${msg.text}`;
  return (
    <div style={{
      ...animStyle(cfg),
      display: 'flex', alignItems: 'center', gap: 7,
      padding: '5px 8px', borderRadius: 6,
      background: toneMap.bg,
      borderLeft: `3px solid ${toneMap.fg}`,
      fontFamily: cfg.MessageFont,
      fontSize: cfg.MessageFontSize * cfg.FontScale,
      color: cfg.MessageColor,
    }}>
      <TimeSpan cfg={cfg} />
      <span style={{ color: toneMap.fg, fontSize: 10, fontWeight: 800, flexShrink: 0, ...outlineStyle(cfg) }}>{toneMap.label}</span>
      <span style={{ color: cfg.MessageColor, fontWeight: cfg.MessageWeight, ...outlineStyle(cfg) }}>{text}</span>
    </div>
  );
}

function DanmuItem({ msg, cfg }: { msg: DanmuMsg; cfg: OverlayConfig }) {
  const nameColor = identityNameColor(cfg, msg.identity);
  const laplaceNameColor = msg.identity === 'owner' ? '#ff96aa' : msg.identity === 'moderator' ? '#e7a9ff' : msg.identity === 'member' ? '#96deff' : '#effee3';
  return (
    <div style={{
      ...animStyle(cfg),
      display: 'flex', alignItems: 'flex-start', gap: 7,
      padding: '5px 8px', borderRadius: 6,
      background: cfg.EffectsEnabled ? 'transparent' : identityBg(cfg, msg.identity),
      textShadow: cfg.EffectsEnabled ? '0 1px 2px rgba(0,0,0,.95)' : undefined,
      wordBreak: 'break-all', lineHeight: 1.5,
      fontSize: cfg.MessageFontSize * cfg.FontScale,
      fontFamily: cfg.MessageFont,
    }}>
      <TimeSpan cfg={cfg} />
      {cfg.ShowAvatar && <Avatar uid={msg.uid} user={msg.user} size={cfg.AvatarSize} />}
      {cfg.ShowUsername && (
        <span style={{
          color: cfg.EffectsEnabled ? laplaceNameColor : nameColor, flexShrink: 0,
          fontFamily: cfg.UserNameFont,
          fontSize: cfg.UserNameFontSize * cfg.FontScale,
          fontWeight: cfg.UserNameWeight,
          ...outlineStyle(cfg),
        }}>{msg.user}：</span>
      )}
      <span style={{
        color: cfg.MessageColor, fontWeight: cfg.MessageWeight,
        ...outlineStyle(cfg),
      }}>{msg.text}</span>
    </div>
  );
}

function GiftItem({ msg, cfg }: { msg: GiftMsg; cfg: OverlayConfig }) {
  const accent = cfg.EffectsEnabled ? '#e91e63' : '#ffa500';
  const priceColor = cfg.EffectsEnabled ? '#ffc107' : '#ffa500';
  return (
    <div style={{
      ...animStyle(cfg),
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 8px', borderRadius: 6,
      background: cfg.EffectsEnabled ? 'rgba(233,30,99,.2)' : identityBg(cfg, msg.identity),
      borderLeft: `3px solid ${accent}`,
      textShadow: cfg.EffectsEnabled ? '0 1px 2px rgba(0,0,0,.95)' : undefined,
      fontFamily: cfg.MessageFont,
      fontSize: cfg.MessageFontSize * cfg.FontScale,
    }}>
      <TimeSpan cfg={cfg} />
      {cfg.ShowAvatar && <Avatar uid={msg.uid} user={msg.user} size={cfg.AvatarSize} />}
      {cfg.ShowUsername && (
        <span style={{ color: uc(msg.uid), fontWeight: cfg.UserNameWeight,
          fontSize: cfg.UserNameFontSize * cfg.FontScale, flexShrink: 0, ...outlineStyle(cfg) }}>{msg.user}</span>
      )}
      <span style={{ color: '#ccc', fontSize: cfg.MessageFontSize * cfg.FontScale - 1 }}>赠送</span>
      {cfg.ShowGiftIcon && <PreviewGiftIcon kind={msg.icon} size={Math.max(16, cfg.AvatarSize * 0.9)} />}
      <span style={{ color: priceColor, fontWeight: 600, flex: 1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...outlineStyle(cfg) }}>{msg.gift}</span>
      {msg.count > 1 && <span style={{ color: priceColor, fontWeight: 800, flexShrink: 0,
        ...outlineStyle(cfg) }}>×{msg.count}</span>}
    </div>
  );
}

function GuardItem({ msg, cfg }: { msg: GuardMsg; cfg: OverlayConfig }) {
  const g = GUARD[msg.gift] ?? GUARD['舰长'];
  return (
    <div style={{
      ...animStyle(cfg),
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 8px', borderRadius: 6,
      background: g.bg, borderLeft: `3px solid ${g.color}`,
      textShadow: cfg.EffectsEnabled ? '0 1px 2px rgba(0,0,0,.95)' : undefined,
      fontFamily: cfg.MessageFont,
      fontSize: cfg.MessageFontSize * cfg.FontScale,
    }}>
      <TimeSpan cfg={cfg} />
      {cfg.ShowAvatar && <Avatar uid={msg.uid} user={msg.user} size={cfg.AvatarSize} />}
      <span style={{ color: g.color, fontWeight: 700, flexShrink: 0, ...outlineStyle(cfg) }}>{g.label}</span>
      {cfg.ShowUsername && (
        <span style={{ color: uc(msg.uid), fontWeight: cfg.UserNameWeight,
          fontSize: cfg.UserNameFontSize * cfg.FontScale, flexShrink: 0, ...outlineStyle(cfg) }}>{msg.user}</span>
      )}
      <span style={{ color: '#ccc', fontSize: cfg.MessageFontSize * cfg.FontScale - 1 }}>开通了</span>
      <span style={{ color: g.color, fontWeight: 800, ...outlineStyle(cfg) }}>{msg.gift}</span>
    </div>
  );
}

function ScItem({ msg, cfg }: { msg: ScMsg; cfg: OverlayConfig }) {
  const c = scColor(msg.price);
  const laplaceSc = cfg.EffectsEnabled;
  return (
    <div style={{
      ...animStyle(cfg),
      borderRadius: laplaceSc ? 6 : 8,
      overflow: 'hidden',
      border: laplaceSc ? undefined : `1.5px solid ${c}44`,
      borderLeft: laplaceSc ? '3px solid #ff9800' : undefined,
      background: laplaceSc ? 'rgba(255,152,0,.2)' : undefined,
      textShadow: laplaceSc ? '0 1px 2px rgba(0,0,0,.95)' : undefined,
      fontFamily: cfg.MessageFont,
    }}>
      <div style={{ background: laplaceSc ? 'transparent' : `${c}33`, padding: laplaceSc ? '5px 8px 0' : '5px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <TimeSpan cfg={cfg} />
        {cfg.ShowAvatar && <Avatar uid={msg.uid} user={msg.user} size={cfg.AvatarSize} />}
        <span style={{
          color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontSize: cfg.FirstLineFontSize * cfg.FontScale, fontWeight: cfg.FirstLineWeight,
          ...outlineStyle(cfg),
        }}>{msg.user}</span>
        <span style={{
          color: c, flexShrink: 0,
          fontSize: cfg.SecondLineFontSize * cfg.FontScale, fontWeight: cfg.SecondLineWeight,
          ...outlineStyle(cfg),
        }}>¥{msg.price}</span>
      </div>
      <div style={{ background: laplaceSc ? 'transparent' : 'rgba(0,0,0,0.82)', padding: laplaceSc ? '2px 8px 6px' : '6px 8px' }}>
        <span style={{
          color: cfg.MessageColor,
          fontSize: cfg.ScContentFontSize * cfg.FontScale,
          fontWeight: cfg.ScContentWeight,
          lineHeight: 1.5,
          ...outlineStyle(cfg),
        }}>{msg.text}</span>
      </div>
    </div>
  );
}

function MessageItem({ msg, cfg }: { msg: ChatMsg; cfg: OverlayConfig }) {
  switch (msg.type) {
    case 'system': return <NoticeItem msg={msg} cfg={cfg} tone="system" />;
    case 'interact': return <NoticeItem msg={msg} cfg={cfg} tone="interact" />;
    case 'like': return <NoticeItem msg={msg} cfg={cfg} tone="like" />;
    case 'danmu': return <DanmuItem msg={msg} cfg={cfg} />;
    case 'gift':  return <GiftItem  msg={msg} cfg={cfg} />;
    case 'guard': return <GuardItem msg={msg} cfg={cfg} />;
    case 'sc':    return <ScItem    msg={msg} cfg={cfg} />;
    case 'entry': return <NoticeItem msg={msg} cfg={cfg} tone="entry" />;
  }
}

function previewEffectStyle(msg: ChatMsg, cfg: OverlayConfig): React.CSSProperties | undefined {
  if (!cfg.EffectsEnabled || (msg.type !== 'gift' && msg.type !== 'guard' && msg.type !== 'sc')) return undefined;
  if (msg.type === 'gift') {
    return { boxShadow: 'inset 0 0 0 1px rgba(233,30,99,0.14)' };
  }
  if (msg.type === 'guard') {
    return { animation: 'previewFxGlow 2600ms ease-in-out infinite', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' };
  }
  return { animation: 'previewFxGlow 2200ms ease-in-out infinite', boxShadow: 'inset 0 0 0 1px rgba(255,152,0,0.12)' };
}

interface PreviewEntry {
  msg: ChatMsg;
  key: string;
}

function PreviewScene({ cfg, previewEntries }: {
  cfg: OverlayConfig;
  previewEntries: PreviewEntry[];
}) {
  const scale = Math.max(0.5, cfg.GlobalScale);
  const previewCfg = { ...cfg, AnimateIn: false };
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute bottom-0 left-0 top-0 flex w-full items-end overflow-hidden">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              gap: `${cfg.MsgGap}px`,
              height: `${100 / scale}%`,
              maxHeight: `${100 / scale}%`,
              overflow: 'hidden',
              transform: `scale(${scale})`,
              transformOrigin: 'bottom left',
              width: `${100 / scale}%`,
              backgroundColor: cfg.BgColor && cfg.BgColor !== 'transparent' ? cfg.BgColor : 'transparent',
              padding: `${8 / scale}px`,
            }}
          >
            {previewEntries.map(({ msg, key }) => (
              <div
                key={key}
                className={cfg.EffectsEnabled && msg.type !== 'danmu' ? 'relative overflow-hidden rounded-[8px]' : undefined}
                style={{
                  ...(cfg.AnimateIn ? { animation: `previewMsgIn ${Math.max(120, cfg.FadeInTime)}ms ease-out` } : {}),
                  ...(previewEffectStyle(msg, cfg) ?? {}),
                }}
              >
                {cfg.EffectsEnabled && msg.type !== 'danmu' && (
                  <span
                    className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[38%]"
                    style={{
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.24), transparent)',
                      opacity: 0.66,
                      animation: `previewFxSweep ${2600 / Math.max(0.4, cfg.EffectIntensity || 1)}ms ease-out 1`,
                      transform: 'translateX(260%) skewX(-16deg)',
                    }}
                  />
                )}
                <MessageItem msg={msg} cfg={previewCfg} />
              </div>
            ))}
          </div>
      </div>
    </div>
  );
}

function PreviewToolbarButton({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-7 rounded-md px-3 text-[11px] font-semibold transition-colors ${
        active
          ? 'bg-white text-[#151922] shadow-sm'
          : 'text-white/72 hover:bg-white/12 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Form components ─────────────────────────────────────────────────────────

function Section({ title, defaultOpen, wide, children }: { title: string; defaultOpen?: boolean; wide?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className={`glass-card overflow-hidden rounded-[18px] ${wide ? '' : ''}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-[12px] font-semibold text-[var(--foreground)] hover:bg-[var(--button-ghost-hover)]"
      >
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary-color)]" />
          {title}
        </span>
        <span className={`transition-transform text-[10px] ${open ? 'rotate-90' : ''} text-[var(--muted-text)]`}>▶</span>
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 mb-2.5">{children}</div>;
}

function Label({ children, w = 86 }: { children: React.ReactNode; w?: number }) {
  return <span className="text-[11.5px] text-gray-600 dark:text-gray-300 shrink-0" style={{ width: w }}>{children}</span>;
}

function Val({ children }: { children: React.ReactNode }) {
  return <span className="text-[10.5px] font-mono text-gray-400 dark:text-gray-500 w-12 text-right shrink-0">{children}</span>;
}

function Slider({ min, max, step, value, onChange }:
  { min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="flex-1 accent-[var(--primary-color)] h-1.5" />
  );
}

function NumInput({ value, min, max, step = 1, onChange, w = 64 }:
  { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; w?: number }) {
  return (
    <input type="number" value={value} min={min} max={max} step={step}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: w }}
      className="h-7 px-2 text-[11.5px] rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--control-text)] focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]/50" />
  );
}

function ColorBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // For rgba() inputs we render the swatch only; for hex we open native picker
  const isHex = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <div className="flex items-center gap-1.5">
      <input type="color" value={isHex ? value : '#000000'}
        onChange={e => onChange(e.target.value)}
        className="w-7 h-7 rounded-lg cursor-pointer border border-[var(--control-border)] bg-[var(--control-bg)]" />
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        className="w-[120px] h-7 px-2 text-[10.5px] font-mono rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--control-text)] focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]/50" />
    </div>
  );
}

function OToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-[var(--primary-color)]' : 'bg-gray-200 dark:bg-white/15'}`}>
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 mb-2.5">
      <span className="text-[11.5px] text-gray-600 dark:text-gray-300 flex-1">{label}</span>
      <OToggle checked={checked} onChange={onChange} />
    </div>
  );
}

function SelectRow({ label, value, options, onChange }:
  { label: string; value: number; options: { v: number; l: string }[]; onChange: (v: number) => void }) {
  return (
    <Row>
      <Label>{label}</Label>
      <select value={value} onChange={e => onChange(Number(e.target.value))}
        className="flex-1 h-7 px-2 text-[11px] rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--control-text)] focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]/50">
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </Row>
  );
}

const FONT_WEIGHTS = [
  { v: 300, l: '细 300' }, { v: 400, l: '常规 400' }, { v: 500, l: '中 500' },
  { v: 600, l: '半粗 600' }, { v: 700, l: '粗 700' }, { v: 800, l: '特粗 800' },
];
type SettingsTab = 'base' | 'text' | 'background' | 'events' | 'motion' | 'css';
const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'base', label: '基础' },
  { id: 'text', label: '文字' },
  { id: 'background', label: '背景' },
  { id: 'events', label: '事件' },
  { id: 'motion', label: '动画' },
  { id: 'css', label: '高级 CSS' },
];

// ─── Main component ──────────────────────────────────────────────────────────

export function ChatOverlay() {
  const [cfg, setCfg] = useState<OverlayConfig>(DEFAULT_CFG);
  const [loaded, setLoaded] = useState(false);
  const [overlayUrl, setOverlayUrl] = useState('');
  const [urlCopied, setUrlCopied] = useState(false);
  const [demoOpened, setDemoOpened] = useState(false);
  const [previewLight, setPreviewLight] = useState(true);
  const [previewRunning, setPreviewRunning] = useState(true);
  const [previewCursor, setPreviewCursor] = useState(0);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('base');
  const [animKey, setAnimKey] = useState(0);

  const dragRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);

  // ── Theme + keyframes ────────────────────────────────────────────────────
  useEffect(() => {
    applyStoredTheme();
    const previousBodyBackground = document.body.style.background;
    const previousHtmlBackground = document.documentElement.style.background;
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    const style = document.createElement('style');
    style.id = 'overlay-keyframes';
    style.textContent = `
      @keyframes msgIn  { from { opacity:0; transform:translateY(5px) } to { opacity:1; transform:none } }
      @keyframes msgOut { from { opacity:1 } to { opacity:0; transform:translateY(-4px) } }
      @keyframes previewMsgIn { from { opacity:0; transform:translateY(-2px) } to { opacity:1; transform:none } }
      @keyframes previewFxSweep { from { transform:translateX(-120%) skewX(-16deg) } to { transform:translateX(260%) skewX(-16deg) } }
      @keyframes previewFxGlow { 0%,100% { filter:brightness(1) } 50% { filter:brightness(1.16) } }
    `;
    document.head.appendChild(style);
    window.addEventListener('storage', applyStoredTheme);
    window.addEventListener('focus', applyStoredTheme);
    return () => {
      style.remove();
      document.body.style.background = previousBodyBackground;
      document.documentElement.style.background = previousHtmlBackground;
      window.removeEventListener('storage', applyStoredTheme);
      window.removeEventListener('focus', applyStoredTheme);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const win = getCurrentWindow();
        win.show().catch(() => {});
        win.setFocus().catch(() => {});
      });
    });
    return () => { cancelled = true; };
  }, [loaded]);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    api.loadOverlayConfig().then(c => {
      setCfg({ ...c, Theme: c.Theme || DEFAULT_CFG.Theme, CustomCss: c.CustomCss || DEFAULT_CUSTOM_CSS });
      setLoaded(true);
    }).catch(() => setLoaded(true));
    api.getOverlayUrl().then(setOverlayUrl).catch(() => {});
  }, []);

  // ── Debounced auto-save ───────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.saveOverlayConfig(cfg).catch(() => {});
    }, 350);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [cfg, loaded]);

  // ── Replay preview animation when fade-in settings change ─────────────────
  useEffect(() => {
    setAnimKey(k => k + 1);
  }, [cfg.AnimateIn, cfg.FadeInTime, cfg.Slide, cfg.ReverseSlide]);

  // ── Notify main window on close so Danmu.tsx syncs button state ──────────
  const closeOverlay = () => {
    emit('overlay-closed').catch(() => {});
    getCurrentWindow().close().catch(() => {});
  };
  // Fallback for Cmd+W / external close
  useEffect(() => {
    const onUnload = () => { emit('overlay-closed').catch(() => {}); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditing = target?.closest('input, textarea, select, [contenteditable="true"]');
      const isCloseShortcut = e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w');
      if (!isCloseShortcut) return;
      if (isEditing && e.key !== 'Escape') return;
      e.preventDefault();
      closeOverlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── Native drag ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = dragRef.current;
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, input, a, select, textarea')) return;
      e.preventDefault();
      getCurrentWindow().startDragging().catch(err =>
        console.error('[overlay] startDragging failed:', err),
      );
    };
    el.addEventListener('mousedown', onDown);
    return () => el.removeEventListener('mousedown', onDown);
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const u = <K extends keyof OverlayConfig>(k: K, v: OverlayConfig[K]) =>
    setCfg(prev => ({ ...prev, [k]: v }));

  const activeTheme = OVERLAY_THEMES.find(theme => theme.id === cfg.Theme) ?? OVERLAY_THEMES[0];
  const applyOverlayTheme = (themeId: OverlayThemeId) => {
    const theme = OVERLAY_THEMES.find(item => item.id === themeId);
    if (!theme) return;
    setCfg(prev => ({ ...prev, ...theme.patch, Theme: theme.id }));
  };

  const resetAll = () => {
    if (confirm('确认重置所有浮层样式为默认值？')) setCfg({ ...DEFAULT_CFG, Port: cfg.Port });
  };

  const copyUrl = () => {
    if (!overlayUrl) return;
    navigator.clipboard.writeText(overlayUrl).then(() => {
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1800);
    }).catch(() => {});
  };

  const openDemoPreview = () => {
    if (!overlayUrl) return;
    const joiner = overlayUrl.includes('?') ? '&' : '?';
    api.openUrl(`${overlayUrl}${joiner}demo=1`).then(() => {
      setDemoOpened(true);
      setTimeout(() => setDemoOpened(false), 1800);
    }).catch(() => {});
  };

  const replayPreview = () => {
    setPreviewCursor(0);
    setAnimKey(k => k + 1);
  };


  const renderSettingsTab = () => {
    switch (activeSettingsTab) {
      case 'base':
        return <div className="grid grid-cols-1 gap-3.5">
          <Section title="全局缩放" defaultOpen>
            <Row><Label>整体缩放</Label>
              <Slider min={0.5} max={2.0} step={0.05} value={cfg.GlobalScale} onChange={v => u('GlobalScale', v)} />
              <Val>{cfg.GlobalScale.toFixed(2)}×</Val>
            </Row>
            <Row><Label>字号缩放</Label>
              <Slider min={0.5} max={2.0} step={0.05} value={cfg.FontScale} onChange={v => u('FontScale', v)} />
              <Val>{cfg.FontScale.toFixed(2)}×</Val>
            </Row>
          </Section>
          <Section title="头像" defaultOpen>
            <ToggleRow label="显示头像" checked={cfg.ShowAvatar} onChange={v => u('ShowAvatar', v)} />
            <Row><Label>头像大小</Label>
              <Slider min={16} max={48} step={1} value={cfg.AvatarSize} onChange={v => u('AvatarSize', v)} />
              <Val>{cfg.AvatarSize}px</Val>
            </Row>
          </Section>
          <Section title="性能" defaultOpen>
            <Row><Label>最大保留</Label>
              <Slider min={10} max={200} step={5} value={cfg.MaxMsgs} onChange={v => u('MaxMsgs', v)} />
              <Val>{cfg.MaxMsgs}条</Val>
            </Row>
            <Row><Label>消息间距</Label>
              <Slider min={0} max={20} step={1} value={cfg.MsgGap} onChange={v => u('MsgGap', v)} />
              <Val>{cfg.MsgGap}px</Val>
            </Row>
          </Section>
        </div>;
      case 'text':
        return <div className="grid grid-cols-1 gap-3.5">
          <Section title="用户名" defaultOpen>
            <ToggleRow label="显示用户名" checked={cfg.ShowUsername} onChange={v => u('ShowUsername', v)} />
            <ToggleRow label="显示身份徽章" checked={cfg.ShowBadges} onChange={v => u('ShowBadges', v)} />
            <Row><Label>字号</Label>
              <Slider min={10} max={24} step={1} value={cfg.UserNameFontSize} onChange={v => u('UserNameFontSize', v)} />
              <Val>{cfg.UserNameFontSize}px</Val>
            </Row>
            <SelectRow label="粗细" value={cfg.UserNameWeight} options={FONT_WEIGHTS} onChange={v => u('UserNameWeight', v)} />
            <Row><Label>普通颜色</Label><ColorBox value={cfg.UserNameColor} onChange={v => u('UserNameColor', v)} /></Row>
            <Row><Label>主播颜色</Label><ColorBox value={cfg.OwnerUserNameColor} onChange={v => u('OwnerUserNameColor', v)} /></Row>
            <Row><Label>房管颜色</Label><ColorBox value={cfg.ModeratorUserNameColor} onChange={v => u('ModeratorUserNameColor', v)} /></Row>
            <Row><Label>舰长颜色</Label><ColorBox value={cfg.MemberUserNameColor} onChange={v => u('MemberUserNameColor', v)} /></Row>
          </Section>
          <Section title="消息文本" defaultOpen>
            <Row><Label>字号</Label>
              <Slider min={11} max={28} step={1} value={cfg.MessageFontSize} onChange={v => u('MessageFontSize', v)} />
              <Val>{cfg.MessageFontSize}px</Val>
            </Row>
            <SelectRow label="粗细" value={cfg.MessageWeight} options={FONT_WEIGHTS} onChange={v => u('MessageWeight', v)} />
            <Row><Label>颜色</Label><ColorBox value={cfg.MessageColor} onChange={v => u('MessageColor', v)} /></Row>
          </Section>
          <Section title="时间" defaultOpen>
            <ToggleRow label="显示时间" checked={cfg.ShowTime} onChange={v => u('ShowTime', v)} />
            <Row><Label>字号</Label>
              <Slider min={9} max={20} step={1} value={cfg.TimeFontSize} onChange={v => u('TimeFontSize', v)} />
              <Val>{cfg.TimeFontSize}px</Val>
            </Row>
            <SelectRow label="粗细" value={cfg.TimeWeight} options={FONT_WEIGHTS} onChange={v => u('TimeWeight', v)} />
            <Row><Label>颜色</Label><ColorBox value={cfg.TimeColor} onChange={v => u('TimeColor', v)} /></Row>
          </Section>
        </div>;
      case 'background':
        return <div className="grid grid-cols-1 gap-3.5">
          <Section title="背景" defaultOpen>
            <Row><Label>整体背景</Label><ColorBox value={cfg.BgColor} onChange={v => u('BgColor', v)} /></Row>
            <Row><Label>普通透明度</Label>
              <Slider min={0} max={1} step={0.02} value={cfg.BgOpacity} onChange={v => u('BgOpacity', v)} />
              <Val>{cfg.BgOpacity.toFixed(2)}</Val>
            </Row>
            <Row><Label>普通背景</Label><ColorBox value={cfg.MessageBgColor} onChange={v => u('MessageBgColor', v)} /></Row>
            <Row><Label>主播背景</Label><ColorBox value={cfg.OwnerMessageBgColor} onChange={v => u('OwnerMessageBgColor', v)} /></Row>
            <Row><Label>房管背景</Label><ColorBox value={cfg.ModeratorMessageBgColor} onChange={v => u('ModeratorMessageBgColor', v)} /></Row>
            <Row><Label>舰长背景</Label><ColorBox value={cfg.MemberMessageBgColor} onChange={v => u('MemberMessageBgColor', v)} /></Row>
          </Section>
          <Section title="描边" defaultOpen>
            <ToggleRow label="启用描边" checked={cfg.ShowOutlines} onChange={v => u('ShowOutlines', v)} />
            <Row><Label>描边宽度</Label>
              <Slider min={1} max={6} step={1} value={cfg.OutlineSize} onChange={v => u('OutlineSize', v)} />
              <Val>{cfg.OutlineSize}px</Val>
            </Row>
            <Row><Label>描边颜色</Label><ColorBox value={cfg.OutlineColor} onChange={v => u('OutlineColor', v)} /></Row>
            <ToggleRow label="模糊描边" checked={cfg.BlurryOutline} onChange={v => u('BlurryOutline', v)} />
          </Section>
        </div>;
      case 'events':
        return <div className="grid grid-cols-1 gap-3.5">
          <Section title="消息过滤" defaultOpen>
            <ToggleRow label="显示礼物" checked={cfg.ShowGift} onChange={v => u('ShowGift', v)} />
            <ToggleRow label="读取礼物图标" checked={cfg.ShowGiftIcon} onChange={v => u('ShowGiftIcon', v)} />
            <Row><Label>礼物起价</Label>
              <NumInput value={cfg.GiftMinCost} min={0} step={1} onChange={v => u('GiftMinCost', v)} />
              <span className="text-[10.5px] text-gray-400">元，0=不限</span>
            </Row>
            <ToggleRow label="显示舰长" checked={cfg.ShowGuard} onChange={v => u('ShowGuard', v)} />
            <ToggleRow label="显示 SC" checked={cfg.ShowSc} onChange={v => u('ShowSc', v)} />
            <Row><Label>SC 起价</Label>
              <NumInput value={cfg.ScMinCost} min={0} step={1} onChange={v => u('ScMinCost', v)} />
              <span className="text-[10.5px] text-gray-400">元，0=不限</span>
            </Row>
          </Section>
          <Section title="SuperChat / 上舰" defaultOpen>
            <Row><Label>第一行字号</Label>
              <Slider min={11} max={28} step={1} value={cfg.FirstLineFontSize} onChange={v => u('FirstLineFontSize', v)} />
              <Val>{cfg.FirstLineFontSize}px</Val>
            </Row>
            <SelectRow label="第一行粗细" value={cfg.FirstLineWeight} options={FONT_WEIGHTS} onChange={v => u('FirstLineWeight', v)} />
            <Row><Label>第二行字号</Label>
              <Slider min={11} max={28} step={1} value={cfg.SecondLineFontSize} onChange={v => u('SecondLineFontSize', v)} />
              <Val>{cfg.SecondLineFontSize}px</Val>
            </Row>
            <SelectRow label="第二行粗细" value={cfg.SecondLineWeight} options={FONT_WEIGHTS} onChange={v => u('SecondLineWeight', v)} />
            <Row><Label>正文字号</Label>
              <Slider min={11} max={28} step={1} value={cfg.ScContentFontSize} onChange={v => u('ScContentFontSize', v)} />
              <Val>{cfg.ScContentFontSize}px</Val>
            </Row>
            <SelectRow label="正文粗细" value={cfg.ScContentWeight} options={FONT_WEIGHTS} onChange={v => u('ScContentWeight', v)} />
          </Section>
        </div>;
      case 'motion':
        return <div className="grid grid-cols-1 gap-3.5">
          <Section title="动画" defaultOpen>
            <ToggleRow label="入场淡入" checked={cfg.AnimateIn} onChange={v => u('AnimateIn', v)} />
            <Row><Label>淡入时长</Label>
              <Slider min={0} max={1000} step={20} value={cfg.FadeInTime} onChange={v => u('FadeInTime', v)} />
              <Val>{cfg.FadeInTime}ms</Val>
            </Row>
            <ToggleRow label="自动淡出" checked={cfg.AnimateOut} onChange={v => u('AnimateOut', v)} />
            <Row><Label>淡出时长</Label>
              <Slider min={0} max={2000} step={50} value={cfg.FadeOutTime} onChange={v => u('FadeOutTime', v)} />
              <Val>{cfg.FadeOutTime}ms</Val>
            </Row>
            <Row><Label>停留秒数</Label>
              <Slider min={5} max={120} step={1} value={cfg.AnimateOutWaitTime} onChange={v => u('AnimateOutWaitTime', v)} />
              <Val>{cfg.AnimateOutWaitTime}s</Val>
            </Row>
            <ToggleRow label="滑动入场" checked={cfg.Slide} onChange={v => u('Slide', v)} />
            <ToggleRow label="反向滑动" checked={cfg.ReverseSlide} onChange={v => u('ReverseSlide', v)} />
          </Section>
          <Section title="特效" defaultOpen>
            <ToggleRow label="启用礼物 / SC / 上舰特效" checked={cfg.EffectsEnabled} onChange={v => u('EffectsEnabled', v)} />
            <Row><Label>特效强度</Label>
              <Slider min={0.4} max={1.8} step={0.1} value={cfg.EffectIntensity} onChange={v => u('EffectIntensity', v)} />
              <Val>{cfg.EffectIntensity.toFixed(1)}×</Val>
            </Row>
          </Section>
        </div>;
      case 'css':
        return <div className="grid grid-cols-1 gap-3.5">
          <Section title="自定义 CSS" wide defaultOpen>
            <textarea value={cfg.CustomCss} onChange={e => u('CustomCss', e.target.value)}
              rows={24} placeholder="/* 任何 CSS 都会注入到浮层网页 */"
              className="w-full px-3 py-2 text-[11px] font-mono rounded-2xl border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--control-text)] focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]/50 resize-none" />
          </Section>
        </div>;
    }
  };

  // ── Filtered preview messages ────────────────────────────────────────────
  const previewMsgs = useMemo(() => SAMPLES.filter(m => {
    if (m.type === 'gift')  return cfg.ShowGift  && (cfg.GiftMinCost === 0 || (m as GiftMsg).price >= cfg.GiftMinCost);
    if (m.type === 'guard') return cfg.ShowGuard;
    if (m.type === 'sc')    return cfg.ShowSc    && (cfg.ScMinCost   === 0 || (m as ScMsg).price  >= cfg.ScMinCost);
    return true;
  }), [cfg]);

  // ── Dynamic preview feed ─────────────────────────────────────────────────
  useEffect(() => {
    if (!previewRunning || previewMsgs.length === 0) return;
    const timer = window.setInterval(() => {
      setPreviewCursor(c => c + 1);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [previewRunning, previewMsgs.length]);

  const previewEntries = useMemo<PreviewEntry[]>(() => {
    if (previewMsgs.length === 0) return [];
    const visible = Math.min(12, previewMsgs.length);
    return Array.from({ length: visible }, (_, i) => {
      const seq = previewCursor - visible + 1 + i;
      const idx = ((seq % previewMsgs.length) + previewMsgs.length) % previewMsgs.length;
      const msg = previewMsgs[idx];
      return { msg, key: `${animKey}-${seq}-${msg.id}` };
    });
  }, [animKey, previewCursor, previewMsgs]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 overflow-hidden bg-transparent p-2 text-[var(--foreground)]">
      <div className="glass-card relative flex h-full min-h-[584px] min-w-[884px] flex-col overflow-hidden rounded-[28px] [clip-path:inset(0_round_28px)]">

      {/* Title bar (drag) */}
      <div ref={dragRef}
        className="relative z-10 flex items-center shrink-0 h-10 px-4 gap-2 cursor-move border-b border-[var(--topbar-border)] bg-[var(--topbar-bg)] select-none">
        <div className="h-2 w-2 rounded-full bg-[var(--primary-color)] opacity-80 pointer-events-none" />
        <span className="text-[12px] font-semibold flex-1 text-[var(--muted-text)] pointer-events-none">
          弹幕浮层 · 样式设置
        </span>
        <button
          onClick={closeOverlay}
          aria-label="关闭弹幕设置"
          title="关闭弹幕设置"
          className="h-7 rounded-full border border-red-400/35 bg-red-500/10 px-3 text-[12px] font-semibold text-red-600 shadow-sm transition-colors hover:border-red-400/65 hover:bg-red-500 hover:text-white dark:text-red-300"
        >
          关闭
        </button>
      </div>

      {/* Body */}
      <div className="relative z-10 flex flex-1 overflow-hidden max-[1040px]:flex-col">

        {/* Left: settings panel */}
        <div className="w-[clamp(440px,48vw,620px)] shrink-0 flex flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] max-[1040px]:h-[52%] max-[1040px]:w-full max-[1040px]:border-b max-[1040px]:border-r-0">
          <div className="shrink-0 p-4">
            <div className="glass-card rounded-[18px] px-5 py-4">
            <div>
              <div>
                <div className="text-[16px] font-bold text-[var(--foreground)]">浮层样式控制台</div>
                <div className="mt-1 text-[11px] text-[var(--muted-text)]">修改会自动保存，右侧只负责预览效果</div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input readOnly value={overlayUrl}
                  onClick={e => (e.target as HTMLInputElement).select()}
                  className="h-8 min-w-[220px] flex-1 px-3 text-[11px] font-mono rounded-full border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--control-text)] truncate" />
                <button onClick={copyUrl}
                  className="h-8 px-4 text-[11px] font-semibold rounded-full bg-[var(--primary-color)] text-white shadow-[0_10px_28px_rgba(var(--primary-rgb),0.28)] hover:opacity-90 shrink-0">
                  {urlCopied ? '已复制 ✓' : '复制'}
                </button>
                <button onClick={openDemoPreview}
                  className="h-8 px-4 text-[11px] font-semibold rounded-full border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--control-text)] hover:bg-[var(--button-ghost-hover)] shrink-0">
                  {demoOpened ? '已打开' : '测试预览'}
                </button>
              </div>
            </div>
            </div>
          </div>

          <div className="shrink-0 px-4 pb-3">
            <div className="glass-card rounded-[18px] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] font-bold text-[var(--foreground)]">主题方案</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-[var(--muted-text)]">{activeTheme.hint}</div>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--button-ghost-hover)] px-2.5 py-1 text-[10px] font-semibold text-[var(--primary-color)]">
                  CSS 叠加
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5 max-[1040px]:grid-cols-6">
                {OVERLAY_THEMES.map(theme => {
                  const active = activeTheme.id === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => applyOverlayTheme(theme.id)}
                      title={theme.hint}
                      className={`h-8 rounded-xl px-2 text-[11px] font-semibold transition-colors ${
                        active
                          ? 'bg-[var(--primary-color)] text-white shadow-sm'
                          : 'border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--control-text)] hover:bg-[var(--button-ghost-hover)]'
                      }`}
                    >
                      {theme.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="shrink-0 px-4 pb-3">
            <div className="grid grid-cols-6 gap-1 rounded-2xl border border-[var(--surface-border)] bg-[var(--control-bg)] p-1 max-[1040px]:grid-cols-3">
              {SETTINGS_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveSettingsTab(tab.id)}
                  className={`h-8 rounded-xl text-[11px] font-semibold transition-colors ${
                    activeSettingsTab === tab.id
                      ? 'bg-[var(--primary-color)] text-white shadow-sm'
                      : 'text-[var(--muted-text)] hover:bg-[var(--button-ghost-hover)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4 [scrollbar-width:thin] [scrollbar-color:rgba(128,128,128,0.18)_transparent]">
            {renderSettingsTab()}
          </div>

          <div className="glass-card shrink-0 m-4 mt-0 flex items-center gap-2 rounded-[18px] px-3 py-3">
            <button onClick={resetAll}
              className="flex-1 h-9 text-[11.5px] font-semibold rounded-full text-[var(--muted-text)] hover:bg-[var(--button-ghost-hover)]">
              重置默认
            </button>
            <span className="rounded-full bg-emerald-500/10 px-3 py-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">自动保存</span>
          </div>
        </div>

        {/* Right: preview */}
        <div
          className="flex-1 flex flex-col"
          style={{
            background: previewLight
              ? 'linear-gradient(135deg, rgba(255,255,255,0.72), rgba(232,238,246,0.52)), repeating-conic-gradient(#f0f3f7 0% 25%, #dfe5ec 0% 50%) 50% / 24px 24px'
              : 'linear-gradient(135deg, rgba(20,24,32,0.72), rgba(10,12,18,0.56)), repeating-conic-gradient(#232833 0% 25%, #171b24 0% 50%) 50% / 24px 24px',
          }}
        >
          <div className="shrink-0 flex items-center gap-2 px-4 h-11 border-b border-white/10 bg-black/45 shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
            <PreviewToolbarButton active={previewRunning} onClick={() => setPreviewRunning(v => !v)}>
              {previewRunning ? '暂停滚动' : '继续滚动'}
            </PreviewToolbarButton>
            <PreviewToolbarButton onClick={replayPreview}>重播动画</PreviewToolbarButton>
            <span className="flex-1" />
            <div className="flex rounded-lg border border-white/12 bg-white/8 p-0.5">
              <PreviewToolbarButton active={!previewLight} onClick={() => setPreviewLight(false)}>暗色</PreviewToolbarButton>
              <PreviewToolbarButton active={previewLight} onClick={() => setPreviewLight(true)}>亮色</PreviewToolbarButton>
            </div>
          </div>

          <div className="flex-1 overflow-hidden relative">
            {previewLight && (
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/42 via-black/18 to-transparent" />
            )}
            <PreviewScene cfg={cfg} previewEntries={previewEntries} />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
