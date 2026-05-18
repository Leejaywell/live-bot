import { useEffect, useRef, useState } from 'react';
import { Copy, Link2, Music2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api, MusicInteractionSettings, PluginSettings, SearchCandidate } from '../lib/api';
import { fallbackConfig } from './WishGoal';

const fallbackMusicInteraction: MusicInteractionSettings = {
  Enabled: true,
  Skin: 'compact',
  StatsRange: 'today',
  Transparent: true,
  Width: 420,
  Height: 180,
  ShowCover: true,
  ShowRequester: true,
  ShowGiftTier: true,
  ShowQueue: true,
  ShowTodayValue: true,
  PrimaryColor: '#22d3ee',
  FontScale: 1,
};

const initialConfig: PluginSettings = {
  ...fallbackConfig,
  MusicInteraction: fallbackMusicInteraction,
};

function mergeConfig(next: PluginSettings): PluginSettings {
  return {
    ...initialConfig,
    ...next,
    MusicInteraction: {
      ...fallbackMusicInteraction,
      ...next.MusicInteraction,
    },
  };
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '-';
  return score.toFixed(score >= 10 ? 0 : 1);
}

export function MusicInteraction() {
  const [config, setConfig] = useState<PluginSettings>(initialConfig);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshingUrl, setRefreshingUrl] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const music = config.MusicInteraction;

  const updateMusic = (patch: Partial<MusicInteractionSettings>) => {
    setConfig(prev => ({ ...prev, MusicInteraction: { ...prev.MusicInteraction, ...patch } }));
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

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('地址已复制');
    } catch (err) {
      toast.error(`复制失败: ${err}`);
    }
  };

  const searchCandidates = async () => {
    const keyword = query.trim();
    if (!keyword) {
      setCandidates([]);
      return;
    }
    setSearching(true);
    try {
      setCandidates(await api.searchMusicCandidates(keyword));
    } catch (err) {
      toast.error(`搜索失败: ${err}`);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    api.loadPluginSettings().then(next => {
      setConfig(mergeConfig(next));
      setLoaded(true);
    }).catch(err => {
      setLoaded(true);
      toast.error(`读取插件配置失败: ${err}`);
    });
    refreshUrl();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
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
              <Toggle checked={music.Enabled} onChange={v => updateMusic({ Enabled: v })} />
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
            <label className="space-y-1.5">
              <span className="text-[11px] font-bold text-[var(--muted-text)]">皮肤</span>
              <select value={music.Skin} onChange={e => updateMusic({ Skin: e.target.value })}
                className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                <option value="compact">紧凑</option>
                <option value="minimal">极简</option>
              </select>
            </label>
          </section>
        </div>

        <div className="flex min-w-0 flex-1 flex-col p-5">
          <div className="mb-4 flex gap-2">
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') searchCandidates(); }}
              placeholder="搜索歌曲"
              className="flex-1"
            />
            <Button variant="primary" onClick={searchCandidates} disabled={searching}>
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
                {candidates.map((candidate) => (
                  <div key={`${candidate.track.source}-${candidate.track.song_id}`} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-black text-[var(--foreground)]">{candidate.track.name}</div>
                      <div className="mt-1 truncate text-[11px] font-semibold text-[var(--muted-text)]">
                        {candidate.track.artists.join(' / ') || '未知歌手'} · {candidate.track.album || '未知专辑'}
                      </div>
                      <div className="mt-2 line-clamp-2 text-[11px] text-[var(--muted-text)]">{candidate.reason}</div>
                    </div>
                    <div className="flex h-8 min-w-[52px] items-center justify-center rounded-lg bg-[var(--primary-color)]/10 px-2 text-[12px] font-black text-[var(--primary-color)]">
                      {formatScore(candidate.score)}
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
