import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

function safeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export function LotteryView({ settings }: { settings: PluginSettings }) {
  const cfg = settings.LotteryInteraction;
  const [visible, setVisible] = useState(false);
  const lastNonce = useRef(0);
  const title = safeString(cfg?.Title, '幸运抽奖');
  const lastWinner = safeString(cfg?.LastWinner, '幸运观众');
  const lastPrize = safeString(cfg?.LastPrize, '');

  useEffect(() => {
    const nonce = Number(cfg?.DrawNonce || 0);
    if (!nonce || nonce === lastNonce.current) return;
    lastNonce.current = nonce;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), Math.max(1, Number(cfg?.StaySeconds || 8)) * 1000);
    return () => window.clearTimeout(timer);
  }, [cfg?.DrawNonce, cfg?.StaySeconds]);

  if (!cfg?.Enabled) {
    return <EmptyState title={title} subtitle="抽奖未启用" />;
  }

  return (
    <section className="lottery-card" data-visible={visible ? '1' : '0'}>
      <div className="lottery-title">{title}</div>
      <div className="lottery-wheel"><div className="lottery-pointer" /></div>
      <div className="lottery-result">
        {visible && lastPrize ? (
          <>
            <div className="lottery-winner">恭喜 {lastWinner} 抽中</div>
            <div className="lottery-prize">{lastPrize}</div>
          </>
        ) : (
          <div className="lottery-empty">等待抽奖触发</div>
        )}
      </div>
    </section>
  );
}
