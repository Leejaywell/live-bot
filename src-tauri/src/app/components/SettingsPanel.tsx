import { X, FolderOpen, Database, RefreshCw, Copy, Check, Settings2, Plus, Mic } from 'lucide-react';
import { useState, useEffect } from 'react';
import { GlassCard } from './GlassCard';
import { Button } from './Button';
import { Input } from './Input';
import { Toggle } from './Toggle';
import { api, AppConfig, SystemInfo } from '../lib/api';
import { toast } from 'sonner';

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [copied, setCopied] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [newFocusTemplate, setNewFocusTemplate] = useState('');

  useEffect(() => {
    api.getSystemInfo().then(setSystemInfo).catch(console.error);
    api.loadConfig().then(setConfig).catch(console.error);
  }, []);

  const updateField = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api.saveConfig(config);
      toast.success('保存配置成功');
      onClose();
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openUrl = (url: string) => {
    api.openUrl(url).catch(err => toast.error(`打开失败: ${err}`));
  };

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <GlassCard className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-[15px] font-semibold">设置</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* 基础配置 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Settings2 className="w-4 h-4 text-[var(--primary-color)]" />
              <h3 className="text-[13px] font-semibold">基础配置</h3>
            </div>
            <div className="bg-white/40 dark:bg-white/5 rounded-lg p-4 border border-gray-200 dark:border-white/10 space-y-4">
              {/* 进入直播间提示 */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-gray-500">进入直播间提示：</label>
                <Input
                  value={config?.EntryMsg ?? ''}
                  onChange={e => updateField('EntryMsg', e.target.value)}
                  placeholder="机器人进入直播间时发送的消息"
                />
              </div>

              {/* 下播提示 */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-gray-500">下播提示：</label>
                <Input
                  value={config?.GoodbyeInfo ?? ''}
                  onChange={e => updateField('GoodbyeInfo', e.target.value)}
                  placeholder="下播时发送的感谢语"
                />
              </div>

              {/* AI 助手提示词 */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-gray-500">AI 助手提示词（界面对话使用）：</label>
                <textarea
                  className="w-full h-32 px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[12px] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50 resize-none"
                  value={config?.AiAssistantPrompt ?? ''}
                  onChange={e => updateField('AiAssistantPrompt', e.target.value)}
                  placeholder="AI 界面聊天使用的系统提示词"
                />
              </div>

              {/* 语音交互提示词 */}
              <div className="space-y-2.5">
                <label className="text-[11px] text-gray-500 flex items-center gap-1.5">
                  <Mic className="w-3 h-3" />
                  语音交互设置（连麦模式使用）：
                </label>
                
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] text-gray-400">AI 性别：</span>
                  <div className="flex items-center gap-1 p-0.5 rounded-xl bg-black/5 dark:bg-white/8 border border-gray-200 dark:border-white/12">
                    {(['女AI', '男AI'] as const).map(g => (
                      <button 
                        key={g} 
                        onClick={() => updateField('VoiceGender', g)}
                        className={`h-[24px] px-3 rounded-lg text-[10px] font-medium transition-all ${
                          (config?.VoiceGender ?? '女AI') === g
                            ? 'bg-white dark:bg-white/20 text-[var(--primary-color)] shadow-sm'
                            : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                        }`}>
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  className="w-full h-44 px-3 py-2 rounded-lg bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[12px] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50 resize-none leading-relaxed"
                  value={config?.VoiceSystemPrompt ?? ''}
                  onChange={e => updateField('VoiceSystemPrompt', e.target.value)}
                  placeholder="语音交互模式下 AI 的系统提示词..."
                />
                <p className="text-[10px] text-gray-400">固定用于语音搭子场景，提示词中可使用 {"{{gender}}"} 占位符</p>
              </div>

              {/* 关注答谢附言 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-gray-500">关注/分享答谢附言（随机选一条追加到感谢语后）：</label>
                  <span className="text-[10px] text-gray-400">{config?.FocusDanmu?.length ?? 0} 条</span>
                </div>
                <div className="space-y-1 max-h-[80px] overflow-y-auto">
                  {(config?.FocusDanmu ?? []).map((t, i) => (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-gray-200 dark:border-white/10 group">
                      <span className="flex-1 text-[11px] truncate">{t}</span>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                        onClick={() => updateField('FocusDanmu', (config?.FocusDanmu ?? []).filter((_, j) => j !== i))}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newFocusTemplate}
                    onChange={e => setNewFocusTemplate(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newFocusTemplate.trim()) {
                        updateField('FocusDanmu', [...(config?.FocusDanmu ?? []), newFocusTemplate.trim()]);
                        setNewFocusTemplate('');
                      }
                    }}
                    placeholder="欢迎加入我的大家庭~"
                    className="flex-1 h-8 text-[11px]"
                  />
                  <button
                    onClick={() => {
                      if (!newFocusTemplate.trim()) return;
                      updateField('FocusDanmu', [...(config?.FocusDanmu ?? []), newFocusTemplate.trim()]);
                      setNewFocusTemplate('');
                    }}
                    className="w-8 h-8 rounded-lg bg-[var(--primary-color)] text-white flex items-center justify-center hover:opacity-90 transition-opacity shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 分隔线 */}
              <div className="h-px bg-gray-200 dark:bg-white/10" />

              {/* 不欢迎自己 */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-medium">不欢迎自己</div>
                  <div className="text-[10px] text-gray-400">主播进入自己直播间时不触发欢迎</div>
                </div>
                <Toggle
                  checked={!(config?.InteractSelf ?? true)}
                  onChange={checked => updateField('InteractSelf', !checked)}
                />
              </div>

              {/* 分享感谢 */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-medium">分享感谢</div>
                  <div className="text-[10px] text-gray-400">分享直播间时自动发送感谢</div>
                </div>
                <Toggle
                  checked={config?.ThanksShare ?? true}
                  onChange={checked => updateField('ThanksShare', checked)}
                />
              </div>

              {/* 关注感谢 */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-medium">关注感谢</div>
                  <div className="text-[10px] text-gray-400">新增关注时自动发送感谢</div>
                </div>
                <Toggle
                  checked={config?.ThanksFocus ?? true}
                  onChange={checked => updateField('ThanksFocus', checked)}
                />
              </div>

              {/* 礼物感谢频率 */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-medium">礼物感谢频率</div>
                  <div className="text-[10px] text-gray-400">礼物聚合感谢的等待时间</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateField('ThanksGiftTimeout', Math.max(0, (config?.ThanksGiftTimeout ?? 3) - 1))}
                    className="w-7 h-7 rounded-lg bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 hover:bg-white/80 flex items-center justify-center text-[14px] font-medium transition-colors"
                  >
                    −
                  </button>
                  <span className="font-mono text-[13px] w-6 text-center select-none">
                    {config?.ThanksGiftTimeout ?? 3}
                  </span>
                  <button
                    onClick={() => updateField('ThanksGiftTimeout', (config?.ThanksGiftTimeout ?? 3) + 1)}
                    className="w-7 h-7 rounded-lg bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 hover:bg-white/80 flex items-center justify-center text-[14px] font-medium transition-colors"
                  >
                    +
                  </button>
                  <span className="text-[11px] text-gray-500">秒</span>
                </div>
              </div>
            </div>

            <Button
              variant="primary"
              className="w-full mt-3"
              onClick={handleSave}
              disabled={saving || !config}
            >
              {saving ? '保存中...' : '保存配置'}
            </Button>
          </div>

          {/* 配置文件位置 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen className="w-4 h-4 text-[var(--primary-color)]" />
              <h3 className="text-[13px] font-semibold">配置文件位置</h3>
            </div>
            <div className="bg-white/40 dark:bg-white/5 rounded-lg p-4 border border-gray-200 dark:border-white/10">
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] font-mono text-gray-700 dark:text-gray-300 break-all">
                  {systemInfo?.config_path || '加载中...'}
                </code>
                {systemInfo && (
                  <button
                    onClick={() => handleCopyPath(systemInfo.config_path)}
                    className="flex-shrink-0 w-8 h-8 rounded-lg hover:bg-white/50 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 数据库配置 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4 text-[var(--primary-color)]" />
              <h3 className="text-[13px] font-semibold">数据库位置 (SQLite)</h3>
            </div>
            <div className="bg-white/40 dark:bg-white/5 rounded-lg p-4 border border-gray-200 dark:border-white/10">
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] font-mono text-gray-700 dark:text-gray-300 break-all">
                  {systemInfo?.db_path || '加载中...'}
                </code>
              </div>
            </div>
          </div>

          {/* 系统更新 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <RefreshCw className="w-4 h-4 text-[var(--primary-color)]" />
              <h3 className="text-[13px] font-semibold">系统更新</h3>
            </div>
            <div className="bg-white/40 dark:bg-white/5 rounded-lg p-4 border border-gray-200 dark:border-white/10">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[12px] font-medium mb-1">当前版本</div>
                  <div className="text-[11px] text-gray-600 dark:text-gray-400">v{systemInfo?.version || '0.0.0'}</div>
                </div>
              </div>
              <div className="pt-3 border-t border-gray-200 dark:border-white/10 space-y-2">
                <Button variant="default" size="sm" className="w-full" onClick={() => openUrl('https://github.com/xbclub/BilibiliDanmuRobot')}>
                  访问项目主页
                </Button>
              </div>
            </div>
          </div>

        </div>
      </GlassCard>
    </div>
  );
}
