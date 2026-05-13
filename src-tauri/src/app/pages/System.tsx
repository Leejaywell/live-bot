import { useState, useEffect, useRef } from 'react';
import { FolderOpen, Upload, Download, RefreshCw, ExternalLink, CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfig } from '../context/ConfigContext';
import { Toggle } from '../components/Toggle';

interface UpdateResult {
  version: string;
  link: string;
  change_log: string;
}

type InstallState = 'idle' | 'downloading' | 'installing' | 'done' | 'error';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function System() {
  const { config, updateConfigImmediate } = useConfig();
  const [sysInfo, setSysInfo] = useState<{ version: string; config_path: string; db_path: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null | 'up-to-date' | 'error'>(undefined as any);

  const [installState, setInstallState] = useState<InstallState>('idle');
  const [downloaded, setDownloaded] = useState(0);
  const [totalSize, setTotalSize] = useState<number | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    api.getSystemInfo().then(setSysInfo).catch(console.error);
    return () => { unlistenRef.current?.(); };
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateResult(undefined as any);
    setInstallState('idle');
    try {
      const result = await api.checkUpdate();
      setUpdateResult(result ?? 'up-to-date');
      if (!result) toast.success('已是最新版本');
    } catch (err) {
      setUpdateResult('error');
      toast.error(`检查更新失败: ${err}`);
    } finally {
      setChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    setInstallState('downloading');
    setDownloaded(0);
    setTotalSize(null);

    unlistenRef.current = await api.onUpdateProgress(({ downloaded: dl, total }) => {
      setDownloaded(dl);
      if (total) setTotalSize(total);
    });

    try {
      await api.installUpdate();
      setInstallState('done');
      toast.success('更新完成，应用即将重启');
    } catch (err) {
      const msg = String(err);
      if (msg === 'already_latest') {
        toast.info('已是最新版本');
        setInstallState('idle');
      } else {
        setInstallState('error');
        toast.error(`自动更新失败: ${err}`);
      }
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
    }
  };

  const handleOpenConfigDir = async () => {
    try {
      await api.openConfigDir();
    } catch (err) {
      toast.error(`无法打开目录: ${err}`);
    }
  };

  const currentVersion = sysInfo?.version ? `v${sysInfo.version}` : '—';
  const hasUpdate = updateResult && updateResult !== 'up-to-date' && updateResult !== 'error';
  const isDownloading = installState === 'downloading';
  const progressPct = totalSize && totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : null;

  return (
    <div className="p-[18px] space-y-4 max-w-3xl">
      {/* 版本 */}
      <GlassCard className="p-5">
        <h2 className="text-[12px] font-semibold mb-4">版本</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <label className="w-24 text-[11px] text-gray-500 shrink-0">当前版本</label>
            <span className="font-mono text-[12px]">{currentVersion}</span>
          </div>

          <div className="flex items-center gap-4">
            <label className="w-24 text-[11px] text-gray-500 shrink-0">自动更新</label>
            <Toggle
              checked={config?.AutoUpdate ?? true}
              onChange={(checked) => updateConfigImmediate({ AutoUpdate: checked })}
            />
            <span className="text-[10px] text-gray-400">发现新版本后自动下载并安装</span>
          </div>

          {updateResult === 'up-to-date' && (
            <div className="flex items-center gap-4">
              <label className="w-24 text-[11px] text-gray-500 shrink-0">最新版本</label>
              <span className="font-mono text-[12px]">{currentVersion}</span>
              <Chip variant="success" className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />已是最新
              </Chip>
            </div>
          )}

          {hasUpdate && (
            <div className="flex items-center gap-4 flex-wrap">
              <label className="w-24 text-[11px] text-gray-500 shrink-0">最新版本</label>
              <span className="font-mono text-[12px] text-[var(--primary-color)]">{(updateResult as UpdateResult).version}</span>
              <Chip variant="warning" className="flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />有新版本
              </Chip>
              <button
                onClick={() => api.openUrl(`https://ghproxy.com/${(updateResult as UpdateResult).link}`)}
                className="flex items-center gap-1 text-[11px] text-[var(--primary-color)] hover:underline"
              >
                <ExternalLink className="w-3 h-3" />镜像下载
              </button>
              <button
                onClick={() => api.openUrl((updateResult as UpdateResult).link)}
                className="flex items-center gap-1 text-[11px] text-gray-500 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />直接下载
              </button>
            </div>
          )}

          {updateResult === 'error' && (
            <div className="flex items-center gap-4">
              <label className="w-24 text-[11px] text-gray-500 shrink-0">检查结果</label>
              <span className="text-[11px] text-red-500">检查失败，请确认网络连接</span>
            </div>
          )}

          {/* 更新日志 */}
          {hasUpdate && (updateResult as UpdateResult).change_log && (
            <div className="mt-2 rounded-lg bg-black/5 dark:bg-white/5 border border-gray-200 dark:border-white/10 p-3">
              <p className="text-[10px] font-medium text-gray-500 mb-1.5">更新内容</p>
              <pre className="text-[11px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed font-sans">
                {(updateResult as UpdateResult).change_log}
              </pre>
            </div>
          )}

          {/* 下载进度条 */}
          {(isDownloading || installState === 'installing') && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-gray-500">
                <span>{installState === 'installing' ? '安装中...' : `下载中 ${formatBytes(downloaded)}${totalSize ? ` / ${formatBytes(totalSize)}` : ''}`}</span>
                {progressPct !== null && <span>{progressPct}%</span>}
              </div>
              <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: progressPct !== null ? `${progressPct}%` : '100%',
                    background: 'var(--primary-color)',
                    animation: progressPct === null ? 'pulse 1.5s ease-in-out infinite' : undefined,
                  }}
                />
              </div>
            </div>
          )}

          {installState === 'done' && (
            <div className="flex items-center gap-2 text-[11px] text-green-600 dark:text-green-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              更新完成，应用即将重启
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleCheckUpdate}
            disabled={checking || isDownloading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? '检查中...' : '检查更新'}
          </Button>

          {hasUpdate && (
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleInstallUpdate}
              disabled={isDownloading || installState === 'done'}
            >
              <Zap className={`w-3.5 h-3.5 ${isDownloading ? 'animate-pulse' : ''}`} />
              {isDownloading ? '下载中...' : installState === 'done' ? '已完成' : '自动更新'}
            </Button>
          )}
        </div>
      </GlassCard>

      {/* 配置 */}
      <GlassCard className="p-5">
        <h2 className="text-[12px] font-semibold mb-4">配置</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <label className="w-24 text-[11px] text-gray-500 shrink-0">路径</label>
            <span className="font-mono text-[11px]">{sysInfo?.config_path ?? 'etc/bilidanmaku-api.yaml'}</span>
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <div className="flex flex-col items-center gap-1">
            <IconButton onClick={handleOpenConfigDir} title="在 Finder 中打开配置目录">
              <FolderOpen className="w-4 h-4" />
            </IconButton>
            <span className="text-[9px] text-gray-500">打开目录</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <IconButton>
              <Upload className="w-4 h-4" />
            </IconButton>
            <span className="text-[9px] text-gray-500">导出</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <IconButton>
              <Download className="w-4 h-4" />
            </IconButton>
            <span className="text-[9px] text-gray-500">导入</span>
          </div>
        </div>
      </GlassCard>

      {/* 数据 */}
      <GlassCard className="p-5">
        <h2 className="text-[12px] font-semibold mb-4">数据</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <label className="w-24 text-[11px] text-gray-500 shrink-0">DB 路径</label>
            <span className="font-mono text-[11px]">{sysInfo?.db_path ?? 'db/sqliteDataBase.db'}</span>
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <div className="flex flex-col items-center gap-1">
            <IconButton>
              <Download className="w-4 h-4" />
            </IconButton>
            <span className="text-[9px] text-gray-500">备份</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <IconButton className="bg-yellow-500/20">
              <RefreshCw className="w-4 h-4 text-yellow-600" />
            </IconButton>
            <span className="text-[9px] text-gray-500">清理</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <IconButton>
              <Upload className="w-4 h-4" />
            </IconButton>
            <span className="text-[9px] text-gray-500">导出</span>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
