import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

function safeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function safeCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(1, Math.trunc(count)) : 1;
}

export function GiftEffectView({ settings }: { settings: PluginSettings }) {
  const cfg = settings.GiftEffect;
  const [visible, setVisible] = useState(false);
  const lastNonce = useRef(0);
  const lastUser = safeString(cfg?.LastUser, '观众');
  const lastGift = safeString(cfg?.LastGift, '礼物');
  const lastCount = safeCount(cfg?.LastCount);
  const bubbleCount = Math.min(36, Math.max(10, lastCount * 2));

  useEffect(() => {
    const nonce = Number(cfg?.EffectNonce || 0);
    if (!nonce || nonce === lastNonce.current) return;
    lastNonce.current = nonce;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 4200);
    return () => window.clearTimeout(timer);
  }, [cfg?.EffectNonce]);

  if (!cfg?.Enabled) return <EmptyState title="礼物特效" subtitle="特效未启用" />;
  if (!visible) return <EmptyState title="礼物特效" subtitle="等待礼物触发" />;

  return (
    <section className="gift-effect-stage">
      <div className="gift-effect-cup" />
      <div className="gift-effect-bubbles">
        {Array.from({ length: bubbleCount }).map((_, index) => (
          <span key={index} style={{ left: `${12 + (index * 23) % 76}%`, animationDelay: `${(index % 8) * 60}ms` }}>
            {index % 3 === 0 ? '🎁' : index % 3 === 1 ? '💗' : '✨'}
          </span>
        ))}
      </div>
      <div className="gift-effect-caption">{lastUser} 送出 {lastGift} x{lastCount}</div>
    </section>
  );
}
