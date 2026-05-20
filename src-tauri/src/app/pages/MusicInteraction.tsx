import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, ListMusic, Monitor, Music2, Play, Radio, RefreshCw, Search, Settings2, SlidersHorizontal, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api, MusicInteractionSettings, MusicQueueItem, MusicTierSettings, PluginSettings, SearchCandidate } from '../lib/api';
import { fallbackConfig } from './WishGoal';

const defaultMusicTiers: MusicTierSettings[] = [
  { Id: 'ordinary', Name: '普通点歌', MinCredit: 10, BaseScore: 1000, Enabled: true },
  { Id: 'priority', Name: '优先点歌', MinCredit: 66, BaseScore: 3000, Enabled: true },
  { Id: 'jump_queue', Name: '插队', MinCredit: 233, BaseScore: 6000, Enabled: true },
  { Id: 'exclusive', Name: '专属点歌', MinCredit: 520, BaseScore: 9000, Enabled: true },
  { Id: 'playlist_takeover', Name: '包场歌单', MinCredit: 1999, BaseScore: 12000, Enabled: true },
];

const fallbackMusicInteraction: MusicInteractionSettings = {
  Enabled: true,
  Skin: 'neon',
  StatsRange: 'session',
  Player: 'auto',
  PlaybackMode: 'manual_confirm',
  UnlimitedRequests: false,
  Transparent: true,
  Width: 720,
  Height: 120,
  ShowCover: true,
  ShowRequester: true,
  ShowGiftTier: true,
  ShowQueue: true,
  ShowNowPlayingPanel: true,
  ShowQueuePanel: true,
  ShowRankPanel: true,
  ShowTodayValue: false,
  PrimaryColor: '#8b5cf6',
  FontScale: 1,
  Tiers: defaultMusicTiers,
};

const initialConfig: PluginSettings = {
  ...fallbackConfig,
  MusicInteraction: fallbackMusicInteraction,
};

const statsRangeOptions = new Set(['session', 'today', 'week', 'month', 'all']);
const skinOptions = new Set(['neon', 'idol-stage', 'vinyl']);
const playerOptions = new Set(['auto', 'netease', 'tencent', 'browser']);
const playbackModeOptions = new Set(['manual_confirm', 'auto_next']);

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeNumber(key: NumericMusicSetting, value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clampSettingValue(key, String(value)) ?? fallback;
}

function sanitizeTierNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(max, Math.max(min, parsed)));
}

function sanitizeMusicTiers(value: unknown): MusicTierSettings[] {
  const source = Array.isArray(value)
    ? value as Array<Partial<Record<keyof MusicTierSettings, unknown>>>
    : [];
  return defaultMusicTiers.map(defaultTier => {
    const saved = source.find(item => item && item.Id === defaultTier.Id);
    return {
      Id: defaultTier.Id,
      Name: typeof saved?.Name === 'string' && saved.Name.trim() ? saved.Name.trim() : defaultTier.Name,
      MinCredit: sanitizeTierNumber(saved?.MinCredit, defaultTier.MinCredit, 1, 999999),
      BaseScore: sanitizeTierNumber(saved?.BaseScore, defaultTier.BaseScore, 0, 999999),
      Enabled: sanitizeBoolean(saved?.Enabled, defaultTier.Enabled),
    };
  });
}

function sanitizeMusicInteraction(next: MusicInteractionSettings | undefined | null): MusicInteractionSettings {
  const source = next && typeof next === 'object'
    ? next as Partial<Record<keyof MusicInteractionSettings, unknown>>
    : {};
  const skin = typeof source.Skin === 'string' && skinOptions.has(source.Skin)
    ? source.Skin
    : fallbackMusicInteraction.Skin;
  const statsRange = typeof source.StatsRange === 'string' && statsRangeOptions.has(source.StatsRange)
    ? source.StatsRange
    : fallbackMusicInteraction.StatsRange;
  const player = typeof source.Player === 'string' && playerOptions.has(source.Player)
    ? source.Player
    : fallbackMusicInteraction.Player;
  const playbackMode = typeof source.PlaybackMode === 'string' && playbackModeOptions.has(source.PlaybackMode)
    ? source.PlaybackMode
    : fallbackMusicInteraction.PlaybackMode;
  return {
    Enabled: sanitizeBoolean(source.Enabled, fallbackMusicInteraction.Enabled),
    UnlimitedRequests: sanitizeBoolean(source.UnlimitedRequests, fallbackMusicInteraction.UnlimitedRequests),
    Skin: skin,
    StatsRange: statsRange,
    Player: player,
    PlaybackMode: playbackMode,
    Transparent: sanitizeBoolean(source.Transparent, fallbackMusicInteraction.Transparent),
    Width: sanitizeNumber('Width', source.Width, fallbackMusicInteraction.Width),
    Height: sanitizeNumber('Height', source.Height, fallbackMusicInteraction.Height),
    ShowCover: sanitizeBoolean(source.ShowCover, fallbackMusicInteraction.ShowCover),
    ShowRequester: sanitizeBoolean(source.ShowRequester, fallbackMusicInteraction.ShowRequester),
    ShowGiftTier: sanitizeBoolean(source.ShowGiftTier, fallbackMusicInteraction.ShowGiftTier),
    ShowQueue: sanitizeBoolean(source.ShowQueue, fallbackMusicInteraction.ShowQueue),
    ShowNowPlayingPanel: sanitizeBoolean(source.ShowNowPlayingPanel, fallbackMusicInteraction.ShowNowPlayingPanel),
    ShowQueuePanel: sanitizeBoolean(source.ShowQueuePanel, fallbackMusicInteraction.ShowQueuePanel),
    ShowRankPanel: sanitizeBoolean(source.ShowRankPanel, fallbackMusicInteraction.ShowRankPanel),
    ShowTodayValue: sanitizeBoolean(source.ShowTodayValue, fallbackMusicInteraction.ShowTodayValue),
    PrimaryColor: isHexColor(source.PrimaryColor) ? source.PrimaryColor.trim() : fallbackMusicInteraction.PrimaryColor,
    FontScale: sanitizeNumber('FontScale', source.FontScale, fallbackMusicInteraction.FontScale),
    Tiers: sanitizeMusicTiers(source.Tiers),
  };
}

function mergeConfig(next: PluginSettings): PluginSettings {
  return {
    ...initialConfig,
    ...next,
    MusicInteraction: sanitizeMusicInteraction(next.MusicInteraction),
  };
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '-';
  return score.toFixed(score >= 10 ? 0 : 1);
}

function candidateKey(candidate: SearchCandidate): string {
  return `${candidate.track.source}-${candidate.track.song_id}`;
}

function sourceLabel(source: SearchCandidate['track']['source']): string {
  switch (source) {
    case 'netease':
      return '网易云';
    case 'tencent':
      return 'QQ 音乐';
    case 'kugou':
      return '酷狗';
    case 'baidu':
      return '百度音乐';
    case 'kuwo':
      return '酷我';
    default:
      return '未知来源';
  }
}

function tierLabel(tierId: string, tiers: MusicTierSettings[]): string {
  const configured = tiers.find(tier => tier.Id === tierId);
  if (configured?.Name.trim()) return configured.Name.trim();
  switch (tierId) {
    case 'playlist_takeover':
      return '包场歌单';
    case 'exclusive':
      return '专属点歌';
    case 'jump_queue':
      return '插队';
    case 'priority':
      return '优先点歌';
    default:
      return '普通点歌';
  }
}

type NumericMusicSetting = 'Width' | 'Height' | 'FontScale';
type BooleanMusicSetting =
  | 'UnlimitedRequests'
  | 'Transparent'
  | 'ShowCover'
  | 'ShowRequester'
  | 'ShowGiftTier'
  | 'ShowQueue'
  | 'ShowNowPlayingPanel'
  | 'ShowQueuePanel'
  | 'ShowRankPanel'
  | 'ShowTodayValue';
type PendingSearchRequest = { keyword: string; userSig: string };
type SearchUserIdentity = { uid: number; uname: string } | null;

const selectClass = 'h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none';

const visualToggleItems: Array<{ label: string; key: BooleanMusicSetting }> = [
  { label: '透明背景', key: 'Transparent' },
  { label: '显示封面', key: 'ShowCover' },
  { label: '显示点歌人', key: 'ShowRequester' },
  { label: '显示礼物档位', key: 'ShowGiftTier' },
  { label: '显示金额', key: 'ShowTodayValue' },
];

const panelToggleItems: Array<{ label: string; key: BooleanMusicSetting }> = [
  { label: '当前播放', key: 'ShowNowPlayingPanel' },
  { label: '点歌队列', key: 'ShowQueuePanel' },
  { label: '点歌排行', key: 'ShowRankPanel' },
  { label: '卡片内队列', key: 'ShowQueue' },
];

const numericBounds: Record<NumericMusicSetting, { min: number; max: number; step?: number }> = {
  Width: { min: 240, max: 1200, step: 1 },
  Height: { min: 120, max: 800, step: 1 },
  FontScale: { min: 0.75, max: 1.5 },
};

function clampSettingValue(key: NumericMusicSetting, raw: string): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const { min, max, step } = numericBounds[key];
  const clamped = Math.min(max, Math.max(min, parsed));
  return step ? Math.round(clamped / step) * step : clamped;
}

export function MusicInteraction() {
  const [config, setConfig] = useState<PluginSettings>(initialConfig);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [manualUname, setManualUname] = useState('');
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const [queue, setQueue] = useState<MusicQueueItem[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<SearchCandidate | null>(null);
  const [confirmedCandidate, setConfirmedCandidate] = useState<SearchCandidate | null>(null);
  const [candidateSearchUser, setCandidateSearchUser] = useState<SearchUserIdentity>(null);
  const [searching, setSearching] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [confirmingIndex, setConfirmingIndex] = useState<number | null>(null);
  const [openingRequestId, setOpeningRequestId] = useState<number | null>(null);
  const [refreshingUrl, setRefreshingUrl] = useState(false);
  const [numberDrafts, setNumberDrafts] = useState<Partial<Record<NumericMusicSetting, string>>>({});
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const latestConfig = useRef(config);
  const loadedRef = useRef(false);
  const saveHydrated = useRef(false);
  const canSaveSettings = useRef(false);
  const pendingSave = useRef(false);
  const warnedUnsavedEdits = useRef(false);
  const searchInFlight = useRef(false);
  const searchRequestId = useRef(0);
  const queueRequestId = useRef(0);
  const activeSearchKey = useRef('');
  const queuedSearchRequest = useRef<PendingSearchRequest | null>(null);
  const latestQuery = useRef('');
  const latestUserSig = useRef('preview');
  const music = config.MusicInteraction;

  const manualUidFromName = (uname: string): number => {
    let hash = 0;
    for (const ch of uname) {
      hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    }
    return hash || 1;
  };

  const manualUserFrom = (unameValue: string): SearchUserIdentity => {
    const uname = unameValue.trim();
    if (!uname) return null;
    return { uid: manualUidFromName(uname), uname };
  };

  const manualUser = () => manualUserFrom(manualUname);
  const userSig = (user: SearchUserIdentity) => user ? `${user.uid}:${user.uname}` : 'preview';

  const clearCandidateState = () => {
    queuedSearchRequest.current = null;
    setCandidates([]);
    setSelectedCandidate(null);
    setConfirmedCandidate(null);
    setCandidateSearchUser(null);
  };

  const updateManualUname = (value: string) => {
    latestUserSig.current = userSig(manualUserFrom(value));
    setManualUname(value);
    clearCandidateState();
  };

  const candidateUserMatchesCurrent = () => {
    const user = manualUser();
    return Boolean(user && candidateSearchUser && user.uid === candidateSearchUser.uid && user.uname === candidateSearchUser.uname);
  };

  const updateMusic = (patch: Partial<MusicInteractionSettings>) => {
    if (loadedRef.current && !canSaveSettings.current && !warnedUnsavedEdits.current) {
      warnedUnsavedEdits.current = true;
      toast.warning('插件配置读取失败，本页修改不会保存');
    }
    setConfig(prev => {
      const next = { ...prev, MusicInteraction: { ...prev.MusicInteraction, ...patch } };
      latestConfig.current = next;
      return next;
    });
  };

  const updateTier = (tierId: string, patch: Partial<MusicTierSettings>) => {
    updateMusic({
      Tiers: music.Tiers.map(tier => tier.Id === tierId ? { ...tier, ...patch } : tier),
    });
  };

  const updateNumberDraft = (key: NumericMusicSetting, value: string) => {
    setNumberDrafts(prev => ({ ...prev, [key]: value }));
  };

  const commitColorDraft = () => {
    if (colorDraft === null) return;
    const next = colorDraft.trim();
    setColorDraft(null);
    if (isHexColor(next)) {
      updateMusic({ PrimaryColor: next });
    } else {
      toast.error('主色必须是 #RRGGBB 格式');
    }
  };

  const commitNumberDraft = (key: NumericMusicSetting) => {
    const raw = numberDrafts[key];
    if (raw === undefined) return;
    const next = clampSettingValue(key, raw);
    setNumberDrafts(prev => {
      const rest = { ...prev };
      delete rest[key];
      return rest;
    });
    if (next !== null) updateMusic({ [key]: next } as Partial<MusicInteractionSettings>);
  };

  const refreshUrl = async () => {
    setRefreshingUrl(true);
    try {
      setUrl(await api.getMusicInteractionUrl());
    } catch (err) {
      toast.error(`读取 OBS 地址失败: ${err}`);
    } finally {
      setRefreshingUrl(false);
    }
  };

  const loadQueue = async () => {
    const requestId = queueRequestId.current + 1;
    queueRequestId.current = requestId;
    setQueueLoading(true);
    try {
      const next = await api.getMusicQueue();
      if (queueRequestId.current === requestId) {
        setQueue(next);
      }
    } catch (err) {
      if (queueRequestId.current === requestId) {
        setQueue([]);
        toast.error(`读取点歌队列失败: ${err}`);
      }
    } finally {
      if (queueRequestId.current === requestId) {
        setQueueLoading(false);
      }
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('地址已复制');
    } catch (err) {
      toast.error(`复制失败: ${err}`);
    }
  };

  const openQueueItem = async (requestId: number) => {
    if (openingRequestId === requestId) return;
    setOpeningRequestId(requestId);
    try {
      await api.openMusicRequest(requestId);
      toast.success('已打开播放器');
    } catch (err) {
      toast.error(`打开失败: ${err}`);
    } finally {
      setOpeningRequestId(current => current === requestId ? null : current);
    }
  };

  const updateQueueItemStatus = async (requestId: number, action: 'finish' | 'skip' | 'fail') => {
    try {
      if (action === 'finish') await api.finishMusicRequest(requestId);
      if (action === 'skip') await api.skipMusicRequest(requestId);
      if (action === 'fail') await api.failMusicRequest(requestId);
      toast.success(action === 'finish' ? '已标记播完' : action === 'skip' ? '已跳过' : '已标记失败');
      await loadQueue();
    } catch (err) {
      toast.error(`更新点歌状态失败: ${err}`);
    }
  };

  const confirmCandidate = async (candidate: SearchCandidate, index: number) => {
    const user = manualUser();
    if (!candidateSearchUser) {
      toast.warning('请先填写点歌用户并重新搜索');
      return;
    }
    if (!user) {
      toast.warning('请先填写点歌用户昵称');
      return;
    }
    if (user.uid !== candidateSearchUser.uid || user.uname !== candidateSearchUser.uname) {
      toast.warning('点歌用户已变更，请重新搜索后再确认');
      return;
    }
    setConfirmingIndex(index);
    try {
      const reply = await api.confirmMusicCandidate(user.uid, user.uname, index);
      if (reply.includes('已加入点歌队列')) {
        setSelectedCandidate(candidate);
        setConfirmedCandidate(candidate);
        toast.success(reply);
        await loadQueue();
      } else {
        toast.warning(reply || '确认未加入队列');
      }
    } catch (err) {
      toast.error(`确认失败: ${err}`);
    } finally {
      setConfirmingIndex(null);
    }
  };

  const searchCandidates = async (requestedKeyword = query.trim()) => {
    const keyword = requestedKeyword.trim();
    if (!keyword) {
      queuedSearchRequest.current = null;
      clearCandidateState();
      return;
    }
    const user = manualUser();
    const searchUserSig = userSig(user);
    latestUserSig.current = searchUserSig;
    const searchKey = `${keyword}|${searchUserSig}`;
    if (searchInFlight.current) {
      if (searchKey === activeSearchKey.current) {
        queuedSearchRequest.current = null;
        return;
      }
      queuedSearchRequest.current = { keyword, userSig: searchUserSig };
      return;
    }
    searchInFlight.current = true;
    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    activeSearchKey.current = searchKey;
    setSearching(true);
    setCandidates([]);
    setSelectedCandidate(null);
    setConfirmedCandidate(null);
    setCandidateSearchUser(null);
    try {
      const next = await api.searchMusicCandidates(keyword, user?.uid, user?.uname);
      if (
        searchRequestId.current === requestId
        && activeSearchKey.current === searchKey
        && latestQuery.current.trim() === keyword
        && latestUserSig.current === searchUserSig
        && queuedSearchRequest.current === null
      ) {
        setCandidates(next);
        setCandidateSearchUser(user);
      }
    } catch (err) {
      if (
        searchRequestId.current === requestId
        && activeSearchKey.current === searchKey
        && latestQuery.current.trim() === keyword
        && latestUserSig.current === searchUserSig
        && queuedSearchRequest.current === null
      ) {
        clearCandidateState();
        toast.error(`搜索失败: ${err}`);
      }
    } finally {
      if (searchRequestId.current === requestId) {
        searchInFlight.current = false;
        setSearching(false);
        const nextRequest = queuedSearchRequest.current;
        queuedSearchRequest.current = null;
        if (nextRequest && (nextRequest.keyword !== keyword || nextRequest.userSig !== searchUserSig)) {
          void searchCandidates(nextRequest.keyword);
        }
      }
    }
  };

  useEffect(() => {
    api.loadPluginSettings().then(next => {
      canSaveSettings.current = true;
      setConfig(mergeConfig(next));
      setLoaded(true);
    }).catch(err => {
      canSaveSettings.current = false;
      toast.error(`读取插件配置失败: ${err}。已使用默认值，修改不会保存`);
      setConfig(initialConfig);
      setLoaded(true);
    });
    refreshUrl().finally(() => { void loadQueue(); });
  }, []);

  useEffect(() => {
    latestConfig.current = config;
  }, [config]);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (loadedRef.current && canSaveSettings.current && pendingSave.current) {
        pendingSave.current = false;
        api.savePluginSettings(latestConfig.current).catch(err => toast.error(`保存失败: ${err}`));
      }
    }
  }, []);

  useEffect(() => {
    if (!loaded || !canSaveSettings.current) return;
    if (!saveHydrated.current) {
      saveHydrated.current = true;
      return;
    }
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    pendingSave.current = true;
    saveTimer.current = window.setTimeout(() => {
      pendingSave.current = false;
      saveTimer.current = null;
      api.savePluginSettings(config).catch(err => toast.error(`保存失败: ${err}`));
    }, 350);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [config, loaded]);

  return (
    <div className="h-full overflow-hidden p-5 text-[var(--foreground)]">
      <GlassCard className="flex h-full min-h-[584px] overflow-hidden rounded-[24px]">
        <div className="w-[clamp(420px,42vw,620px)] shrink-0 overflow-y-auto border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-5 [scrollbar-width:thin]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--primary-color)]/12 text-[var(--primary-color)]">
                <Music2 className="h-4 w-4" />
              </div>
              <div className="text-[16px] font-bold">音乐互动</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[var(--muted-text)]">启用</span>
              <Toggle checked={music.Enabled} onChange={v => updateMusic({ Enabled: v })} disabled={!loaded} />
            </div>
          </div>

          <section className="mb-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--control-bg)] p-4">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-bold">
              <Link2 className="h-3.5 w-3.5 text-[var(--primary-color)]" />
              OBS 地址
            </div>
            <div className="flex gap-2">
              <Input readOnly mono value={url} onClick={e => (e.target as HTMLInputElement).select()} className="flex-1" />
              <Button size="sm" onClick={refreshUrl} disabled={refreshingUrl}>
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingUrl ? 'animate-spin' : ''}`} />刷新
              </Button>
              <Button size="sm" variant="primary" onClick={copyUrl} disabled={!url}>
                <Copy className="h-3.5 w-3.5" />复制
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--surface-border)] bg-[var(--control-bg)] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[12px] font-black">
                <Settings2 className="h-3.5 w-3.5 text-[var(--primary-color)]" />
                点歌设置
              </div>
              <div className="rounded-full border border-[var(--surface-border)] px-2 py-1 text-[10px] font-black text-[var(--muted-text)]">
                {music.PlaybackMode === 'auto_next' ? '自动下一首' : '手动播放'}
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] font-black text-[var(--muted-text)]">
                  <Radio className="h-3.5 w-3.5" />
                  播放控制
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-bold text-[var(--muted-text)]">播放方式</span>
                    <select value={music.Player} onChange={e => updateMusic({ Player: e.target.value })} disabled={!loaded} className={selectClass}>
                      <option value="auto">按歌曲来源</option>
                      <option value="netease">网易云音乐</option>
                      <option value="tencent">QQ 音乐</option>
                      <option value="browser">浏览器</option>
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-bold text-[var(--muted-text)]">播放模式</span>
                    <select value={music.PlaybackMode} onChange={e => updateMusic({ PlaybackMode: e.target.value })} disabled={!loaded} className={selectClass}>
                      <option value="manual_confirm">必须手动确认</option>
                      <option value="auto_next">播完后自动下一首</option>
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-bold text-[var(--muted-text)]">统计范围</span>
                    <select value={music.StatsRange} onChange={e => updateMusic({ StatsRange: e.target.value })} disabled={!loaded} className={selectClass}>
                      <option value="session">本场</option>
                      <option value="today">今日</option>
                      <option value="week">本周</option>
                      <option value="month">本月</option>
                      <option value="all">全部</option>
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-bold text-[var(--muted-text)]">皮肤</span>
                    <select value={music.Skin} onChange={e => updateMusic({ Skin: e.target.value })} disabled={!loaded} className={selectClass}>
                      <option value="neon">霓虹</option>
                      <option value="idol-stage">偶像舞台</option>
                      <option value="vinyl">黑胶</option>
                    </select>
                  </label>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-subtle)] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[11px] font-black text-[var(--control-text)]">无限制点歌</div>
                    <div className="mt-0.5 text-[10px] font-medium text-[var(--muted-text)]">
                      开启后新点歌无需礼物权益，已排队歌曲不受影响
                    </div>
                  </div>
                  <Toggle
                    checked={music.UnlimitedRequests}
                    onChange={v => updateMusic({ UnlimitedRequests: v })}
                    disabled={!loaded}
                  />
                </div>
              </div>

              <div className="border-t border-[var(--surface-border)] pt-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-black text-[var(--muted-text)]">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  OBS 外观
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-bold text-[var(--muted-text)]">宽度</span>
                    <Input
                      type="number"
                      min={numericBounds.Width.min}
                      max={numericBounds.Width.max}
                      value={numberDrafts.Width ?? String(music.Width)}
                      onChange={e => updateNumberDraft('Width', e.target.value)}
                      onBlur={() => commitNumberDraft('Width')}
                      onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
                      disabled={!loaded}
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-bold text-[var(--muted-text)]">高度</span>
                    <Input
                      type="number"
                      min={numericBounds.Height.min}
                      max={numericBounds.Height.max}
                      value={numberDrafts.Height ?? String(music.Height)}
                      onChange={e => updateNumberDraft('Height', e.target.value)}
                      onBlur={() => commitNumberDraft('Height')}
                      onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
                      disabled={!loaded}
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-bold text-[var(--muted-text)]">字号倍率</span>
                    <Input
                      type="number"
                      min={numericBounds.FontScale.min}
                      max={numericBounds.FontScale.max}
                      step={0.05}
                      value={numberDrafts.FontScale ?? String(music.FontScale)}
                      onChange={e => updateNumberDraft('FontScale', e.target.value)}
                      onBlur={() => commitNumberDraft('FontScale')}
                      onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
                      disabled={!loaded}
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-bold text-[var(--muted-text)]">主色</span>
                    <div className="flex gap-2">
                      <Input type="color" value={music.PrimaryColor} onChange={e => { setColorDraft(null); updateMusic({ PrimaryColor: e.target.value }); }} disabled={!loaded} className="w-[44px] px-1" />
                      <Input
                        value={colorDraft ?? music.PrimaryColor}
                        onChange={e => setColorDraft(e.target.value)}
                        onBlur={commitColorDraft}
                        onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
                        disabled={!loaded}
                        className="min-w-0 flex-1"
                      />
                    </div>
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {visualToggleItems.map(item => (
                    <div key={item.key} className="flex items-center justify-between gap-2 border-b border-[var(--surface-border)] px-1 py-2">
                      <span className="text-[11px] font-bold text-[var(--muted-text)]">{item.label}</span>
                      <Toggle checked={Boolean(music[item.key])} onChange={v => updateMusic({ [item.key]: v } as Partial<MusicInteractionSettings>)} disabled={!loaded} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-[var(--surface-border)] pt-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-black text-[var(--muted-text)]">
                  <Monitor className="h-3.5 w-3.5" />
                  统一页面面板
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {panelToggleItems.map(item => (
                    <div key={item.key} className="flex items-center justify-between gap-2 border-b border-[var(--surface-border)] px-1 py-2">
                      <span className="text-[11px] font-bold text-[var(--muted-text)]">{item.label}</span>
                      <Toggle checked={Boolean(music[item.key])} onChange={v => updateMusic({ [item.key]: v } as Partial<MusicInteractionSettings>)} disabled={!loaded} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-[var(--surface-border)] pt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[11px] font-black text-[var(--muted-text)]">
                    <WalletCards className="h-3.5 w-3.5" />
                    礼物金额档位
                  </div>
                  <ListMusic className="h-3.5 w-3.5 text-[var(--muted-text)]" />
                </div>
                <div className="mb-2 grid grid-cols-[1fr_86px_86px_36px] gap-2 px-1 text-[10px] font-black text-[var(--muted-text)]">
                  <span>名称</span>
                  <span>最低</span>
                  <span>基础分</span>
                  <span>启用</span>
                </div>
                <div className="space-y-2">
                  {music.Tiers.map(tier => (
                    <div key={tier.Id} className="grid grid-cols-[1fr_86px_86px_36px] items-center gap-2 border-b border-[var(--surface-border)] px-1 pb-2">
                      <Input
                        value={tier.Name}
                        onChange={e => updateTier(tier.Id, { Name: e.target.value })}
                        disabled={!loaded}
                      />
                      <Input
                        type="number"
                        min={1}
                        value={tier.MinCredit}
                        onChange={e => updateTier(tier.Id, { MinCredit: sanitizeTierNumber(Number(e.target.value), tier.MinCredit, 1, 999999) })}
                        disabled={!loaded}
                      />
                      <Input
                        type="number"
                        min={0}
                        value={tier.BaseScore}
                        onChange={e => updateTier(tier.Id, { BaseScore: sanitizeTierNumber(Number(e.target.value), tier.BaseScore, 0, 999999) })}
                        disabled={!loaded}
                      />
                      <Toggle checked={tier.Enabled} onChange={v => updateTier(tier.Id, { Enabled: v })} disabled={!loaded} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="flex min-w-0 flex-1 flex-col p-5">
          {confirmedCandidate && (
            <div className="mb-4 rounded-2xl border border-[var(--primary-color)]/30 bg-[var(--primary-color)]/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-black text-[var(--primary-color)]">
                <Check className="h-3.5 w-3.5" />
                已确认候选歌曲
              </div>
              <div className="truncate text-[14px] font-black text-[var(--foreground)]">{confirmedCandidate.track.name}</div>
              <div className="mt-1 truncate text-[11px] font-semibold text-[var(--muted-text)]">
                {confirmedCandidate.track.artists.join(' / ') || '未知歌手'} · {confirmedCandidate.track.album || '未知专辑'}
              </div>
            </div>
          )}
          <div className="mb-4 grid grid-cols-[minmax(92px,128px)_minmax(180px,1fr)_112px] gap-2 max-[760px]:grid-cols-1">
            <Input
              value={manualUname}
              onChange={e => updateManualUname(e.target.value)}
              placeholder="点歌用户昵称"
            />
            <Input
              value={query}
              onChange={e => {
                latestQuery.current = e.target.value;
                setQuery(e.target.value);
                if (searchInFlight.current) {
                  clearCandidateState();
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter') searchCandidates(); }}
              placeholder="搜索歌曲"
              className="min-w-0"
            />
            <Button variant="primary" onClick={() => searchCandidates()} className="min-w-[112px] whitespace-nowrap max-[760px]:w-full">
              <Search className="h-3.5 w-3.5" />{searching ? '搜索中' : '搜索'}
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[var(--surface-border)] bg-[var(--control-bg)] [scrollbar-width:thin]">
            {candidates.length === 0 ? (
              <div className="flex h-full min-h-[220px] items-center justify-center text-[12px] font-semibold text-[var(--muted-text)]">
                输入关键词搜索候选歌曲
              </div>
            ) : (
              <div className="divide-y divide-[var(--surface-border)]">
                {candidates.map((candidate, index) => {
                  const key = candidateKey(candidate);
                  const candidateIndex = index + 1;
                  const selected = selectedCandidate ? candidateKey(selectedCandidate) === key : false;
                  const confirmed = confirmedCandidate ? candidateKey(confirmedCandidate) === key : false;
                  const canConfirmCandidate = confirmingIndex === null && candidateUserMatchesCurrent();
                  return (
                  <div key={key} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-black text-[var(--foreground)]">{candidate.track.name}</div>
                      <div className="mt-1 truncate text-[11px] font-semibold text-[var(--muted-text)]">
                        {sourceLabel(candidate.track.source)} · {candidate.track.artists.join(' / ') || '未知歌手'} · {candidate.track.album || '未知专辑'}
                      </div>
                      <div className="mt-2 line-clamp-2 text-[11px] text-[var(--muted-text)]">{candidate.reason}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 min-w-[52px] items-center justify-center rounded-lg bg-[var(--primary-color)]/10 px-2 text-[12px] font-black text-[var(--primary-color)]">
                        {formatScore(candidate.score)}
                      </div>
                      <Button size="sm" variant={selected ? 'primary' : 'default'} onClick={() => setSelectedCandidate(candidate)}>
                        {selected ? '已选' : '选择'}
                      </Button>
                      <Button
                        size="sm"
                        variant={confirmed ? 'primary' : 'default'}
                        onClick={() => confirmCandidate(candidate, candidateIndex)}
                        disabled={!canConfirmCandidate}
                      >
                        {confirmingIndex === candidateIndex ? '确认中' : confirmed ? '已确认' : '确认'}
                      </Button>
                    </div>
                  </div>
                );})}
              </div>
            )}
          </div>
          {selectedCandidate && (
            <div className="mt-4 grid grid-cols-[1fr_auto] gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--control-bg)] p-4">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-[var(--muted-text)]">待确认候选</div>
                <div className="mt-1 truncate text-[13px] font-black text-[var(--foreground)]">{selectedCandidate.track.name}</div>
                <div className="mt-1 truncate text-[11px] font-semibold text-[var(--muted-text)]">
                  {sourceLabel(selectedCandidate.track.source)} · {selectedCandidate.track.artists.join(' / ') || '未知歌手'} · {selectedCandidate.track.album || '未知专辑'}
                </div>
              </div>
              <Button
                variant="primary"
                onClick={() => {
                  const selectedIndex = candidates.findIndex(candidate => candidateKey(candidate) === candidateKey(selectedCandidate));
                  if (selectedIndex >= 0) void confirmCandidate(selectedCandidate, selectedIndex + 1);
                }}
                disabled={confirmingIndex !== null || !candidateUserMatchesCurrent()}
              >
                <Check className="h-3.5 w-3.5" />确认候选
              </Button>
            </div>
          )}
          <div className="mt-4 rounded-2xl border border-[var(--surface-border)] bg-[var(--control-bg)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-[12px] font-bold text-[var(--foreground)]">当前队列</div>
              <Button size="sm" onClick={loadQueue} disabled={queueLoading}>
                <RefreshCw className={`h-3.5 w-3.5 ${queueLoading ? 'animate-spin' : ''}`} />刷新
              </Button>
            </div>
            {queue.length === 0 ? (
              <div className="py-2 text-[12px] font-semibold text-[var(--muted-text)]">
                {queueLoading ? '正在读取队列' : '暂无排队歌曲'}
              </div>
            ) : (
              <div className="max-h-[168px] overflow-y-auto divide-y divide-[var(--surface-border)] [scrollbar-width:thin]">
                {queue.map(item => (
                  <div key={item.requestId} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2">
                    <div className="flex h-7 min-w-8 items-center justify-center rounded-lg bg-[var(--primary-color)]/10 px-2 text-[11px] font-black text-[var(--primary-color)]">
                      #{item.requestId}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-black text-[var(--foreground)]">{item.songName}</div>
                      <div className="mt-0.5 truncate text-[11px] font-semibold text-[var(--muted-text)]">
                        {item.artistNames || '未知歌手'} · {item.uname || '未知用户'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right text-[11px] font-bold text-[var(--muted-text)]">
                        <div>{tierLabel(item.tier, music.Tiers)}</div>
                        <div>{item.status}</div>
                      </div>
                      <Button
                        size="sm"
                        variant={item.status === 'playing' ? 'primary' : 'default'}
                        onClick={() => openQueueItem(item.requestId)}
                        disabled={openingRequestId === item.requestId}
                        className="px-3"
                      >
                        <Play className="h-3.5 w-3.5" />
                        {openingRequestId === item.requestId ? '打开中' : '播放'}
                      </Button>
                      <Button size="sm" onClick={() => updateQueueItemStatus(item.requestId, 'finish')}>
                        播完
                      </Button>
                      <Button size="sm" onClick={() => updateQueueItemStatus(item.requestId, 'skip')}>
                        跳过
                      </Button>
                      <Button size="sm" onClick={() => updateQueueItemStatus(item.requestId, 'fail')}>
                        失败
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
