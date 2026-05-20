import { ReactNode, createElement, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, proxyImage } from '../../runtime/fetch';
import { DanmakuChatSettings } from '../../runtime/types';

type MessageKind = 'danmu' | 'gift' | 'superchat' | 'guard' | 'interaction' | 'entry';
type MessageRole = 'normal' | 'member' | 'moderator' | 'owner';

interface RenderMessage {
  id: number;
  kind: MessageKind;
  role: MessageRole;
  user: string;
  text: string;
  time: string;
  legacyClass: string;
  guardLevel: number;
  avatar?: string;
  badge?: string;
  gift?: string;
  giftImage?: string;
  count?: number;
  price?: number;
  priceLevel?: number;
  accent?: string;
  accentSoft?: string;
  accentText?: string;
  label?: string;
}

interface DanmakuChatViewProps {
  settings?: DanmakuChatSettings;
}

const MAX_RENDERED_MESSAGES = 120;
const MIN_EMIT_INTERVAL_MS = 120;
const MAX_EMIT_INTERVAL_MS = 520;
let cachedDanmakuItems: RenderMessage[] = [];

function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim() ? value : fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rawInfo(raw: Record<string, unknown>): unknown[] | null {
  return Array.isArray(raw.info) ? raw.info : null;
}

function rawInfoUser(raw: Record<string, unknown>): string {
  const info = rawInfo(raw);
  const user = info?.[2];
  return Array.isArray(user) ? safeString(user[1]) : '';
}

function rawDanmuText(raw: Record<string, unknown>): string {
  const info = rawInfo(raw);
  return typeof info?.[1] === 'string' ? info[1] : '';
}

function rawAvatar(raw: Record<string, unknown>): string | undefined {
  const info = rawInfo(raw);
  const userBlock = info?.[15];
  const userRecord = isRecord(userBlock) ? userBlock : null;
  const user = userRecord && isRecord(userRecord.user) ? userRecord.user : null;
  const base = user && isRecord(user.base) ? user.base : null;
  const originInfo = base && isRecord(base.origin_info) ? base.origin_info : null;
  const data = (raw as { data?: Record<string, unknown> }).data;

  return firstImage(
    raw.face,
    raw.uface,
    raw.user_face,
    raw.userFace,
    raw.avatar,
    data?.face,
    data?.uface,
    data?.user_face,
    data?.userFace,
    base?.face,
    originInfo?.face,
  );
}

function normalizeType(value: unknown): MessageKind | null {
  const text = safeString(value).toLowerCase().split(':', 1)[0];
  switch (text) {
    case 'danmu':
    case 'message':
    case 'danmu_msg':
      return 'danmu';
    case 'gift':
    case 'send_gift':
      return 'gift';
    case 'superchat':
    case 'super_chat':
    case 'super_chat_message':
      return 'superchat';
    case 'guardbuy':
    case 'guard_buy':
      return 'guard';
    case 'entryeffect':
    case 'entry_effect':
    case 'entry_effect_must_receive':
      return 'entry';
    case 'interaction':
    case 'interact':
    case 'interact_word':
    case 'like-click':
    case 'like_click':
    case 'like_info_v3_click':
      return 'interaction';
    default:
      return null;
  }
}

function normalizedPrice(...values: unknown[]): number {
  for (const value of values) {
    const price = safeNumber(value, Number.NaN);
    if (!Number.isFinite(price) || price <= 0) {
      continue;
    }
    if (price >= 1000) {
      return Math.round(price) / 1000;
    }
    return price;
  }
  return 0;
}

function normalizedCount(...values: unknown[]): number {
  for (const value of values) {
    const count = safeNumber(value, Number.NaN);
    if (Number.isFinite(count) && count > 0) {
      return Math.max(1, Math.round(count));
    }
  }
  return 1;
}

function inferRole(value: unknown, guardLevel: number): MessageRole {
  const role = safeString(value).toLowerCase();
  if (role === 'owner' || role === 'anchor') {
    return 'owner';
  }
  if (role === 'moderator' || role === 'admin') {
    return 'moderator';
  }
  if (role === 'member' || role === 'guard') {
    return 'member';
  }
  if (guardLevel > 0) {
    return 'member';
  }
  return 'normal';
}

function timeText(value: unknown): string {
  const text = safeString(value);
  const date = text ? new Date(text) : new Date();
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function firstImage(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = safeString(value);
    if (!text) continue;
    const next = proxyImage(text);
    if (next) return next;
  }
  return undefined;
}

function badgeText(medalName: unknown, medalLevel: unknown, guardLevel: number): string | undefined {
  const name = safeString(medalName);
  const level = safeNumber(medalLevel);
  if (name) {
    return level > 0 ? `${name} ${level}` : name;
  }
  if (guardLevel === 3) return '总督';
  if (guardLevel === 2) return '提督';
  if (guardLevel === 1) return '舰长';
  return undefined;
}

function stripEntryMarkers(text: string): string {
  return text.replace(/<%([^%>]+)%>/g, '$1').trim();
}

function interactionText(action: unknown): string {
  switch (safeNumber(action)) {
    case 1:
      return '进入直播间';
    case 2:
      return '关注了直播间';
    case 3:
      return '分享了直播间';
    case 4:
      return '特别关注了直播间';
    case 5:
      return '互相关注了直播间';
    default:
      return '和直播间产生了互动';
  }
}

function interactionMessage(
  live: Record<string, unknown> | null,
  root: Record<string, unknown> | null,
  rawData: Record<string, unknown> | null,
): string {
  const explicit =
    safeString(live?.text || root?.text || rawData?.message || rawData?.content || rawData?.uname_title);
  if (explicit) {
    return explicit;
  }
  const count = safeNumber(rawData?.like_count ?? rawData?.click_count, 0);
  if (count > 0) {
    return `点赞了 ${count} 次`;
  }
  return interactionText(rawData?.msg_type ?? rawData?.action);
}

function priceTheme(price: number) {
  if (price >= 700) {
    return {
      level: 7,
      accent: '#d00000',
      accentSoft: 'rgba(230,33,23,0.28)',
      accentText: '#ffffff',
    };
  }
  if (price >= 350) {
    return {
      level: 6,
      accent: '#c2185b',
      accentSoft: 'rgba(233,30,99,0.26)',
      accentText: '#ffffff',
    };
  }
  if (price >= 140) {
    return {
      level: 5,
      accent: '#e65100',
      accentSoft: 'rgba(245,124,0,0.24)',
      accentText: '#fff7ef',
    };
  }
  if (price >= 70) {
    return {
      level: 4,
      accent: '#ffb300',
      accentSoft: 'rgba(255,202,40,0.24)',
      accentText: '#221100',
    };
  }
  if (price >= 35) {
    return {
      level: 3,
      accent: '#00bfa5',
      accentSoft: 'rgba(29,233,182,0.24)',
      accentText: '#031313',
    };
  }
  if (price >= 14) {
    return {
      level: 2,
      accent: '#00b8d4',
      accentSoft: 'rgba(0,229,255,0.24)',
      accentText: '#061215',
    };
  }
  if (price > 0) {
    return {
      level: 1,
      accent: '#1565c0',
      accentSoft: 'rgba(30,136,229,0.24)',
      accentText: '#ffffff',
    };
  }
  return {
    level: 0,
    accent: '#99ecff',
    accentSoft: 'rgba(153,236,255,0.24)',
    accentText: '#091014',
  };
}

function normalizeLiveItem(
  payload: unknown,
  giftCatalog: Record<string, string>,
): RenderMessage | null {
  const root = isRecord(payload) ? payload : null;
  const live = isRecord(root?.event) ? root.event : root;
  const raw = isRecord(root?.raw) ? root.raw : null;
  const rawData = isRecord(raw?.data) ? raw.data : null;
  const userInfo = rawData && isRecord(rawData.user_info) ? rawData.user_info : null;
  const type =
    normalizeType(live?.type) ||
    normalizeType(root?.type) ||
    normalizeType(raw?.cmd) ||
    normalizeType(rawData?.cmd);

  if (!type) {
    return null;
  }

  const guardLevel = safeNumber(
    live?.guardLevel ?? live?.guard_level ?? root?.guardLevel ?? rawData?.guard_level ?? rawData?.privilege_type,
  );
  const role = inferRole(live?.role ?? live?.identity ?? root?.identity, guardLevel);
  const badge = badgeText(
    live?.medalName ?? root?.medalName ?? rawData?.fans_medal_name,
    live?.medalLevel ?? root?.medalLevel ?? rawData?.fans_medal_level,
    guardLevel,
  );
  const user =
    safeString(live?.user || live?.uname || root?.user || rawData?.uname || userInfo?.uname) ||
    (raw ? rawInfoUser(raw) : '') ||
    '观众';
  const time = timeText(live?.time ?? root?.time ?? rawData?.timestamp);
  const avatar = firstImage(
    live?.avatar,
    root?.avatar,
    rawData?.face,
    rawData?.uface,
    userInfo?.face,
  ) || (raw ? rawAvatar(raw) : undefined);

  if (type === 'danmu') {
    const text = safeString(live?.text || root?.text) || (raw ? rawDanmuText(raw) : '');
    if (!text) return null;
    return {
      id: Date.now() + Math.random(),
      kind: 'danmu',
      role,
      user,
      text,
      time,
      legacyClass: 'msg-danmu',
      guardLevel,
      avatar,
      badge,
    };
  }

  if (type === 'gift') {
    const gift = safeString(live?.gift || root?.gift || rawData?.giftName || rawData?.gift_name, '礼物');
    const count = normalizedCount(live?.count, root?.count, rawData?.num, rawData?.count);
    const price = normalizedPrice(
      live?.priceNormalized,
      root?.priceNormalized,
      rawData?.price_normalized,
      live?.price,
      root?.price,
      rawData?.discount_price,
      rawData?.price,
      rawData?.total_coin,
    );
    const theme = priceTheme(price);
    return {
      id: Date.now() + Math.random(),
      kind: 'gift',
      role,
      user,
      text: `${gift} x${count}`,
      time,
      legacyClass: 'msg-gift',
      guardLevel,
      avatar,
      badge,
      gift,
      giftImage: giftCatalog[gift] ? proxyImage(giftCatalog[gift]) : undefined,
      count,
      price,
      priceLevel: theme.level,
      accent: theme.accent,
      accentSoft: theme.accentSoft,
      accentText: theme.accentText,
      label: price > 0 ? `¥${price}` : '免费礼物',
    };
  }

  if (type === 'superchat') {
    const text =
      safeString(live?.text || root?.text || rawData?.message || rawData?.content, '醒目留言');
    const price = normalizedPrice(
      live?.priceNormalized,
      root?.priceNormalized,
      rawData?.price_normalized,
      live?.price,
      root?.price,
      rawData?.price,
      rawData?.rmb,
    );
    const theme = priceTheme(price);
    return {
      id: Date.now() + Math.random(),
      kind: 'superchat',
      role,
      user,
      text,
      time,
      legacyClass: 'msg-sc',
      guardLevel,
      avatar,
      badge,
      price,
      priceLevel: theme.level,
      accent: theme.accent,
      accentSoft: theme.accentSoft,
      accentText: theme.accentText,
    };
  }

  if (type === 'guard') {
    const gift = safeString(live?.gift || root?.gift || rawData?.gift_name || rawData?.giftName, '舰长');
    const count = normalizedCount(live?.count, root?.count, rawData?.num);
    const price = normalizedPrice(
      live?.priceNormalized,
      root?.priceNormalized,
      rawData?.price_normalized,
      live?.price,
      root?.price,
      rawData?.price,
    );
    const theme = priceTheme(Math.max(price, 198));
    return {
      id: Date.now() + Math.random(),
      kind: 'guard',
      role: 'member',
      user,
      text: `${gift} x${count}`,
      time,
      legacyClass: 'msg-guard',
      guardLevel: Math.max(guardLevel, 1),
      avatar,
      badge,
      gift,
      giftImage: giftCatalog[gift] ? proxyImage(giftCatalog[gift]) : undefined,
      count,
      price,
      priceLevel: theme.level,
      accent: '#73efff',
      accentSoft: 'rgba(0,188,212,0.18)',
      accentText: '#eefcff',
      label: gift,
    };
  }

  if (type === 'entry') {
    const text = stripEntryMarkers(
      safeString(live?.text || root?.text || rawData?.copy_writing_v2 || rawData?.copy_writing, `${user} 来了`),
    );
    return {
      id: Date.now() + Math.random(),
      kind: 'entry',
      role,
      user,
      text,
      time,
      legacyClass: 'msg-entry',
      guardLevel,
      avatar,
      badge,
      accent: guardLevel > 0 ? '#73efff' : '#00bcd4',
      accentSoft: guardLevel > 0 ? 'rgba(0,188,212,0.22)' : 'rgba(0,188,212,0.16)',
      label: '入场',
    };
  }

  if (type === 'interaction') {
    const text = interactionMessage(live, root, rawData);
    return {
      id: Date.now() + Math.random(),
      kind: 'interaction',
      role,
      user,
      text,
      time,
      legacyClass: 'msg-interaction',
      guardLevel,
      avatar,
      badge,
      accent: '#ffd455',
      accentSoft: 'rgba(255,255,255,0.12)',
      label: '互动',
    };
  }

  return null;
}

const DEMO_SAMPLES: unknown[] = [
  { type: 'EntryEffect', user: '晚风剧场', text: '<%晚风剧场%> 来了', guardLevel: 0, avatar: 'https://i1.hdslb.com/bfs/face/9a68fe661986d7ec26f1f7f5f0a8b46c4b8bffd4.jpg' },
  { type: 'Danmu', user: '折纸信号', text: '这一版默认样式终于顺眼了', guardLevel: 0 },
  { type: 'Interaction', user: '海盐汽水', text: '关注了直播间', guardLevel: 0 },
  { type: 'Gift', user: '霓虹雨棚', gift: '心动卡', count: 3, price: 300, guardLevel: 0 },
  { type: 'SuperChat', user: '白昼航线', text: '右侧预览就按这个节奏循环就行', price: 66, guardLevel: 0 },
  { type: 'SuperChat', user: '月面观测员', text: '默认主题保持简洁透明，别再堆太多装饰', price: 520, guardLevel: 0 },
  { type: 'GuardBuy', user: '北岸提督', gift: '舰长', count: 1, price: 198000, guardLevel: 1 },
];

function allowMessage(item: RenderMessage, settings?: DanmakuChatSettings): boolean {
  if (!settings) return true;
  if (item.kind === 'gift') {
    return settings.ShowGift !== false && (item.price ?? 0) >= (settings.GiftMinCost ?? 0);
  }
  if (item.kind === 'superchat') {
    return settings.ShowSc !== false && (item.price ?? 0) >= (settings.ScMinCost ?? 0);
  }
  if (item.kind === 'guard') {
    return settings.ShowGuard !== false;
  }
  return true;
}

function messageLimit(settings?: DanmakuChatSettings): number {
  const limit = safeNumber(settings?.MaxMsgs, 50);
  return Math.max(10, Math.min(MAX_RENDERED_MESSAGES, limit || 50));
}

function emitIntervalMs(item: RenderMessage, settings?: DanmakuChatSettings): number {
  const base = Math.max(MIN_EMIT_INTERVAL_MS, safeNumber(settings?.FadeInTime, 200));
  if (item.kind === 'superchat') {
    return Math.min(MAX_EMIT_INTERVAL_MS, base + 180);
  }
  if (item.kind === 'guard') {
    return Math.min(MAX_EMIT_INTERVAL_MS, base + 120);
  }
  if (item.kind === 'gift') {
    return Math.min(MAX_EMIT_INTERVAL_MS, base + 60);
  }
  if (item.kind === 'entry' || item.kind === 'interaction') {
    return Math.max(MIN_EMIT_INTERVAL_MS, base - 40);
  }
  return Math.min(MAX_EMIT_INTERVAL_MS, base);
}

export function DanmakuChatView({ settings }: DanmakuChatViewProps) {
  const [items, setItems] = useState<RenderMessage[]>(() => cachedDanmakuItems);
  const [giftCatalog, setGiftCatalog] = useState<Record<string, string>>({});
  const [fadingIds, setFadingIds] = useState<Set<number>>(() => new Set());
  const isDemo = useMemo(() => new URLSearchParams(window.location.search).get('demo') === '1', []);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<DanmakuChatSettings | undefined>(settings);
  const queueRef = useRef<RenderMessage[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fadeStartTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const fadeRemoveTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  function clearFadeTimers(itemId?: number) {
    const clearFrom = (store: Map<number, ReturnType<typeof setTimeout>>) => {
      if (itemId == null) {
        store.forEach(timer => clearTimeout(timer));
        store.clear();
        return;
      }
      const timer = store.get(itemId);
      if (timer) {
        clearTimeout(timer);
        store.delete(itemId);
      }
    };
    clearFrom(fadeStartTimersRef.current);
    clearFrom(fadeRemoveTimersRef.current);
  }

  function dropMessage(itemId: number) {
    clearFadeTimers(itemId);
    setFadingIds(prev => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    setItems(prev => prev.filter(item => item.id !== itemId));
  }

  function scheduleDismiss(item: RenderMessage) {
    const cfg = settingsRef.current;
    if (!cfg?.AnimateOut) {
      return;
    }
    clearFadeTimers(item.id);
    const waitMs = Math.max(0, safeNumber(cfg.AnimateOutWaitTime, 30)) * 1000;
    const fadeMs = Math.max(0, safeNumber(cfg.FadeOutTime, 400));
    const startTimer = setTimeout(() => {
      fadeStartTimersRef.current.delete(item.id);
      setFadingIds(prev => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
      const removeTimer = setTimeout(() => {
        fadeRemoveTimersRef.current.delete(item.id);
        dropMessage(item.id);
      }, fadeMs);
      fadeRemoveTimersRef.current.set(item.id, removeTimer);
    }, waitMs);
    fadeStartTimersRef.current.set(item.id, startTimer);
  }

  useEffect(() => {
    let disposed = false;
    fetchJson<Record<string, string>>('/gift-catalog', {}).then(next => {
      if (!disposed) {
        setGiftCatalog(next);
      }
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    let demoTimer: ReturnType<typeof setInterval> | undefined;

    function scheduleFlush(delay = MIN_EMIT_INTERVAL_MS) {
      if (disposed || flushTimerRef.current) {
        return;
      }
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = undefined;
        const next = queueRef.current.shift();
        if (!next) {
          return;
        }
        setItems(prev => {
          const merged = [...prev, next];
          const limited = merged.slice(-messageLimit(settingsRef.current));
          const keepIds = new Set(limited.map(item => item.id));
          for (const item of merged) {
            if (!keepIds.has(item.id)) {
              clearFadeTimers(item.id);
            }
          }
          setFadingIds(prevFading => {
            let changed = false;
            const nextFading = new Set<number>();
            for (const id of prevFading) {
              if (keepIds.has(id)) {
                nextFading.add(id);
              } else {
                changed = true;
              }
            }
            return changed ? nextFading : prevFading;
          });
          return limited;
        });
        scheduleDismiss(next);
        if (queueRef.current.length) {
          scheduleFlush(emitIntervalMs(queueRef.current[0], settingsRef.current));
        }
      }, delay);
    }

    function enqueueItem(payload: unknown) {
      const next = normalizeLiveItem(payload, giftCatalog);
      if (!next || !allowMessage(next, settingsRef.current)) {
        return;
      }
      queueRef.current.push(next);
      if (queueRef.current.length === 1) {
        scheduleFlush(emitIntervalMs(next, settingsRef.current));
      }
    }

    async function loadRecent() {
      const recent = await fetchJson<unknown[]>('/recent-events?limit=10', []);
      if (disposed || !Array.isArray(recent)) {
        return;
      }
      const normalized = recent
        .map(item => normalizeLiveItem(item, giftCatalog))
        .filter((item): item is RenderMessage => Boolean(item))
        .filter(item => allowMessage(item, settingsRef.current))
        .map((item, index) => ({ ...item, id: Date.now() + index }));
      setItems(normalized);
      queueRef.current = [];
    }

    function scheduleRetry() {
      if (disposed || retryTimeout) {
        return;
      }
      retryTimeout = setTimeout(() => {
        const previousSocket = socket;
        socket = undefined;
        retryTimeout = undefined;
        previousSocket?.close();
        if (!disposed) {
          connect();
        }
      }, 1000);
    }

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const nextSocket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket = nextSocket;

      nextSocket.addEventListener('message', event => {
        if (socket !== nextSocket) {
          return;
        }
        try {
          enqueueItem(JSON.parse(event.data));
        } catch {
          // Keep OBS quiet on malformed packets.
        }
      });

      nextSocket.addEventListener('close', () => {
        if (socket === nextSocket) {
          scheduleRetry();
        }
      });
      nextSocket.addEventListener('error', () => {
        if (socket === nextSocket) {
          scheduleRetry();
        }
      });
    }

    loadRecent();

    if (isDemo) {
      let cursor = 0;
      demoTimer = setInterval(() => {
        enqueueItem(DEMO_SAMPLES[cursor % DEMO_SAMPLES.length]);
        cursor += 1;
      }, 1100);
    } else {
      connect();
    }

    return () => {
      disposed = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (demoTimer) {
        clearInterval(demoTimer);
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = undefined;
      }
      clearFadeTimers();
      queueRef.current = [];
      socket?.close();
    };
  }, [giftCatalog, isDemo]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [items]);

  useEffect(() => {
    cachedDanmakuItems = items;
  }, [items]);

  return createElement(
    'yt-live-chat-renderer',
    { id: 'app', class: 'style-scope yt-live-chat-app danmaku-root', 'hide-timestamps': '' },
    createElement(
      'yt-live-chat-item-list-renderer',
      { class: 'style-scope yt-live-chat-renderer', 'allow-scroll': '' },
      <div
        ref={scrollerRef}
        id="item-scroller"
        className="style-scope yt-live-chat-item-list-renderer animated danmaku-scroller"
      >
        <div id="item-offset" className="style-scope yt-live-chat-item-list-renderer">
          <div id="items" className="style-scope yt-live-chat-item-list-renderer">
            <div className="spacer" />
            {items.map(item => renderMessage(item, settingsRef.current, fadingIds.has(item.id)))}
          </div>
        </div>
      </div>,
    ),
  );
}

function renderMessage(
  item: RenderMessage,
  settings?: DanmakuChatSettings,
  fading = false,
): ReactNode {
  switch (item.kind) {
    case 'gift':
      return renderGift(item, settings, fading);
    case 'superchat':
      return renderSuperChat(item, settings, fading);
    case 'guard':
      return renderGuard(item, settings, fading);
    case 'entry':
    case 'interaction':
      return renderInfo(item, settings, fading);
    default:
      return renderDanmu(item, settings, fading);
  }
}

function messageClass(item: RenderMessage, settings?: DanmakuChatSettings, fading = false): string {
  const classes = ['msg', 'event', item.kind === 'danmu' ? 'message' : item.kind, item.legacyClass, 'style-scope', 'yt-live-chat-item-list-renderer'];
  if (settings?.AnimateIn) {
    classes.push('anim-in');
  }
  if (fading) {
    classes.push('anim-out');
  }
  return classes.join(' ');
}

function renderMeta(item: RenderMessage): ReactNode {
  return (
    <>
      <span className="tm">{item.time}</span>
      {item.badge && <span className="idbadge">{item.badge}</span>}
    </>
  );
}

function renderGiftIcon(item: RenderMessage): ReactNode {
  if (!item.giftImage) {
    return null;
  }
  return <img src={item.giftImage} alt="" className="gift-icon" referrerPolicy="no-referrer" />;
}

function renderDanmu(item: RenderMessage, settings?: DanmakuChatSettings, fading = false): ReactNode {
  return createElement(
    'yt-live-chat-text-message-renderer',
    {
      class: messageClass(item, settings, fading),
      'data-id': item.role,
      'data-kind': item.kind,
      'blc-guard-level': String(item.guardLevel),
      'data-guard-level': String(item.guardLevel),
      'data-price-level': item.priceLevel == null ? undefined : String(item.priceLevel),
      key: item.id,
    },
    renderAvatar(item),
    <div id="content" className="style-scope yt-live-chat-text-message-renderer msg-main">
      <div>
        {renderMeta(item)}
        <span className="uname username style-scope yt-live-chat-author-chip">{item.user}:</span>
        <span id="message" className="dtext text style-scope yt-live-chat-text-message-renderer">{item.text}</span>
      </div>
    </div>,
  );
}

function renderGift(item: RenderMessage, settings?: DanmakuChatSettings, fading = false): ReactNode {
  return createElement(
    'yt-live-chat-paid-message-renderer',
    {
      class: messageClass(item, settings, fading),
      'data-id': item.role,
      'data-kind': item.kind,
      'blc-guard-level': String(item.guardLevel),
      'data-guard-level': String(item.guardLevel),
      'data-price-level': item.priceLevel == null ? undefined : String(item.priceLevel),
      key: item.id,
      style: {
        '--gift-accent': item.accent || '#e91e63',
        '--gift-soft': item.accentSoft || 'rgba(233,30,99,0.18)',
        '--gift-text': item.accentText || '#ffffff',
        '--event-bg': item.accentSoft || 'rgba(233,30,99,0.18)',
        '--event-border': item.accent || '#e91e63',
        '--price-glow': String((item.priceLevel || 0) * 3),
      } as React.CSSProperties,
    },
    renderAvatar(item),
    <div id="content" className="style-scope yt-live-chat-paid-message-renderer msg-main gift-card">
        {renderMeta(item)}
        <span id="author-name" className="uname username style-scope yt-live-chat-paid-message-renderer">{item.user}:</span>
        <span id="purchase-amount" className="gcnt price style-scope yt-live-chat-paid-message-renderer">
          [{item.price ? `¥${item.price}` : '¥0'}]
        </span>
        {renderGiftIcon(item)}
        <span id="message" className="gname text style-scope yt-live-chat-paid-message-renderer">
          {item.text}
        </span>
    </div>,
  );
}

function renderSuperChat(item: RenderMessage, settings?: DanmakuChatSettings, fading = false): ReactNode {
  return createElement(
    'yt-live-chat-paid-message-renderer',
    {
      class: messageClass(item, settings, fading),
      'data-id': item.role,
      'data-kind': item.kind,
      'blc-guard-level': String(item.guardLevel),
      'data-guard-level': String(item.guardLevel),
      'data-price-level': item.priceLevel == null ? undefined : String(item.priceLevel),
      key: item.id,
      style: {
        '--sc-accent': item.accent || '#ff9800',
        '--sc-soft': item.accentSoft || 'rgba(255,152,0,0.16)',
        '--sc-text': item.accentText || '#ffffff',
        '--event-bg': item.accentSoft || 'rgba(255,152,0,0.16)',
        '--event-border': item.accent || '#ff9800',
        '--price-glow': String((item.priceLevel || 0) * 3),
      } as React.CSSProperties,
    },
    renderAvatar(item),
    <div id="content" className="style-scope yt-live-chat-paid-message-renderer msg-main sc-card">
      {renderMeta(item)}
      <span className="sc-uname username">{item.user}:</span>
      <span className="sc-price price">[¥{item.price || 0}]</span>
      <span className="sc-body text">{item.text}</span>
    </div>,
  );
}

function renderGuard(item: RenderMessage, settings?: DanmakuChatSettings, fading = false): ReactNode {
  const guardClass = item.guardLevel > 0 ? `guard-type-${item.guardLevel}` : '';
  return createElement(
    'yt-live-chat-membership-item-renderer',
    {
      class: `${messageClass(item, settings, fading)} ${guardClass}`,
      'data-id': 'member',
      'data-kind': item.kind,
      'blc-guard-level': String(item.guardLevel),
      'data-guard-level': String(item.guardLevel),
      'data-price-level': item.priceLevel == null ? undefined : String(item.priceLevel),
      key: item.id,
      style: {
        '--guard-accent': item.accent || '#73efff',
        '--guard-soft': item.accentSoft || 'rgba(0,188,212,0.18)',
        '--guard-text': item.accentText || '#eefcff',
        '--event-bg': item.accentSoft || 'rgba(0,188,212,0.18)',
        '--event-border': item.accent || '#73efff',
      } as React.CSSProperties,
    },
    renderAvatar(item),
    <div id="content" className="style-scope yt-live-chat-membership-item-renderer msg-main guard-card">
      {renderMeta(item)}
      <span className="uname username style-scope yt-live-chat-author-chip">{item.user}:</span>
      {renderGiftIcon(item)}
      <span className="text guard-body">
        开通了 {item.gift || item.label || '舰长'}
        {item.count && item.count > 1 ? ` x${item.count}` : ''}
        {item.price ? `，支持 ¥${item.price}` : ''}
      </span>
    </div>,
  );
}

function renderInfo(item: RenderMessage, settings?: DanmakuChatSettings, fading = false): ReactNode {
  const kindClass = item.kind === 'entry' ? 'entry-effect' : 'interaction';
  const guardClass = item.guardLevel > 0 ? `guard-type-${item.guardLevel}` : '';
  return createElement(
    'yt-live-chat-text-message-renderer',
    {
      class: `${messageClass(item, settings, fading)} ${kindClass} ${guardClass}`,
      'data-id': item.role,
      'data-kind': item.kind,
      'blc-guard-level': String(item.guardLevel),
      'data-guard-level': String(item.guardLevel),
      key: item.id,
      style: {
        '--info-accent': item.accent || '#ffffff',
        '--info-soft': item.accentSoft || 'rgba(255,255,255,0.12)',
        '--event-bg': item.accentSoft || 'rgba(255,255,255,0.12)',
        '--event-border': item.accent || '#ffffff',
      } as React.CSSProperties,
    },
    <div id="content" className="style-scope yt-live-chat-text-message-renderer msg-main">
      {renderMeta(item)}
      {renderAvatar(item)}
      {item.kind === 'interaction' && <span className="uname username style-scope yt-live-chat-author-chip">{item.user}</span>}
      <span id="message" className="dtext text style-scope yt-live-chat-text-message-renderer">{item.text}</span>
    </div>,
  );
}

function renderAvatar(item: RenderMessage): ReactNode {
  if (item.avatar) {
    return <img src={item.avatar} alt="" className="av" referrerPolicy="no-referrer" />;
  }
  return <div className="av av-fallback">{item.user.slice(0, 1)}</div>;
}
