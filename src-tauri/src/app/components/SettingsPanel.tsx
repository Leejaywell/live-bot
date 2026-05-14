import {
  FolderOpen,
  Database,
  RefreshCw,
  Cpu,
  Info,
  Download,
  CheckCircle2,
  AlertCircle,
  Globe,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
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

interface DlState {
  active: boolean;
  pct: number;
  downloaded_mb?: string;
  total_mb?: string;
  stage?: string;
}

interface ModelCardProps {
  title: string;
  desc: string;
  size: string;
  installed: boolean | null;
  dl: DlState;
  useMirror: boolean;
  onDownload: () => void;
}

function ModelCard({ title, desc, size, installed, dl, useMirror, onDownload }: ModelCardProps) {
  return (
    <div className="bg-white/40 dark:bg-white/5 rounded-xl p-4 border border-gray-200 dark:border-white/10 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-gray-800 dark:text-gray-100">{title}</div>
          <div className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{desc}</div>
        </div>
        <div className="shrink-0 mt-0.5">
          {installed === null ? (
            <span className="text-[10px] text-gray-400">检查中…</span>
          ) : installed ? (
            <div className="flex items-center gap-1 text-[10px] text-emerald-500 font-semibold">
              <CheckCircle2 className="w-3 h-3" />
              已安装
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[10px] text-amber-500 font-semibold">
              <AlertCircle className="w-3 h-3" />
              未安装
            </div>
          )}
        </div>
      </div>

      {/* Size */}
      <div className="text-[10px] text-gray-400 font-mono">{size}</div>

      {/* Progress bar */}
      {dl.active && (
        <div className="space-y-1.5">
          <div className="h-1.5 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--primary-color)] rounded-full transition-all duration-300"
              style={{ width: `${dl.pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-gray-500">
            <span>{dl.stage === 'extracting' ? '解压中…' : `${dl.pct}%`}</span>
            {dl.downloaded_mb && dl.total_mb && (
              <span>{dl.downloaded_mb} / {dl.total_mb} MB</span>
            )}
          </div>
        </div>
      )}

      {/* Download button */}
      {!installed && (
        <Button
          variant="default"
          size="sm"
          className="w-full gap-1.5"
          onClick={onDownload}
          disabled={dl.active}
        >
          <Download className="w-3.5 h-3.5" />
          {dl.active
            ? (dl.stage === 'extracting' ? '解压中…' : `下载中 ${dl.pct}%`)
            : (useMirror ? '镜像下载' : '下载')}
        </Button>
      )}
    </div>
  );
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('basic');

  // Models tab state
  const [modelStatus, setModelStatus] = useState<{ vad_model_ok: boolean; asr_local_model_ok: boolean } | null>(null);
  const [ipRegion, setIpRegion] = useState<string>('');
  const [useMirror, setUseMirror] = useState(false);
  const [vadDl, setVadDl] = useState<DlState>({ active: false, pct: 0 });
  const [asrDl, setAsrDl] = useState<DlState>({ active: false, pct: 0 });
  const modelsLoaded = useRef(false);

  useEffect(() => {
    api.getSystemInfo().then(setSystemInfo).catch(console.error);
  }, []);

  useEffect(() => {
    if (tab !== 'models' || modelsLoaded.current) return;
    modelsLoaded.current = true;

    api.checkVoiceModels().then(m => setModelStatus(m)).catch(console.error);
    api.checkIpRegion().then(region => {
      setIpRegion(region);
      if (region === 'CN') setUseMirror(true);
    }).catch(console.error);

    let vadUnsub: (() => void) | undefined;
    let asrUnsub: (() => void) | undefined;

    api.onVadModelProgress(data => {
      if (data.stage === 'done') {
        setVadDl({ active: false, pct: 100 });
        setModelStatus(prev => prev ? { ...prev, vad_model_ok: true } : prev);
      } else {
        setVadDl({ active: true, pct: data.pct, downloaded_mb: data.downloaded_mb, total_mb: data.total_mb, stage: data.stage });
      }
    }).then(f => { vadUnsub = f; });

    api.onVoiceModelProgress(data => {
      if (data.stage === 'done') {
        setAsrDl({ active: false, pct: 100 });
        setModelStatus(prev => prev ? { ...prev, asr_local_model_ok: true } : prev);
      } else {
        setAsrDl({ active: true, pct: data.pct, downloaded_mb: data.downloaded_mb, total_mb: data.total_mb, stage: data.stage });
      }
    }).then(f => { asrUnsub = f; });

    return () => {
      vadUnsub?.();
      asrUnsub?.();
    };
  }, [tab]);

  const handleDownloadVad = async () => {
    setVadDl({ active: true, pct: 0 });
    try {
      await api.downloadVadModel(useMirror);
      toast.success('VAD 模型下载完成');
    } catch (e) {
      setVadDl({ active: false, pct: 0 });
      toast.error(`下载失败: ${e}`);
    }
  };

  const handleDownloadAsr = async () => {
    setAsrDl({ active: true, pct: 0 });
    try {
      await api.downloadSensevoiceModel(useMirror);
      toast.success('SenseVoice 模型下载完成');
    } catch (e) {
      setAsrDl({ active: false, pct: 0 });
      toast.error(`下载失败: ${e}`);
    }
  };

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
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[var(--primary-color)]" />
                <h3 className="text-[13px] font-semibold">本地模型</h3>
              </div>
              {/* IP region + mirror toggle */}
              <div className="flex items-center gap-2">
                {ipRegion && (
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <Globe className="w-3 h-3" />
                    {ipRegion}
                  </div>
                )}
                <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-white/10 text-[10px] font-semibold">
                  <button
                    onClick={() => setUseMirror(false)}
                    className={cn(
                      'px-2.5 py-1 transition-colors',
                      !useMirror
                        ? 'bg-[var(--primary-color)] text-white'
                        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    )}
                  >
                    直连
                  </button>
                  <button
                    onClick={() => setUseMirror(true)}
                    className={cn(
                      'px-2.5 py-1 transition-colors',
                      useMirror
                        ? 'bg-[var(--primary-color)] text-white'
                        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    )}
                  >
                    镜像
                  </button>
                </div>
              </div>
            </div>

            {/* China mirror banner */}
            {ipRegion === 'CN' && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 text-[10px] text-amber-600 dark:text-amber-400">
                <Globe className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>检测到中国 IP，已自动切换为镜像下载（GitHub ghproxy）</span>
              </div>
            )}

            {/* VAD model */}
            <ModelCard
              title="VAD · 语音活动检测"
              desc="实时检测说话的起止时间，用于语音交互的端点判断。由 Silero 提供。"
              size="silero_vad.onnx · ~1.8 MB · GitHub"
              installed={modelStatus ? modelStatus.vad_model_ok : null}
              dl={vadDl}
              useMirror={useMirror}
              onDownload={handleDownloadVad}
            />

            {/* SenseVoice ASR model */}
            <ModelCard
              title="SenseVoice ASR · 本地语音识别"
              desc="多语言离线识别（中 / 英 / 日 / 韩 / 粤），int8 量化版，无需联网。由 k2-fsa / sherpa-onnx 提供。"
              size="sherpa-onnx-sense-voice-*-int8 · ~300 MB · GitHub"
              installed={modelStatus ? modelStatus.asr_local_model_ok : null}
              dl={asrDl}
              useMirror={useMirror}
              onDownload={handleDownloadAsr}
            />

            <p className="text-[10px] text-gray-400 leading-relaxed">
              模型存储在应用缓存目录。语音功能所需模型可在此页面统一下载，下载完成后无需重启即可启用。
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
