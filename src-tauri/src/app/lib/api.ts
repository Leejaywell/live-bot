import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface AiProvider {
  Id: string;
  /** "llm" | "asr" | "tts" */
  ProviderType: string;
  Name: string;
  Model: string;
  APIUrl: string;
  APIKey: string;
  SystemPrompt: string;
  TriggerCommand: string;
  FuzzyMatch: boolean;
  Nickname: string;
  Enabled: boolean;
}

/** 机器人：引用一个 LLM，拥有独立昵称、人设和会话记忆 */
export interface AiBot {
  Id: string;
  /** 引用的 LLM provider id */
  ProviderId: string;
  Nickname: string;
  SystemPrompt: string;
  Enabled: boolean;
}

export interface AppConfig {
  AutoUpdate: boolean;
  MinimizeToTray: boolean;
  LaunchAtStartup: boolean;
  RoomId: number;
  MyRoomIds: number[];
  RecordEnabled: boolean;
  WsServerUrl: string;
  DanmuLen: number;
  EntryMsg: string;
  PkNotice: boolean;
  ShowBlockMsg: boolean;
  GoodbyeInfo: string;
  DanmuFilterEnable: boolean;
  DanmuFilterWords: string[];
  DanmuFilterRepeatThreshold: number;
  TalkRobotCmd: string;
  FuzzyMatchCmd: boolean;
  RobotName: string;
  ActiveProviderId: string;
  ActiveAsrProviderId: string;
  ActiveTtsProviderId: string;
  AiProviders: AiProvider[];
  /** 新版机器人列表，各自独立记忆 */
  AiBots: AiBot[];
  AiReplyToDanmaku: boolean;
  EntryEffect: boolean;
  ThanksFocus: boolean;
  ThanksShare: boolean;
  InteractSelf: boolean;
  InteractAnchor: boolean;
  FocusDanmu: string[];
  PermanentBlacklistUsers: number[];
  PermanentBlacklistNames: string[];
  SpecialNicknames: Record<string, string>;
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
  DanmuCntEnable: boolean;
  BlindBoxStat: boolean;
  DBPath: string;
  DBName: string;
  CustomizeBullet: boolean;
  LotteryEnable: boolean;
  LotteryUrl: string;
  AiAssistantPrompt: string;
  // Voice / TTS / ASR / OBS
  TtsEnabled: boolean;
  TtsVoice: string;
  TtsSpeed: number;
  TtsPitch: number;
  ObsEnabled: boolean;
  ObsHost: string;
  ObsPort: number;
  ObsPassword: string;
  VadEnabled: boolean;
  AsrUrl: string;
  AsrEngine: string;
  AsrLanguage: string;
  /** 语音交互模式的 AI 系统提示词 */
  VoiceSystemPrompt: string;
  /** 语音 AI 性别：女AI / 男AI */
  VoiceGender: string;
  GeneralWelcomeEnabled: boolean;
  GeneralWelcomeMsgs: string[];
  SpecialWelcomeList: SpecialWelcomeEntry[];
  /** 弹幕播报开关（仅内存，不持久化） */
  DanmuAnnounce?: boolean;
}

export interface UserInfo {
  uid: number;
  uname: string;
  face: string;
  level: number;
  vip_status: number;
  vip_type: number;
  coins: number;
  vip_nickname_color: string;
  is_login: boolean;
  saved_at: number;
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
  live_time: string;
  uname: string;
  parent_area_name: string;
  area_name: string;
  online: number;
  keyframe: string;
  cover: string;
}

export interface AnchorInfo {
  uid: number;
  uname: string;
  face: string;
  follower_num: number;
  medal_name: string;
  sign: string;
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

export interface SpecialWelcomeEntry {
  Uid: string;
  Msg: string;
}

export interface UserGiftStat {
  uid: number;
  uname: string;
  gift_value: number;
  gift_count: number;
}

export interface KnownUser {
  uid: number;
  nickname: string;
  alias: string;
  notes: string;
  danmu_count: number;
  gift_value: number;
  session_count: number;
  last_seen: string;
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
  logout: () => invoke<void>('logout'),
  onLoginStatus: (callback: (status: string) => void) => listen<string>('login-status', (event) => callback(event.payload)),

  // Room
  checkRoom: (roomId: number) => invoke<RoomInfo>('check_room', { roomId }),
  getRoomByUid: (uid: number) => invoke<RoomInfo>('get_room_by_uid', { uid }),

  // Monitor
  startMonitor: (roomId?: number) => invoke<void>('start_monitor', { roomId: roomId ?? null }),
  stopMonitor: () => invoke<void>('stop_monitor'),
  getMonitorStatus: () => invoke<boolean>('get_monitor_status'),
  getMonitorLogs: () => invoke<string[]>('get_monitor_logs'),
  onMonitorStatus: (callback: (status: string) => void) => listen<string>('monitor-status', (event) => callback(event.payload)),
  onMonitorLog: (callback: (log: string) => void) => listen<string>('monitor-log', (event) => callback(event.payload)),
  onMonitorLogs: (callback: (logs: string[]) => void) => listen<string[]>('monitor-logs', (event) => callback(event.payload)),
  onLiveEvent: (callback: (event: any) => void) => listen<any>('live-event', (event) => callback(event.payload)),
  onLiveEvents: (callback: (events: any[]) => void) => listen<any[]>('live-events', (event) => callback(event.payload)),
  onRoomStatus: (callback: (data: { live_status: number; online: number; live_time: string }) => void) =>
    listen<any>('room-status', (event) => callback(event.payload)),
  onRoomOnline: (callback: (data: { count: number }) => void) =>
    listen<any>('room-online', (event) => callback(event.payload)),

  // Anchor
  getAnchorInfo: (uid: number) => invoke<AnchorInfo>('get_anchor_info', { uid }),

  // Stats
  getStats: (days: number) => invoke<any>('get_stats', { days }),
  getGiftStats: (days: number, n: number) => invoke<any[]>('get_gift_stats', { days, n }),
  getUserGiftStats: (days: number, n: number) => invoke<UserGiftStat[]>('get_user_gift_stats', { days, n }),

  // PK
  getPkSummary: () => invoke<any>('get_pk_summary'),
  getPkHistory: () => invoke<any[]>('get_pk_history'),

  // Misc
  getSystemInfo: () => invoke<SystemInfo>('get_system_info'),
  checkUpdate: () => invoke<{ version: string; link: string; change_log: string } | null>('check_update_cmd'),
  openConfigDir: () => invoke<void>('open_config_dir'),
  sendDanmu: (message: string) => invoke<void>('send_danmu', { message }),
  queryUserDetail: (uid: string) => invoke<UserDetailResult>('query_user_detail', { uid }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  proxyImage: (url: string) => invoke<string>('proxy_image', { url }),

  // Persistent room connection
  setConnectedRoom: (roomId: number | null) => invoke<void>('set_connected_room', { roomId }),
  getConnectedRoom: () => invoke<number | null>('get_connected_room'),

  // Auto update
  installUpdate: () => invoke<void>('install_update'),
  onUpdateProgress: (callback: (data: { downloaded: number; total: number | null }) => void) =>
    listen<{ downloaded: number; total: number | null }>('update-download-progress', (e) => callback(e.payload)),

  // AI message (used by AI page and Voice page)
  sendAiMessage: (prompt: string) => invoke<string>('send_ai_message', { prompt }),

  // Session summary (emitted on every event)
  onSessionSummary: (callback: (data: any) => void) =>
    listen<any>('session-summary', (e) => callback(e.payload)),

  // Voice model status
  checkModels: () => invoke<{ model_dir: string; models: Record<string, boolean> }>('check_models'),
  downloadModel: (modelId: string) => invoke<string>('download_model', { modelId }),
  cancelModelDownload: (modelId: string) => invoke<void>('cancel_model_download', { modelId }),
  deleteModel: (modelId: string) => invoke<string>('delete_model', { modelId }),
  onModelDlProgress: (callback: (data: { model_id: string; stage: string; pct: number; downloaded_mb?: string; total_mb?: string }) => void) =>
    listen<{ model_id: string; stage: string; pct: number; downloaded_mb?: string; total_mb?: string }>('model-dl-progress', (e) => callback(e.payload)),
  openFolder: (path: string) => invoke<void>('open_folder', { path }),

  // Danmaku polling (replaces Tauri event broadcast)
  getRecentDanmaku: () => invoke<string[]>('get_recent_danmaku'),

  // Blind box stats
  getBlindBoxStats: (days: number) => invoke<[string, number][]>('get_blind_box_stats', { days }),

  // Daily breakdown for trend chart
  getDailyStats: (days: number) => invoke<{ date: string; danmu_count: number; entry_count: number; gift_count: number; follow_count: number }[]>('get_daily_stats', { days }),

  // Audience / tracked users
  getTrackedUsers: (limit: number) => invoke<KnownUser[]>('get_tracked_users', { limit }),
  checkTrackedUser: (uid: number) => invoke<{ status: string; nickname: string; alias: string; notes: string } | null>('check_tracked_user', { uid }),
  addTrackedUser: (uid: number, nickname: string, alias: string, notes: string) => invoke<void>('add_tracked_user', { uid, nickname, alias, notes }),
  restoreTrackedUser: (uid: number, alias: string, notes: string) => invoke<void>('restore_tracked_user', { uid, alias, notes }),
  updateTrackedUser: (uid: number, alias: string, notes: string) => invoke<void>('update_tracked_user', { uid, alias, notes }),
  softDeleteTrackedUser: (uid: number) => invoke<void>('soft_delete_tracked_user', { uid }),

  // Voice Changer
  startVoiceChanger: (modelId: string) => invoke<void>('start_voice_changer', { modelId }),
  stopVoiceChanger: () => invoke<void>('stop_voice_changer'),
  getVoiceChangerStatus: () => invoke<boolean>('get_voice_changer_status'),
  searchRvcModels: (query: string) => invoke<any[]>('search_rvc_models', { query }),
};
