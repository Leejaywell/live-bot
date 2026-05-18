import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, Music2, Play, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api, MusicInteractionSettings, MusicQueueItem, PluginSettings, SearchCandidate } from '../lib/api';
import { fallbackConfig } from './WishGoal';

const fallbackMusicInteraction: MusicInteractionSettings = {
  Enabled: true,
  Skin: 'compact',
  StatsRange: 'session',
  Transparent: true,
  Width: 720,
  Height: 120,
  ShowCover: true,
  ShowRequester: true,
  ShowGiftTier: true,
  ShowQueue: true,
  ShowTodayValue: false,
  PrimaryColor: '#8b5cf6',
  FontScale: 1,
};

const initialConfig: PluginSettings = {
  ...fallbackConfig,
  MusicInteraction: fallbackMusicInteraction,
};

const statsRangeOptions = new Set(['session', 'today', 'week', 'month', 'all']);
const skinOptions = new Set(['compact', 'minimal']);

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
  return {
    Enabled: sanitizeBoolean(source.Enabled, fallbackMusicInteraction.Enabled),
    Skin: skin,
    StatsRange: statsRange,
    Transparent: sanitizeBoolean(source.Transparent, fallbackMusicInteraction.Transparent),
    Width: sanitizeNumber('Width', source.Width, fallbackMusicInteraction.Width),
    Height: sanitizeNumber('Height', source.Height, fallbackMusicInteraction.Height),
    ShowCover: sanitizeBoolean(source.ShowCover, fallbackMusicInteraction.ShowCover),
    ShowRequester: sanitizeBoolean(source.ShowRequester, fallbackMusicInteraction.ShowRequester),
    ShowGiftTier: sanitizeBoolean(source.ShowGiftTier, fallbackMusicInteraction.ShowGiftTier),
    ShowQueue: sanitizeBoolean(source.ShowQueue, fallbackMusicInteraction.ShowQueue),
    ShowTodayValue: sanitizeBoolean(source.ShowTodayValue, fallbackMusicInteraction.ShowTodayValue),
    PrimaryColor: isHexColor(source.PrimaryColor) ? source.PrimaryColor.trim() : fallbackMusicInteraction.PrimaryColor,
    FontScale: sanitizeNumber('FontScale', source.FontScale, fallbackMusicInteraction.FontScale),
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

type NumericMusicSetting = 'Width' | 'Height' | 'FontScale';
type PendingSearchRequest = { keyword: string; userSig: string };
type SearchUserIdentity = { uid: number; uname: string } | null;

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
  const [manualUid, setManualUid] = useState('');
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

  const manualUserFrom = (uidValue: string, unameValue: string): SearchUserIdentity => {
    const uid = Number(uidValue.trim());
    const uname = unameValue.trim();
    if (!Number.isInteger(uid) || uid <= 0 || !uname) return null;
    return { uid, uname };
  };

  const manualUser = () => manualUserFrom(manualUid, manualUname);
  const userSig = (user: SearchUserIdentity) => user ? `${user.uid}:${user.uname}` : 'preview';

  const clearCandidateState = () => {
    queuedSearchRequest.current = null;
    setCandidates([]);
    setSelectedCandidate(null);
    setConfirmedCandidate(null);
    setCandidateSearchUser(null);
  };

  const updateManualUid = (value: string) => {
    latestUserSig.current = userSig(manualUserFrom(value, manualUname));
    setManualUid(value);
    clearCandidateState();
  };

  const updateManualUname = (value: string) => {
    latestUserSig.current = userSig(manualUserFrom(manualUid, value));
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

  const confirmCandidate = async (candidate: SearchCandidate, index: number) => {
    const user = manualUser();
    if (!candidateSearchUser) {
      toast.warning('请先填写点歌用户并重新搜索');
      return;
    }
    if (!user) {
      toast.warning('请先填写有效的用户 UID 和昵称');
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
            <div className="mb-3 text-[12px] font-bold">显示设置</div>
            <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-[11px] font-bold text-[var(--muted-text)]">皮肤</span>
              <select value={music.Skin} onChange={e => updateMusic({ Skin: e.target.value })} disabled={!loaded}
                className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                <option value="compact">紧凑</option>
                <option value="minimal">极简</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-bold text-[var(--muted-text)]">统计范围</span>
              <select value={music.StatsRange} onChange={e => updateMusic({ StatsRange: e.target.value })} disabled={!loaded}
                className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                <option value="session">本场</option>
                <option value="today">今日</option>
                <option value="week">本周</option>
                <option value="month">本月</option>
                <option value="all">全部</option>
              </select>
            </label>
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
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                ['透明背景', 'Transparent'],
                ['显示封面', 'ShowCover'],
                ['显示点歌人', 'ShowRequester'],
                ['显示礼物档位', 'ShowGiftTier'],
                ['显示队列', 'ShowQueue'],
                ['显示今日数值', 'ShowTodayValue'],
              ].map(([label, key]) => (
                <div key={key} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-bg)] px-3 py-2">
                  <span className="text-[11px] font-bold text-[var(--muted-text)]">{label}</span>
                  <Toggle checked={Boolean(music[key as keyof MusicInteractionSettings])} onChange={v => updateMusic({ [key]: v } as Partial<MusicInteractionSettings>)} disabled={!loaded} />
                </div>
              ))}
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
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-[minmax(120px,160px)_1fr] gap-2">
              <Input
                value={manualUid}
                onChange={e => updateManualUid(e.target.value)}
                placeholder="用户 UID"
              />
              <Input
                value={manualUname}
                onChange={e => updateManualUname(e.target.value)}
                placeholder="用户昵称"
              />
            </div>
            <div className="flex gap-2">
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
                className="flex-1"
              />
              <Button variant="primary" onClick={() => searchCandidates()}>
                <Search className="h-3.5 w-3.5" />{searching ? '搜索中' : '搜索'}
              </Button>
            </div>
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
                        {candidate.track.artists.join(' / ') || '未知歌手'} · {candidate.track.album || '未知专辑'}
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
                  {selectedCandidate.track.artists.join(' / ') || '未知歌手'} · {selectedCandidate.track.album || '未知专辑'}
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
                        <div>{item.tier}</div>
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
