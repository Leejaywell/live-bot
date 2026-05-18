import { useEffect, useState } from 'react';

export function DanmakuOverlay() {
  const [items, setItems] = useState<Array<{ id: number; text: string; kind: string }>>([]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data) as LiveEventPayload;
        const live = data.event || data;
        const user = live.user || '观众';
        const text = live.text || live.gift || live.kind || '';
        if (!text) return;
        setItems(prev => [...prev, { id: Date.now() + Math.random(), text: `${user}: ${text}`, kind: live.kind || 'event' }].slice(-80));
      } catch {
        // Keep OBS quiet on malformed packets.
      }
    };
    return () => socket.close();
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
