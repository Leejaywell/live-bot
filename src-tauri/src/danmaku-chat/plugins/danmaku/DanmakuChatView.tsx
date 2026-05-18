import { ReactNode, createElement, useEffect, useState } from 'react';

function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim() ? value : fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

export function DanmakuChatView() {
  const [items, setItems] = useState<Array<{ id: number; user: string; text: string; kind: string; legacyClass: string }>>([]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;

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
          const data = JSON.parse(event.data) as LiveEventPayload;
          const live = data.event || data;
          const user = safeString(live.user, '观众');
          const text = safeString(live.text) || safeString(live.gift) || safeString(live.kind);
          const kind = safeString(live.kind, 'event');
          if (!text) return;
          setItems(prev => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              user,
              text,
              kind,
              legacyClass: legacyMessageClass(live),
            },
          ].slice(-80));
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

    connect();

    return () => {
      disposed = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      socket?.close();
    };
  }, []);

  return (
    createElement('yt-live-chat-renderer', { id: 'app', className: 'danmaku-list style-scope yt-live-chat-app', 'hide-timestamps': '' },
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
      className: `danmaku-item msg ${item.legacyClass} style-scope yt-live-chat-item-list-renderer`,
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
