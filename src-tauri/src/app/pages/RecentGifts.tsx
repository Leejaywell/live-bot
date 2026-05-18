import { useEffect, useRef, useState } from 'react';
import { Copy, Gift, Send } from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api, PluginSettings } from '../lib/api';
import { fallbackConfig } from './WishGoal';

function mergeConfig(next: PluginSettings): PluginSettings {
  return { ...fallbackConfig, ...next, RecentGifts: { ...fallbackConfig.RecentGifts, ...next.RecentGifts } };
}

export function RecentGifts() {
  const [config, setConfig] = useState<PluginSettings>(fallbackConfig);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const saveTimer = useRef<number | null>(null);
  const recent = config.RecentGifts;

  const updateRecent = (patch: Partial<typeof recent>) => {
    setConfig(prev => ({ ...prev, RecentGifts: { ...prev.RecentGifts, ...patch } }));
  };

  useEffect(() => {
    api.loadPluginSettings().then(next => {
      setConfig(mergeConfig(next));
      setLoaded(true);
    }).catch(err => {
      setLoaded(true);
      toast.error(`读取插件配置失败: ${err}`);
    });
    api.getRecentGiftsUrl().then(setUrl).catch(() => {});
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
    const next = await api.simulateRecentGift();
    setConfig(mergeConfig(next));
  };

  return (
    <div className="h-full overflow-hidden p-5 text-[var(--foreground)]">
      <GlassCard className="flex h-full min-h-[584px] overflow-hidden rounded-[24px]">
        <div className="w-[clamp(430px,44vw,660px)] shrink-0 overflow-y-auto border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-5 [scrollbar-width:thin]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--primary-color)]/12 text-[var(--primary-color)]">
                <Gift className="h-4 w-4" />
              </div>
              <div className="text-[16px] font-bold">最近礼物</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[var(--muted-text)]">启用</span>
              <Toggle checked={recent.Enabled} onChange={v => updateRecent({ Enabled: v })} />
            </div>
          </div>

          <GlassCard className="mb-3 p-4">
            <div className="mb-3 text-[12px] font-bold">地址</div>
            <div className="flex gap-2">
              <Input readOnly mono value={url} onClick={e => (e.target as HTMLInputElement).select()} className="flex-1" />
              <Button size="sm" variant="primary" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success('地址已复制'))}><Copy className="h-3.5 w-3.5" />复制</Button>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="mb-3 text-[12px] font-bold">常用配置项</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">显示数量</span>
                <Input type="number" min={1} max={10} value={recent.MaxItems} onChange={e => updateRecent({ MaxItems: Number(e.target.value) })} />
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">免费皮肤</span>
                <select value={recent.Skin} onChange={e => updateRecent({ Skin: e.target.value })}
                  className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                  <option value="compact">普通</option>
                  <option value="glass">霓虹</option>
                </select>
              </label>
              <ColorField label="昵称颜色" value={recent.NameColor} onChange={v => updateRecent({ NameColor: v })} />
              <ColorField label="数字颜色" value={recent.NumberColor} onChange={v => updateRecent({ NumberColor: v })} />
              <ColorField label="礼物颜色" value={recent.GiftColor} onChange={v => updateRecent({ GiftColor: v })} />
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
            <div className="flex min-w-[240px] flex-col gap-2">
              {(recent.Items.length ? recent.Items : [
                { Id: 'a', User: '介猴不卖', Avatar: '', Gift: '吃瓜', Count: 1 },
                { Id: 'b', User: '章鱼小丸子', Avatar: '', Gift: '舰长', Count: 1 },
                { Id: 'c', User: '绅士小熊', Avatar: '', Gift: '小电视飞船', Count: 1 },
              ]).slice(0, recent.MaxItems).map(item => (
                <div key={item.Id} className="flex min-h-[58px] items-center gap-2 border-l-4 border-sky-400 bg-black/75 px-3 py-2 shadow-xl">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pink-200 text-white">{item.Avatar ? <img src={item.Avatar} className="h-full w-full rounded-full object-cover" /> : item.User.slice(0, 1)}</div>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-black" style={{ color: recent.NameColor }}>{item.User}</div>
                    <div className="truncate text-[12px] font-bold" style={{ color: recent.GiftColor }}>赠送 {item.Gift} <span style={{ color: recent.NumberColor }}>x{item.Count}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-bold text-[var(--muted-text)]">{label}</span>
      <div className="flex">
        <input type="color" value={value.startsWith('#') ? value : '#808080'} onChange={e => onChange(e.target.value)}
          className="h-[32px] w-12 rounded-l-lg border border-r-0 border-[var(--control-border)] bg-[var(--control-bg)] p-1" />
        <Input value={value} onChange={e => onChange(e.target.value)} className="rounded-l-none" />
      </div>
    </label>
  );
}
