import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Gift, RefreshCw, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api, GiftCatalogItem, PluginSettings } from '../lib/api';
import { fallbackConfig as wishFallbackConfig } from './WishGoal';

const fallbackConfig: PluginSettings = {
  ...wishFallbackConfig,
  GiftEffect: {
    Enabled: true,
    Skin: 'cat_cup',
    GiftName: '',
    Sound: 'pop',
    SoundVolume: 60,
    CustomSoundPath: '',
    LastUser: '',
    LastGift: '',
    LastCount: 0,
    EffectNonce: 0,
  },
};

function imageUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : '';
}

function formatGiftPrice(price: number): string {
  if (price <= 0) return '免费';
  const yuan = price / 1000;
  return yuan >= 100 ? `¥${Math.round(yuan)}` : `¥${yuan.toFixed(yuan >= 10 ? 1 : 2).replace(/\.?0+$/, '')}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function GiftEffect() {
  const [config, setConfig] = useState<PluginSettings>(fallbackConfig);
  const [loaded, setLoaded] = useState(false);
  const [effectUrl, setEffectUrl] = useState('');
  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogItem[]>([]);
  const [giftPickerOpen, setGiftPickerOpen] = useState(false);
  const [refreshingGifts, setRefreshingGifts] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const effect = config.GiftEffect;
  const selectedGift = useMemo(() => giftCatalog.find(gift => gift.Name === effect.GiftName), [giftCatalog, effect.GiftName]);

  const updateEffect = (patch: Partial<typeof effect>) => {
    setConfig(prev => ({ ...prev, GiftEffect: { ...prev.GiftEffect, ...patch } }));
  };

  useEffect(() => {
    api.loadPluginSettings().then(next => {
      setConfig({ ...fallbackConfig, ...next, GiftEffect: { ...fallbackConfig.GiftEffect, ...next.GiftEffect } });
      setLoaded(true);
    }).catch(err => {
      setLoaded(true);
      toast.error(`读取插件配置失败: ${err}`);
    });
    api.getGiftEffectUrl().then(setEffectUrl).catch(() => {});
    api.getGiftCatalog().then(setGiftCatalog).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.savePluginSettings(config).catch(err => toast.error(`保存失败: ${err}`));
    }, 350);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [config, loaded]);

  const copyUrl = () => {
    navigator.clipboard.writeText(effectUrl).then(() => toast.success('地址已复制')).catch(() => {});
  };

  const refreshGifts = async () => {
    setRefreshingGifts(true);
    try {
      const next = await api.refreshGiftCatalog();
      setGiftCatalog(next);
      toast.success('礼物列表已更新');
    } catch (err) {
      toast.error(`更新礼物列表失败: ${err}`);
    } finally {
      setRefreshingGifts(false);
    }
  };

  const chooseSoundResource = async () => {
    try {
      const path = await api.pickPluginResource('sound');
      if (path) updateEffect({ Sound: 'custom', CustomSoundPath: path });
    } catch (err) {
      toast.error(`选择资源失败: ${err}`);
    }
  };

  const simulate = async () => {
    const next = await api.simulateGiftEffect();
    setConfig({ ...fallbackConfig, ...next, GiftEffect: { ...fallbackConfig.GiftEffect, ...next.GiftEffect } });
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
              <div className="text-[16px] font-bold">礼物特效</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[var(--muted-text)]">启用</span>
              <Toggle checked={effect.Enabled} onChange={v => updateEffect({ Enabled: v })} />
            </div>
          </div>

          <GlassCard className="mb-3 p-4">
            <div className="mb-3 text-[12px] font-bold">地址</div>
            <div className="flex gap-2">
              <Input readOnly mono value={effectUrl} onClick={e => (e.target as HTMLInputElement).select()} className="flex-1" />
              <Button size="sm" variant="primary" onClick={copyUrl}><Copy className="h-3.5 w-3.5" />复制</Button>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="mb-3 text-[12px] font-bold">常用配置项</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">免费皮肤</span>
                <select value={effect.Skin} onChange={e => updateEffect({ Skin: e.target.value })}
                  className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                  <option value="cat_cup">猫爪杯</option>
                </select>
              </label>
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">触发礼物</span>
                <button onClick={() => setGiftPickerOpen(true)}
                  className="flex h-[32px] w-full items-center gap-2 rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2 text-left text-[12px] text-[var(--control-text)]">
                  {selectedGift?.Image && <img src={imageUrl(selectedGift.Image)} alt="" className="h-6 w-6 shrink-0 rounded object-contain" />}
                  <span className="min-w-0 flex-1 truncate">{effect.GiftName || '全部礼物'}</span>
                </button>
              </div>
              <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">免费音效</span>
                <select value={effect.Sound} onChange={e => updateEffect({ Sound: e.target.value })}
                  className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                  <option value="mute">静音</option>
                  <option value="pop">弹跳音</option>
                  <option value="custom">自定义音效</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">音效音量</span>
                <div className="flex h-[32px] items-center gap-2 rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3">
                  <input type="range" min={0} max={100} value={effect.SoundVolume} onChange={e => updateEffect({ SoundVolume: Number(e.target.value) })} className="flex-1 accent-[var(--primary-color)]" />
                  <span className="w-9 text-right font-mono text-[11px] text-[var(--muted-text)]">{effect.SoundVolume}</span>
                </div>
              </label>
              {effect.Sound === 'custom' && (
                <div className="col-span-2 flex h-[32px] items-center gap-2 rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2">
                  <span className="min-w-0 flex-1 truncate text-[12px]" title={effect.CustomSoundPath}>{effect.CustomSoundPath ? fileName(effect.CustomSoundPath) : '未选择音效文件'}</span>
                  <button className="text-[11px] font-bold text-[var(--primary-color)]" onClick={chooseSoundResource}>选择</button>
                </div>
              )}
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
          <div className="flex flex-1 items-end justify-center p-8">
            <div className="relative h-[360px] w-[360px]">
              <div className="absolute bottom-0 left-1/2 h-[190px] w-[220px] -translate-x-1/2 rounded-b-[38px] rounded-t-[18px] border-4 border-slate-600/70 bg-white/50 shadow-2xl" />
              <div className="absolute bottom-[172px] left-1/2 h-[22px] w-[250px] -translate-x-1/2 rounded-full border-2 border-slate-600/70 bg-white/70" />
              <div className="absolute bottom-3 left-1/2 min-w-[280px] -translate-x-1/2 rounded-full border-2 border-purple-400 bg-purple-900/85 px-4 py-2 text-center text-[13px] font-black text-yellow-100">
                {effect.LastUser || '观众'} 送出 {effect.LastGift || effect.GiftName || '礼物'} x{effect.LastCount || 1}
              </div>
            </div>
          </div>
        </div>
      </GlassCard>

      {giftPickerOpen && (
        <GiftPickerDialog
          gifts={giftCatalog}
          refreshing={refreshingGifts}
          onRefresh={refreshGifts}
          onClose={() => setGiftPickerOpen(false)}
          onPick={(gift) => {
            updateEffect({ GiftName: gift.Name });
            setGiftPickerOpen(false);
          }}
          onAll={() => {
            updateEffect({ GiftName: '' });
            setGiftPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function GiftPickerDialog({ gifts, refreshing, onRefresh, onClose, onPick, onAll }: {
  gifts: GiftCatalogItem[];
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onPick: (gift: GiftCatalogItem) => void;
  onAll: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-5 backdrop-blur-sm">
      <div className="flex h-[70vh] w-[760px] flex-col overflow-hidden rounded-[24px] border border-[var(--surface-border)] bg-[var(--surface-bg)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--surface-border)] p-4">
          <div className="text-[15px] font-bold">选择礼物</div>
          <span className="flex-1" />
          <Button variant="default" size="sm" onClick={onAll}>全部礼物</Button>
          <Button variant="default" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />刷新
          </Button>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--button-ghost-hover)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid flex-1 grid-cols-3 content-start gap-2 overflow-y-auto p-4 [scrollbar-width:thin]">
          {gifts.map(gift => (
            <button key={gift.GiftId} onClick={() => onPick(gift)}
              className="flex items-center gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--control-bg)] p-3 text-left transition-colors hover:border-[var(--primary-color)]/45 hover:bg-[var(--button-ghost-hover)]">
              <img src={imageUrl(gift.Image)} alt={gift.Name} referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-xl object-contain" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-bold">{gift.Name}</div>
                <div className="text-[11px] font-semibold text-[var(--muted-text)]">{formatGiftPrice(gift.Price)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
