import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

export function GiftEffectOverlay({ settings }: { settings: PluginSettings }) {
  const cfg = settings.GiftEffect;
  const [visible, setVisible] = useState(false);
  const lastNonce = useRef(0);

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
        {Array.from({ length: Math.min(36, Math.max(10, Number(cfg.LastCount || 1) * 2)) }).map((_, index) => (
          <span key={index} style={{ left: `${12 + (index * 23) % 76}%`, animationDelay: `${(index % 8) * 60}ms` }}>
            {index % 3 === 0 ? '🎁' : index % 3 === 1 ? '💗' : '✨'}
          </span>
        ))}
      </div>
      <div className="gift-effect-caption">{cfg.LastUser || '观众'} 送出 {cfg.LastGift || '礼物'} x{cfg.LastCount || 1}</div>
    </section>
  );
}
