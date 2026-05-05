import { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Toggle } from '../components/Toggle';
import { api, AppConfig } from '../lib/api';
import { toast } from 'sonner';

export function AutoReply() {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    api.loadConfig().then(setConfig).catch(console.error);
  }, []);

  const saveConfig = async (newConfig: AppConfig) => {
    try {
      await api.saveConfig(newConfig);
      setConfig(newConfig);
      toast.success('配置已保存');
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    }
  };

  const toggleField = (key: keyof AppConfig) => {
    if (!config) return;
    saveConfig({ ...config, [key]: !config[key] });
  };

  if (!config) return <div className="p-4">加载中...</div>;

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-4">
        {/* 关键词匹配 */}
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-blue-500 flex items-center justify-center">
                <span className="text-white text-[10px]">📝</span>
              </div>
              <h2 className="text-[14px] font-semibold">关键词回复</h2>
            </div>
            <Toggle checked={config.KeywordReply} onChange={() => toggleField('KeywordReply')} />
          </div>

          <div className="space-y-2 mb-3 max-h-[400px] overflow-y-auto">
            {Object.entries(config.KeywordReplyList).map(([trigger, reply], i) => (
              <div key={i} className="p-3 rounded-lg bg-white/40 dark:bg-white/5 border border-gray-200/50 dark:border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-500">关键词</span>
                    <Chip variant="default" className="text-[11px]">{trigger}</Chip>
                  </div>
                  <button 
                    className="text-gray-400 hover:text-red-500"
                    onClick={() => {
                      const newList = { ...config.KeywordReplyList };
                      delete newList[trigger];
                      saveConfig({ ...config, KeywordReplyList: newList });
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-gray-500 mt-0.5">回复</span>
                  <span className="text-[12px] flex-1">{reply}</span>
                </div>
              </div>
            ))}
          </div>

          <Button variant="default" size="sm" className="w-full" onClick={() => toast.info('请在配置文件中编辑更多复杂规则')}>
            <Plus className="w-3.5 h-3.5" />
            添加关键词 (开发中)
          </Button>
        </GlassCard>

        {/* 自动欢迎 */}
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-green-500 flex items-center justify-center">
                <span className="text-white text-[10px]">👋</span>
              </div>
              <h2 className="text-[14px] font-semibold">自动欢迎</h2>
            </div>
            <Toggle checked={config.WelcomeSwitch} onChange={() => toggleField('WelcomeSwitch')} />
          </div>

          <div className="space-y-3">
             <div className="text-[11px] text-gray-500">
               启用后，当观众进入直播间时，将随机发送以下欢迎语：
             </div>
             <div className="space-y-1">
               {config.WelcomeDanmu.map((msg, i) => (
                 <div key={i} className="text-[12px] p-2 rounded bg-white/20 dark:bg-white/5">
                   {msg}
                 </div>
               ))}
             </div>
             <div className="flex items-center justify-between pt-2">
               <span className="text-[11px] text-gray-500">使用 @ 观众</span>
               <Toggle checked={config.WelcomeUseAt} onChange={() => toggleField('WelcomeUseAt')} />
             </div>
          </div>
        </GlassCard>

        {/* 礼物答谢 */}
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-orange-500 flex items-center justify-center">
                <span className="text-white text-[10px]">🎁</span>
              </div>
              <h2 className="text-[14px] font-semibold">礼物答谢</h2>
            </div>
            <Toggle checked={config.ThanksGift} onChange={() => toggleField('ThanksGift')} />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">最小感谢价值 (电池)</span>
              <span className="text-[12px] font-mono">{config.ThanksMinCost}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">使用 @ 观众</span>
              <Toggle checked={config.ThanksGiftUseAt} onChange={() => toggleField('ThanksGiftUseAt')} />
            </div>
            <div className="pt-3 border-t border-white/10">
              <div className="text-[11px] text-gray-500 mb-2">感谢模板</div>
              <div className="text-[12px] p-3 rounded-lg bg-white/40 dark:bg-white/5">
                {config.GiftSummaryTemplate || '谢谢大家的礼物！'}
              </div>
            </div>
          </div>
        </GlassCard>

        {/* 发送黑名单 */}
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-red-500 flex items-center justify-center">
                <span className="text-white text-[10px]">🚫</span>
              </div>
              <h2 className="text-[14px] font-semibold">黑名单</h2>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-gray-500">UID 黑名单</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {config.PermanentBlacklistUsers.map((uid, i) => (
                  <Chip key={i} variant="default" className="text-[10px]">
                    {uid}
                    <button className="ml-1 hover:text-red-500" onClick={() => {
                      const newList = config.PermanentBlacklistUsers.filter(id => id !== uid);
                      saveConfig({ ...config, PermanentBlacklistUsers: newList });
                    }}><X className="w-2.5 h-2.5" /></button>
                  </Chip>
                ))}
                {config.PermanentBlacklistUsers.length === 0 && <span className="text-[11px] text-gray-400 italic">暂无</span>}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-gray-500">关键词/昵称黑名单</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {config.PermanentBlacklistNames.map((name, i) => (
                  <Chip key={i} variant="default" className="text-[10px]">
                    {name}
                    <button className="ml-1 hover:text-red-500" onClick={() => {
                      const newList = config.PermanentBlacklistNames.filter(n => n !== name);
                      saveConfig({ ...config, PermanentBlacklistNames: newList });
                    }}><X className="w-2.5 h-2.5" /></button>
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
