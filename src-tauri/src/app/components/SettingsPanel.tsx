import { X, FolderOpen, Database, RefreshCw } from 'lucide-react';
import { useState, useEffect } from 'react';
import { GlassCard } from './GlassCard';
import { Button } from './Button';
import { api, SystemInfo } from '../lib/api';
import { toast } from 'sonner';

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.getSystemInfo().then(setSystemInfo).catch(console.error);
  }, []);

  const handleOpenDir = (filePath: string) => {
    const sep = filePath.includes('/') ? '/' : '\\';
    const dir = filePath.split(sep).slice(0, -1).join(sep);
    api.openUrl(dir).catch(err => toast.error(`打开失败: ${err}`));
  };

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      const result = await api.checkUpdate();
      if (result) {
        toast.success(`发现新版本 v${result.version}`, {
          description: result.change_log?.slice(0, 120) || '点击下载安装',
        });
      } else {
        toast.success('当前已是最新版本');
      }
    } catch (err) {
      toast.error(`检查更新失败: ${err}`);
    } finally {
      setChecking(false);
    }
  };

  const filename = (p: string) =>
    p.split('/').pop() || p.split('\\').pop() || p;

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <GlassCard className="w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col">
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
                <code className="flex-1 text-[11px] font-mono text-gray-700 dark:text-gray-300 truncate">
                  {systemInfo ? filename(systemInfo.config_path) : '加载中...'}
                </code>
                {systemInfo && (
                  <button
                    onClick={() => handleOpenDir(systemInfo.config_path)}
                    title="打开所在文件夹"
                    className="flex-shrink-0 w-8 h-8 rounded-lg hover:bg-white/50 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    <FolderOpen className="w-4 h-4 text-gray-400 hover:text-[var(--primary-color)] transition-colors" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 数据库位置 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4 text-[var(--primary-color)]" />
              <h3 className="text-[13px] font-semibold">数据库位置 (SQLite)</h3>
            </div>
            <div className="bg-white/40 dark:bg-white/5 rounded-lg p-4 border border-gray-200 dark:border-white/10">
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] font-mono text-gray-700 dark:text-gray-300 truncate">
                  {systemInfo ? filename(systemInfo.db_path) : '加载中...'}
                </code>
                {systemInfo && (
                  <button
                    onClick={() => handleOpenDir(systemInfo.db_path)}
                    title="打开所在文件夹"
                    className="flex-shrink-0 w-8 h-8 rounded-lg hover:bg-white/50 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    <FolderOpen className="w-4 h-4 text-gray-400 hover:text-[var(--primary-color)] transition-colors" />
                  </button>
                )}
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
                  <div className="text-[11px] text-gray-600 dark:text-gray-400">
                    v{systemInfo?.version || '0.0.0'}
                  </div>
                </div>
              </div>
              <Button
                variant="default"
                size="sm"
                className="w-full"
                onClick={handleCheckUpdate}
                disabled={checking}
              >
                {checking ? '检查中...' : '检查更新'}
              </Button>
            </div>
          </div>

        </div>
      </GlassCard>
    </div>
  );
}
