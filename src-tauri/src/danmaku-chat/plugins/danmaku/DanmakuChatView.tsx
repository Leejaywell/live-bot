import { ReactNode, createElement, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../runtime/fetch';

function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim() ? value : fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rawInfoUser(raw: Record<string, unknown>): string {
  const info = raw.info;
  if (!Array.isArray(info)) return '';
  const user = info[2];
  return Array.isArray(user) ? safeString(user[1]) : '';
}

function rawDanmuText(raw: Record<string, unknown>): string {
  const info = raw.info;
  if (Array.isArray(info) && typeof info[1] === 'string') {
    return info[1];
  }
  return '';
}

function rawGift(raw: Record<string, unknown>): { user: string; gift: string; count: number } | null {
  const data = isRecord(raw.data) ? raw.data : null;
  if (!data) return null;
  const gift = safeString(data.giftName || data.gift_name);
  if (!gift) return null;
  return {
    user: safeString(data.uname, '观众'),
    gift,
    count: Number(data.num || data.count || 1) || 1,
  };
}

function normalizeLiveItem(payload: unknown): { user: string; text: string; kind: string; legacyClass: string } | null {
  const root = isRecord(payload) ? payload : null;
  const live = isRecord(root?.event) ? root.event : root;
  const raw = isRecord(root?.raw) ? root.raw : null;

  const type = safeString(live?.type || root?.type || raw?.cmd, 'event');
  let user =
    safeString(live?.user || live?.uname || live?.username) ||
    (raw ? safeString(raw.data && isRecord(raw.data) ? raw.data.uname : undefined) : '') ||
    (raw ? rawInfoUser(raw) : '') ||
    '观众';
  let text =
    safeString(live?.text) ||
    safeString(live?.gift) ||
    safeString(live?.kind);

  if (!text && raw) {
    if (safeString(raw.cmd) === 'DANMU_MSG') {
      text = rawDanmuText(raw);
      user = rawInfoUser(raw) || user;
    } else {
      const gift = rawGift(raw);
      if (gift) {
        user = gift.user || user;
        text = `${gift.gift} x${gift.count}`;
      }
    }
  }

  if (!text) return null;

  return {
    user,
    text,
    kind: type,
    legacyClass: legacyMessageClass({ type }),
  };
}

const DEMO_SAMPLES: Array<{ user: string; text: string; kind: string; legacyClass: string }> = [
  { user: '团子', text: '晚上好，今天的弹幕样式很干净', kind: 'Danmu', legacyClass: 'msg-danmu' },
  { user: '落日游民', text: '人气票 x1', kind: 'Gift', legacyClass: 'msg-gift' },
  { user: '绅士小熊', text: '醒目留言测试中', kind: 'SuperChat', legacyClass: 'msg-sc' },
  { user: '深巷与猫', text: '舰长', kind: 'GuardBuy', legacyClass: 'msg-guard' },
];

export function DanmakuChatView() {
  const [items, setItems] = useState<Array<{ id: number; user: string; text: string; kind: string; legacyClass: string }>>([]);
  const isDemo = useMemo(() => new URLSearchParams(window.location.search).get('demo') === '1', []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    let demoTimer: ReturnType<typeof setInterval> | undefined;

    function pushItem(next: { user: string; text: string; kind: string; legacyClass: string }) {
      setItems(prev => [
        ...prev,
        {
          id: Date.now() + Math.random(),
          ...next,
        },
      ].slice(-80));
    }

    async function loadRecent() {
      const recent = await fetchJson<unknown[]>('/recent-events?limit=24', []);
      if (disposed || !Array.isArray(recent)) {
        return;
      }
      const normalized = recent
        .map(normalizeLiveItem)
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      setItems(normalized.map((item, index) => ({
        id: Date.now() + index,
        ...item,
      })));
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

      nextSocket.addEventListener('message', (event) => {
        if (socket !== nextSocket) {
          return;
        }

        try {
          const next = normalizeLiveItem(JSON.parse(event.data));
          if (!next) return;
          pushItem(next);
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

    if (isDemo) {
      loadRecent();
      let cursor = 0;
      demoTimer = setInterval(() => {
        pushItem(DEMO_SAMPLES[cursor % DEMO_SAMPLES.length]);
        cursor += 1;
      }, 1200);
    } else {
      loadRecent();
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
      socket?.close();
    };
  }, [isDemo]);

  return (
    createElement('yt-live-chat-renderer', { id: 'app', class: 'danmaku-list style-scope yt-live-chat-app', 'hide-timestamps': '' },
      <div className="danmaku-spacer" />,
      items.map(item => renderLegacyMessage(item)),
    )
  );
}

function renderLegacyMessage(item: { id: number; user: string; text: string; kind: string; legacyClass: string }): ReactNode {
  const tagName =
    item.legacyClass === 'msg-gift' || item.legacyClass === 'msg-sc'
      ? 'yt-live-chat-paid-message-renderer'
      : item.legacyClass === 'msg-guard'
        ? 'yt-live-chat-membership-item-renderer'
        : 'yt-live-chat-text-message-renderer';

  return createElement(
    tagName,
    {
      class: `danmaku-item msg ${item.legacyClass} style-scope yt-live-chat-item-list-renderer`,
      'data-id': 'normal',
      'data-kind': item.kind,
      key: item.id,
    },
    <span className="uname style-scope yt-live-chat-author-chip">{item.user}</span>,
    <span className="dtext style-scope yt-live-chat-text-message-renderer" id="message">{item.text}</span>,
  );
}

function legacyMessageClass(event: LiveEvent): string {
  switch (event.type) {
    case 'Gift':
      return 'msg-gift';
    case 'GuardBuy':
      return 'msg-guard';
    case 'SuperChat':
      return 'msg-sc';
    default:
      return 'msg-danmu';
  }
}

interface LiveEventPayload {
  event?: LiveEvent;
  raw?: Record<string, unknown>;
  kind?: string;
  user?: string;
  text?: string;
  gift?: string;
  count?: number;
}

interface LiveEvent {
  type?: string;
  kind?: string;
  user?: string;
  text?: string;
  gift?: string;
  count?: number;
}
