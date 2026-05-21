import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AiProvider {
  Id: string;
  /** "llm" | "asr" | "tts" */
  ProviderType: string;
  Name: string;
  Model: string;
  APIUrl: string;
  TtsHttpUrl?: string;
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
  DisableBackgroundEffects: boolean;
  DisableCursorEffects: boolean;
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
  DanmuAnnounce: boolean;
  DanmuAnnounceTtsProviderId: string;
  DanmuAnnounceTtsVoice: string;
  TtsSpeed: number;
  DanmuAnnounceSpeed: number;
  TtsPitch: number;
  VoiceChangerModelId: string;
  VoiceChangerInputGain: number;
  VoiceChangerWetMix: number;
  VoiceChangerFrameMs: number;
  ObsEnabled: boolean;
  ObsHost: string;
  ObsPort: number;
  ObsPassword: string;
  VadEnabled: boolean;
  VadThreshold: number;
  VadMinSpeechDuration: number;
  VadMinSilenceDuration: number;
  VoiceMicGain: number;
  VoiceReplyMaxChars: number;
  VoiceTemperature: number;
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

/** 弹幕聊天配置（plugin-settings.toml / DanmakuChat） */
export interface DanmakuChatConfig {
  // 服务 / 性能
  Port: number;
  MaxMsgs: number;
  MsgGap: number;
  Theme: string;
  CustomCss: string;

  // 全局缩放
  GlobalScale: number;
  FontScale: number;

  // 头像
  ShowAvatar: boolean;
  AvatarSize: number;

  // 用户名
  ShowUsername: boolean;
  UserNameFont: string;
  UserNameFontSize: number;
  UserNameWeight: number;
  UserNameColor: string;
  OwnerUserNameColor: string;
  ModeratorUserNameColor: string;
  MemberUserNameColor: string;
  ShowBadges: boolean;

  // 消息
  MessageFont: string;
  MessageFontSize: number;
  MessageWeight: number;
  MessageColor: string;

  // 时间
  ShowTime: boolean;
  TimeFont: string;
  TimeFontSize: number;
  TimeWeight: number;
  TimeColor: string;

  // 背景
  BgColor: string;
  BgOpacity: number;
  MessageBgColor: string;
  OwnerMessageBgColor: string;
  ModeratorMessageBgColor: string;
  MemberMessageBgColor: string;

  // 礼物 / SC / 舰长
  ShowGift: boolean;
  GiftMinCost: number;
  ShowGiftIcon: boolean;
  ShowGuard: boolean;
  ShowSc: boolean;
  ScMinCost: number;

  // SC 三行
  FirstLineFontSize: number;
  FirstLineWeight: number;
  SecondLineFontSize: number;
  SecondLineWeight: number;
  ScContentFontSize: number;
  ScContentWeight: number;

  // 动画
  AnimateIn: boolean;
  FadeInTime: number;
  AnimateOut: boolean;
  FadeOutTime: number;
  AnimateOutWaitTime: number;
  Slide: boolean;
  ReverseSlide: boolean;
  EffectsEnabled: boolean;
  EffectIntensity: number;

  // 描边
  ShowOutlines: boolean;
  OutlineSize: number;
  OutlineColor: string;
  BlurryOutline: boolean;
}

export interface PluginSettings {
  DanmakuChat: DanmakuChatConfig;
  WishGoal: WishGoalSettings;
  LotteryInteraction: LotteryInteractionSettings;
  GiftEffect: GiftEffectSettings;
  RecentGifts: RecentGiftsSettings;
  GiftRank: GiftRankSettings;
  MusicInteraction: MusicInteractionSettings;
}

export interface MusicInteractionSettings {
  Enabled: boolean;
  Skin: string;
  StatsRange: string;
  Player: string;
  PlaybackMode: string;
  UnlimitedRequests: boolean;
  Transparent: boolean;
  Width: number;
  Height: number;
  ShowCover: boolean;
  ShowRequester: boolean;
  ShowGiftTier: boolean;
  ShowQueue: boolean;
  ShowNowPlayingPanel: boolean;
  ShowQueuePanel: boolean;
  ShowRankPanel: boolean;
  ShowTodayValue: boolean;
  PrimaryColor: string;
  FontScale: number;
  Tiers: MusicTierSettings[];
}

export interface MusicTierSettings {
  Id: string;
  Name: string;
  MinCredit: number;
  BaseScore: number;
  Enabled: boolean;
}

export interface MusicTrack {
  source: "netease" | "tencent" | "kugou" | "baidu" | "kuwo";
  song_id: string;
  name: string;
  artists: string[];
  album: string;
  pic_id: string;
  url_id: string;
  lyric_id: string;
  duration_ms: number | null;
}

export interface MusicQueueItem {
  requestId: number;
  uid: number;
  uname: string;
  songName: string;
  artistNames: string;
  tier: string;
  creditValue: number;
  priorityScore: number;
  status: string;
  createdAt: string;
}

export interface SearchCandidate {
  track: MusicTrack;
  score: number;
  reason: string;
}

export interface WishGoalSettings {
  Enabled: boolean;
  Title: string;
  Goals: WishGoalItem[];
  NumberColor: string;
  BackgroundColor: string;
  AccentColor: string;
  TextColor: string;
  DisplaySize: "small" | "normal" | "large" | string;
  ShowIcons: boolean;
  FontFamily: string;
  StylePreset: string;
  CustomCss: string;
  CompleteAnimation: string;
  CompleteSound: string;
  SoundVolume: number;
  SoundRepeat: string;
  CustomSoundPath: string;
}

export interface WishGoalItem {
  Id: string;
  Name: string;
  Current: number;
  Target: number;
  Icon: string;
  MatchKind: "gift" | "manual" | string;
  GiftName: string;
  Increment: number;
}

export interface GiftCatalogItem {
  GiftId: number;
  Name: string;
  Price: number;
  Image: string;
  UpdatedAt: string;
}

export interface LotteryInteractionSettings {
  Enabled: boolean;
  Title: string;
  GiftName: string;
  GiftCount: number;
  StaySeconds: number;
  Prizes: LotteryPrize[];
  LastWinner: string;
  LastPrize: string;
  DrawNonce: number;
}

export interface LotteryPrize {
  Id: string;
  Name: string;
  Weight: number;
}

export interface GiftEffectSettings {
  Enabled: boolean;
  Skin: string;
  GiftName: string;
  Sound: string;
  SoundVolume: number;
  CustomSoundPath: string;
  LastUser: string;
  LastGift: string;
  LastCount: number;
  EffectNonce: number;
}

export interface RecentGiftsSettings {
  Enabled: boolean;
  Title: string;
  MaxItems: number;
  Skin: string;
  NameColor: string;
  NumberColor: string;
  GiftColor: string;
  Items: RecentGiftItem[];
}

export interface RecentGiftItem {
  Id: string;
  User: string;
  Avatar: string;
  Gift: string;
  Count: number;
}

export interface GiftRankSettings {
  Enabled: boolean;
  Title: string;
  MaxItems: number;
  Skin: string;
  Date: string;
  Items: GiftRankItem[];
}

export interface GiftRankItem {
  User: string;
  Avatar: string;
  Value: number;
  Count: number;
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
  platform_id?: PlatformId;
}

export interface LoginUrl {
  url: string;
  qrcode_key: string;
}

export type PlatformId = "bilibili" | string;

export interface PlatformRoomRef {
  platform_id: PlatformId;
  platform_room_id: string;
  display_id?: string | null;
}

export interface LiveRoomInfo {
  room: PlatformRoomRef;
  owner?: {
    platform_id: PlatformId;
    platform_user_id: string;
    display_name: string;
  } | null;
  live_status: number;
  live_time: string;
  title: string;
  area_name: string;
  parent_area_name: string;
  online: number;
  keyframe: string;
  cover: string;
}

export interface LoginChallenge {
  platform_id: PlatformId;
  challenge_id: string;
  url: string;
}

export interface StartLoginChallenge extends LoginUrl {
  platform_id: PlatformId;
  challenge_id: string;
}

export interface LoginPollPending {
  status: "Scanning";
  message: string;
}

export interface LoginPollExpired {
  status: "Expired";
  message: string;
}

export type LoginPollSuccess =
  | ({ status: "Success" } & UserInfo)
  | { status: "Success" };

export type LoginPollResult =
  | LoginPollPending
  | LoginPollExpired
  | LoginPollSuccess;

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
  tts_provider_id: string;
  tts_voice_id: string;
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

export interface VoiceLatency {
  asr_ms: number;
  ai_first_chunk_ms: number | null;
  ai_total_ms: number;
  total_ms: number;
}

export type LogoutMode = "manual" | "expired";

export const api = {
  // Config
  loadConfig: () => invoke<AppConfig>("load_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),

  // User/Login
  getUserInfo: () => invoke<UserInfo>("get_user_info"),
  startLogin: () => invoke<StartLoginChallenge>("start_login"),
  pollLogin: (key: string) => invoke<LoginPollResult>("poll_login", { key }),
  listLivePlatforms: () => invoke<PlatformId[]>("list_live_platforms"),
  createPlatformLoginChallenge: (platformId: PlatformId) =>
    invoke<LoginChallenge>("create_platform_login_challenge", { platformId }),
  pollPlatformLogin: (platformId: PlatformId, challengeId: string) =>
    invoke<LoginPollResult>("poll_platform_login", { platformId, challengeId }),
  resolvePlatformRoom: (platformId: PlatformId, roomInput: string) =>
    invoke<LiveRoomInfo>("resolve_platform_room", { platformId, roomInput }),
  logout: (mode: LogoutMode = "manual") => invoke<void>("logout", { mode }),
  onLoginStatus: (callback: (status: string) => void) =>
    listen<string>("login-status", (event) => callback(event.payload)),

  // Room
  checkRoom: (roomId: number) => invoke<RoomInfo>("check_room", { roomId }),
  getRoomByUid: (uid: number) => invoke<RoomInfo>("get_room_by_uid", { uid }),

  // Monitor
  startMonitor: (roomId?: number) =>
    invoke<void>("start_monitor", { roomId: roomId ?? null }),
  stopMonitor: () => invoke<void>("stop_monitor"),
  reloadMonitorTts: () => invoke<void>("reload_monitor_tts"),
  reloadMonitorVoice: () => invoke<void>("reload_monitor_voice"),
  getMonitorStatus: () => invoke<boolean>("get_monitor_status"),
  getMonitorLogs: () => invoke<string[]>("get_monitor_logs"),
  onMonitorStatus: (callback: (status: string) => void) =>
    listen<string>("monitor-status", (event) => callback(event.payload)),
  onMonitorLog: (callback: (log: string) => void) =>
    listen<string>("monitor-log", (event) => callback(event.payload)),
  onMonitorLogs: (callback: (logs: string[]) => void) =>
    listen<string[]>("monitor-logs", (event) => callback(event.payload)),
  onVoiceLatency: (callback: (data: VoiceLatency) => void) =>
    listen<VoiceLatency>("voice-latency", (event) => callback(event.payload)),
  getDanmakuChatUrl: () => invoke<string>("get_danmaku_chat_url"),
  getWishGoalUrl: () => invoke<string>("get_wish_goal_url"),
  getLotteryUrl: () => invoke<string>("get_lottery_url"),
  getGiftEffectUrl: () => invoke<string>("get_gift_effect_url"),
  getRecentGiftsUrl: () => invoke<string>("get_recent_gifts_url"),
  getGiftRankUrl: () => invoke<string>("get_gift_rank_url"),
  getMusicInteractionUrl: () => invoke<string>("get_music_interaction_url"),
  searchMusicCandidates: (query: string, uid?: number, uname?: string) =>
    invoke<SearchCandidate[]>("search_music_candidates", {
      query,
      uid: uid ?? null,
      uname: uname ?? null,
    }),
  getMusicQueue: () => invoke<MusicQueueItem[]>("get_music_queue"),
  openMusicRequest: (requestId: number) =>
    invoke<void>("open_music_request", { requestId }),
  finishMusicRequest: (requestId: number) =>
    invoke<void>("finish_music_request", { requestId }),
  skipMusicRequest: (requestId: number) =>
    invoke<void>("skip_music_request", { requestId }),
  failMusicRequest: (requestId: number) =>
    invoke<void>("fail_music_request", { requestId }),
  confirmMusicCandidate: (uid: number, uname: string, index: number) =>
    invoke<string>("confirm_music_candidate", { uid, uname, index }),
  pickPluginResource: (kind: "sound") =>
    invoke<string | null>("pick_plugin_resource", { kind }),
  getGiftCatalog: () => invoke<GiftCatalogItem[]>("get_gift_catalog"),
  refreshGiftCatalog: () => invoke<GiftCatalogItem[]>("refresh_gift_catalog"),
  onLiveEvent: (callback: (event: any) => void) =>
    listen<any>("live-event", (event) => callback(event.payload)),
  onLiveEvents: (callback: (events: any[]) => void) =>
    listen<any[]>("live-events", (event) => callback(event.payload)),
  onRoomStatus: (
    callback: (data: {
      live_status: number;
      online: number;
      live_time: string;
    }) => void,
  ) => listen<any>("room-status", (event) => callback(event.payload)),
  onRoomOnline: (callback: (data: { count: number }) => void) =>
    listen<any>("room-online", (event) => callback(event.payload)),

  // Anchor
  getAnchorInfo: (uid: number) =>
    invoke<AnchorInfo>("get_anchor_info", { uid }),

  // Stats
  getStats: (days: number) => invoke<any>("get_stats", { days }),
  getGiftStats: (days: number, n: number) =>
    invoke<any[]>("get_gift_stats", { days, n }),
  getUserGiftStats: (days: number, n: number) =>
    invoke<UserGiftStat[]>("get_user_gift_stats", { days, n }),

  // PK
  getPkSummary: () => invoke<any>("get_pk_summary"),
  getPkHistory: () => invoke<any[]>("get_pk_history"),

  // Misc
  getSystemInfo: () => invoke<SystemInfo>("get_system_info"),
  checkUpdate: () =>
    invoke<{ version: string; link: string; change_log: string } | null>(
      "check_update_cmd",
    ),
  openConfigDir: () => invoke<void>("open_config_dir"),
  sendDanmu: (message: string) => invoke<void>("send_danmu", { message }),
  queryUserDetail: (uid: string) =>
    invoke<UserDetailResult>("query_user_detail", { uid }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  proxyImage: (url: string) => invoke<string>("proxy_image", { url }),

  // Danmaku chat config (stored in plugin-settings.toml)
  loadDanmakuChatConfig: () =>
    invoke<DanmakuChatConfig>("load_danmaku_chat_config"),
  saveDanmakuChatConfig: (config: DanmakuChatConfig) =>
    invoke<void>("save_danmaku_chat_config", { config }),
  loadPluginSettings: () => invoke<PluginSettings>("load_plugin_settings"),
  savePluginSettings: (config: PluginSettings) =>
    invoke<void>("save_plugin_settings", { config }),
  resetWishGoal: () => invoke<PluginSettings>("reset_wish_goal"),
  simulateWishGoal: () => invoke<PluginSettings>("simulate_wish_goal"),
  simulateLottery: () => invoke<PluginSettings>("simulate_lottery"),
  simulateGiftEffect: () => invoke<PluginSettings>("simulate_gift_effect"),
  simulateRecentGift: () => invoke<PluginSettings>("simulate_recent_gift"),
  simulateGiftRank: () => invoke<PluginSettings>("simulate_gift_rank"),

  // Persistent room connection
  setConnectedRoom: (room: PlatformRoomRef | null) =>
    invoke<void>("set_connected_room", { room }),
  getConnectedRoom: () => invoke<PlatformRoomRef | null>("get_connected_room"),

  // Auto update
  installUpdate: () => invoke<void>("install_update"),
  onUpdateProgress: (
    callback: (data: { downloaded: number; total: number | null }) => void,
  ) =>
    listen<{ downloaded: number; total: number | null }>(
      "update-download-progress",
      (e) => callback(e.payload),
    ),

  // AI message (used by AI page and Voice page)
  sendAiMessage: (prompt: string) =>
    invoke<string>("send_ai_message", { prompt }),

  // Session summary (emitted on every event)
  onSessionSummary: (callback: (data: any) => void) =>
    listen<any>("session-summary", (e) => callback(e.payload)),

  // Voice model status
  checkModels: () =>
    invoke<{ model_dir: string; models: Record<string, boolean> }>(
      "check_models",
    ),
  downloadModel: (modelId: string) =>
    invoke<string>("download_model", { modelId }),
  cancelModelDownload: (modelId: string) =>
    invoke<void>("cancel_model_download", { modelId }),
  deleteModel: (modelId: string) => invoke<string>("delete_model", { modelId }),
  onModelDlProgress: (
    callback: (data: {
      model_id: string;
      stage: string;
      pct: number;
      downloaded_mb?: string;
      total_mb?: string;
    }) => void,
  ) =>
    listen<{
      model_id: string;
      stage: string;
      pct: number;
      downloaded_mb?: string;
      total_mb?: string;
    }>("model-dl-progress", (e) => callback(e.payload)),
  openFolder: (path: string) => invoke<void>("open_folder", { path }),

  // Danmaku polling (replaces Tauri event broadcast)
  getRecentDanmaku: () => invoke<string[]>("get_recent_danmaku"),
  speakText: (
    text: string,
    voice: string,
    providerId?: string,
    speed?: number,
  ) =>
    invoke<void>("speak_text_cmd", {
      text,
      voice,
      providerId: providerId ?? null,
      speed: speed ?? null,
    }),

  // Blind box stats
  getBlindBoxStats: (days: number) =>
    invoke<[string, number][]>("get_blind_box_stats", { days }),

  // Daily breakdown for trend chart
  getDailyStats: (days: number) =>
    invoke<
      {
        date: string;
        danmu_count: number;
        entry_count: number;
        gift_count: number;
        follow_count: number;
      }[]
    >("get_daily_stats", { days }),

  // Audience / tracked users
  getTrackedUsers: (limit: number) =>
    invoke<KnownUser[]>("get_tracked_users", { limit }),
  checkTrackedUser: (uid: number) =>
    invoke<{
      status: string;
      nickname: string;
      alias: string;
      notes: string;
      tts_provider_id: string;
      tts_voice_id: string;
    } | null>("check_tracked_user", { uid }),
  addTrackedUser: (
    uid: number,
    nickname: string,
    alias: string,
    notes: string,
  ) => invoke<void>("add_tracked_user", { uid, nickname, alias, notes }),
  restoreTrackedUser: (uid: number, alias: string, notes: string) =>
    invoke<void>("restore_tracked_user", { uid, alias, notes }),
  updateTrackedUser: (uid: number, alias: string, notes: string) =>
    invoke<void>("update_tracked_user", { uid, alias, notes }),
  updateTrackedUserTtsVoice: (
    uid: number,
    ttsProviderId: string,
    ttsVoiceId: string,
  ) =>
    invoke<void>("update_tracked_user_tts_voice", {
      uid,
      ttsProviderId,
      ttsVoiceId,
    }),
  softDeleteTrackedUser: (uid: number) =>
    invoke<void>("soft_delete_tracked_user", { uid }),
};
