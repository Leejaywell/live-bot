import { useState, useEffect } from 'react';
import { Plus, X, Clock, MessageSquare, ShieldOff, User, Pencil, Check } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api, AppConfig } from '../lib/api';
import { toast } from 'sonner';

type TabId = 'welcome' | 'timed' | 'blacklist';

const TABS: { id: TabId; label: string; Icon: typeof Clock }[] = [
  { id: 'welcome',   label: '指定欢迎', Icon: MessageSquare },
  { id: 'timed',     label: '定时回复', Icon: Clock },
  { id: 'blacklist', label: '黑名单',   Icon: ShieldOff },
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
  const [activeTab, setActiveTab] = useState<TabId>('welcome');

  // 指定欢迎
  const [newUid, setNewUid] = useState('');
  const [newWelcomeMsg, setNewWelcomeMsg] = useState('');
  const [editingUid, setEditingUid] = useState<string | null>(null); // 正在编辑的原始UID

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

  // ── 指定欢迎 ──
  const startEdit = (uid: string, msg: string) => {
    setEditingUid(uid);
    setNewUid(uid);
    setNewWelcomeMsg(msg);
  };

  const cancelEdit = () => {
    setEditingUid(null);
    setNewUid('');
    setNewWelcomeMsg('');
  };

  const addOrSaveWelcome = () => {
    const uid = newUid.trim(), msg = newWelcomeMsg.trim();
    if (!uid || !msg) return;
    const next = { ...config.WelcomeString };
    if (editingUid && editingUid !== uid) delete next[editingUid];
    next[uid] = msg;
    save({ ...config, WelcomeString: next }, editingUid ? '修改成功' : '添加成功');
    setEditingUid(null);
    setNewUid('');
    setNewWelcomeMsg('');
  };

  const removeWelcome = (uid: string) => {
    const next = { ...config.WelcomeString };
    delete next[uid];
    save({ ...config, WelcomeString: next }, '删除成功');
    if (editingUid === uid) cancelEdit();
  };

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

  // ── 指定欢迎 Tab ──────────────────────────────────────────────────────────
  const WelcomeTab = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[12px] font-medium">指定人欢迎</span>
          <span className="text-[10px] text-gray-500 ml-2">当指定 UID 进入直播间时发送专属欢迎语</span>
        </div>
        <Toggle checked={config.WelcomeSwitch} onChange={() => toggle('WelcomeSwitch')} />
      </div>

      <div className="flex items-center gap-2 p-3 rounded-xl bg-black/5 dark:bg-black/20 border border-dashed border-gray-300 dark:border-white/10">
        <Input
          value={newUid}
          onChange={e => setNewUid(e.target.value)}
          placeholder="用户 UID"
          className="text-[12px] h-9 w-32 shrink-0"
        />
        <Input
          value={newWelcomeMsg}
          onChange={e => setNewWelcomeMsg(e.target.value)}
          placeholder="专属欢迎语内容"
          className="text-[12px] h-9 flex-1"
          onKeyDown={e => e.key === 'Enter' && addOrSaveWelcome()}
        />
        {editingUid && (
          <Button variant="ghost" size="sm" className="h-9 px-3 shrink-0" onClick={cancelEdit}>
            取消
          </Button>
        )}
        <Button
          variant="primary" size="sm" className="h-9 px-4 shrink-0"
          onClick={addOrSaveWelcome}
          disabled={!newUid.trim() || !newWelcomeMsg.trim()}
        >
          {editingUid ? <><Check className="w-3.5 h-3.5 mr-1" />保存</> : <><Plus className="w-3.5 h-3.5 mr-1" />添加</>}
        </Button>
      </div>

      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {Object.entries(config.WelcomeString).length === 0 && (
          <div className="text-center text-gray-400 text-[11px] italic py-8">暂无指定欢迎规则</div>
        )}
        {Object.entries(config.WelcomeString).map(([uid, msg]) => (
          <div
            key={uid}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border group transition-all ${
              editingUid === uid
                ? 'bg-[var(--primary-color)]/8 border-[var(--primary-color)]/30'
                : 'bg-white/50 dark:bg-white/5 border-gray-200/60 dark:border-white/10'
            }`}
          >
            <div className="flex items-center gap-1.5 shrink-0">
              <User className="w-3 h-3 text-gray-400" />
              <span className="text-[10px] font-mono text-[var(--primary-color)] font-medium">{uid}</span>
            </div>
            <span className="text-gray-300 dark:text-gray-600 text-[10px] shrink-0">→</span>
            <span className="text-[12px] flex-1 min-w-0 truncate">{msg}</span>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-[var(--primary-color)] hover:bg-black/5"
                onClick={() => startEdit(uid, msg)}
                title="编辑"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                onClick={() => removeWelcome(uid)}
                title="删除"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── 定时回复 Tab ──────────────────────────────────────────────────────────
  const TimedTab = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[12px] font-medium">定时任务</span>
          <span className="text-[10px] text-gray-500 ml-2">按固定频率或 Cron 表达式自动发送弹幕</span>
        </div>
        <Toggle checked={config.CronDanmu} onChange={() => toggle('CronDanmu')} />
      </div>

      <div className="flex items-center gap-2 p-3 rounded-xl bg-black/5 dark:bg-black/20 border border-dashed border-gray-300 dark:border-white/10 flex-wrap">
        <div className="flex gap-1 shrink-0">
          {(['freq', 'cron'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setTimedMode(mode)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                timedMode === mode
                  ? 'bg-[var(--primary-color)] text-white border-transparent'
                  : 'bg-white/40 dark:bg-white/10 border-gray-200 dark:border-white/10 text-gray-500'
              }`}
            >
              {mode === 'freq' ? '频率' : 'Cron'}
            </button>
          ))}
        </div>

        {timedMode === 'freq' ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] text-gray-500">每隔</span>
            <Input value={freqNum} onChange={e => setFreqNum(e.target.value)} placeholder="数字" className="text-[12px] h-9 w-16 text-center" />
            <select
              value={freqUnit}
              onChange={e => setFreqUnit(e.target.value as 's' | 'm')}
              className="bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/10 rounded-lg text-[11px] px-2 py-1.5 focus:outline-none"
            >
              <option value="s">秒</option>
              <option value="m">分钟</option>
            </select>
          </div>
        ) : (
          <Input value={newCron} onChange={e => setNewCron(e.target.value)} placeholder="*/5 * * * *" className="text-[11px] h-9 w-36 font-mono shrink-0" />
        )}

        <Input
          value={newCronMsg}
          onChange={e => setNewCronMsg(e.target.value)}
          placeholder="定时发送的弹幕内容"
          className="text-[12px] h-9 flex-1 min-w-[140px]"
          onKeyDown={e => e.key === 'Enter' && addTimedTask()}
        />
        <Button
          variant="primary" size="sm" className="h-9 px-4 shrink-0"
          onClick={addTimedTask}
          disabled={!newCronMsg.trim() || (timedMode === 'freq' ? !freqNum.trim() : !newCron.trim())}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />添加
        </Button>
      </div>

      <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
        {(config.CronDanmuList as any[]).length === 0 && (
          <div className="text-center text-gray-400 text-[11px] italic py-8">暂无定时规则</div>
        )}
        {(config.CronDanmuList as any[]).map((entry: any, i: number) => (
          <div key={i} className="px-3 py-2.5 rounded-xl bg-white/50 dark:bg-white/5 border border-gray-200/60 dark:border-white/10 group">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-[var(--primary-color)]" />
                <span className="text-[11px] font-medium text-[var(--primary-color)]">{cronToNatural(entry.Cron)}</span>
              </div>
              <button
                className="text-gray-300 dark:text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => removeTimedTask(i)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-0.5 pl-5">
              {(entry.Danmu as string[]).map((msg: string, j: number) => (
                <div key={j} className="text-[11px] text-gray-500 dark:text-gray-400 truncate italic">"{msg}"</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── 黑名单 Tab ────────────────────────────────────────────────────────────
  const BlacklistTab = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[12px] font-medium">全局黑名单</span>
          <span className="text-[10px] text-gray-500 ml-2">被拦截的用户将不触发任何自动互动</span>
        </div>
        <Toggle checked={config.DanmuFilterEnable} onChange={() => toggle('DanmuFilterEnable')} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* UID 黑名单 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] text-gray-500 font-medium">UID 黑名单 (精确匹配)</label>
            <span className="text-[10px] text-gray-400">{config.PermanentBlacklistUsers.length} 个</span>
          </div>
          <div className="p-2.5 rounded-xl bg-white/50 dark:bg-white/5 border border-gray-200/60 dark:border-white/10 min-h-[100px] max-h-[200px] flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto flex flex-wrap gap-1.5 content-start mb-2">
              {config.PermanentBlacklistUsers.map((uid, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-[10px] text-red-600 dark:text-red-400 font-mono">
                  {uid}
                  <button onClick={() => save({ ...config, PermanentBlacklistUsers: config.PermanentBlacklistUsers.filter(id => id !== uid) }, '删除成功')}>
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              value={blackUidInput}
              onChange={e => setBlackUidInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addBlackUid()}
              placeholder="输入 UID 后回车添加..."
              className="h-8 text-[11px] w-full shrink-0 bg-black/5 dark:bg-white/8"
            />
          </div>
        </div>

        {/* 昵称黑名单 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] text-gray-500 font-medium">昵称黑名单 (模糊匹配)</label>
            <span className="text-[10px] text-gray-400">{config.PermanentBlacklistNames.length} 个</span>
          </div>
          <div className="p-2.5 rounded-xl bg-white/50 dark:bg-white/5 border border-gray-200/60 dark:border-white/10 min-h-[100px] max-h-[200px] flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto flex flex-wrap gap-1.5 content-start mb-2">
              {config.PermanentBlacklistNames.map((name, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 text-[10px] text-orange-600 dark:text-orange-400">
                  {name}
                  <button onClick={() => save({ ...config, PermanentBlacklistNames: config.PermanentBlacklistNames.filter(n => n !== name) }, '删除成功')}>
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              value={blackNameInput}
              onChange={e => setBlackNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addBlackName()}
              placeholder="输入昵称关键词后回车..."
              className="h-8 text-[11px] w-full shrink-0 bg-black/5 dark:bg-white/8"
            />
          </div>
        </div>
      </div>

      {/* 内容过滤 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] text-gray-500 font-medium">弹幕屏蔽词 (含关键词的弹幕不触发自动回复)</label>
          <span className="text-[10px] text-gray-400">{config.DanmuFilterWords.length} 个</span>
        </div>
        <div className="p-2.5 rounded-xl bg-white/50 dark:bg-white/5 border border-gray-200/60 dark:border-white/10 flex flex-col overflow-hidden">
          <div className="flex flex-wrap gap-1.5 content-start mb-2 min-h-[32px]">
            {config.DanmuFilterWords.map((word, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 text-[10px] text-purple-600 dark:text-purple-400">
                {word}
                <button onClick={() => save({ ...config, DanmuFilterWords: config.DanmuFilterWords.filter((_, j) => j !== i) }, '删除成功')}>
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
          <Input
            value={filterWordInput}
            onChange={e => setFilterWordInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addFilterWord()}
            placeholder="输入屏蔽词后回车添加..."
            className="h-8 text-[11px] w-full shrink-0 bg-black/5 dark:bg-white/8"
          />
        </div>
      </div>

      {/* 重复阈值 */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-white/50 dark:bg-white/5 border border-gray-200/60 dark:border-white/10">
        <div>
          <div className="text-[12px] font-medium">重复弹幕阈值</div>
          <div className="text-[10px] text-gray-400">同一用户发送相同内容达到此次数后停止回复，设为 1 则不限制</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => save({ ...config, DanmuFilterRepeatThreshold: Math.max(1, config.DanmuFilterRepeatThreshold - 1) })}
            className="w-7 h-7 rounded-lg bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 hover:bg-white/80 flex items-center justify-center text-[14px] font-medium transition-colors"
          >
            −
          </button>
          <span className="font-mono text-[13px] w-6 text-center select-none">{config.DanmuFilterRepeatThreshold}</span>
          <button
            onClick={() => save({ ...config, DanmuFilterRepeatThreshold: config.DanmuFilterRepeatThreshold + 1 })}
            className="w-7 h-7 rounded-lg bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 hover:bg-white/80 flex items-center justify-center text-[14px] font-medium transition-colors"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );

  const CONTENT: Record<TabId, JSX.Element> = {
    welcome:   WelcomeTab,
    timed:     TimedTab,
    blacklist: BlacklistTab,
  };

  return (
    <div className="p-4 h-full flex flex-col">
      <GlassCard className="flex-1 p-4 flex flex-col overflow-hidden">
        <div className="flex gap-1 mb-4 p-1 rounded-xl bg-black/5 dark:bg-black/20 shrink-0">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => { setActiveTab(id); if (id !== 'welcome') cancelEdit(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                activeTab === id
                  ? 'bg-white dark:bg-white/20 shadow-sm text-gray-900 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {CONTENT[activeTab]}
        </div>
      </GlassCard>
    </div>
  );
}
