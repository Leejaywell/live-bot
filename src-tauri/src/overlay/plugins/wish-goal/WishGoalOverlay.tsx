import { EmptyState } from '../../components/EmptyState';
import { proxyImage } from '../../runtime/fetch';
import { PluginSettings } from '../../runtime/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function WishGoalOverlay({ settings }: { settings: PluginSettings }) {
  const cfg = settings.WishGoal;
  const goals = (Array.isArray(cfg?.Goals) ? cfg.Goals : []).filter(isRecord);

  if (!goals.length) {
    return <EmptyState title={cfg?.Title || '今日心愿目标'} subtitle="暂无心愿目标" />;
  }

  return (
    <section className="wish-card">
      <div className="wish-title">{cfg?.Title || '今日心愿目标'}</div>
      <div className="wish-list">
        {goals.map(goal => {
          const target = Math.max(1, Number(goal.Target || 1));
          const current = Math.max(0, Number(goal.Current || 0));
          const pct = Math.min(100, (current / target) * 100);
          const icon = proxyImage(goal.Icon);
          const name = typeof goal.Name === 'string' && goal.Name ? goal.Name : '心愿';
          const id = typeof goal.Id === 'string' && goal.Id ? goal.Id : name;

          return (
            <div className="wish-goal" key={id}>
              {cfg?.ShowIcons !== false && icon ? <img src={icon} alt="" /> : null}
              <div className="wish-main">
                <div className="wish-line">
                  <strong>{name}</strong>
                  <span>{current}/{target}</span>
                </div>
                <div className="wish-bar">
                  <div style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
