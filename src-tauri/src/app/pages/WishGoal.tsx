import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Copy, Gift, Pencil, Plus, RefreshCw, RotateCcw, Search, Send, Target, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api, GiftCatalogItem, PluginSettings, WishGoalItem, WishGoalSettings } from '../lib/api';

const CHINESE_FONT_CANDIDATES = [
  'PingFang SC',
  'Hiragino Sans GB',
  'Microsoft YaHei',
  'Microsoft JhengHei',
  'Noto Sans CJK SC',
  'Noto Serif CJK SC',
  'Source Han Sans SC',
  'Source Han Serif SC',
  'Heiti SC',
  'Songti SC',
  'Kaiti SC',
  'STHeiti',
  'STSong',
  'STKaiti',
  'STFangsong',
  'SimHei',
  'SimSun',
  'KaiTi',
  'FangSong',
  'WenQuanYi Micro Hei',
  'WenQuanYi Zen Hei',
];

export const fallbackConfig: PluginSettings = {
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
    Prizes: [],
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

const matchOptions = [
  { value: 'gift', label: '礼物' },
  { value: 'manual', label: '手动' },
];

const stylePresets = [
  { value: 'classic', label: '经典条形' },
  { value: 'capsule', label: '糖果胶囊' },
  { value: 'neon', label: '霓虹任务' },
  { value: 'circle', label: '圆形进度' },
  { value: 'plain', label: '简洁清单' },
  { value: 'ribbon', label: '缎带任务' },
  { value: 'glass', label: '玻璃浮层' },
  { value: 'compact', label: '紧凑排行' },
  { value: 'custom', label: '自定义' },
];

const presetCss: Record<string, string> = {
  classic: `.goal {
  transition: transform .22s ease, box-shadow .22s ease;
}
.goal:hover {
  transform: translateY(-1px);
}
.bar {
  height: 10px;
}
.fill {
  animation: wishShimmer 2.4s linear infinite;
  background-image: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent), white 36%), var(--accent));
  background-size: 180% 100%;
}
.num {
  color: var(--num);
  text-shadow: 0 1px 2px rgba(0,0,0,.72);
}`,
  capsule: `.goal {
  border-radius: 999px;
  padding: 8px 12px;
}
.bar {
  height: 18px;
}
.fill {
  background: linear-gradient(90deg,#93c5fd,#c4b5fd,#f0abfc);
  animation: wishShimmer 2.2s linear infinite;
  background-size: 180% 100%;
}
.num {
  color: #fff;
  text-shadow: 0 1px 3px rgba(55,48,163,.75);
}`,
  neon: `#card {
  background: #20242a;
  border-color: #22d3ee;
  box-shadow: 0 0 24px rgba(34,211,238,.3);
}
.title,
.goal {
  background: rgba(20,24,28,.84);
  border-color: #22d3ee;
  color: #fff;
}
.goal {
  animation: wishNeon 2.6s ease-in-out infinite;
}
.num {
  color: #fff;
  text-shadow: 0 0 8px rgba(34,211,238,.75), 0 1px 2px rgba(0,0,0,.9);
}`,
  circle: `#card {
  min-width: 150px;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
}
.title {
  display: none;
}
.goal {
  border: 0;
  background: transparent;
  box-shadow: none;
  text-align: center;
  animation: wishFloat 2.8s ease-in-out infinite;
}
.line {
  flex-direction: column;
}
.name,
.bar {
  display: none;
}
.icon {
  width: 58px;
  height: 58px;
  border-radius: 999px;
  padding: 8px;
  border: 4px solid rgba(255,255,255,.62);
}
.num {
  font-size: 20px;
  color: var(--num);
  text-shadow: 0 2px 3px rgba(0,0,0,.7);
}`,
  plain: `#card {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
}
.title,
.bar {
  display: none;
}
.goal {
  border: 0;
  background: transparent;
  box-shadow: none;
  animation: wishFloat 3s ease-in-out infinite;
}
.name,
.num {
  color: #fff;
  text-shadow: 0 2px 3px rgba(0,0,0,.65);
}`,
  ribbon: `.title {
  border-radius: 999px;
  background: linear-gradient(180deg,#bfdbfe,#60a5fa);
  color: #fff;
  text-shadow: 0 2px 3px rgba(30,64,175,.58);
}
.goal {
  border-radius: 14px;
  border-left-width: 5px;
  animation: wishSlide 2.8s ease-in-out infinite;
}
.bar {
  height: 12px;
}
.fill {
  background: repeating-linear-gradient(45deg,var(--accent) 0 10px,color-mix(in srgb,var(--accent),white 35%) 10px 20px);
  animation: wishStripe 1.8s linear infinite;
}`,
  glass: `#card {
  background: rgba(255,255,255,.26);
  border-color: rgba(255,255,255,.62);
  box-shadow: 0 18px 42px rgba(15,23,42,.18);
}
.title,
.goal {
  background: rgba(255,255,255,.34);
  border-color: rgba(255,255,255,.7);
}
.goal {
  animation: wishGlow 2.7s ease-in-out infinite;
}
.num {
  color: var(--num);
  text-shadow: 0 1px 3px rgba(0,0,0,.68);
}`,
  compact: `#card {
  min-width: 280px;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}
.title {
  display: none;
}
.goal {
  border: 0;
  background: transparent;
  box-shadow: none;
  padding: 3px 0;
  animation: wishFloat 3.2s ease-in-out infinite;
}
.bar {
  display: none;
}
.name {
  color: #fff;
  text-shadow: 0 2px 3px rgba(0,0,0,.72);
}
.num {
  color: #fff;
  text-shadow: 0 2px 3px rgba(0,0,0,.72);
}`,
};

function newGoal(): WishGoalItem {
  return {
    Id: `goal-${Date.now()}`,
    Name: '新目标',
    Current: 0,
    Target: 1,
    Icon: '',
    MatchKind: 'gift',
    GiftName: '',
    Increment: 1,
  };
}

function formatGiftPrice(price: number): string {
  if (price <= 0) return '免费';
  const yuan = price / 1000;
  return yuan >= 100 ? `¥${Math.round(yuan)}` : `¥${yuan.toFixed(yuan >= 10 ? 1 : 2).replace(/\.?0+$/, '')}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function imageUrl(url: string): string {
  if (!url) return '';
  return /^https?:\/\//.test(url) ? url : '';
}

function goalImage(goal: WishGoalItem, giftByName: Map<string, GiftCatalogItem>): string {
  return imageUrl(goal.Icon) || imageUrl(giftByName.get(goal.GiftName)?.Image || '');
}

function cssForStyle(style: string): string {
  return presetCss[style] || presetCss.classic;
}

function cssForTextarea(settings: WishGoalSettings): string {
  return settings.StylePreset === 'custom' ? (settings.CustomCss || presetCss.classic) : cssForStyle(settings.StylePreset || 'classic');
}

function previewCss(settings: WishGoalSettings): string {
  const base = settings.StylePreset === 'custom' ? (settings.CustomCss || presetCss.classic) : cssForStyle(settings.StylePreset || 'classic');
  return `
@keyframes wishShimmer{0%{background-position:0 0}100%{background-position:180% 0}}
@keyframes wishNeon{0%,100%{filter:drop-shadow(0 0 0 rgba(34,211,238,0))}50%{filter:drop-shadow(0 0 8px rgba(34,211,238,.45))}}
@keyframes wishFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@keyframes wishSlide{0%,100%{transform:translateX(0)}50%{transform:translateX(2px)}}
@keyframes wishStripe{0%{background-position:0 0}100%{background-position:28px 0}}
@keyframes wishGlow{0%,100%{box-shadow:0 8px 20px rgba(15,23,42,.12)}50%{box-shadow:0 12px 28px rgba(15,23,42,.22)}}
${base}`;
}

function detectChineseFonts(): string[] {
  if (typeof document === 'undefined') return ['PingFang SC'];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return ['PingFang SC'];
  const sample = '直播心愿目标舰长辣条 123';
  const bases = ['sans-serif', 'serif', 'monospace'].map(base => {
    ctx.font = `16px ${base}`;
    return ctx.measureText(sample).width;
  });
  const fonts = CHINESE_FONT_CANDIDATES.filter(font => {
    ctx.font = `16px "${font}", monospace`;
    const width = ctx.measureText(sample).width;
    return bases.some(base => Math.abs(width - base) > 0.5);
  });
  return fonts.length ? fonts : ['PingFang SC'];
}

export function WishGoal() {
  const [config, setConfig] = useState<PluginSettings>(fallbackConfig);
  const [loaded, setLoaded] = useState(false);
  const [wishUrl, setWishUrl] = useState('');
  const [editingGoal, setEditingGoal] = useState<WishGoalItem | null>(null);
  const [giftPickerOpen, setGiftPickerOpen] = useState(false);
  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogItem[]>([]);
  const [systemFonts, setSystemFonts] = useState<string[]>(['PingFang SC']);
  const [baseOpen, setBaseOpen] = useState(false);
  const [giftQuery, setGiftQuery] = useState('');
  const [refreshingGifts, setRefreshingGifts] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const wish = config.WishGoal;
  const goals = wish.Goals ?? [];
  const giftByName = useMemo(() => new Map(giftCatalog.map(gift => [gift.Name, gift])), [giftCatalog]);

  const updateWish = (patch: Partial<WishGoalSettings>) => {
    setConfig(prev => ({ ...prev, WishGoal: { ...prev.WishGoal, ...patch } }));
  };

  const updateStylePreset = (style: string) => {
    updateWish({
      StylePreset: style,
      ...(style === 'custom' ? { CustomCss: cssForTextarea(wish) } : {}),
    });
  };

  useEffect(() => {
    api.loadPluginSettings()
      .then(c => {
        setConfig(c);
        setLoaded(true);
      })
      .catch(err => {
        setLoaded(true);
        toast.error(`读取插件配置失败: ${err}`);
      });
    api.getWishGoalUrl().then(setWishUrl).catch(() => {});
    api.getGiftCatalog().then(setGiftCatalog).catch(() => {});
    setSystemFonts(detectChineseFonts());
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.savePluginSettings(config).catch(err => toast.error(`保存失败: ${err}`));
    }, 350);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [config, loaded]);

  useEffect(() => {
    if (!loaded || systemFonts.length === 0) return;
    if (!systemFonts.includes(config.WishGoal.FontFamily)) {
      updateWish({ FontFamily: systemFonts[0] });
    }
  }, [loaded, systemFonts]);

  useEffect(() => {
    if (!loaded || giftCatalog.length === 0 || goals.length === 0) return;
    let changed = false;
    const nextGoals = goals.map(goal => {
      if (goal.MatchKind !== 'gift' || imageUrl(goal.Icon)) return goal;
      const gift = giftByName.get(goal.GiftName);
      if (!gift?.Image) return goal;
      changed = true;
      return { ...goal, Icon: gift.Image };
    });
    if (changed) updateWish({ Goals: nextGoals });
  }, [loaded, giftCatalog, goals, giftByName]);

  const saveGoal = (goal: WishGoalItem) => {
    let nextGoal = goal;
    if (goal.MatchKind === 'gift') {
      const gift = giftCatalog.find(item => item.Name === goal.GiftName);
      if (!gift) {
        toast.error('请从礼物列表中选择礼物');
        return;
      }
      nextGoal = { ...goal, Name: gift.Name, GiftName: gift.Name, Icon: gift.Image };
    }
    const exists = goals.some(item => item.Id === goal.Id);
    updateWish({ Goals: exists ? goals.map(item => item.Id === goal.Id ? nextGoal : item) : [...goals, nextGoal] });
    setEditingGoal(null);
  };

  const deleteGoal = (id: string) => updateWish({ Goals: goals.filter(goal => goal.Id !== id) });

  const moveGoal = (id: string, direction: -1 | 1) => {
    const index = goals.findIndex(goal => goal.Id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= goals.length) return;
    const next = [...goals];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateWish({ Goals: next });
  };

  const copyUrl = () => {
    if (!wishUrl) return;
    navigator.clipboard.writeText(wishUrl).then(() => toast.success('地址已复制')).catch(() => {});
  };

  const chooseSoundResource = async () => {
    try {
      const path = await api.pickPluginResource('sound');
      if (!path) return;
      updateWish({ CompleteSound: 'custom', CustomSoundPath: path });
    } catch (err) {
      toast.error(`选择资源失败: ${err}`);
    }
  };

  const reset = async () => {
    const next = await api.resetWishGoal();
    setConfig(next);
    toast.success('心愿目标已重置');
  };

  const simulate = async () => {
    const next = await api.simulateWishGoal();
    setConfig(next);
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

  const previewGoals = useMemo(() => goals.length ? goals : fallbackConfig.WishGoal.Goals, [goals]);
  const goalGiftImage = (goal: WishGoalItem) => goalImage(goal, giftByName);

  return (
    <div className="h-full overflow-hidden p-5 text-[var(--foreground)]">
      <GlassCard className="flex h-full min-h-[584px] overflow-hidden rounded-[24px]">
        <div className="w-[clamp(430px,44vw,660px)] shrink-0 overflow-y-auto border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-5 [scrollbar-width:thin]">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--primary-color)]/12 text-[var(--primary-color)]">
                <Target className="h-4 w-4" />
              </div>
              <div>
                <div className="text-[16px] font-bold">心愿目标</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[var(--muted-text)]">启用</span>
              <Toggle checked={wish.Enabled} onChange={v => updateWish({ Enabled: v })} />
            </div>
          </div>

          <GlassCard className="mb-3 p-4">
            <div className="mb-3 text-[12px] font-bold">地址</div>
            <div className="flex gap-2">
              <Input readOnly mono value={wishUrl} onClick={e => (e.target as HTMLInputElement).select()} className="flex-1" />
              <Button size="sm" variant="primary" onClick={copyUrl}><Copy className="h-3.5 w-3.5" />复制</Button>
            </div>
          </GlassCard>

          <GlassCard className="mb-3 overflow-hidden">
            <button onClick={() => setBaseOpen(v => !v)} className="flex w-full items-center justify-between border-b border-[var(--surface-border)] px-4 py-3 text-left">
              <div className="text-[12px] font-bold">基础面板</div>
              <ChevronDown className={`h-4 w-4 text-[var(--muted-text)] transition-transform ${baseOpen ? 'rotate-180' : ''}`} />
            </button>
            {baseOpen && (
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 items-end gap-3">
                  <label className="space-y-1.5">
                  <span className="text-[11px] font-bold text-[var(--muted-text)]">标题</span>
                  <Input value={wish.Title} onChange={e => updateWish({ Title: e.target.value })} />
                  </label>
                  <label className="space-y-1.5">
                  <span className="text-[11px] font-bold text-[var(--muted-text)]">显示大小</span>
                  <select value={wish.DisplaySize} onChange={e => updateWish({ DisplaySize: e.target.value })}
                    className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                    <option value="small">小</option>
                    <option value="normal">普通</option>
                    <option value="large">大</option>
                  </select>
                  </label>
                </div>
                <label className="block space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">系统中文字体</span>
                <select value={wish.FontFamily} onChange={e => updateWish({ FontFamily: e.target.value })}
                  className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                  {systemFonts.map(font => <option key={font} value={font}>{font}</option>)}
                </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">达成动画</span>
                <select value={wish.CompleteAnimation} onChange={e => updateWish({ CompleteAnimation: e.target.value })}
                  className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                  <option value="none">无</option>
                  <option value="spark">烟花</option>
                  <option value="pulse">闪烁</option>
                  <option value="bounce">弹跳</option>
                </select>
                  </label>
                  <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">达成音效</span>
                <select value={wish.CompleteSound} onChange={e => updateWish({ CompleteSound: e.target.value })}
                  className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                  <option value="mute">静音</option>
                  <option value="chime">提示音</option>
                  <option value="coin">金币</option>
                  <option value="success">达成</option>
                  <option value="custom">自定义音效</option>
                </select>
                  </label>
                  {wish.CompleteSound === 'custom' && (
                    <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-[var(--muted-text)]">自定义音效</span>
                  <div className="flex h-[32px] items-center gap-2 rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--control-text)]" title={wish.CustomSoundPath || ''}>
                      {wish.CustomSoundPath ? fileName(wish.CustomSoundPath) : '未选择'}
                    </span>
                    {wish.CustomSoundPath && (
                      <button className="text-[11px] font-bold text-[var(--muted-text)] hover:text-[var(--text-color)]" onClick={() => updateWish({ CustomSoundPath: '', CompleteSound: 'mute' })}>清除</button>
                    )}
                    <button className="text-[11px] font-bold text-[var(--primary-color)]" onClick={chooseSoundResource}>选择</button>
                  </div>
                    </div>
                  )}
                  <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">达成音效音量</span>
                <div className="flex h-[32px] items-center gap-2 rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3">
                  <input type="range" min={0} max={100} value={wish.SoundVolume} onChange={e => updateWish({ SoundVolume: Number(e.target.value) })} className="flex-1 accent-[var(--primary-color)]" />
                  <span className="w-9 text-right font-mono text-[11px] text-[var(--muted-text)]">{wish.SoundVolume}</span>
                </div>
                  </label>
                  <label className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--muted-text)]">达成音效重复播放</span>
                <select value={wish.SoundRepeat} onChange={e => updateWish({ SoundRepeat: e.target.value })}
                  className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                  <option value="once">只播放一次</option>
                  <option value="always">每次达成都播放</option>
                </select>
                  </label>
                  <ColorField label="数字颜色" value={wish.NumberColor} onChange={v => updateWish({ NumberColor: v })} />
                  <ColorField label="背景底色" value={wish.BackgroundColor} onChange={v => updateWish({ BackgroundColor: v })} />
                  <ColorField label="强调颜色" value={wish.AccentColor} onChange={v => updateWish({ AccentColor: v })} />
                  <ColorField label="文字颜色" value={wish.TextColor} onChange={v => updateWish({ TextColor: v })} />
                </div>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-bold text-[var(--muted-text)]">风格</span>
                  <select value={wish.StylePreset || 'classic'} onChange={e => updateStylePreset(e.target.value)}
                    className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
                    {stylePresets.map(style => <option key={style.value} value={style.value}>{style.label}</option>)}
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-bold text-[var(--muted-text)]">自定义 CSS</span>
                  <textarea value={cssForTextarea(wish)} onChange={e => updateWish({ CustomCss: e.target.value })}
                    readOnly={wish.StylePreset !== 'custom'}
                    spellCheck={false}
                    className="min-h-[160px] w-full resize-y rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 py-2 font-mono text-[12px] text-[var(--control-text)] outline-none read-only:opacity-75" />
                </label>
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[12px] font-bold">心选管理</div>
              <Button size="sm" variant="primary" onClick={() => setEditingGoal(newGoal())}><Plus className="h-3.5 w-3.5" />添加</Button>
            </div>
            <div className="overflow-hidden rounded-2xl border border-[var(--surface-border)]">
              {goals.map((goal, index) => (
                <div key={goal.Id} className="flex items-center gap-2 border-b border-[var(--surface-border)] bg-[var(--control-bg)] px-3 py-2 last:border-b-0">
                  {goalGiftImage(goal) && (
                    <img src={goalGiftImage(goal)} alt="" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-xl object-contain" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-bold">{goal.Name}</div>
                    <div className="truncate text-[10px] text-[var(--muted-text)]">
                      {matchOptions.find(item => item.value === goal.MatchKind)?.label ?? '礼物'}
                      {goal.GiftName ? ` · ${goal.GiftName}` : ''} · {goal.Current}/{goal.Target}
                    </div>
                  </div>
                  <IconButton title="修改" onClick={() => setEditingGoal({ ...goal })}><Pencil className="h-3.5 w-3.5" /></IconButton>
                  <IconButton title="上移" onClick={() => moveGoal(goal.Id, -1)} disabled={index === 0}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                  <IconButton title="下移" onClick={() => moveGoal(goal.Id, 1)} disabled={index === goals.length - 1}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                  <IconButton title="删除" onClick={() => deleteGoal(goal.Id)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                </div>
              ))}
              {goals.length === 0 && <div className="px-3 py-8 text-center text-[12px] text-[var(--muted-text)]">暂无心愿项目</div>}
            </div>
          </GlassCard>
        </div>

        <div className="flex flex-1 flex-col bg-[radial-gradient(circle_at_24%_18%,rgba(var(--primary-rgb),0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.68),rgba(228,235,242,0.52))] dark:bg-[radial-gradient(circle_at_24%_18%,rgba(var(--primary-rgb),0.18),transparent_30%),linear-gradient(135deg,rgba(20,24,32,0.72),rgba(10,12,18,0.56))]">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 bg-black/35 px-4 text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
            <span className="text-[12px] font-bold">预览</span>
            <span className="text-[11px] text-white/60">设置会自动保存并同步展示页</span>
            <span className="flex-1" />
            <button onClick={simulate} className="flex h-7 items-center gap-1.5 rounded-lg border border-white/12 bg-white/8 px-2.5 text-[11px] font-semibold text-white/80 hover:bg-white/14">
              <Send className="h-3 w-3" />模拟数据
            </button>
            <button onClick={reset} className="flex h-7 items-center gap-1.5 rounded-lg border border-white/12 bg-white/8 px-2.5 text-[11px] font-semibold text-white/80 hover:bg-white/14">
              <RotateCcw className="h-3 w-3" />重置
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center p-8">
            <WishPreview settings={wish} goals={previewGoals} giftByName={giftByName} />
          </div>
        </div>
      </GlassCard>

      {editingGoal && (
        <GoalDialog
          goal={editingGoal}
          selectedGift={giftByName.get(editingGoal.GiftName)}
          onChange={setEditingGoal}
          onClose={() => setEditingGoal(null)}
          onSave={() => saveGoal(editingGoal)}
          onOpenGiftPicker={() => setGiftPickerOpen(true)}
        />
      )}
      {editingGoal && giftPickerOpen && (
        <GiftPickerDialog
          gifts={giftCatalog}
          query={giftQuery}
          refreshing={refreshingGifts}
          onQueryChange={setGiftQuery}
          onRefresh={refreshGifts}
          onClose={() => setGiftPickerOpen(false)}
          onPick={(gift) => {
            setEditingGoal(goal => goal ? {
              ...goal,
              Name: gift.Name,
              GiftName: gift.Name,
              MatchKind: 'gift',
              Increment: 1,
              Icon: gift.Image,
            } : goal);
            setGiftPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function GoalDialog({ goal, selectedGift, onChange, onClose, onSave, onOpenGiftPicker }: {
  goal: WishGoalItem;
  selectedGift?: GiftCatalogItem;
  onChange: (goal: WishGoalItem) => void;
  onClose: () => void;
  onSave: () => void;
  onOpenGiftPicker: () => void;
}) {
  const patch = (next: Partial<WishGoalItem>) => onChange({ ...goal, ...next });
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-5 backdrop-blur-sm">
      <div className="w-[560px] overflow-hidden rounded-[24px] border border-[var(--surface-border)] bg-[var(--surface-bg)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--surface-border)] px-5 py-4">
          <div>
            <div className="text-[15px] font-bold">心愿项目</div>
            <div className="mt-0.5 text-[11px] text-[var(--muted-text)]">{goal.MatchKind === 'gift' ? '选择礼物后自动使用礼物名称和图标' : '手动目标只记录数值'}</div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--button-ghost-hover)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <label className="space-y-1.5">
            <span className="text-[11px] font-bold text-[var(--muted-text)]">统计方式</span>
            <select value={goal.MatchKind} onChange={e => patch({ MatchKind: e.target.value, GiftName: e.target.value === 'manual' ? '' : goal.GiftName })}
              className="h-[32px] w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[12px] text-[var(--control-text)] focus:outline-none">
              {matchOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          {goal.MatchKind === 'gift' ? (
            <div>
              <div className="mb-1.5 text-[11px] font-bold text-[var(--muted-text)]">礼物</div>
              <button onClick={onOpenGiftPicker}
                className="flex min-h-[72px] w-full items-center gap-3 rounded-2xl border border-[var(--control-border)] bg-[var(--control-bg)] p-3 text-left transition-colors hover:border-[var(--primary-color)]/45 hover:bg-[var(--button-ghost-hover)]">
                {imageUrl(selectedGift?.Image || goal.Icon) ? (
                  <img src={imageUrl(selectedGift?.Image || goal.Icon)} alt="" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-xl object-contain" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-color)]/12 text-[var(--primary-color)]">
                    <Gift className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold">{goal.GiftName || '选择礼物'}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted-text)]">{selectedGift ? formatGiftPrice(selectedGift.Price) : '从缓存礼物列表中选择'}</div>
                </div>
                <span className="text-[11px] font-bold text-[var(--primary-color)]">选择</span>
              </button>
            </div>
          ) : (
            <label className="space-y-1.5">
              <span className="text-[11px] font-bold text-[var(--muted-text)]">名称</span>
              <Input value={goal.Name} onChange={e => patch({ Name: e.target.value })} />
            </label>
          )}

          <div className="grid grid-cols-3 gap-3">
            <NumberField label="当前值" value={goal.Current} onChange={v => patch({ Current: v })} />
            <NumberField label="目标值" value={goal.Target} min={1} onChange={v => patch({ Target: v })} />
            <NumberField label="单次增量" value={goal.Increment} min={1} onChange={v => patch({ Increment: v })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--surface-border)] px-5 py-4">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={onSave}>保存</Button>
        </div>
      </div>
    </div>
  );
}

function GiftPickerDialog({ gifts, query, refreshing, onQueryChange, onRefresh, onClose, onPick }: {
  gifts: GiftCatalogItem[];
  query: string;
  refreshing: boolean;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onClose: () => void;
  onPick: (gift: GiftCatalogItem) => void;
}) {
  const filtered = gifts.filter(gift => !query.trim() || gift.Name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-5 backdrop-blur-sm">
      <div className="flex h-[72vh] w-[760px] flex-col overflow-hidden rounded-[24px] border border-[var(--surface-border)] bg-[var(--surface-bg)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--surface-border)] p-4">
          <div className="text-[15px] font-bold">选择礼物</div>
          <div className="relative ml-3 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-text)]" />
            <Input value={query} onChange={e => onQueryChange(e.target.value)} placeholder="搜索礼物名称" className="w-full pl-8" />
          </div>
          <Button variant="default" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />刷新
          </Button>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--button-ghost-hover)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid flex-1 grid-cols-3 content-start gap-2 overflow-y-auto p-4 [scrollbar-width:thin]">
          {filtered.map(gift => (
            <button key={gift.GiftId} onClick={() => onPick(gift)}
              className="flex items-center gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--control-bg)] p-3 text-left transition-colors hover:border-[var(--primary-color)]/45 hover:bg-[var(--button-ghost-hover)]">
              <img src={imageUrl(gift.Image)} alt={gift.Name} referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-xl object-contain" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-bold">{gift.Name}</div>
                <div className="text-[11px] font-semibold text-[var(--muted-text)]">{formatGiftPrice(gift.Price)}</div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <div className="col-span-3 py-12 text-center text-[12px] text-[var(--muted-text)]">暂无礼物缓存，点击刷新获取</div>}
        </div>
      </div>
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

function NumberField({ label, value, min = 0, onChange }: { label: string; value: number; min?: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-bold text-[var(--muted-text)]">{label}</span>
      <Input type="number" min={min} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
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

function WishPreview({ settings, goals, giftByName }: { settings: WishGoalSettings; goals: WishGoalItem[]; giftByName: Map<string, GiftCatalogItem> }) {
  const fontFamily = `"${settings.FontFamily || 'PingFang SC'}","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif`;
  const preset = settings.StylePreset || 'classic';
  return (
    <div id="card" className={`wish-preview style-${preset} w-[340px] rounded-xl border-2 p-2 shadow-[0_18px_48px_rgba(0,0,0,0.18)] backdrop-blur-md`}
      style={{ borderColor: settings.AccentColor, background: settings.BackgroundColor, fontFamily }}>
      <style>{previewCss(settings)}</style>
      <div className="title wish-title mb-2 rounded-lg border bg-white/55 px-3 py-1 text-center text-[17px] font-black shadow-sm"
        style={{ color: settings.TextColor, borderColor: settings.AccentColor }}>
        {settings.Title || '今日心愿目标'}
      </div>
      <div className="space-y-1.5">
        {goals.map(goal => {
          const pct = Math.min(100, Math.max(0, Math.round((goal.Current / Math.max(1, goal.Target)) * 100)));
          const image = goalImage(goal, giftByName);
          return (
            <div key={goal.Id} className="goal wish-goal rounded-lg border bg-white/55 px-2 py-1.5 shadow-sm" style={{ color: settings.TextColor, borderColor: settings.AccentColor }}>
              <div className="line wish-line mb-1 flex items-center gap-2">
                {image && <img src={image} alt="" referrerPolicy="no-referrer" className="icon wish-icon h-8 w-8 shrink-0 rounded-lg object-contain" />}
                <span className="name wish-name flex-1 text-[15px] font-black">{goal.Name}</span>
                <span className="num wish-num font-mono text-[18px] font-black" style={{ color: settings.NumberColor }}>{goal.Current}/{goal.Target}</span>
              </div>
              <div className="bar wish-bar h-2.5 overflow-hidden rounded-full bg-white/55">
                <div className="fill wish-fill h-full rounded-full" style={{ width: `${pct}%`, background: settings.AccentColor }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
