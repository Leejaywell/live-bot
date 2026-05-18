import { EmptyState } from '../../components/EmptyState';
import { MarqueeText } from '../../components/MarqueeText';
import { proxyImage } from '../../runtime/fetch';
import { PluginSettings } from '../../runtime/types';

export function RecentGiftsOverlay({ settings }: { settings: PluginSettings }) {
  const cfg = settings.RecentGifts;
  const items = (cfg?.Items || []).slice(0, Math.max(1, Number(cfg?.MaxItems || 3)));

  if (!items.length) {
    return <EmptyState title={cfg?.Title || '最近礼物'} subtitle="等待礼物数据" />;
  }

  return (
    <section className="recent-gifts">
      {items.map((item, index) => {
        const avatar = proxyImage(item.Avatar);

        return (
          <div className="recent-gift" key={`${item.User || 'user'}-${index}`}>
            <div className="recent-avatar">
              {avatar ? <img src={avatar} alt="" /> : (item.User || '观').slice(0, 1)}
            </div>
            <div className="recent-text">
              <MarqueeText className="recent-user">{item.User || '观众'}</MarqueeText>
              <MarqueeText className="recent-gift-name">
                赠送 {item.Gift || '礼物'} x{Number(item.Count || 1)}
              </MarqueeText>
            </div>
          </div>
        );
      })}
    </section>
  );
}
