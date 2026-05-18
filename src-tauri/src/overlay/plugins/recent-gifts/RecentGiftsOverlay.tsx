import { EmptyState } from '../../components/EmptyState';
import { MarqueeText } from '../../components/MarqueeText';
import { proxyImage } from '../../runtime/fetch';
import { PluginSettings } from '../../runtime/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function RecentGiftsOverlay({ settings }: { settings: PluginSettings }) {
  const cfg = settings.RecentGifts;
  const items = (Array.isArray(cfg?.Items) ? cfg.Items : [])
    .filter(isRecord)
    .slice(0, Math.max(1, Number(cfg?.MaxItems || 3)));

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
