export type OverlayMotion = 'full' | 'reduced' | 'off';

export interface OverlayRuntimeConfig {
  skin: string;
  transparent: boolean;
  scale: number;
  motion: OverlayMotion;
  primaryColor: string | null;
}

export interface OverlayRoute {
  plugin: 'danmaku' | 'wish-goal' | 'lottery' | 'gift-effect' | 'recent-gifts' | 'gift-rank' | 'song-request';
  view: 'default' | 'playlist' | 'now-playing' | 'rank';
}

export interface PluginSettings {
  WishGoal?: WishGoalSettings;
  LotteryInteraction?: LotteryInteractionSettings;
  GiftEffect?: GiftEffectSettings;
  RecentGifts?: RecentGiftsSettings;
  GiftRank?: GiftRankSettings;
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
