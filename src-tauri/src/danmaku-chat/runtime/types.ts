export type DanmakuChatMotion = 'full' | 'reduced' | 'off';

export interface DanmakuChatRuntimeConfig {
  skin: string;
  transparent: boolean;
  scale: number;
  motion: DanmakuChatMotion;
  primaryColor: string | null;
}

export interface DanmakuChatRoute {
  plugin: 'danmaku' | 'wish-goal' | 'lottery' | 'gift-effect' | 'recent-gifts' | 'gift-rank' | 'song-request';
  view: 'default' | 'dashboard' | 'playlist' | 'now-playing' | 'rank';
}

export interface PluginSettings {
  DanmakuChat?: DanmakuChatSettings;
  WishGoal?: WishGoalSettings;
  LotteryInteraction?: LotteryInteractionSettings;
  GiftEffect?: GiftEffectSettings;
  RecentGifts?: RecentGiftsSettings;
  GiftRank?: GiftRankSettings;
  MusicInteraction?: MusicInteractionSettings;
}

export interface DanmakuChatSettings {
  CustomCss?: string;
  GlobalScale?: number;
  FontScale?: number;
  MessageFont?: string;
  MsgGap?: number;
  BgColor?: string;
  AvatarSize?: number;
  ShowAvatar?: boolean;
  ShowUsername?: boolean;
  UserNameFont?: string;
  UserNameFontSize?: number;
  UserNameWeight?: number;
  UserNameColor?: string;
  OwnerUserNameColor?: string;
  ModeratorUserNameColor?: string;
  MemberUserNameColor?: string;
  ShowBadges?: boolean;
  ShowGiftIcon?: boolean;
  MessageFontSize?: number;
  MessageWeight?: number;
  MessageColor?: string;
  ShowTime?: boolean;
  TimeFont?: string;
  TimeFontSize?: number;
  TimeWeight?: number;
  TimeColor?: string;
  BgOpacity?: number;
  MessageBgColor?: string;
  OwnerMessageBgColor?: string;
  ModeratorMessageBgColor?: string;
  MemberMessageBgColor?: string;
  FirstLineFontSize?: number;
  FirstLineWeight?: number;
  SecondLineFontSize?: number;
  SecondLineWeight?: number;
  ScContentFontSize?: number;
  ScContentWeight?: number;
  FadeInTime?: number;
  FadeOutTime?: number;
  Slide?: boolean;
  ReverseSlide?: boolean;
  EffectsEnabled?: boolean;
  EffectIntensity?: number;
  ShowOutlines?: boolean;
  OutlineSize?: number;
  OutlineColor?: string;
  BlurryOutline?: boolean;
}

export interface MusicInteractionSettings {
  Enabled?: boolean;
  Skin?: string;
  StatsRange?: string;
  Player?: string;
  PlaybackMode?: string;
  Transparent?: boolean;
  Width?: number;
  Height?: number;
  ShowCover?: boolean;
  ShowRequester?: boolean;
  ShowGiftTier?: boolean;
  ShowQueue?: boolean;
  ShowNowPlayingPanel?: boolean;
  ShowQueuePanel?: boolean;
  ShowRankPanel?: boolean;
  ShowTodayValue?: boolean;
  PrimaryColor?: string;
  FontScale?: number;
  Tiers?: MusicTierSettings[];
}

export interface MusicTierSettings {
  Id?: string;
  Name?: string;
  MinCredit?: number;
  BaseScore?: number;
  Enabled?: boolean;
}

export interface WishGoalSettings {
  Enabled?: boolean;
  Title?: string;
  Goals?: Array<{ Id?: string; Name?: string; Current?: number; Target?: number; Icon?: string }>;
  StylePreset?: string;
  AccentColor?: string;
  BackgroundColor?: string;
  TextColor?: string;
  NumberColor?: string;
  ShowIcons?: boolean;
}

export interface LotteryInteractionSettings {
  Enabled?: boolean;
  Title?: string;
  LastWinner?: string;
  LastPrize?: string;
  DrawNonce?: number;
  StaySeconds?: number;
}

export interface GiftEffectSettings {
  Enabled?: boolean;
  Skin?: string;
  LastUser?: string;
  LastGift?: string;
  LastCount?: number;
  EffectNonce?: number;
}

export interface RecentGiftsSettings {
  Enabled?: boolean;
  Title?: string;
  MaxItems?: number;
  Skin?: string;
  NameColor?: string;
  NumberColor?: string;
  GiftColor?: string;
  Items?: Array<{ User?: string; Gift?: string; Count?: number; Avatar?: string }>;
}

export interface GiftRankSettings {
  Enabled?: boolean;
  Title?: string;
  MaxItems?: number;
  Skin?: string;
  Items?: Array<{ User?: string; Value?: number; Avatar?: string }>;
}
