import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { PluginSettings } from '../../runtime/types';

export function LotteryOverlay({ settings }: { settings: PluginSettings }) {
  const cfg = settings.LotteryInteraction;
  const [visible, setVisible] = useState(false);
  const lastNonce = useRef(0);

  useEffect(() => {
    const nonce = Number(cfg?.DrawNonce || 0);
    if (!nonce || nonce === lastNonce.current) return;
    lastNonce.current = nonce;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), Math.max(1, Number(cfg?.StaySeconds || 8)) * 1000);
    return () => window.clearTimeout(timer);
  }, [cfg?.DrawNonce, cfg?.StaySeconds]);

  if (!cfg?.Enabled) {
    return <EmptyState title={cfg?.Title || '幸运抽奖'} subtitle="抽奖未启用" />;
  }

  return (
    <section className="lottery-card" data-visible={visible ? '1' : '0'}>
      <div className="lottery-title">{cfg.Title || '幸运抽奖'}</div>
      <div className="lottery-wheel"><div className="lottery-pointer" /></div>
      <div className="lottery-result">
        {visible && cfg.LastPrize ? (
          <>
            <div className="lottery-winner">恭喜 {cfg.LastWinner || '幸运观众'} 抽中</div>
            <div className="lottery-prize">{cfg.LastPrize}</div>
          </>
        ) : (
          <div className="lottery-empty">等待抽奖触发</div>
        )}
      </div>
    </section>
  );
}
