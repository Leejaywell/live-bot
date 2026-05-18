import { useEffect, useRef, useState } from 'react';
import { Copy, Send, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api, GiftRankItem, PluginSettings } from '../lib/api';
import { fallbackConfig } from './WishGoal';

function mergeConfig(next: PluginSettings): PluginSettings {
  return { ...fallbackConfig, ...next, GiftRank: { ...fallbackConfig.GiftRank, ...next.GiftRank } };
}

const previewItems: GiftRankItem[] = [
  { User: '团子', Avatar: '', Value: 28800, Count: 8 },
  { User: '绅士小熊', Avatar: '', Value: 15600, Count: 6 },
  { User: '深巷与猫', Avatar: '', Value: 9200, Count: 4 },
];

function formatValue(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, '')}万`;
  return String(value);
}

export function GiftRank() {
  const [config, setConfig] = useState<PluginSettings>(fallbackConfig);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const saveTimer = useRef<number | null>(null);
  const rank = config.GiftRank;
  const items = (rank.Items.length ? rank.Items : previewItems).slice(0, rank.MaxItems);

  const updateRank = (patch: Partial<typeof rank>) => {
    setConfig(prev => ({ ...prev, GiftRank: { ...prev.GiftRank, ...patch } }));
  };

  useEffect(() => {
    api.loadPluginSettings().then(next => {
      setConfig(mergeConfig(next));
      setLoaded(true);
    }).catch(err => {
      setLoaded(true);
      toast.error(`读取插件配置失败: ${err}`);
    });
    api.getGiftRankUrl().then(setUrl).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.savePluginSettings(config).catch(err => toast.error(`保存失败: ${err}`));
    }, 350);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [config, loaded]);

  const simulate = async () => {
    const next = await api.simulateGiftRank();
    setConfig(mergeConfig(next));
  };

  return (
    <div className="h-full overflow-hidden p-5 text-[var(--foreground)]">
      <GlassCard className="flex h-full min-h-[584px] overflow-hidden rounded-[24px]">
        <div className="w-[clamp(430px,44vw,660px)] shrink-0 overflow-y-auto border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-5 [scrollbar-width:thin]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--primary-color)]/12 text-[var(--primary-color)]">
                <Trophy className="h-4 w-4" />
              </div>
              <div className="text-[16px] font-bold">礼物排行</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[var(--muted-text)]">启用</span>
              <Toggle checked={rank.Enabled} onChange={v => updateRank({ Enabled: v })} />
            </div>
          </div>

          <GlassCard className="mb-3 p-4">
            <div className="mb-3 text-[12px] font-bold">地址</div>
            <div className="flex gap-2">
              <Input readOnly mono value={url} onClick={e => (e.target as HTMLInputElement).select()} className="flex-1" />
              <Button size="sm" variant="primary" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success('地址已复制'))}>
                <Copy className="h-3.5 w-3.5" />复制
              </Button>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="mb-3 text-[12px] font-bold">常用配置项</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">标题</span>
                <Input value={rank.Title} onChange={e => updateRank({ Title: e.target.value })} />
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">显示数量</span>
                <Input type="number" min={1} max={10} value={rank.MaxItems} onChange={e => updateRank({ MaxItems: Number(e.target.value) })} />
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">免费皮肤</span>
                <select value={rank.Skin} onChange={e => updateRank({ Skin: e.target.value })}
                  className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                  <option value="podium">领奖台</option>
                  <option value="list">紧凑列表</option>
                </select>
              </label>
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">统计日期</span>
                <div className="flex h-[32px] items-center rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--muted-text)]">
                  {rank.Date || '今日'}
                </div>
              </div>
            </div>
          </GlassCard>
        </div>

        <div className="flex flex-1 flex-col bg-[radial-gradient(circle_at_24%_18%,rgba(var(--primary-rgb),0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.68),rgba(228,235,242,0.52))]">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 bg-black/35 px-4 text-white">
            <span className="text-[12px] font-bold">预览</span>
            <span className="flex-1" />
            <button onClick={simulate} className="flex h-7 items-center gap-1.5 rounded-lg border border-white/12 bg-white/8 px-2.5 text-[11px] font-semibold text-white/80 hover:bg-white/14">
              <Send className="h-3 w-3" />发送模拟数据
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-8">
            {rank.Skin === 'list' ? <RankList items={items} /> : <Podium items={items} />}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

function Podium({ items }: { items: GiftRankItem[] }) {
  return (
    <div className="flex min-w-[340px] items-end justify-center gap-1">
      {items.map((item, index) => (
        <div key={item.User} className={`flex flex-col items-center ${index === 0 ? 'order-2' : index === 1 ? 'order-1' : 'order-3'}`}>
          <div className={`${index === 0 ? 'h-[74px] w-[74px]' : 'h-[66px] w-[66px]'} relative rounded-full bg-gradient-to-br from-amber-200 to-pink-300 p-1 shadow-xl`}>
            <div className="absolute left-1/2 top-[-20px] -translate-x-1/2 text-[20px] text-amber-300">◆</div>
            <Avatar item={item} />
          </div>
          <div className={`${index === 0 ? 'h-10' : 'h-8'} mt-[-6px] w-[76px] rounded-b-2xl rounded-t-xl border border-sky-100 bg-sky-100 shadow-inner`} />
          <div className="mt-1 max-w-[104px] truncate rounded-full border border-amber-300 bg-stone-600 px-3 py-1 text-[13px] font-black text-white">{item.User}</div>
          <div className="mt-1 text-[11px] font-black text-amber-200 drop-shadow">{formatValue(item.Value)}</div>
        </div>
      ))}
    </div>
  );
}

function RankList({ items }: { items: GiftRankItem[] }) {
  return (
    <div className="flex min-w-[280px] flex-col gap-2">
      {items.map((item, index) => (
        <div key={item.User} className="flex min-h-[58px] items-center gap-3 border-l-4 border-amber-300 bg-black/75 px-3 py-2 shadow-xl">
          <div className="text-[13px] font-black text-amber-200">#{index + 1}</div>
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-200 to-pink-300 p-0.5">
            <Avatar item={item} />
          </div>
          <div className="min-w-0 flex-1 truncate text-[14px] font-black text-white">{item.User}</div>
          <div className="text-[13px] font-black text-amber-200">{formatValue(item.Value)}</div>
        </div>
      ))}
    </div>
  );
}

function Avatar({ item }: { item: GiftRankItem }) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border-2 border-white/80 bg-amber-100 text-[18px] font-black text-amber-800">
      {item.Avatar ? <img src={item.Avatar} className="h-full w-full object-cover" /> : item.User.slice(0, 1)}
    </div>
  );
}
