import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface AppConfig {
  RoomId: number;
  WsServerUrl: string;
  DanmuLen: number;
  EntryMsg: string;
  PkNotice: boolean;
  ShowBlockMsg: boolean;
  GoodbyeInfo: string;
  KeywordReply: boolean;
  KeywordReplyList: Record<string, string>;
  DanmuFilterEnable: boolean;
  DanmuFilterWords: string[];
  DanmuFilterRepeatThreshold: number;
  TalkRobotCmd: string;
  FuzzyMatchCmd: boolean;
  RobotName: string;
  RobotMode: string;
  ChatGPT: {
    APIUrl: string;
    APIToken: string;
    Prompt: string;
    Limit: boolean;
    Model: string;
  };
  InteractWord: boolean;
  WelcomeUseAt: boolean;
  WelcomeDanmu: string[];
  InteractWordByTime: boolean;
  WelcomeDanmuByTime: any[];
  EntryEffect: boolean;
  WelcomeHighWealthy: boolean;
  WelcomeHighWealthyLevel: number;
  ThanksFocus: boolean;
  ThanksShare: boolean;
  InteractSelf: boolean;
  InteractAnchor: boolean;
  FocusDanmu: string[];
  WelcomeSwitch: boolean;
  WelcomeString: Record<string, string>;
  WelcomeBlacklistWide: string[];
  WelcomeBlacklist: string[];
  PermanentBlacklistUsers: number[];
  PermanentBlacklistNames: string[];
  SpecialNicknames: Record<string, string>;
  NewcomerDanmuEnable: boolean;
  NewcomerDanmuTemplate: string;
  ThanksGift: boolean;
  ThanksGiftTimeout: number;
  ThanksBlindBoxTimeout: number;
  ThanksMinCost: number;
  BlindBoxProfitLossStat: boolean;
  ThanksGiftUseAt: boolean;
  GiftAliases: Record<string, string>;
  GiftThanksTemplates: Record<string, string>;
  GiftSummaryThanks: boolean;
  GiftSummaryTemplate: string;
  CronDanmu: boolean;
  CronDanmuList: any[];
  DrawByLot: boolean;
  DrawLotsList: string[];
  SignInEnable: boolean;
  DanmuCntEnable: boolean;
  BlindBoxStat: boolean;
  DBPath: string;
  DBName: string;
  CustomizeBullet: boolean;
  LotteryEnable: boolean;
  LotteryUrl: string;
}

export interface UserInfo {
  uid: number;
  uname: string;
  face: string;
  is_login: boolean;
}

export interface LoginUrl {
  url: string;
  qrcode_key: string;
}

export interface RoomInfo {
  room_id: number;
  short_id: number;
  uid: number;
  title: string;
  live_status: number;
  uname: string;
  parent_area_name: string;
  area_name: string;
}

export interface UserDetailResult {
  uid: number;
  uname: string | null;
  danmu_count: number;
  recent_danmu: string | null;
  gift_count: number;
  gift_value: number;
  recent_gift: string | null;
  entry_count: number;
  medal_name: string | null;
  medal_level: number | null;
  guard_level: number | null;
  wealth_level: number | null;
}

export interface SystemInfo {
  version: string;
  config_path: string;
  db_path: string;
}

export const api = {
  // Config
  loadConfig: () => invoke<AppConfig>('load_config'),
  saveConfig: (config: AppConfig) => invoke<void>('save_config', { config }),

  // User/Login
  getUserInfo: () => invoke<UserInfo>('get_user_info'),
  startLogin: () => invoke<LoginUrl>('start_login'),
  onLoginStatus: (callback: (status: string) => void) => listen<string>('login-status', (event) => callback(event.payload)),

  // Room
  checkRoom: (roomId: number) => invoke<RoomInfo>('check_room', { roomId }),

  // Monitor
  startMonitor: () => invoke<void>('start_monitor'),
  stopMonitor: () => invoke<void>('stop_monitor'),
  getMonitorStatus: () => invoke<boolean>('get_monitor_status'),
  onMonitorLog: (callback: (log: string) => void) => listen<string>('monitor-log', (event) => callback(event.payload)),

  // Stats
  getStats: (days: number) => invoke<any>('get_stats', { days }),
  getGiftStats: (days: number, n: number) => invoke<any[]>('get_gift_stats', { days, n }),

  // PK
  getPkSummary: () => invoke<any>('get_pk_summary'),
  getPkHistory: () => invoke<any[]>('get_pk_history'),

  // Misc
  getSystemInfo: () => invoke<SystemInfo>('get_system_info'),
  sendDanmu: (message: string) => invoke<void>('send_danmu', { message }),
  queryUserDetail: (uid: string) => invoke<UserDetailResult>('query_user_detail', { uid }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
};
