import { useState, useEffect } from 'react';
import { Plus, X, Clock, ShieldCheck, Gift, Heart, Activity } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api, AppConfig } from '../lib/api';
import { toast } from 'sonner';

type TabId = 'gift' | 'fans' | 'timed' | 'filter' | 'system';

const TABS: { id: TabId; label: string; Icon: any }[] = [
  { id: 'gift',      label: '礼物感谢', Icon: Gift },
  { id: 'fans',      label: '粉丝互动', Icon: Heart },
  { id: 'timed',     label: '定时任务', Icon: Clock },
  { id: 'filter',    label: '过滤防护', Icon: ShieldCheck },
  { id: 'system',    label: '系统事件', Icon: Activity },
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
  const [activeTab, setActiveTab] = useState<TabId>('timed');

  // 定时回复
  const [timedMode, setTimedMode] = useState<'freq' | 'cron'>('freq');
  const [freqNum, setFreqNum] = useState('');
  const [freqUnit, setFreqUnit] = useState<'s' | 'm'>('m');
  const [newCron, setNewCron] = useState('');
  const [newCronMsg, setNewCronMsg] = useState('');

  // 黑名单
  const [blackUidInput, setBlackUidInput] = useState('');
  const [blackNameInput, setBlackNameInput] = useState('');
  const [filterWordInput, setFilterWordInput] = useState('');

  useEffect(() => {
    api.loadConfig().then(setConfig).catch(console.error);
  }, []);

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
    save(
      { ...config, CronDanmuList: (config.CronDanmuList as any[]).filter((_, idx) => idx !== i) },
      '删除成功',
    );
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

  const TimedTab = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[12px] font-medium">定时任务</span>
          <span className="text-[10px] text-gray-500 ml-2">按固定频率或 Cron 表达式自动发送弹幕</span>
        </div>
        <Toggle checked={config.CronDanmu} onChange={() => toggle('CronDanmu')} />
      </div>
      
      <div className="p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-dashed border-gray-300 dark:border-white/10 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex p-1 rounded-xl bg-black/5 dark:bg-white/10 border border-black/5">
            <button onClick={() => setTimedMode('freq')} className={`px-4 py-1.5 rounded-lg text-[11px] font-bold transition-all ${timedMode === 'freq' ? 'bg-white dark:bg-white/20 shadow-sm text-[var(--primary-color)]' : 'text-gray-500'}`}>频率</button>
            <button onClick={() => setTimedMode('cron')} className={`px-4 py-1.5 rounded-lg text-[11px] font-bold transition-all ${timedMode === 'cron' ? 'bg-white dark:bg-white/20 shadow-sm text-[var(--primary-color)]' : 'text-gray-500'}`}>Cron</button>
          </div>
          {timedMode === 'freq' ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">每</span>
              <Input value={freqNum} onChange={e => setFreqNum(e.target.value)} className="w-16 h-8 text-center" placeholder="30" />
              <select value={freqUnit} onChange={e => setFreqUnit(e.target.value as any)} className="bg-transparent text-[11px] font-bold outline-none">
                <option value="s">秒</option>
                <option value="m">分钟</option>
              </select>
            </div>
          ) : (
            <Input value={newCron} onChange={e => setNewCron(e.target.value)} className="flex-1 h-8 text-[11px]" placeholder="*/30 * * * * *" />
          )}
        </div>
        <div className="flex gap-2">
          <Input value={newCronMsg} onChange={e => setNewCronMsg(e.target.value)} className="flex-1 h-9 text-[12px]" placeholder="输入定时发送的内容..." onKeyDown={e => e.key === 'Enter' && addTimedTask()} />
          <Button variant="primary" size="sm" className="h-9 px-6 shrink-0" onClick={addTimedTask}>添加任务</Button>
        </div>
      </div>

      <div className="space-y-1.5 max-h-[350px] overflow-y-auto pr-1">
        {config.CronDanmuList.map((task, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-white/50 dark:bg-white/5 border-gray-200/60 dark:border-white/10 group">
             <div className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/5 text-[10px] font-mono font-bold text-[var(--primary-color)] shrink-0">{cronToNatural(task.Cron)}</div>
             <span className="text-[12px] flex-1 truncate font-medium">{task.Danmu[0]}</span>
             <button className="text-gray-400 hover:text-red-500 transition-colors" onClick={() => removeTimedTask(i)}><X className="w-4 h-4" /></button>
          </div>
        ))}
        {config.CronDanmuList.length === 0 && (
          <div className="py-10 text-center opacity-30 text-[12px]">暂无定时任务</div>
        )}
      </div>
    </div>
  );

  const BlacklistTab = (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[12px] font-medium">全局过滤</span>
          <span className="text-[10px] text-gray-500 ml-2">满足条件的弹幕或用户将不触发任何自动互动</span>
        </div>
        <Toggle checked={config.DanmuFilterEnable} onChange={() => toggle('DanmuFilterEnable')} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* UID 黑名单 */}
        <div className="space-y-3">
          <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">UID 黑名单</label>
          <div className="flex gap-2">
            <Input value={blackUidInput} onChange={e => setBlackUidInput(e.target.value)} placeholder="UID" className="h-8 text-[11px]" onKeyDown={e => e.key === 'Enter' && addBlackUid()} />
            <button onClick={addBlackUid} className="w-8 h-8 rounded-lg bg-[var(--primary-color)] text-white flex items-center justify-center shrink-0"><Plus className="w-4 h-4" /></button>
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
            {config.PermanentBlacklistUsers.map(uid => (
              <div key={uid} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 group">
                <span className="text-[11px] font-mono">{uid}</span>
                <button onClick={() => save({ ...config, PermanentBlacklistUsers: config.PermanentBlacklistUsers.filter(u => u !== uid) })} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* 昵称黑名单 */}
        <div className="space-y-3">
          <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">昵称关键词</label>
          <div className="flex gap-2">
            <Input value={blackNameInput} onChange={e => setBlackNameInput(e.target.value)} placeholder="昵称含..." className="h-8 text-[11px]" onKeyDown={e => e.key === 'Enter' && addBlackName()} />
            <button onClick={addBlackName} className="w-8 h-8 rounded-lg bg-[var(--primary-color)] text-white flex items-center justify-center shrink-0"><Plus className="w-4 h-4" /></button>
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
            {config.PermanentBlacklistNames.map(name => (
              <div key={name} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 group">
                <span className="text-[11px] truncate">{name}</span>
                <button onClick={() => save({ ...config, PermanentBlacklistNames: config.PermanentBlacklistNames.filter(n => n !== name) })} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* 弹幕过滤 */}
        <div className="space-y-3">
          <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">弹幕敏感词</label>
          <div className="flex gap-2">
            <Input value={filterWordInput} onChange={e => setFilterWordInput(e.target.value)} placeholder="关键词" className="h-8 text-[11px]" onKeyDown={e => e.key === 'Enter' && addFilterWord()} />
            <button onClick={addFilterWord} className="w-8 h-8 rounded-lg bg-[var(--primary-color)] text-white flex items-center justify-center shrink-0"><Plus className="w-4 h-4" /></button>
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
            {config.DanmuFilterWords.map(word => (
              <div key={word} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 group">
                <span className="text-[11px] truncate">{word}</span>
                <button onClick={() => save({ ...config, DanmuFilterWords: config.DanmuFilterWords.filter(w => w !== word) })} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const CONTENT: Record<TabId, JSX.Element> = {
    gift:      <div className="text-center py-20 text-gray-400 italic">礼物感谢配置正在开发中...</div>,
    fans:      <div className="text-center py-20 text-gray-400 italic">粉丝互动配置正在开发中...</div>,
    timed:     TimedTab,
    filter:    BlacklistTab,
    system:    <div className="text-center py-20 text-gray-400 italic">系统事件配置正在开发中...</div>,
  };

  return (
    <div className="p-5 h-full flex flex-col">
      <GlassCard className="flex-1 p-5 flex flex-col overflow-hidden border-white/60 dark:border-white/10">
        <div className="flex gap-2 mb-6 p-1.5 rounded-2xl bg-black/5 dark:bg-black/20 shrink-0 overflow-x-auto scrollbar-none">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 min-w-[80px] flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-[12px] font-bold transition-all ${
                activeTab === id
                  ? 'bg-white dark:bg-white/20 shadow-md text-[var(--primary-color)]'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto pr-2 scrollbar-none">
          {CONTENT[activeTab]}
        </div>
      </GlassCard>
    </div>
  );
}
