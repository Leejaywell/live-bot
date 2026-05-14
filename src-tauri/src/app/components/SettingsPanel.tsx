import { FolderOpen, Database, RefreshCw, Cpu, Info } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from './Button';
import { Modal, ModalCloseButton } from './Modal';
import { api, SystemInfo } from '../lib/api';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

interface SettingsPanelProps {
  onClose: () => void;
}

type SettingsTab = 'basic' | 'models' | 'about';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'basic',  label: '基础' },
  { id: 'models', label: '模型' },
  { id: 'about',  label: '关于' },
];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('basic');

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
    <Modal open={true} onClose={onClose} className="w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" zIndex={50}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
        <h2 className="text-[15px] font-semibold">设置</h2>
        <ModalCloseButton onClose={onClose} className="w-8 h-8" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-5 pt-3 shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all',
              tab === t.id
                ? 'bg-[var(--primary-color)] text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {tab === 'basic' && (
          <>
            {/* 配置文件位置 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <FolderOpen className="w-4 h-4 text-[var(--primary-color)]" />
                <h3 className="text-[13px] font-semibold">配置文件</h3>
              </div>
              <div className="bg-white/40 dark:bg-white/5 rounded-lg p-3.5 border border-gray-200 dark:border-white/10">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] font-mono text-gray-700 dark:text-gray-300 truncate">
                    {systemInfo ? filename(systemInfo.config_path) : '加载中...'}
                  </code>
                  {systemInfo && (
                    <button
                      onClick={() => handleOpenDir(systemInfo.config_path)}
                      title="打开所在文件夹"
                      className="flex-shrink-0 w-7 h-7 rounded-lg hover:bg-white/50 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-gray-400 hover:text-[var(--primary-color)] transition-colors" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 数据库位置 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Database className="w-4 h-4 text-[var(--primary-color)]" />
                <h3 className="text-[13px] font-semibold">数据库 (SQLite)</h3>
              </div>
              <div className="bg-white/40 dark:bg-white/5 rounded-lg p-3.5 border border-gray-200 dark:border-white/10">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] font-mono text-gray-700 dark:text-gray-300 truncate">
                    {systemInfo ? filename(systemInfo.db_path) : '加载中...'}
                  </code>
                  {systemInfo && (
                    <button
                      onClick={() => handleOpenDir(systemInfo.db_path)}
                      title="打开所在文件夹"
                      className="flex-shrink-0 w-7 h-7 rounded-lg hover:bg-white/50 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-gray-400 hover:text-[var(--primary-color)] transition-colors" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 系统更新 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <RefreshCw className="w-4 h-4 text-[var(--primary-color)]" />
                <h3 className="text-[13px] font-semibold">检查更新</h3>
              </div>
              <div className="bg-white/40 dark:bg-white/5 rounded-lg p-3.5 border border-gray-200 dark:border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] text-gray-600 dark:text-gray-400">
                    当前版本 <span className="font-mono font-bold">v{systemInfo?.version || '0.0.0'}</span>
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
          </>
        )}

        {tab === 'models' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Cpu className="w-4 h-4 text-[var(--primary-color)]" />
              <h3 className="text-[13px] font-semibold">本地模型</h3>
            </div>
            <div className="bg-white/40 dark:bg-white/5 rounded-lg p-4 border border-gray-200 dark:border-white/10 space-y-3">
              <div>
                <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">VAD 模型</div>
                <code className="text-[10px] font-mono text-gray-500">assets/models/silero_vad.onnx</code>
              </div>
              <div className="h-px bg-gray-100 dark:bg-white/10" />
              <div>
                <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">ASR 模型（可选）</div>
                <code className="text-[10px] font-mono text-gray-500">assets/models/sherpa-onnx-sense-voice-*</code>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              将模型文件放到上述路径后重启程序即可启用本地语音识别。也可在「模型服务」页配置外部 ASR 服务（如 FunASR）。
            </p>
          </div>
        )}

        {tab === 'about' && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--primary-color)]/10 flex items-center justify-center">
                <Info className="w-6 h-6 text-[var(--primary-color)]" />
              </div>
              <div>
                <div className="text-[14px] font-black tracking-tight">流光</div>
                <div className="text-[11px] text-gray-500">v{systemInfo?.version || '0.0.0'}</div>
              </div>
            </div>
            <div className="bg-white/40 dark:bg-white/5 rounded-lg p-4 border border-gray-200 dark:border-white/10 space-y-2.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-500">开发者</span>
                <span className="font-medium">Jay</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-500">平台</span>
                <span className="font-medium">Bilibili 直播</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-500">技术栈</span>
                <span className="font-medium">Tauri · Rust · React</span>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              流光是一款 B站直播间 AI 互动助手，支持欢迎、礼物感谢、关键词回复、AI 问答等自动化功能。
            </p>
          </div>
        )}

      </div>
    </Modal>
  );
}
