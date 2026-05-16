import React, { useState, useEffect } from 'react';
import { Plus, X, Clock, ShieldCheck, Gift, Heart, Activity, MessageSquare, Hash, Sparkles, Volume2, ChevronDown, UserX } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api, AppConfig, SpecialWelcomeEntry } from '../lib/api';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';

type TabId = 'welcome' | 'fans' | 'gift' | 'timed' | 'filter' | 'system';

const TABS: { id: TabId; label: string; Icon: any; color: string }[] = [
  { id: 'welcome',  label: '欢迎语',   Icon: MessageSquare, color: '#4b8eff' },
  { id: 'fans',     label: '粉丝互动', Icon: Heart,         color: '#ff2d55' },
  { id: 'gift',     label: '礼物感谢', Icon: Gift,          color: '#ff9f0a' },
  { id: 'timed',    label: '定时任务', Icon: Clock,         color: '#af52de' },
  { id: 'filter',   label: '过滤防护', Icon: ShieldCheck,   color: '#ff3b30' },
  { id: 'system',   label: '系统事件', Icon: Activity,      color: '#34c759' },
];

const WELCOME_PRESETS = [
  '欢迎 {user} 进入直播间！',
  '欢迎欢迎！热烈欢迎 {user} 来到直播间~',
  '{user} 来啦！感谢关注，欢迎入驻！',
  '嗷～ {user} 悄悄进来了，快来互动吧！',
  '哇！{user} 到了，直播间又多了位新朋友！',
];

function cronToNatural(cron: string): string {
  const parts = cron.split(' ');
  if (cron.startsWith('*/')) {
    const val = parts[0].slice(2);
    return `每 ${val} ${parts.length > 5 ? '秒' : '分钟'}`;
  }
  if (parts.length >= 5) {
    const [m, h, d, mo, w] = parts;
    if (h === '*' && d === '*' && mo === '*' && w === '*') return `每分钟第 ${m} 秒`;
    if (m !== '*' && h !== '*' && d === '*' && mo === '*' && w === '*') return `每天 ${h}:${m.padStart(2, '0')}`;
    if (m === '0' && h === '*' && d === '*' && mo === '*' && w === '*') return '每小时整点';
  }
  return cron;
}

export function AutoReply() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<TabId>((tabParam as TabId) ?? 'welcome');

  // 定时回复
  const [timedMode, setTimedMode] = useState<'freq' | 'cron'>('freq');
  const [freqNum, setFreqNum] = useState('');
  const [freqUnit, setFreqUnit] = useState<'s' | 'm'>('m');
  const [newCron, setNewCron] = useState('');
  const [newCronMsg, setNewCronMsg] = useState('');

  // 礼物页折叠
  const [giftTemplatesOpen, setGiftTemplatesOpen] = useState(false);
  const [giftAliasOpen, setGiftAliasOpen] = useState(false);

  // 黑名单
  const [blackUidInput, setBlackUidInput] = useState('');
  const [blackNameInput, setBlackNameInput] = useState('');
  const [filterWordInput, setFilterWordInput] = useState('');

  // 删除确认
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const withConfirm = (key: string, onConfirm: () => void) => {
    if (confirmingDelete === key) { onConfirm(); setConfirmingDelete(null); }
    else { setConfirmingDelete(key); setTimeout(() => setConfirmingDelete(c => c === key ? null : c), 3000); }
  };

  // 欢迎语
  const [newWelcomeMsg, setNewWelcomeMsg] = useState('');
  const [newSpecialUid, setNewSpecialUid] = useState('');
  const [newSpecialMsg, setNewSpecialMsg] = useState('');

  // 粉丝互动
  const [newFocusTemplate, setNewFocusTemplate] = useState('');

  useEffect(() => {
    api.loadConfig().then(setConfig).catch(console.error);
  }, []);

  useEffect(() => {
    if (tabParam && TABS.some(t => t.id === tabParam)) {
      setActiveTab(tabParam as TabId);
    }
  }, [tabParam]);

  const save = async (next: AppConfig, msg = '保存成功') => {
    try {
      await api.saveConfig(next);
      setConfig(next);
      toast.success(msg);
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const toggle = (key: keyof AppConfig) => {
    if (!config) return;
    save({ ...config, [key]: !config[key] });
  };

  if (!config) return <div className="p-4 text-gray-400 text-[12px]">加载中...</div>;

  // ── 定时回复 ──
  const addTimedTask = () => {
    const msg = newCronMsg.trim();
    if (!msg) return;
    let cron = '';
    if (timedMode === 'freq') {
      const val = freqNum.trim();
      if (!val) return;
      cron = freqUnit === 's' ? `*/${val} * * * * *` : `*/${val} * * * *`;
    } else {
      cron = newCron.trim();
      if (!cron) return;
    }
    save(
      { ...config, CronDanmuList: [...(config.CronDanmuList as any[]), { Cron: cron, Random: false, Danmu: [msg] }] },
      '添加成功',
    );
    setNewCronMsg(''); setFreqNum(''); setNewCron('');
  };

  const removeTimedTask = (i: number) => {
    save({ ...config, CronDanmuList: (config.CronDanmuList as any[]).filter((_, idx) => idx !== i) }, '删除成功');
  };

  // ── 黑名单 ──
  const addBlackUid = () => {
    const val = parseInt(blackUidInput.trim());
    if (isNaN(val) || config.PermanentBlacklistUsers.includes(val)) return;
    save({ ...config, PermanentBlacklistUsers: [...config.PermanentBlacklistUsers, val] }, '添加成功');
    setBlackUidInput('');
  };

  const addBlackName = () => {
    const val = blackNameInput.trim();
    if (!val || config.PermanentBlacklistNames.includes(val)) return;
    save({ ...config, PermanentBlacklistNames: [...config.PermanentBlacklistNames, val] }, '添加成功');
    setBlackNameInput('');
  };

  const addFilterWord = () => {
    const val = filterWordInput.trim();
    if (!val || config.DanmuFilterWords.includes(val)) return;
    save({ ...config, DanmuFilterWords: [...config.DanmuFilterWords, val] }, '添加成功');
    setFilterWordInput('');
  };

  // ── 欢迎语 ──
  const addWelcomeMsg = (msg: string) => {
    const m = msg.trim();
    if (!m || (config.GeneralWelcomeMsgs ?? []).includes(m)) return;
    save({ ...config, GeneralWelcomeMsgs: [...(config.GeneralWelcomeMsgs ?? []), m] }, '添加成功');
    setNewWelcomeMsg('');
  };

  const removeWelcomeMsg = (i: number) => {
    save({ ...config, GeneralWelcomeMsgs: (config.GeneralWelcomeMsgs ?? []).filter((_, idx) => idx !== i) }, '删除成功');
  };

  const addSpecialWelcome = () => {
    const uid = newSpecialUid.trim();
    const msg = newSpecialMsg.trim();
    if (!uid || !msg) return;
    const next = [...(config.SpecialWelcomeList ?? []), { Uid: uid, Msg: msg }];
    save({ ...config, SpecialWelcomeList: next }, '添加成功');
    setNewSpecialUid(''); setNewSpecialMsg('');
  };

  const removeSpecialWelcome = (i: number) => {
    save({ ...config, SpecialWelcomeList: (config.SpecialWelcomeList ?? []).filter((_, idx) => idx !== i) }, '删除成功');
  };

  // ── Tab content ──

  const WelcomeTab = (
    <div className="space-y-6">
      {/* 通用欢迎语 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold">通用欢迎语</div>
            <div className="text-[10px] text-gray-500 mt-0.5">随机选一条对所有进场观众发送，{'{user}'} 替换为昵称</div>
          </div>
          <Toggle checked={config.GeneralWelcomeEnabled ?? false} onChange={() => toggle('GeneralWelcomeEnabled')} />
        </div>

        {/* 模板列表 */}
        <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
          {(config.GeneralWelcomeMsgs ?? []).map((msg, i) => {
            const key = `welcome-${i}`;
            const confirming = confirmingDelete === key;
            return (
            <div key={msg} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/50 dark:bg-white/5 border border-gray-200/60 dark:border-white/10 group animate-item-in" style={{ animationDelay: `${i * 25}ms` }}>
              <Sparkles className="w-3 h-3 text-[var(--primary-color)]/50 shrink-0" />
              <span className="flex-1 text-[11px] truncate">{msg}</span>
              <button
                className={`opacity-0 group-hover:opacity-100 transition-all text-[10px] font-bold px-1.5 py-0.5 rounded-md ${confirming ? 'opacity-100 text-red-500 bg-red-50 dark:bg-red-500/10' : 'text-gray-400 hover:text-red-500'}`}
                onClick={() => withConfirm(key, () => removeWelcomeMsg(i))}
              >
                {confirming ? '确认?' : <X className="w-3 h-3" />}
              </button>
            </div>
            );
          })}
          {(config.GeneralWelcomeMsgs ?? []).length === 0 && (
            <div className="py-5 text-center opacity-30 text-[11px]">暂无模板，请添加或从下方快速选择</div>
          )}
        </div>

        {/* 自定义输入 */}
        <div className="flex gap-2">
          <Input
            value={newWelcomeMsg}
            onChange={e => setNewWelcomeMsg(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addWelcomeMsg(newWelcomeMsg)}
            placeholder="自定义欢迎语，支持 {user}"
            className="flex-1 h-9 text-[11px]"
          />
          <button
            onClick={() => addWelcomeMsg(newWelcomeMsg)}
            className="w-9 h-9 rounded-lg bg-[var(--primary-color)] text-white flex items-center justify-center hover:opacity-90 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 预设模板 */}
        <div className="space-y-1.5">
          <div className="text-[10px] text-gray-400 font-medium">快速添加预设：</div>
          <div className="flex flex-wrap gap-1.5">
            {WELCOME_PRESETS.map((preset, i) => {
              const already = (config.GeneralWelcomeMsgs ?? []).includes(preset);
              return (
                <button
                  key={i}
                  onClick={() => !already && addWelcomeMsg(preset)}
                  disabled={already}
                  title={preset}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all max-w-[180px] truncate ${
                    already
                      ? 'bg-[var(--primary-color)]/10 border-[var(--primary-color)]/20 text-[var(--primary-color)] opacity-50 cursor-default'
                      : 'bg-black/5 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:border-[var(--primary-color)]/40 hover:text-[var(--primary-color)]'
                  }`}
                >
                  {already ? '✓ ' : '+ '}{preset}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-px bg-gradient-to-r from-blue-400/40 via-blue-400/15 to-transparent" />

      {/* 特定欢迎语 */}
      <div className="space-y-3">
        <div>
          <div className="text-[12px] font-semibold">特定欢迎语</div>
          <div className="text-[10px] text-gray-500 mt-0.5">按 UID 精准匹配，优先于通用欢迎语触发</div>
        </div>

        {/* 添加表单 */}
        <div className="flex items-stretch rounded-xl border border-gray-200/80 dark:border-white/10 overflow-hidden bg-white/60 dark:bg-white/5">
          <div className="flex items-center gap-1.5 px-3 w-[115px] shrink-0 border-r border-gray-200/80 dark:border-white/10">
            <Hash className="w-3 h-3 text-gray-300 shrink-0" />
            <input
              value={newSpecialUid}
              onChange={e => setNewSpecialUid(e.target.value)}
              placeholder="UID"
              className="w-full h-[40px] text-[11px] font-mono bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-300 dark:placeholder:text-gray-600"
            />
          </div>
          <input
            value={newSpecialMsg}
            onChange={e => setNewSpecialMsg(e.target.value)}
            placeholder="专属欢迎弹幕，支持 {user}"
            className="flex-1 h-[40px] px-3 text-[11px] bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-300 dark:placeholder:text-gray-600"
            onKeyDown={e => e.key === 'Enter' && addSpecialWelcome()}
          />
          <button
            onClick={addSpecialWelcome}
            className="w-[42px] bg-[var(--primary-color)] text-white flex items-center justify-center hover:opacity-90 transition-opacity shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 列表 */}
        <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
          {(config.SpecialWelcomeList ?? []).map((entry: SpecialWelcomeEntry, i: number) => (
            <div key={entry.Uid} className="flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-white/50 dark:bg-white/5 border-gray-200/60 dark:border-white/10 group animate-item-in" style={{ animationDelay: `${i * 25}ms` }}>
              <div className="flex items-center gap-1.5 shrink-0">
                <Hash className="w-3 h-3 text-gray-400" />
                <span className="text-[11px] font-mono font-bold text-[var(--primary-color)]">{entry.Uid}</span>
              </div>
              <span className="text-[11px] flex-1 truncate text-gray-600 dark:text-gray-300">{entry.Msg}</span>
              {(() => { const key = `special-${i}`; const conf = confirmingDelete === key; return (
              <button className={`opacity-0 group-hover:opacity-100 transition-all text-[10px] font-bold px-1.5 py-0.5 rounded-md ${conf ? 'opacity-100 text-red-500 bg-red-50 dark:bg-red-500/10' : 'text-gray-400 hover:text-red-500'}`}
                onClick={() => withConfirm(key, () => removeSpecialWelcome(i))}>
                {conf ? '确认?' : <X className="w-3.5 h-3.5" />}
              </button>); })()}
            </div>
          ))}
          {(config.SpecialWelcomeList ?? []).length === 0 && (
            <div className="py-8 text-center opacity-30 text-[11px]">暂无特定欢迎配置</div>
          )}
        </div>
      </div>
    </div>
  );

  const FansTab = (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-medium">关注感谢</div>
            <div className="text-[10px] text-gray-400">新增关注时自动发送感谢弹幕</div>
          </div>
          <Toggle checked={config.ThanksFocus ?? false} onChange={() => toggle('ThanksFocus')} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-medium">分享感谢</div>
            <div className="text-[10px] text-gray-400">分享直播间时自动发送感谢弹幕</div>
          </div>
          <Toggle checked={config.ThanksShare ?? false} onChange={() => toggle('ThanksShare')} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-medium">醒目留言感谢 (SC)</div>
            <div className="text-[10px] text-gray-400">收到醒目留言时自动发送感谢弹幕</div>
          </div>
          <Toggle checked={config.ThanksSuperChat ?? false} onChange={() => toggle('ThanksSuperChat')} />
        </div>
      </div>

      <div className="h-px bg-gradient-to-r from-blue-400/40 via-blue-400/15 to-transparent" />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-gray-500 font-bold">关注/分享答谢附言（随机选一条追加到感谢后）</label>
          <span className="text-[10px] text-gray-400">{config.FocusDanmu?.length ?? 0} 条</span>
        </div>
        <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1">
          {(config.FocusDanmu ?? []).map((t, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/50 dark:bg-white/5 border border-gray-200/60 dark:border-white/10 group">
              <span className="flex-1 text-[11px] truncate">{t}</span>
              {(() => { const key = `focus-${i}`; const conf = confirmingDelete === key; return (
              <button className={`opacity-0 group-hover:opacity-100 transition-all text-[10px] font-bold px-1.5 py-0.5 rounded-md ${conf ? 'opacity-100 text-red-500 bg-red-50 dark:bg-red-500/10' : 'text-gray-400 hover:text-red-500'}`}
                onClick={() => withConfirm(key, () => save({ ...config, FocusDanmu: (config.FocusDanmu ?? []).filter((_, j) => j !== i) }))}>
                {conf ? '确认?' : <X className="w-3 h-3" />}
              </button>); })()}
            </div>
          ))}
          {(config.FocusDanmu ?? []).length === 0 && (
            <div className="py-6 text-center opacity-30 text-[12px]">暂无附言模板</div>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={newFocusTemplate}
            onChange={e => setNewFocusTemplate(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newFocusTemplate.trim()) {
                save({ ...config, FocusDanmu: [...(config.FocusDanmu ?? []), newFocusTemplate.trim()] });
                setNewFocusTemplate('');
              }
            }}
            placeholder="欢迎加入我的大家庭~"
            className="flex-1 h-9 text-[11px]"
          />
          <button
            onClick={() => {
              if (!newFocusTemplate.trim()) return;
              save({ ...config, FocusDanmu: [...(config.FocusDanmu ?? []), newFocusTemplate.trim()] });
              setNewFocusTemplate('');
            }}
            className="w-9 h-9 rounded-lg bg-[var(--primary-color)] text-white flex items-center justify-center hover:opacity-90 transition-opacity shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  const GiftTab = (
    <div className="space-y-4">
      {/* ── 基础感谢 ── */}
      <div className="bg-black/[0.02] dark:bg-white/[0.02] rounded-2xl p-4 border border-black/5 dark:border-white/5 space-y-4">
        <div className="flex items-center gap-2">
          <Gift className="w-3.5 h-3.5 text-[var(--primary-color)]" />
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-gray-500 flex-1">基础感谢</h3>
          <Toggle checked={config.ThanksGift ?? false} onChange={() => toggle('ThanksGift')} />
        </div>
        <div className="h-px bg-black/5 dark:bg-white/5" />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold">最低感谢价值</div>
            <div className="text-[10px] text-gray-400">低于此价值（电池）的礼物不触发</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => save({ ...config, ThanksMinCost: Math.max(0, (config.ThanksMinCost ?? 0) - 10) })} className="w-7 h-7 rounded-lg bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 hover:bg-gray-50 flex items-center justify-center text-[12px] shadow-sm">−</button>
            <span className="font-mono text-[12px] w-8 text-center">{config.ThanksMinCost ?? 0}</span>
            <button onClick={() => save({ ...config, ThanksMinCost: (config.ThanksMinCost ?? 0) + 10 })} className="w-7 h-7 rounded-lg bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 hover:bg-gray-50 flex items-center justify-center text-[12px] shadow-sm">+</button>
          </div>
        </div>
      </div>

      {/* ── 聚合策略 ── */}
      <div className="bg-black/[0.02] dark:bg-white/[0.02] rounded-2xl p-4 border border-black/5 dark:border-white/5 space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[var(--primary-color)]" />
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-gray-500 flex-1">聚合策略</h3>
          <Toggle checked={config.GiftSummaryThanks ?? false} onChange={() => toggle('GiftSummaryThanks')} />
        </div>
        <div className="h-px bg-black/5 dark:bg-white/5" />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold">聚合等待时间</div>
            <div className="text-[10px] text-gray-400">收到礼物后等待更多礼物的时长</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => save({ ...config, ThanksGiftTimeout: Math.max(0, (config.ThanksGiftTimeout ?? 3) - 1) })} className="w-7 h-7 rounded-lg bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 hover:bg-gray-50 flex items-center justify-center text-[12px] shadow-sm">−</button>
            <span className="font-mono text-[12px] w-8 text-center">{config.ThanksGiftTimeout ?? 3}s</span>
            <button onClick={() => save({ ...config, ThanksGiftTimeout: (config.ThanksGiftTimeout ?? 3) + 1 })} className="w-7 h-7 rounded-lg bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 hover:bg-gray-50 flex items-center justify-center text-[12px] shadow-sm">+</button>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-tight">聚合感谢模板</div>
          <Input
            value={config.GiftSummaryTemplate ?? ''}
            onChange={e => setConfig({ ...config, GiftSummaryTemplate: e.target.value })}
            onBlur={() => save(config!)}
            className="h-9 text-[11px] bg-white dark:bg-white/5"
            placeholder="本轮收到 {count} 件礼物，价值 {value} 电池"
          />
        </div>
      </div>

      {/* ── 特定礼物模板（可折叠）── */}
      <div className="rounded-2xl border border-black/5 dark:border-white/5 overflow-hidden">
        <button
          className="w-full flex items-center gap-2 p-4 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
          onClick={() => setGiftTemplatesOpen(o => !o)}
        >
          <MessageSquare className="w-3.5 h-3.5 text-[var(--primary-color)]" />
          <span className="text-[12px] font-bold uppercase tracking-wider text-gray-500 flex-1 text-left">特定礼物模板</span>
          <span className="text-[10px] text-gray-400 mr-1">{Object.keys(config.GiftThanksTemplates ?? {}).length} 条</span>
          <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${giftTemplatesOpen ? 'rotate-180' : ''}`} />
        </button>
        {giftTemplatesOpen && (
          <div className="p-4 space-y-3 bg-black/[0.01] dark:bg-white/[0.01]">
            <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
              {Object.entries(config.GiftThanksTemplates ?? {}).map(([gift, tmpl]) => (
                <div key={gift} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-white/10 border border-black/5 dark:border-white/5 group animate-item-in">
                  <span className="text-[11px] font-bold text-[var(--primary-color)] w-16 truncate">{gift}</span>
                  <span className="flex-1 text-[11px] truncate opacity-70 italic">{tmpl}</span>
                  {(() => { const key = `gtmpl-${gift}`; const conf = confirmingDelete === key; return (
                  <button className={`opacity-0 group-hover:opacity-100 transition-all text-[10px] font-bold px-1.5 py-0.5 rounded-md ${conf ? 'opacity-100 text-red-500 bg-red-50 dark:bg-red-500/10' : 'text-gray-400 hover:text-red-500'}`}
                    onClick={() => withConfirm(key, () => { const next = { ...config.GiftThanksTemplates }; delete next[gift]; save({ ...config, GiftThanksTemplates: next }); })}>
                    {conf ? '确认?' : <X className="w-3.5 h-3.5" />}
                  </button>); })()}
                </div>
              ))}
              {Object.keys(config.GiftThanksTemplates ?? {}).length === 0 && (
                <div className="py-4 text-center text-[10px] text-gray-400 italic">暂无特定模板</div>
              )}
            </div>
            <div className="flex gap-2">
              <Input id="gift-tmpl-name" placeholder="礼物名" className="w-20 h-9 text-[11px] bg-white dark:bg-white/5" />
              <Input id="gift-tmpl-val" placeholder="感谢模板" className="flex-1 h-9 text-[11px] bg-white dark:bg-white/5" />
              <button onClick={() => {
                const name = (document.getElementById('gift-tmpl-name') as HTMLInputElement).value.trim();
                const val = (document.getElementById('gift-tmpl-val') as HTMLInputElement).value.trim();
                if (name && val) {
                  save({ ...config, GiftThanksTemplates: { ...config.GiftThanksTemplates, [name]: val } });
                  (document.getElementById('gift-tmpl-name') as HTMLInputElement).value = '';
                  (document.getElementById('gift-tmpl-val') as HTMLInputElement).value = '';
                }
              }} className="w-9 h-9 rounded-xl bg-[var(--primary-color)] text-white flex items-center justify-center hover:opacity-90 shadow-sm shrink-0">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 礼物别名（可折叠）── */}
      <div className="rounded-2xl border border-black/5 dark:border-white/5 overflow-hidden">
        <button
          className="w-full flex items-center gap-2 p-4 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
          onClick={() => setGiftAliasOpen(o => !o)}
        >
          <Hash className="w-3.5 h-3.5 text-[var(--primary-color)]" />
          <span className="text-[12px] font-bold uppercase tracking-wider text-gray-500 flex-1 text-left">礼物别名</span>
          <span className="text-[10px] text-gray-400 mr-1">{Object.keys(config.GiftAliases ?? {}).length} 条</span>
          <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${giftAliasOpen ? 'rotate-180' : ''}`} />
        </button>
        {giftAliasOpen && (
          <div className="p-4 space-y-3 bg-black/[0.01] dark:bg-white/[0.01]">
            <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
              {Object.entries(config.GiftAliases ?? {}).map(([gift, alias]) => (
                <div key={gift} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-white/10 border border-black/5 dark:border-white/5 group animate-item-in">
                  <span className="text-[11px] font-bold w-16 truncate">{gift}</span>
                  <span className="text-[10px] text-gray-400">→</span>
                  <span className="flex-1 text-[11px] truncate text-[var(--primary-color)] font-medium">{alias}</span>
                  {(() => { const key = `galias-${gift}`; const conf = confirmingDelete === key; return (
                  <button className={`opacity-0 group-hover:opacity-100 transition-all text-[10px] font-bold px-1.5 py-0.5 rounded-md ${conf ? 'opacity-100 text-red-500 bg-red-50 dark:bg-red-500/10' : 'text-gray-400 hover:text-red-500'}`}
                    onClick={() => withConfirm(key, () => { const next = { ...config.GiftAliases }; delete next[gift]; save({ ...config, GiftAliases: next }); })}>
                    {conf ? '确认?' : <X className="w-3.5 h-3.5" />}
                  </button>); })()}
                </div>
              ))}
              {Object.keys(config.GiftAliases ?? {}).length === 0 && (
                <div className="py-4 text-center text-[10px] text-gray-400 italic">暂无别名配置</div>
              )}
            </div>
            <div className="flex gap-2">
              <Input id="gift-alias-name" placeholder="原名" className="w-20 h-9 text-[11px] bg-white dark:bg-white/5" />
              <Input id="gift-alias-val" placeholder="别名" className="flex-1 h-9 text-[11px] bg-white dark:bg-white/5" />
              <button onClick={() => {
                const name = (document.getElementById('gift-alias-name') as HTMLInputElement).value.trim();
                const val = (document.getElementById('gift-alias-val') as HTMLInputElement).value.trim();
                if (name && val) {
                  save({ ...config, GiftAliases: { ...config.GiftAliases, [name]: val } });
                  (document.getElementById('gift-alias-name') as HTMLInputElement).value = '';
                  (document.getElementById('gift-alias-val') as HTMLInputElement).value = '';
                }
              }} className="w-9 h-9 rounded-xl bg-[var(--primary-color)] text-white flex items-center justify-center hover:opacity-90 shadow-sm shrink-0">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const TimedTab = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[12px] font-medium">定时任务</span>
          <span className="text-[10px] text-gray-500 ml-2">按固定频率或 Cron 表达式自动发送弹幕</span>
        </div>
        <Toggle checked={config.CronDanmu} onChange={() => toggle('CronDanmu')} />
      </div>

      {/* Single-row input area */}
      <div className="flex items-center gap-2 p-3 rounded-2xl bg-black/5 dark:bg-white/5 border border-dashed border-gray-300 dark:border-white/10">
        {/* Mode toggle */}
        <div className="flex p-0.5 rounded-lg bg-black/8 dark:bg-white/10 border border-black/5 shrink-0">
          <button onClick={() => setTimedMode('freq')} className={`h-[26px] px-2.5 rounded-md text-[10px] font-bold transition-all ${timedMode === 'freq' ? 'bg-white dark:bg-white/20 shadow-sm text-[var(--primary-color)]' : 'text-gray-500'}`}>频率</button>
          <button onClick={() => setTimedMode('cron')} className={`h-[26px] px-2.5 rounded-md text-[10px] font-bold transition-all ${timedMode === 'cron' ? 'bg-white dark:bg-white/20 shadow-sm text-[var(--primary-color)]' : 'text-gray-500'}`}>表达式</button>
        </div>

        {/* Frequency or Cron input */}
        {timedMode === 'freq' ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] text-gray-500">每</span>
            <Input value={freqNum} onChange={e => setFreqNum(e.target.value)} className="w-14 h-[30px] text-center text-[11px]" placeholder="30" />
            <select value={freqUnit} onChange={e => setFreqUnit(e.target.value as any)} className="h-[30px] px-1.5 rounded-lg bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[11px] font-bold outline-none">
              <option value="s">秒</option>
              <option value="m">分钟</option>
            </select>
          </div>
        ) : (
          <Input value={newCron} onChange={e => setNewCron(e.target.value)} className="w-[180px] h-[30px] text-[10px] font-mono shrink-0" placeholder="*/30 * * * * *（每30秒）" />
        )}

        {/* Message input */}
        <Input
          value={newCronMsg}
          onChange={e => setNewCronMsg(e.target.value)}
          className="flex-1 h-[30px] text-[11px]"
          placeholder="定时发送的弹幕内容..."
          onKeyDown={e => e.key === 'Enter' && addTimedTask()}
        />

        {/* Add button */}
        <button
          onClick={addTimedTask}
          className="h-[30px] px-3.5 rounded-lg bg-[var(--primary-color)] text-white text-[11px] font-bold hover:opacity-90 transition-opacity shrink-0"
        >
          添加
        </button>
      </div>

      <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
        {config.CronDanmuList.map((task, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-white/50 dark:bg-white/5 border-gray-200/60 dark:border-white/10 group">
            <div className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/5 text-[10px] font-mono font-bold text-[var(--primary-color)] shrink-0">{cronToNatural(task.Cron)}</div>
            <span className="text-[12px] flex-1 truncate font-medium">{task.Danmu[0]}</span>
            {(() => { const key = `timed-${i}`; const conf = confirmingDelete === key; return (
            <button className={`opacity-0 group-hover:opacity-100 transition-all text-[10px] font-bold px-1.5 py-0.5 rounded-md ${conf ? 'opacity-100 text-red-500 bg-red-50 dark:bg-red-500/10' : 'text-gray-400 hover:text-red-500'}`}
              onClick={() => withConfirm(key, () => removeTimedTask(i))}>
              {conf ? '确认?' : <X className="w-4 h-4" />}
            </button>); })()}
          </div>
        ))}
        {config.CronDanmuList.length === 0 && (
          <div className="py-10 text-center opacity-30 text-[12px]">暂无定时任务</div>
        )}
      </div>
    </div>
  );

  const FilterTab = (
    <div className="space-y-4">
      {/* Global toggle — card style */}
      <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-red-500/6 dark:bg-red-500/8 border border-red-200/40 dark:border-red-500/18">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-red-500/12 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-red-500" />
          </div>
          <div>
            <div className="text-[12px] font-semibold">全局过滤</div>
            <div className="text-[10px] text-gray-500">满足条件的弹幕或用户不触发任何自动互动</div>
          </div>
        </div>
        <Toggle checked={config.DanmuFilterEnable} onChange={() => toggle('DanmuFilterEnable')} />
      </div>

      {/* Three columns */}
      <div className="grid grid-cols-3 gap-3">
        {/* UID 黑名单 */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
            <span className="text-[11px] font-black text-gray-500 uppercase tracking-widest">UID 黑名单</span>
          </div>
          <div className="flex gap-1.5">
            <Input value={blackUidInput} onChange={e => setBlackUidInput(e.target.value)} placeholder="用户 UID" className="flex-1 h-8 text-[11px] font-mono" onKeyDown={e => e.key === 'Enter' && addBlackUid()} />
            <button onClick={addBlackUid} className="w-8 h-8 rounded-lg bg-[var(--primary-color)] text-white flex items-center justify-center shrink-0"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex flex-wrap gap-1 max-h-[180px] overflow-y-auto">
            {config.PermanentBlacklistUsers.map(uid => (
              <span key={uid} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-500/10 border border-red-200/60 dark:border-red-500/20 text-[10px] font-mono text-red-600 dark:text-red-400 group">
                {uid}
                <button onClick={() => save({ ...config, PermanentBlacklistUsers: config.PermanentBlacklistUsers.filter(u => u !== uid) })} className="opacity-40 hover:opacity-100 text-red-500 ml-0.5">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
            {config.PermanentBlacklistUsers.length === 0 && <span className="text-[10px] text-gray-400 italic">暂无</span>}
          </div>
        </div>

        {/* 昵称黑名单 */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <UserX className="w-3 h-3 text-orange-400 shrink-0" />
            <span className="text-[11px] font-black text-gray-500 uppercase tracking-widest">昵称屏蔽词</span>
          </div>
          <div className="flex gap-1.5">
            <Input value={blackNameInput} onChange={e => setBlackNameInput(e.target.value)} placeholder="昵称含..." className="flex-1 h-8 text-[11px]" onKeyDown={e => e.key === 'Enter' && addBlackName()} />
            <button onClick={addBlackName} className="w-8 h-8 rounded-lg bg-[var(--primary-color)] text-white flex items-center justify-center shrink-0"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex flex-wrap gap-1 max-h-[180px] overflow-y-auto">
            {config.PermanentBlacklistNames.map(name => (
              <span key={name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 dark:bg-orange-500/10 border border-orange-200/60 dark:border-orange-500/20 text-[10px] text-orange-700 dark:text-orange-400 group max-w-full" title={name}>
                <span className="truncate max-w-[80px]">{name}</span>
                <button onClick={() => save({ ...config, PermanentBlacklistNames: config.PermanentBlacklistNames.filter(n => n !== name) })} className="opacity-40 hover:opacity-100 text-orange-500 ml-0.5 shrink-0">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
            {config.PermanentBlacklistNames.length === 0 && <span className="text-[10px] text-gray-400 italic">暂无</span>}
          </div>
        </div>

        {/* 弹幕敏感词 */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
            <span className="text-[11px] font-black text-gray-500 uppercase tracking-widest">弹幕敏感词</span>
          </div>
          <div className="flex gap-1.5">
            <Input value={filterWordInput} onChange={e => setFilterWordInput(e.target.value)} placeholder="关键词" className="flex-1 h-8 text-[11px]" onKeyDown={e => e.key === 'Enter' && addFilterWord()} />
            <button onClick={addFilterWord} className="w-8 h-8 rounded-lg bg-[var(--primary-color)] text-white flex items-center justify-center shrink-0"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex flex-wrap gap-1 max-h-[180px] overflow-y-auto">
            {config.DanmuFilterWords.map(word => (
              <span key={word} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200/60 dark:border-yellow-500/20 text-[10px] text-yellow-700 dark:text-yellow-400 group max-w-full" title={word}>
                <span className="truncate max-w-[80px]">{word}</span>
                <button onClick={() => save({ ...config, DanmuFilterWords: config.DanmuFilterWords.filter(w => w !== word) })} className="opacity-40 hover:opacity-100 text-yellow-500 ml-0.5 shrink-0">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
            {config.DanmuFilterWords.length === 0 && <span className="text-[10px] text-gray-400 italic">暂无</span>}
          </div>
        </div>
      </div>
    </div>
  );

  const SystemTab = (
    <div className="space-y-5">
      {/* Left-right message boxes */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-gray-200/60 dark:border-white/10">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">进入直播间</label>
            <textarea
              className="w-full h-[72px] px-3 py-2 rounded-xl bg-white/70 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[11px] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/40 leading-relaxed"
              value={config.EntryMsg ?? ''}
              onChange={e => setConfig({ ...config, EntryMsg: e.target.value })}
              placeholder="机器人进入直播间时发送…"
            />
          </div>
          <div className="space-y-1.5 p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-gray-200/60 dark:border-white/10">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">下播提示</label>
            <textarea
              className="w-full h-[72px] px-3 py-2 rounded-xl bg-white/70 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[11px] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/40 leading-relaxed"
              value={config.GoodbyeInfo ?? ''}
              onChange={e => setConfig({ ...config, GoodbyeInfo: e.target.value })}
              placeholder="下播时发送的感谢语…"
            />
          </div>
        </div>
        <Button size="sm" variant="primary" className="h-8 px-5 text-[11px]" onClick={() => save(config)}>保存</Button>
      </div>

      <div className="h-px bg-gradient-to-r from-blue-400/40 via-blue-400/15 to-transparent" />

      {/* 互动过滤 toggles */}
      <div className="space-y-1">
        <div className="text-[12px] font-semibold mb-2">欢迎过滤</div>
        <div className="space-y-2 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-gray-200/60 dark:border-white/10 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-[12px] font-medium">欢迎自己</div>
              <div className="text-[10px] text-gray-400">开启后，主播自己进入直播间时触发通用欢迎</div>
            </div>
            <Toggle checked={config.InteractSelf ?? false} onChange={v => save({ ...config, InteractSelf: v })} />
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-[12px] font-medium">欢迎主播</div>
              <div className="text-[10px] text-gray-400">开启后，主播账号进入直播间时触发通用欢迎</div>
            </div>
            <Toggle checked={config.InteractAnchor ?? false} onChange={v => save({ ...config, InteractAnchor: v })} />
          </div>
        </div>
      </div>
    </div>
  );

  const CONTENT: Record<TabId, JSX.Element> = {
    welcome: WelcomeTab,
    fans:    FansTab,
    gift:    GiftTab,
    timed:   TimedTab,
    filter:  FilterTab,
    system:  SystemTab,
  };

  const activeColor = TABS.find(t => t.id === activeTab)?.color ?? 'var(--primary-color)';

  return (
    <div className="p-5 h-full flex flex-col">
      <GlassCard className="flex-1 p-5 flex flex-col overflow-hidden border-white/60 dark:border-white/10" style={{ '--tab-color': activeColor } as React.CSSProperties}>
        <div className="flex gap-1.5 mb-5 p-1.5 rounded-2xl bg-black/5 dark:bg-black/20 shrink-0 overflow-x-auto scrollbar-none">
          {TABS.map(({ id, label, Icon, color }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 min-w-[72px] flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-[11px] font-bold transition-all ${
                activeTab === id
                  ? 'bg-white dark:bg-white/20 shadow-md'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              style={activeTab === id ? { color } : undefined}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        {/* Colored accent bar matching active tab */}
        <div className="h-px mb-4 rounded-full shrink-0 transition-all duration-300" style={{ background: `linear-gradient(90deg, ${activeColor}60, ${activeColor}20, transparent)` }} />

        <div key={activeTab} className="animate-tab-in flex-1 overflow-y-auto pr-2 scrollbar-none">
          {CONTENT[activeTab]}
        </div>
      </GlassCard>
    </div>
  );
}
