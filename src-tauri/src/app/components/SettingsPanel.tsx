import { X, FolderOpen, Database, RefreshCw, Copy, Check } from 'lucide-react';
import { useState, useEffect } from 'react';
import { GlassCard } from './GlassCard';
import { Button } from './Button';
import { api, SystemInfo } from '../lib/api';
import { toast } from 'sonner';

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [copied, setCopied] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    loadSystemInfo();
  }, []);

  const loadSystemInfo = async () => {
    try {
      const info = await api.getSystemInfo();
      setSystemInfo(info);
    } catch (err) {
      console.error('Failed to load system info:', err);
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
