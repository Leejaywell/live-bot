import { useEffect, useState } from 'react';

function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim() ? value : fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

export function DanmakuOverlay() {
  const [items, setItems] = useState<Array<{ id: number; text: string; kind: string }>>([]);

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
          setItems(prev => [...prev, { id: Date.now() + Math.random(), text: `${user}: ${text}`, kind }].slice(-80));
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
    <section className="danmaku-list">
      <div className="danmaku-spacer" />
      {items.map(item => (
        <div className="danmaku-item" data-kind={item.kind} key={item.id}>{item.text}</div>
      ))}
    </section>
  );
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
  kind?: string;
  user?: string;
  text?: string;
  gift?: string;
  count?: number;
}
