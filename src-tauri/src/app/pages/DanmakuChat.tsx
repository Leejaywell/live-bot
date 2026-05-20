import { useEffect, useMemo, useRef, useState } from 'react';
import { api, DanmakuChatConfig } from '../lib/api';
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

// ─── Default config (mirrors Rust DanmakuChatConfig::default) ────────────────────

const DEFAULT_CUSTOM_CSS = '';

const DEFAULT_CFG: DanmakuChatConfig = {
  Port: 12450, MaxMsgs: 100, MsgGap: 8, Theme: 'classic', CustomCss: DEFAULT_CUSTOM_CSS,
  GlobalScale: 1, FontScale: 1,
  ShowAvatar: true, AvatarSize: 30,
  ShowUsername: true, UserNameFont: 'PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif',
  UserNameFontSize: 20, UserNameWeight: 600,
  UserNameColor: '#effee3',
  OwnerUserNameColor: '#ff96aa', ModeratorUserNameColor: '#e7a9ff', MemberUserNameColor: '#96deff',
  ShowBadges: false,
  MessageFont: 'PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif',
  MessageFontSize: 20, MessageWeight: 600, MessageColor: '#ffffff',
  ShowTime: false, TimeFont: 'inherit', TimeFontSize: 16, TimeWeight: 400, TimeColor: '#999999',
  BgColor: 'rgba(0,0,0,0)', BgOpacity: 0.8,
  MessageBgColor: 'transparent',
  OwnerMessageBgColor: 'rgba(255,214,0,0.18)',
  ModeratorMessageBgColor: 'rgba(94,132,241,0.18)',
  MemberMessageBgColor: 'rgba(15,157,88,0.18)',
  ShowGift: true, GiftMinCost: 1, ShowGiftIcon: false, ShowGuard: true, ShowSc: true, ScMinCost: 0,
  FirstLineFontSize: 20, FirstLineWeight: 700,
  SecondLineFontSize: 20, SecondLineWeight: 700,
  ScContentFontSize: 20, ScContentWeight: 600,
  AnimateIn: false, FadeInTime: 200, AnimateOut: false, FadeOutTime: 400, AnimateOutWaitTime: 30,
  Slide: false, ReverseSlide: false,
  EffectsEnabled: false, EffectIntensity: 1,
  ShowOutlines: false, OutlineSize: 2, OutlineColor: '#000000', BlurryOutline: false,
};

type DanmakuChatThemeId = 'classic' | 'mist' | 'contrast' | 'frost' | 'focus' | 'clean';

const DANMAKU_CHAT_THEMES: {
  id: DanmakuChatThemeId;
  name: string;
  patch: Partial<DanmakuChatConfig>;
}[] = [
  {
    id: 'classic',
    name: '默认主题',
    patch: {
      ShowAvatar: true, ShowUsername: true, ShowBadges: false,
      UserNameColor: '#effee3',
      OwnerUserNameColor: '#ff96aa', ModeratorUserNameColor: '#e7a9ff', MemberUserNameColor: '#96deff',
      MessageBgColor: 'transparent', OwnerMessageBgColor: 'rgba(255,214,0,0.18)',
      ModeratorMessageBgColor: 'rgba(94,132,241,0.18)', MemberMessageBgColor: 'rgba(15,157,88,0.18)',
      ShowGiftIcon: false, ShowOutlines: false, BlurryOutline: false, EffectsEnabled: false, EffectIntensity: 1,
      AnimateIn: false, FadeInTime: 200, Slide: false, ReverseSlide: false,
    },
  },
  {
    id: 'mist',
    name: '薄雾透明',
    patch: {
      ShowAvatar: true, ShowUsername: true, ShowBadges: false,
      BgOpacity: 0.72,
      UserNameColor: '#f6fff5',
      OwnerUserNameColor: '#ffb8c9', ModeratorUserNameColor: '#efc1ff', MemberUserNameColor: '#a3e2ff',
      MessageBgColor: 'transparent', OwnerMessageBgColor: 'rgba(255,214,0,0.10)',
      ModeratorMessageBgColor: 'rgba(94,132,241,0.10)', MemberMessageBgColor: 'rgba(15,157,88,0.08)',
      ShowGiftIcon: false, ShowOutlines: false, BlurryOutline: false, EffectsEnabled: false, EffectIntensity: 1,
      AnimateIn: false, FadeInTime: 220, Slide: false, ReverseSlide: false,
    },
  },
  {
    id: 'contrast',
    name: '高对比',
    patch: {
      ShowAvatar: true, ShowUsername: true, ShowBadges: false,
      MessageWeight: 700, MessageColor: '#ffffff',
      UserNameWeight: 800, UserNameColor: '#ffffff',
      OwnerUserNameColor: '#ffd166', ModeratorUserNameColor: '#f0abfc', MemberUserNameColor: '#93c5fd',
      MessageBgColor: 'rgba(0,0,0,0.40)', OwnerMessageBgColor: 'rgba(108,74,0,0.42)',
      ModeratorMessageBgColor: 'rgba(44,54,134,0.42)', MemberMessageBgColor: 'rgba(0,88,68,0.40)',
      ShowOutlines: true, OutlineSize: 3, OutlineColor: '#000000', BlurryOutline: true,
      EffectsEnabled: false, EffectIntensity: 1, AnimateIn: false, FadeInTime: 160, Slide: false, ReverseSlide: false,
    },
  },
  {
    id: 'frost',
    name: '霜蓝通透',
    patch: {
      ShowAvatar: true, ShowUsername: true, ShowBadges: false,
      UserNameWeight: 700,
      UserNameColor: '#eef7ff',
      OwnerUserNameColor: '#ff9fb7', ModeratorUserNameColor: '#cab8ff', MemberUserNameColor: '#96deff',
      MessageBgColor: 'rgba(80,114,196,0.14)',
      OwnerMessageBgColor: 'rgba(255,214,0,0.12)',
      ModeratorMessageBgColor: 'rgba(137,92,255,0.16)',
      MemberMessageBgColor: 'rgba(33,179,255,0.14)',
      ShowGiftIcon: false, ShowOutlines: false, BlurryOutline: false, EffectsEnabled: false, EffectIntensity: 1,
      AnimateIn: true, FadeInTime: 180, Slide: true, ReverseSlide: false,
    },
  },
  {
    id: 'focus',
    name: '特效拉满',
    patch: {
      ShowAvatar: true, ShowUsername: true, ShowBadges: false,
      UserNameWeight: 800, UserNameColor: '#ffffff',
      OwnerUserNameColor: '#ffd166', ModeratorUserNameColor: '#f0abfc', MemberUserNameColor: '#7dd3fc',
      MessageWeight: 700, MessageColor: '#ffffff',
      MessageBgColor: 'rgba(255,255,255,0.06)', OwnerMessageBgColor: 'rgba(255,214,0,0.24)',
      ModeratorMessageBgColor: 'rgba(94,132,241,0.24)', MemberMessageBgColor: 'rgba(15,157,88,0.22)',
      ShowGiftIcon: true, ShowOutlines: true, OutlineSize: 3, OutlineColor: '#000000', BlurryOutline: true,
      EffectsEnabled: true, EffectIntensity: 1.8,
      AnimateIn: true, FadeInTime: 120, Slide: true, ReverseSlide: false,
    },
  },
  {
    id: 'clean',
    name: '纯净文字',
    patch: {
      ShowAvatar: false, ShowUsername: true, ShowBadges: false,
      UserNameWeight: 600, UserNameColor: '#f2f2f2',
      OwnerUserNameColor: '#ffd166', ModeratorUserNameColor: '#d8b4fe', MemberUserNameColor: '#93c5fd',
      MessageBgColor: 'transparent', OwnerMessageBgColor: 'transparent',
      ModeratorMessageBgColor: 'transparent', MemberMessageBgColor: 'transparent',
      ShowOutlines: true, OutlineSize: 2, OutlineColor: '#000000', BlurryOutline: false,
      EffectsEnabled: false, EffectIntensity: 1, AnimateIn: false, FadeInTime: 120, Slide: false, ReverseSlide: false,
    },
  },
];

function normalizeThemeId(themeId?: string): DanmakuChatThemeId {
  if (themeId === 'glass') return 'mist';
  if (themeId === 'wechat' || themeId === 'compact') return 'classic';
  if (themeId === 'gift') return 'focus';
  if (themeId === 'minimal') return 'clean';
  return DANMAKU_CHAT_THEMES.some(theme => theme.id === themeId)
    ? (themeId as DanmakuChatThemeId)
    : 'classic';
}

function resolveThemeDefaults(themeId: string, port: number): DanmakuChatConfig {
  const normalized = normalizeThemeId(themeId);
  const theme = DANMAKU_CHAT_THEMES.find(item => item.id === normalized) ?? DANMAKU_CHAT_THEMES[0];
  return {
    ...DEFAULT_CFG,
    ...theme.patch,
    Port: port,
    Theme: theme.id,
    CustomCss: DEFAULT_CUSTOM_CSS,
  };
}

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

function identityNameColor(cfg: DanmakuChatConfig, id: Identity): string {
  if (id === 'owner')     return cfg.OwnerUserNameColor;
  if (id === 'moderator') return cfg.ModeratorUserNameColor;
  if (id === 'member')    return cfg.MemberUserNameColor;
  return cfg.UserNameColor;
}
function identityBg(cfg: DanmakuChatConfig, id: Identity): string {
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

function outlineStyle(cfg: DanmakuChatConfig): React.CSSProperties {
  if (!cfg.ShowOutlines) return {};
  const w = cfg.OutlineSize, c = cfg.OutlineColor;
  return cfg.BlurryOutline
    ? { textShadow: `0 0 ${w}px ${c}, 0 0 ${w * 2}px ${c}` }
    : { textShadow: `-${w}px -${w}px 0 ${c}, ${w}px -${w}px 0 ${c}, -${w}px ${w}px 0 ${c}, ${w}px ${w}px 0 ${c}` };
}

function animStyle(cfg: DanmakuChatConfig): React.CSSProperties {
  return cfg.AnimateIn ? { animation: `msgIn ${cfg.FadeInTime}ms ease` } : {};
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function TimeSpan({ cfg }: { cfg: DanmakuChatConfig }) {
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

function NoticeItem({ msg, cfg, tone }: { msg: SystemMsg | InteractMsg | LikeMsg | EntryMsg; cfg: DanmakuChatConfig; tone: 'system' | 'interact' | 'like' | 'entry' }) {
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

function DanmuItem({ msg, cfg }: { msg: DanmuMsg; cfg: DanmakuChatConfig }) {
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

function GiftItem({ msg, cfg }: { msg: GiftMsg; cfg: DanmakuChatConfig }) {
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

function GuardItem({ msg, cfg }: { msg: GuardMsg; cfg: DanmakuChatConfig }) {
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

function ScItem({ msg, cfg }: { msg: ScMsg; cfg: DanmakuChatConfig }) {
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

function MessageItem({ msg, cfg }: { msg: ChatMsg; cfg: DanmakuChatConfig }) {
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

function previewEffectStyle(msg: ChatMsg, cfg: DanmakuChatConfig): React.CSSProperties | undefined {
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
  cfg: DanmakuChatConfig;
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

function fontSizeLabel(value: number) {
  return `${value}号`;
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

export function DanmakuChat() {
  const [cfg, setCfg] = useState<DanmakuChatConfig>(DEFAULT_CFG);
  const [loaded, setLoaded] = useState(false);
  const [chatUrl, setChatUrl] = useState('');
  const [urlCopied, setUrlCopied] = useState(false);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('base');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const saveTimer = useRef<number | null>(null);
  const saveStateTimer = useRef<number | null>(null);
  const saveSuccessTimer = useRef<number | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);

  // ── Theme + keyframes ────────────────────────────────────────────────────
  useEffect(() => {
    applyStoredTheme();
    const previousBodyBackground = document.body.style.background;
    const previousHtmlBackground = document.documentElement.style.background;
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    const style = document.createElement('style');
    style.id = 'danmaku-chat-keyframes';
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
      if (saveStateTimer.current) {
        window.clearTimeout(saveStateTimer.current);
      }
      if (saveSuccessTimer.current) {
        window.clearTimeout(saveSuccessTimer.current);
      }
    };
  }, []);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    api.loadDanmakuChatConfig().then(c => {
      const themeId = normalizeThemeId(c.Theme);
      setCfg({ ...c, Theme: themeId, CustomCss: c.CustomCss ?? DEFAULT_CUSTOM_CSS });
      setLoaded(true);
    }).catch(() => setLoaded(true));
    api.getDanmakuChatUrl().then(setChatUrl).catch(() => {});
  }, []);

  // ── Debounced auto-save ───────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSaveState('saving');
      api.saveDanmakuChatConfig(cfg).then(() => {
        if (saveSuccessTimer.current) window.clearTimeout(saveSuccessTimer.current);
        saveSuccessTimer.current = window.setTimeout(() => {
          setSaveState('saved');
          if (saveStateTimer.current) window.clearTimeout(saveStateTimer.current);
          saveStateTimer.current = window.setTimeout(() => setSaveState('idle'), 1400);
        }, 1000);
      }).catch(() => {
        if (saveSuccessTimer.current) window.clearTimeout(saveSuccessTimer.current);
        if (saveStateTimer.current) window.clearTimeout(saveStateTimer.current);
        setSaveState('error');
        if (saveStateTimer.current) window.clearTimeout(saveStateTimer.current);
        saveStateTimer.current = window.setTimeout(() => setSaveState('idle'), 1800);
      });
    }, 350);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [cfg, loaded]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const u = <K extends keyof DanmakuChatConfig>(k: K, v: DanmakuChatConfig[K]) =>
    setCfg(prev => ({ ...prev, [k]: v }));

  const activeTheme = DANMAKU_CHAT_THEMES.find(theme => theme.id === cfg.Theme) ?? DANMAKU_CHAT_THEMES[0];
  const applyDanmakuChatTheme = (themeId: DanmakuChatThemeId) => {
    const theme = DANMAKU_CHAT_THEMES.find(item => item.id === themeId);
    if (!theme) return;
    setCfg(prev => ({
      ...resolveThemeDefaults(theme.id, prev.Port),
      CustomCss: prev.CustomCss,
    }));
  };

  const resetAll = () => {
    if (confirm(`确认将当前主题“${activeTheme.name}”恢复为默认样式和面板设置？`)) {
      setCfg(resolveThemeDefaults(cfg.Theme || activeTheme.id, cfg.Port));
    }
  };

  const copyUrl = () => {
    if (!chatUrl) return;
    navigator.clipboard.writeText(chatUrl).then(() => {
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1800);
    }).catch(() => {});
  };

  const renderSettingsTab = () => {
    switch (activeSettingsTab) {
      case 'base':
        return <div className="grid grid-cols-1 gap-3.5">
          <Section title="基础元素" defaultOpen>
            <ToggleRow label="显示头像" checked={cfg.ShowAvatar} onChange={v => u('ShowAvatar', v)} />
            <ToggleRow label="显示用户名" checked={cfg.ShowUsername} onChange={v => u('ShowUsername', v)} />
            <ToggleRow label="显示身份徽章" checked={cfg.ShowBadges} onChange={v => u('ShowBadges', v)} />
            <ToggleRow label="显示时间" checked={cfg.ShowTime} onChange={v => u('ShowTime', v)} />
          </Section>
          <Section title="事件类型" defaultOpen>
            <ToggleRow label="显示礼物" checked={cfg.ShowGift} onChange={v => u('ShowGift', v)} />
            <ToggleRow label="显示礼物图标" checked={cfg.ShowGiftIcon} onChange={v => u('ShowGiftIcon', v)} />
            <ToggleRow label="显示舰长" checked={cfg.ShowGuard} onChange={v => u('ShowGuard', v)} />
            <ToggleRow label="显示醒目留言" checked={cfg.ShowSc} onChange={v => u('ShowSc', v)} />
          </Section>
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
            <Row><Label>字号</Label>
              <Slider min={10} max={24} step={1} value={cfg.UserNameFontSize} onChange={v => u('UserNameFontSize', v)} />
              <Val>{fontSizeLabel(cfg.UserNameFontSize)}</Val>
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
              <Val>{fontSizeLabel(cfg.MessageFontSize)}</Val>
            </Row>
            <SelectRow label="粗细" value={cfg.MessageWeight} options={FONT_WEIGHTS} onChange={v => u('MessageWeight', v)} />
            <Row><Label>颜色</Label><ColorBox value={cfg.MessageColor} onChange={v => u('MessageColor', v)} /></Row>
          </Section>
          <Section title="时间" defaultOpen>
            <Row><Label>字号</Label>
              <Slider min={9} max={20} step={1} value={cfg.TimeFontSize} onChange={v => u('TimeFontSize', v)} />
              <Val>{fontSizeLabel(cfg.TimeFontSize)}</Val>
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
          <Section title="事件过滤" defaultOpen>
            <Row><Label>礼物起价</Label>
              <NumInput value={cfg.GiftMinCost} min={0} step={1} onChange={v => u('GiftMinCost', v)} />
              <span className="text-[10.5px] text-gray-400">元，0=不限</span>
            </Row>
            <Row><Label>SC 起价</Label>
              <NumInput value={cfg.ScMinCost} min={0} step={1} onChange={v => u('ScMinCost', v)} />
              <span className="text-[10.5px] text-gray-400">元，0=不限</span>
            </Row>
          </Section>
          <Section title="醒目留言 / 舰长" defaultOpen>
            <Row><Label>第一行字号</Label>
              <Slider min={11} max={28} step={1} value={cfg.FirstLineFontSize} onChange={v => u('FirstLineFontSize', v)} />
              <Val>{fontSizeLabel(cfg.FirstLineFontSize)}</Val>
            </Row>
            <SelectRow label="第一行粗细" value={cfg.FirstLineWeight} options={FONT_WEIGHTS} onChange={v => u('FirstLineWeight', v)} />
            <Row><Label>第二行字号</Label>
              <Slider min={11} max={28} step={1} value={cfg.SecondLineFontSize} onChange={v => u('SecondLineFontSize', v)} />
              <Val>{fontSizeLabel(cfg.SecondLineFontSize)}</Val>
            </Row>
            <SelectRow label="第二行粗细" value={cfg.SecondLineWeight} options={FONT_WEIGHTS} onChange={v => u('SecondLineWeight', v)} />
            <Row><Label>正文字号</Label>
              <Slider min={11} max={28} step={1} value={cfg.ScContentFontSize} onChange={v => u('ScContentFontSize', v)} />
              <Val>{fontSizeLabel(cfg.ScContentFontSize)}</Val>
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
            <textarea value={cfg.CustomCss} onChange={e => u('CustomCss', e.target.value)} onFocus={e => e.currentTarget.select()}
              rows={24} placeholder="/* 任何 CSS 都会注入到弹幕聊天网页 */"
              spellCheck={false}
              className="w-full px-3 py-2 text-[11px] font-mono rounded-2xl border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--control-text)] focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]/50 resize-none" />
          </Section>
        </div>;
    }
  };

  const previewUrl = useMemo(() => {
    if (!chatUrl) {
      return '';
    }
    const joiner = chatUrl.includes('?') ? '&' : '?';
    return `${chatUrl}${joiner}demo=1&transparent=1&scale=0.96`;
  }, [chatUrl]);

  const runningPort = useMemo(() => {
    if (!chatUrl) {
      return null;
    }
    try {
      return Number(new URL(chatUrl).port || '80');
    } catch {
      return null;
    }
  }, [chatUrl]);

  const portNeedsRestart = runningPort !== null && cfg.Port !== runningPort;

  useEffect(() => {
    const frame = previewFrameRef.current;
    if (!frame?.contentWindow) {
      return;
    }
    frame.contentWindow.postMessage({
      type: 'streamix-preview-settings',
      settings: cfg,
    }, window.location.origin);
  }, [cfg, previewReloadKey]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-hidden bg-transparent p-5 text-[var(--foreground)]">
      <div className="glass-card relative flex h-full min-h-[584px] flex-col overflow-hidden rounded-[24px]">

      {/* Body */}
      <div className="relative z-10 flex flex-1 overflow-hidden max-[1040px]:flex-col">

        {/* Left: settings panel */}
        <div className="w-[clamp(400px,42vw,540px)] shrink-0 flex flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] max-[1040px]:h-[52%] max-[1040px]:w-full max-[1040px]:border-b max-[1040px]:border-r-0">
          <div className="shrink-0 p-4">
            <div className="glass-card rounded-[18px] px-5 py-4">
            <div>
              <div>
                <div className="text-[16px] font-bold text-[var(--foreground)]">弹幕样式控制台</div>
                <div className="mt-1 text-[11px] text-[var(--muted-text)]">修改会自动保存，右侧直接嵌入真实弹幕页预览</div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input readOnly value={chatUrl}
                  onClick={e => (e.target as HTMLInputElement).select()}
                  className="h-8 min-w-[220px] flex-1 px-3 text-[11px] font-mono rounded-full border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--control-text)] truncate" />
                <button onClick={copyUrl}
                  className="h-8 px-4 text-[11px] font-semibold rounded-full bg-[var(--primary-color)] text-white shadow-[0_10px_28px_rgba(var(--primary-rgb),0.28)] hover:opacity-90 shrink-0">
                  {urlCopied ? '已复制 ✓' : '复制'}
                </button>
              </div>
              {portNeedsRestart && (
                <div className="mt-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-200">
                  当前实际预览仍运行在 {runningPort} 端口。你已把配置端口改成 {cfg.Port}，这个变更需要重启程序后才会生效。
                </div>
              )}
            </div>
            </div>
          </div>

          <div className="shrink-0 px-4 pb-3">
            <div className="glass-card rounded-[18px] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-bold text-[var(--foreground)]">主题方案</div>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--button-ghost-hover)] px-2.5 py-1 text-[10px] font-semibold text-[var(--primary-color)]">
                  CSS 叠加
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5 max-[1040px]:grid-cols-6">
                {DANMAKU_CHAT_THEMES.map(theme => {
                  const active = activeTheme.id === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => applyDanmakuChatTheme(theme.id)}
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
            {saveState !== 'idle' && (
              <span
                title={saveState === 'error' ? '保存失败' : saveState === 'saving' ? '保存中' : '保存成功'}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  saveState === 'error'
                    ? 'bg-rose-500/12 text-rose-600 dark:text-rose-300'
                    : saveState === 'saving'
                      ? 'bg-sky-500/12 text-sky-600 dark:text-sky-300'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                }`}
              >
                <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                  saveState === 'saving'
                    ? 'animate-spin border-current border-t-transparent'
                    : saveState === 'error'
                      ? 'border-current text-[10px] leading-none'
                      : 'border-current text-[10px] leading-none'
                }`}>
                  {saveState === 'saving' ? '' : saveState === 'error' ? '!' : '✓'}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Right: preview */}
        <div
          className="flex-1 flex flex-col"
          style={{
            background:
              'radial-gradient(circle at top, rgba(71,85,105,0.24), transparent 36%), linear-gradient(180deg, #1f2937 0%, #0f172a 100%)',
          }}
        >
          <div className="shrink-0 flex items-center gap-2 px-4 h-11 border-b border-white/10 bg-black/45 shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
            <PreviewToolbarButton onClick={() => setPreviewReloadKey(key => key + 1)}>重播</PreviewToolbarButton>
          </div>

          <div className="flex-1 overflow-hidden">
            {previewUrl ? (
              <iframe
                key={`${previewUrl}-${previewReloadKey}`}
                ref={previewFrameRef}
                src={previewUrl}
                title="真实弹幕预览"
                onLoad={() => {
                  previewFrameRef.current?.contentWindow?.postMessage({
                    type: 'streamix-preview-settings',
                    settings: cfg,
                  }, window.location.origin);
                }}
                className="block h-full w-full border-0 bg-transparent"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-white/60">
                弹幕服务地址加载中...
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
