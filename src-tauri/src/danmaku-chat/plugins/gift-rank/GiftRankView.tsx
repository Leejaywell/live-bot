import { useEffect, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { MarqueeText } from '../../components/MarqueeText';
import { fetchJson } from '../../runtime/fetch';
import { proxyImage } from '../../runtime/fetch';
import { PluginSettings } from '../../runtime/types';

function formatValue(value: unknown) {
  const num = Number(value || 0);
  if (num >= 10000) {
    return `${(num / 10000).toFixed(num >= 100000 ? 0 : 1).replace(/\.0$/, '')}万`;
  }
  return String(num);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveRankSkin(skin: unknown) {
  return skin === 'list' || skin === 'podium' ? skin : 'podium';
}

export function GiftRankView({ settings }: { settings: PluginSettings }) {
  const cfg = settings.GiftRank;
  const fallbackItems = (Array.isArray(cfg?.Items) ? cfg.Items : [])
    .filter(isRecord)
    .slice(0, Math.max(1, Number(cfg?.MaxItems || 3)));
  const [historyItems, setHistoryItems] = useState<Record<string, unknown>[]>([]);
  const items = fallbackItems.length ? fallbackItems : historyItems;
  const skin = resolveRankSkin(cfg?.Skin);

  useEffect(() => {
    if (fallbackItems.length) {
      setHistoryItems([]);
      return;
    }
    let disposed = false;
    fetchJson<Record<string, unknown>[]>(`/gift-rank-data?limit=${Math.max(1, Number(cfg?.MaxItems || 3))}`, [])
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
    return <EmptyState title={cfg?.Title || '礼物排行'} subtitle="等待排行数据" />;
  }

  return (
    <section className={`gift-rank rank-${skin}`}>
      {items.map((item, index) => {
        const avatar = proxyImage(item.Avatar);
        const user = typeof item.User === 'string' && item.User ? item.User : '观众';

        return (
          <div className="gift-rank-slot" key={`${user}-${index}`}>
            <div className="gift-rank-avatar">
              {avatar ? <img src={avatar} alt="" /> : user.slice(0, 1)}
            </div>
            <MarqueeText className="gift-rank-name">{user}</MarqueeText>
            <div className="gift-rank-value">{formatValue(item.Value)}</div>
          </div>
        );
      })}
    </section>
  );
}
