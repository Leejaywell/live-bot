import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, Gift, Pencil, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api, GiftCatalogItem, LotteryPrize, PluginSettings } from '../lib/api';

const fallbackConfig: PluginSettings = {
  WishGoal: {
    Enabled: true,
    Title: '今日心愿目标',
    Goals: [],
    NumberColor: '#ffffff',
    BackgroundColor: 'rgba(30, 34, 40, 0.72)',
    AccentColor: '#22d3ee',
    TextColor: '#111827',
    DisplaySize: 'normal',
    ShowIcons: true,
    FontFamily: 'PingFang SC',
    StylePreset: 'classic',
    CustomCss: '',
    CompleteAnimation: 'spark',
    CompleteSound: 'mute',
    SoundVolume: 60,
    SoundRepeat: 'once',
    CustomSoundPath: '',
  },
  LotteryInteraction: {
    Enabled: true,
    Title: '幸运抽奖',
    GiftName: '',
    GiftCount: 1,
    StaySeconds: 8,
    Prizes: [
      { Id: 'prize-1', Name: '1元红包', Weight: 1 },
      { Id: 'prize-2', Name: '20元红包', Weight: 1 },
      { Id: 'prize-3', Name: '谢谢参与', Weight: 5 },
      { Id: 'prize-4', Name: '神秘礼物', Weight: 1 },
    ],
    LastWinner: '',
    LastPrize: '',
    DrawNonce: 0,
  },
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
  RecentGifts: {
    Enabled: true,
    Title: '最近礼物',
    MaxItems: 3,
    Skin: 'compact',
    NameColor: '#ffffff',
    NumberColor: '#fcee21',
    GiftColor: 'rgba(255,255,255,0.72)',
    Items: [],
  },
  GiftRank: {
    Enabled: true,
    Title: '今日礼物排行',
    MaxItems: 3,
    Skin: 'podium',
    Date: '',
    Items: [],
  },
};

function formatGiftPrice(price: number): string {
  if (price <= 0) return '免费';
  const yuan = price / 1000;
  return yuan >= 100 ? `¥${Math.round(yuan)}` : `¥${yuan.toFixed(yuan >= 10 ? 1 : 2).replace(/\.?0+$/, '')}`;
}

function imageUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : '';
}

export function LotteryInteraction() {
  const [config, setConfig] = useState<PluginSettings>(fallbackConfig);
  const [loaded, setLoaded] = useState(false);
  const [lotteryUrl, setLotteryUrl] = useState('');
  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogItem[]>([]);
  const [giftPickerOpen, setGiftPickerOpen] = useState(false);
  const [editingPrize, setEditingPrize] = useState<LotteryPrize | null>(null);
  const [refreshingGifts, setRefreshingGifts] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const lottery = config.LotteryInteraction;
  const selectedGift = useMemo(() => giftCatalog.find(gift => gift.Name === lottery.GiftName), [giftCatalog, lottery.GiftName]);

  const updateLottery = (patch: Partial<typeof lottery>) => {
    setConfig(prev => ({ ...prev, LotteryInteraction: { ...prev.LotteryInteraction, ...patch } }));
  };

  useEffect(() => {
    api.loadPluginSettings().then(next => {
      setConfig({ ...fallbackConfig, ...next, LotteryInteraction: { ...fallbackConfig.LotteryInteraction, ...next.LotteryInteraction } });
      setLoaded(true);
    }).catch(err => {
      setLoaded(true);
      toast.error(`读取插件配置失败: ${err}`);
    });
    api.getLotteryUrl().then(setLotteryUrl).catch(() => {});
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
    navigator.clipboard.writeText(lotteryUrl).then(() => toast.success('地址已复制')).catch(() => {});
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

  const simulate = async () => {
    if (lottery.Prizes.length === 0) {
      toast.error('请先添加奖品');
      return;
    }
    const next = await api.simulateLottery();
    setConfig({ ...fallbackConfig, ...next, LotteryInteraction: { ...fallbackConfig.LotteryInteraction, ...next.LotteryInteraction } });
  };

  const savePrize = (prize: LotteryPrize) => {
    if (!prize.Name.trim()) {
      toast.error('奖品名称不能为空');
      return;
    }
    const exists = lottery.Prizes.some(item => item.Id === prize.Id);
    updateLottery({ Prizes: exists ? lottery.Prizes.map(item => item.Id === prize.Id ? prize : item) : [...lottery.Prizes, prize] });
    setEditingPrize(null);
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
              <div className="text-[16px] font-bold">抽奖互动</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[var(--muted-text)]">启用</span>
              <Toggle checked={lottery.Enabled} onChange={v => updateLottery({ Enabled: v })} />
            </div>
          </div>

          <GlassCard className="mb-3 p-4">
            <div className="mb-3 text-[12px] font-bold">地址</div>
            <div className="flex gap-2">
              <Input readOnly mono value={lotteryUrl} onClick={e => (e.target as HTMLInputElement).select()} className="flex-1" />
              <Button size="sm" variant="primary" onClick={copyUrl}><Copy className="h-3.5 w-3.5" />复制</Button>
            </div>
          </GlassCard>

          <GlassCard className="mb-3 p-4">
            <div className="mb-3 text-[12px] font-bold">基础设置</div>
            <div className="grid grid-cols-1 gap-3">
              <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">标题</span>
                <Input value={lottery.Title} onChange={e => updateLottery({ Title: e.target.value })} />
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">停留展示时间</span>
                <Input type="number" min={1} value={lottery.StaySeconds} onChange={e => updateLottery({ StaySeconds: Number(e.target.value) })} />
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">礼物数量</span>
                <Input type="number" min={1} value={lottery.GiftCount} onChange={e => updateLottery({ GiftCount: Number(e.target.value) })} />
              </label>
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">触发礼物</span>
                <button onClick={() => setGiftPickerOpen(true)}
                  className="flex h-[32px] w-full items-center gap-2 rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2 text-left text-[12px] text-[var(--control-text)]">
                  {selectedGift?.Image && <img src={imageUrl(selectedGift.Image)} alt="" className="h-6 w-6 shrink-0 rounded object-contain" />}
                  <span className="min-w-0 flex-1 truncate">{lottery.GiftName || '选择礼物'}</span>
                </button>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[12px] font-bold">奖品设置</div>
              <Button size="sm" variant="primary" onClick={() => setEditingPrize({ Id: `prize-${Date.now()}`, Name: '新奖品', Weight: 1 })}><Plus className="h-3.5 w-3.5" />添加</Button>
            </div>
            <div className="overflow-hidden rounded-2xl border border-[var(--surface-border)]">
              {lottery.Prizes.map(prize => (
                <div key={prize.Id} className="flex items-center gap-2 border-b border-[var(--surface-border)] bg-[var(--control-bg)] px-3 py-2 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-bold">{prize.Name}</div>
                    <div className="text-[10px] text-[var(--muted-text)]">权重 {prize.Weight}</div>
                  </div>
                  <IconButton title="修改" onClick={() => setEditingPrize({ ...prize })}><Pencil className="h-3.5 w-3.5" /></IconButton>
                  <IconButton title="删除" onClick={() => updateLottery({ Prizes: lottery.Prizes.filter(item => item.Id !== prize.Id) })}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                </div>
              ))}
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
            <div className="w-[360px] rounded-[24px] border-2 border-purple-300 bg-gradient-to-b from-purple-600 to-indigo-950 p-5 text-center text-white shadow-2xl">
              <div className="text-[24px] font-black">{lottery.Title || '幸运抽奖'}</div>
              <div className="mx-auto my-5 flex h-[210px] w-[210px] items-center justify-center rounded-full border-[10px] border-purple-700 bg-[conic-gradient(#facc15_0_25%,#fb7185_0_50%,#60a5fa_0_75%,#a78bfa_0)] text-[42px] font-black text-purple-700 shadow-inner">
                抽
              </div>
              <div className="rounded-2xl bg-black/35 p-3">
                <div className="text-[12px] text-purple-100">{lottery.LastWinner ? `恭喜 ${lottery.LastWinner} 抽中` : '等待抽奖触发'}</div>
                <div className="mt-1 text-[22px] font-black text-yellow-200">{lottery.LastPrize || '奖品'}</div>
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
            updateLottery({ GiftName: gift.Name });
            setGiftPickerOpen(false);
          }}
        />
      )}
      {editingPrize && (
        <PrizeDialog
          prize={editingPrize}
          onChange={setEditingPrize}
          onClose={() => setEditingPrize(null)}
          onSave={() => savePrize(editingPrize)}
        />
      )}
    </div>
  );
}

function GiftPickerDialog({ gifts, refreshing, onRefresh, onClose, onPick }: {
  gifts: GiftCatalogItem[];
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onPick: (gift: GiftCatalogItem) => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-5 backdrop-blur-sm">
      <div className="flex h-[70vh] w-[760px] flex-col overflow-hidden rounded-[24px] border border-[var(--surface-border)] bg-[var(--surface-bg)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--surface-border)] p-4">
          <div className="text-[15px] font-bold">选择礼物</div>
          <span className="flex-1" />
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

function PrizeDialog({ prize, onChange, onClose, onSave }: {
  prize: LotteryPrize;
  onChange: (prize: LotteryPrize) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const patch = (next: Partial<LotteryPrize>) => onChange({ ...prize, ...next });
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-5 backdrop-blur-sm">
      <div className="w-[420px] rounded-[24px] border border-[var(--surface-border)] bg-[var(--surface-bg)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[15px] font-bold">奖品</div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--button-ghost-hover)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 space-y-1.5">
            <span className="text-[11px] font-bold text-[var(--muted-text)]">奖品名称</span>
            <Input value={prize.Name} onChange={e => patch({ Name: e.target.value })} />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-bold text-[var(--muted-text)]">权重</span>
            <Input type="number" min={1} value={prize.Weight} onChange={e => patch({ Weight: Number(e.target.value) })} />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={onSave}>保存</Button>
        </div>
      </div>
    </div>
  );
}

function IconButton({ children, title, disabled, onClick }: { children: ReactNode; title: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button title={title} disabled={disabled} onClick={onClick}
      className="flex h-[32px] w-[32px] items-center justify-center rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--muted-text)] transition-colors hover:bg-[var(--button-ghost-hover)] disabled:opacity-35">
      {children}
    </button>
  );
}
