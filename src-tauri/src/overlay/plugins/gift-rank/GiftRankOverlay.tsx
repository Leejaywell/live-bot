import { EmptyState } from '../../components/EmptyState';
import { MarqueeText } from '../../components/MarqueeText';
import { proxyImage } from '../../runtime/fetch';
import { PluginSettings } from '../../runtime/types';

function formatValue(value: unknown) {
  const num = Number(value || 0);
  if (num >= 10000) {
    return `${(num / 10000).toFixed(num >= 100000 ? 0 : 1).replace(/\.0$/, '')}万`;
  }
  return String(num);
}

export function GiftRankOverlay({ settings }: { settings: PluginSettings }) {
  const cfg = settings.GiftRank;
  const items = (cfg?.Items || []).slice(0, Math.max(1, Number(cfg?.MaxItems || 3)));

  if (!items.length) {
    return <EmptyState title={cfg?.Title || '礼物排行'} subtitle="等待排行数据" />;
  }

  return (
    <section className={`gift-rank rank-${cfg?.Skin || 'podium'}`}>
      {items.map((item, index) => {
        const avatar = proxyImage(item.Avatar);

        return (
          <div className="gift-rank-slot" key={`${item.User || 'user'}-${index}`}>
            <div className="gift-rank-avatar">
              {avatar ? <img src={avatar} alt="" /> : (item.User || '观').slice(0, 1)}
            </div>
            <MarqueeText className="gift-rank-name">{item.User || '观众'}</MarqueeText>
            <div className="gift-rank-value">{formatValue(item.Value)}</div>
          </div>
        );
      })}
    </section>
  );
}
