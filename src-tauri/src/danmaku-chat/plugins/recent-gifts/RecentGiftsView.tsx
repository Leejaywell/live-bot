import { useEffect, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { MarqueeText } from '../../components/MarqueeText';
import { fetchJson } from '../../runtime/fetch';
import { proxyImage } from '../../runtime/fetch';
import { PluginSettings } from '../../runtime/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function RecentGiftsView({ settings }: { settings: PluginSettings }) {
  const cfg = settings.RecentGifts;
  const fallbackItems = (Array.isArray(cfg?.Items) ? cfg.Items : [])
    .filter(isRecord)
    .slice(0, Math.max(1, Number(cfg?.MaxItems || 3)));
  const [historyItems, setHistoryItems] = useState<Record<string, unknown>[]>([]);
  const items = fallbackItems.length ? fallbackItems : historyItems;

  useEffect(() => {
    if (fallbackItems.length) {
      setHistoryItems([]);
      return;
    }
    let disposed = false;
    fetchJson<Record<string, unknown>[]>(`/recent-gifts-data?limit=${Math.max(1, Number(cfg?.MaxItems || 3))}`, [])
      .then(next => {
        if (!disposed) {
          setHistoryItems(Array.isArray(next) ? next.filter(isRecord) : []);
        }
      });
    return () => {
      disposed = true;
    };
  }, [cfg?.MaxItems, fallbackItems.length]);

  if (!items.length) {
    return <EmptyState title={cfg?.Title || '最近礼物'} subtitle="等待礼物数据" />;
  }

  return (
    <section className="recent-gifts">
      {items.map((item, index) => {
        const avatar = proxyImage(item.Avatar);
        const user = typeof item.User === 'string' && item.User ? item.User : '观众';
        const gift = typeof item.Gift === 'string' && item.Gift ? item.Gift : '礼物';

        return (
          <div className="recent-gift" key={`${user}-${index}`}>
            <div className="recent-avatar">
              {avatar ? <img src={avatar} alt="" /> : user.slice(0, 1)}
            </div>
            <div className="recent-text">
              <MarqueeText className="recent-user">{user}</MarqueeText>
              <MarqueeText className="recent-gift-name">
                赠送 {gift} x{Number(item.Count || 1)}
              </MarqueeText>
            </div>
          </div>
        );
      })}
    </section>
  );
}
