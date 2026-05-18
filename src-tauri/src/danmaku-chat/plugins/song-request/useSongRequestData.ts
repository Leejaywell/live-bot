import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '../../runtime/fetch';
import { NowPlayingResponse, RankResponse, SongQueueItem, SongQueueResponse, SongRequestVisualState } from './types';

const EMPTY_VISUAL: SongRequestVisualState = {
  newRequestIds: new Set<number>(),
  playingChanged: false,
  highTierRequestId: null,
};

function highTier(item: SongQueueItem | null | undefined) {
  return item?.tier === 'jump_queue' || item?.tier === 'exclusive' || item?.tier === 'playlist_takeover';
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function responseItems(value: unknown): unknown[] {
  return isObjectLike(value) && Array.isArray(value.items) ? value.items : [];
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function normalizeQueueItem(value: unknown): SongQueueItem | null {
  if (!isObjectLike(value) || typeof value.requestId !== 'number' || !Number.isFinite(value.requestId)) {
    return null;
  }

  return {
    requestId: value.requestId,
    uid: finiteNumber(value.uid),
    uname: stringValue(value.uname),
    songName: stringValue(value.songName),
    artistNames: stringValue(value.artistNames),
    tier: stringValue(value.tier),
    creditValue: finiteNumber(value.creditValue),
    priorityScore: finiteNumber(value.priorityScore),
    status: stringValue(value.status),
    requestedAt: stringValue(value.requestedAt),
  };
}

function normalizeRankItem(value: unknown): RankResponse['items'][number] | null {
  if (!isObjectLike(value)) {
    return null;
  }

  return {
    uname: stringValue(value.uname),
    tier: stringValue(value.tier),
    value: finiteNumber(value.value),
    count: finiteNumber(value.count),
  };
}

export function useSongRequestData(view: 'dashboard' | 'playlist' | 'now-playing' | 'rank') {
  const [queue, setQueue] = useState<SongQueueItem[]>([]);
  const [nowPlaying, setNowPlaying] = useState<SongQueueItem | null>(null);
  const [rank, setRank] = useState<RankResponse['items']>([]);
  const [visual, setVisual] = useState<SongRequestVisualState>(EMPTY_VISUAL);
  const previousIds = useRef<Set<number>>(new Set());
  const previousPlaying = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;

    async function load() {
      if (view === 'now-playing') {
        const data = await fetchJson<NowPlayingResponse>('/song-request/api/now-playing', { item: null });
        if (disposed) return;
        const item = isObjectLike(data) ? normalizeQueueItem(data.item) : null;
        const nextPlayingId = item?.requestId ?? null;
        setVisual({
          newRequestIds: new Set<number>(),
          playingChanged: previousPlaying.current !== null && previousPlaying.current !== nextPlayingId,
          highTierRequestId: highTier(item) ? item.requestId : null,
        });
        previousPlaying.current = nextPlayingId;
        setNowPlaying(item);
        return;
      }

      if (view === 'rank') {
        const data = await fetchJson<RankResponse>('/song-request/api/rank', { items: [] });
        if (!disposed) setRank(responseItems(data).map(normalizeRankItem).filter(item => item !== null));
        return;
      }

      const [queueData, rankData] = view === 'dashboard'
        ? await Promise.all([
          fetchJson<SongQueueResponse>('/song-request/api/queue', { items: [] }),
          fetchJson<RankResponse>('/song-request/api/rank', { items: [] }),
        ])
        : [await fetchJson<SongQueueResponse>('/song-request/api/queue', { items: [] }), null];
      if (disposed) return;
      const items = responseItems(queueData).map(normalizeQueueItem).filter(item => item !== null);
      const nextIds = new Set(items.map(item => item.requestId));
      const newRequestIds = new Set(items.filter(item => !previousIds.current.has(item.requestId)).map(item => item.requestId));
      const playing = items.find(item => item.status === 'playing') || null;
      setVisual({
        newRequestIds,
        playingChanged: previousPlaying.current !== null && previousPlaying.current !== (playing?.requestId ?? null),
        highTierRequestId: items.find(highTier)?.requestId ?? null,
      });
      previousIds.current = nextIds;
      previousPlaying.current = playing?.requestId ?? null;
      setQueue(items);
      setNowPlaying(playing);
      if (rankData) setRank(responseItems(rankData).map(normalizeRankItem).filter(item => item !== null));
    }

    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [view]);

  return { queue, nowPlaying, rank, visual };
}
