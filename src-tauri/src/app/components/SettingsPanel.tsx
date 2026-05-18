import {
  Cpu,
  Info,
  Download,
  CheckCircle2,
  AlertCircle,
  Settings,
  Sparkles,
  X,
  Mic,
  Volume2,
  Activity,
  FolderOpen,
  Clock,
  Database,
  Home,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { Button } from './Button';
import { Modal, ModalCloseButton } from './Modal';
import { api, SystemInfo } from '../lib/api';
import { showSplashAgain } from '../lib/splashTrigger';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useConfig, DlState } from '../context/ConfigContext';
import { Toggle } from './Toggle';

interface SettingsPanelProps {
  onClose: () => void;
}

type SettingsTab = 'basic' | 'models' | 'system' | 'about';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'basic',  label: '基础' },
  // { id: 'models', label: '模型' },  // 模型自动下载后隐藏，代码保留
  { id: 'system', label: '系统' },
  { id: 'about',  label: '关于' },
];

type ModelCategory = 'vad' | 'asr' | 'tts';

interface ModelDef {
  id: string;
  title: string;
  desc: string;
  size: string;
  category: ModelCategory;
  comingSoon?: boolean;
}

const MODEL_CATALOG: ModelDef[] = [
  // VAD
  { id: 'silero-vad', category: 'vad',
    title: 'Silero VAD',
    desc: '毫秒级检测说话起止时刻，体积极小、CPU 占用低，是所有本地语音功能的必备基础组件。',
    size: '~1.8 MB' },
  // ASR
  { id: 'sensevoice', category: 'asr',
    title: 'SenseVoice int8',
    desc: '支持中 / 英 / 日 / 韩 / 粤五种语言，同时输出情绪标签（高兴 / 悲伤等），识别速度是同类最快方案之一，完全离线运行。',
    size: '~300 MB' },
  { id: 'paraformer', category: 'asr',
    title: 'Paraformer',
    desc: '阿里达摩院出品，专为中文场景深度调优，口语、方言词汇准确率高，推理速度快，适合弹幕高频识别。',
    size: '~250 MB' },
  { id: 'whisper-tiny', category: 'asr',
    title: 'Whisper Tiny',
    desc: 'OpenAI 出品，支持 99 种语言自动检测，体积最小、内存占用低，适合低配设备或只需偶尔识别的场景。',
    size: '~75 MB' },
  { id: 'whisper-small', category: 'asr',
    title: 'Whisper Small',
    desc: 'OpenAI 出品，多语言识别，准确率显著优于 Tiny，体积适中，是大多数场景下性价比最高的选择。',
    size: '~466 MB' },
  { id: 'whisper-medium', category: 'asr',
    title: 'Whisper Medium',
    desc: 'OpenAI 出品，多语言高准确率，对口音、背景噪声的容忍度更强，适合对识别质量有较高要求的场景。',
    size: '~1.5 GB' },
  // TTS
  { id: 'kokoro', category: 'tts',
    title: 'Kokoro v1.0 int8',
    desc: '音质接近商用水准，内置中文女声（zf_001）和男声（zm_yunxi），实时合成速度快，完全离线，Apache 2.0 开源。',
    size: '~87 MB' },
  { id: 'melo-tts', category: 'tts', comingSoon: true,
    title: 'MeloTTS',
    desc: '微软出品，中文自然度高，支持多种音色风格，发音字正腔圆，适合需要稳定播报风格的直播场景。',
    size: '~200 MB' },
  { id: 'chat-tts', category: 'tts', comingSoon: true,
    title: 'ChatTTS',
    desc: '专为对话优化，支持插入笑声、停顿、语气词等副语言特征，说话风格极为自然，接近真人对话节奏。',
    size: '~900 MB' },
  { id: 'cosyvoice', category: 'tts', comingSoon: true,
    title: 'CosyVoice 2',
    desc: '阿里出品，支持中英日韩多语言合成且切换时口音保持一致，可用自然语言描述说话风格与情绪，首包延迟低适合实时对话。',
    size: '~1.5 GB' },
  { id: 'fish-speech', category: 'tts', comingSoon: true,
    title: 'Fish Speech',
    desc: '全开源声音克隆方案，10 秒参考音频即可复刻音色，支持多语言，生成速度快，适合个性化主播音色定制。',
    size: '~1 GB' },
  { id: 'bert-vits2', category: 'tts', comingSoon: true,
    title: 'Bert-VITS2',
    desc: '结合语义理解与音色建模，情感表达细腻，韵律自然，中文合成质量出众，适合追求高表现力的直播互动场景。',
    size: '~600 MB' },
];

const CATEGORY_META: Record<ModelCategory, { icon: React.ReactNode; label: string }> = {
  vad: { icon: <Activity className="w-3.5 h-3.5 text-[var(--primary-color)]" />, label: 'VAD · 人声检测' },
  asr: { icon: <Mic className="w-3.5 h-3.5 text-[var(--primary-color)]" />,      label: 'ASR · 语音识别' },
  tts: { icon: <Volume2 className="w-3.5 h-3.5 text-[var(--primary-color)]" />,  label: 'TTS · 语音合成' },
};

interface ModelCardProps {
  title: string;
  desc: string;
  size: string;
  installed: boolean | null;
  dl: DlState;
  comingSoon?: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

function ModelCard({ title, desc, size, installed, dl, comingSoon, onDownload, onCancel, onDelete }: ModelCardProps) {
  return (
    <div className="bg-white/40 dark:bg-white/5 rounded-xl p-4 border border-gray-200 dark:border-white/10 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-gray-800 dark:text-gray-100">{title}</div>
          <div className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{desc}</div>
        </div>
        <div className="shrink-0 mt-0.5 flex flex-col items-end gap-2">
          {dl.active ? (
            <span className="text-[10px] text-blue-500 font-semibold">
              {dl.stage === 'extracting' ? '解压中…' : '下载中…'}
            </span>
          ) : comingSoon ? (
            <div className="flex items-center gap-1 text-[10px] text-gray-400 font-semibold">
              <Clock className="w-3 h-3" />
              即将支持
            </div>
          ) : installed === null ? (
            <span className="text-[10px] text-gray-400">检查中…</span>
          ) : installed ? (
            <>
              <div className="flex items-center gap-1 text-[10px] text-emerald-500 font-semibold">
                <CheckCircle2 className="w-3 h-3" />
                已安装
              </div>
              {onDelete && (
                <button
                  onClick={onDelete}
                  className="text-[10px] text-red-500/70 hover:text-red-500 font-bold transition-colors underline decoration-red-500/20 underline-offset-4"
                >
                  删除
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-1 text-[10px] text-amber-500 font-semibold">
              <AlertCircle className="w-3 h-3" />
              未安装
            </div>
          )}
        </div>
      </div>

      <div className="text-[10px] text-gray-400 font-mono">{size}</div>

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

      {dl.active ? (
        <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={onCancel}>
          <X className="w-3.5 h-3.5" />
          取消下载
        </Button>
      ) : !comingSoon && !installed && (
        <Button variant="default" size="sm" className="w-full gap-1.5" onClick={onDownload}>
          <Download className="w-3.5 h-3.5" />
          下载
        </Button>
      )}
    </div>
  );
}

function AddRoomIdInput({ onAdd }: { onAdd: (rid: number) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="添加房间号"
        className="flex-1 h-[28px] px-2.5 rounded-lg bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const rid = parseInt(value);
            if (rid) { onAdd(rid); setValue(''); }
          }
        }}
      />
      <button
        onClick={() => {
          const rid = parseInt(value);
          if (rid) { onAdd(rid); setValue(''); }
        }}
        className="text-[11px] text-gray-400 hover:text-[var(--primary-color)] transition-colors px-2 py-1 rounded-lg hover:bg-[var(--primary-color)]/10 shrink-0"
      >
        添加
      </button>
    </div>
  );
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { config, updateConfig, modelDl, downloadModel, cancelModel } = useConfig();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('basic');
  const [modelStatus, setModelStatus] = useState<{ model_dir: string; models: Record<string, boolean> } | null>(null);

  useEffect(() => {
    api.getSystemInfo().then(setSystemInfo).catch(console.error);
  }, []);

  const refreshModelStatus = useCallback(() => {
    api.checkModels().then(setModelStatus).catch(console.error);
  }, []);

  useEffect(() => {
    if (tab === 'models') refreshModelStatus();
  }, [tab, refreshModelStatus]);

  // Refresh when any download finishes
  useEffect(() => {
    const anyJustDone = Object.values(modelDl).some(d => !d.active && d.pct === 100);
    if (anyJustDone) refreshModelStatus();
  }, [modelDl, refreshModelStatus]);

  const handleDelete = async (modelId: string) => {
    try {
      const msg = await api.deleteModel(modelId);
      toast.success(msg);
      refreshModelStatus();
    } catch (e) {
      toast.error(`删除失败: ${e}`);
    }
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
        toast.info('当前已是最新版本');
      }
    } catch {
      toast.error('检查更新失败', {
        description: '可能是由于网络限制或 GitHub API 频率限制，请稍后再试。'
      });
    } finally {
      setChecking(false);
    }
  };

  if (!config) {
    return (
      <Modal open={true} onClose={onClose} className="h-[400px] flex items-center justify-center" zIndex={50}>
        <div className="text-[12px] text-gray-400 animate-pulse">正在加载配置...</div>
      </Modal>
    );
  }

  const categories: ModelCategory[] = ['vad', 'asr', 'tts'];

  return (
    <Modal open={true} onClose={onClose} className="max-h-[80vh] overflow-hidden flex flex-col" zIndex={50}>
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
          <div className="space-y-6">
            {/* 数据记录 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[var(--primary-color)]" />
                <h3 className="text-[13px] font-semibold">数据记录</h3>
              </div>
              <div className="bg-white/40 dark:bg-white/5 rounded-lg p-3.5 border border-gray-200 dark:border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-[12px] font-medium text-gray-800 dark:text-gray-200">启用互动数据记录</div>
                    <div className="text-[10px] text-gray-400">记录弹幕、礼物、关注等互动事件及观众档案</div>
                  </div>
                  <Toggle
                    checked={config?.RecordEnabled ?? true}
                    onChange={(val) => updateConfig({ RecordEnabled: val })}
                  />
                </div>
                <div className="pt-3 border-t border-black/5 dark:border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Home className="w-3.5 h-3.5 text-gray-400" />
                        <div className="text-[12px] font-medium text-gray-800 dark:text-gray-200">我的直播间</div>
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {config?.MyRoomIds && config.MyRoomIds.length > 0
                          ? `房间号 ${config.MyRoomIds.join('、')}，仅记录这些房间的数据`
                          : '未配置，所有房间均会记录数据'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {config?.MyRoomIds?.map((rid) => (
                        <button
                          key={rid}
                          onClick={() => updateConfig({ MyRoomIds: config.MyRoomIds.filter((id: number) => id !== rid) })}
                          className="text-[11px] text-gray-400 hover:text-red-500 transition-colors px-2 py-0.5 rounded-lg hover:bg-red-500/10"
                        >
                          ×{rid}
                        </button>
                      ))}
                    </div>
                  </div>
                  <AddRoomIdInput
                    onAdd={(rid) => {
                      const ids = config?.MyRoomIds ?? [];
                      if (!ids.includes(rid)) {
                        updateConfig({ MyRoomIds: [...ids, rid] });
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* 个性化 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--primary-color)]" />
                <h3 className="text-[13px] font-semibold">个性化</h3>
              </div>
              <div className="bg-white/40 dark:bg-white/5 rounded-lg p-3.5 border border-gray-200 dark:border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-[12px] font-medium text-gray-800 dark:text-gray-200">关闭背景特效</div>
                    <div className="text-[10px] text-gray-400">关闭主界面的动态背景动画（降低 CPU 占用）</div>
                  </div>
                  <Toggle
                    checked={config?.DisableBackgroundEffects ?? false}
                    onChange={(val) => updateConfig({ DisableBackgroundEffects: val })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-[12px] font-medium text-gray-800 dark:text-gray-200">关闭鼠标特效</div>
                    <div className="text-[10px] text-gray-400">关闭自定义光标与点击波纹（不影响背景）</div>
                  </div>
                  <Toggle
                    checked={config?.DisableCursorEffects ?? false}
                    onChange={(val) => updateConfig({ DisableCursorEffects: val })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-[12px] font-medium text-gray-800 dark:text-gray-200">预览启动页</div>
                    <div className="text-[10px] text-gray-400">按当前主题与时段重新播放启动动画</div>
                  </div>
                  <Button size="sm" variant="default" onClick={() => showSplashAgain()}>
                    查看
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'models' && (
          <div className="space-y-6">
            {categories.map(cat => {
              const models = MODEL_CATALOG.filter(m => m.category === cat);
              const meta = CATEGORY_META[cat];
              return (
                <div key={cat} className="space-y-3">
                  <div className="flex items-center gap-2">
                    {meta.icon}
                    <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {meta.label}
                    </span>
                  </div>
                  {models.map(m => {
                    const dl = modelDl[m.id] ?? { active: false, pct: 0 };
                    const installed = m.comingSoon ? false : (modelStatus ? (modelStatus.models[m.id] ?? false) : null);
                    return (
                      <ModelCard
                        key={m.id}
                        title={m.title}
                        desc={m.desc}
                        size={m.size}
                        installed={installed}
                        dl={dl}
                        comingSoon={m.comingSoon}
                        onDownload={() => downloadModel(m.id)}
                        onCancel={() => cancelModel(m.id)}
                        onDelete={!m.comingSoon ? () => handleDelete(m.id) : undefined}
                      />
                    );
                  })}
                </div>
              );
            })}

            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              <span>模型存储在应用缓存目录</span>
              <button
                onClick={async () => {
                  if (!modelStatus?.model_dir) return;
                  try { await api.openFolder(modelStatus.model_dir); }
                  catch (e) { toast.error(`打开目录失败: ${e}`); }
                }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                title={modelStatus?.model_dir}
              >
                <FolderOpen className="w-3 h-3" />
                打开目录
              </button>
            </div>
          </div>
        )}

        {tab === 'system' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Settings className="w-4 h-4 text-[var(--primary-color)]" />
              <h3 className="text-[13px] font-semibold">系统设置</h3>
            </div>
            <div className="bg-white/40 dark:bg-white/5 rounded-lg p-3.5 border border-gray-200 dark:border-white/10 space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-[12px] font-medium text-gray-800 dark:text-gray-200">自动检查更新</div>
                  <div className="text-[10px] text-gray-500">启动时自动检查并提示新版本</div>
                </div>
                <Toggle
                  checked={config?.AutoUpdate ?? true}
                  onChange={(val) => updateConfig({ AutoUpdate: val })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-[12px] font-medium text-gray-800 dark:text-gray-200">最小化至托盘</div>
                  <div className="text-[10px] text-gray-500">关闭或最小化时隐藏到系统托盘</div>
                </div>
                <Toggle
                  checked={config?.MinimizeToTray ?? true}
                  onChange={(val) => updateConfig({ MinimizeToTray: val })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-[12px] font-medium text-gray-800 dark:text-gray-200">开机自启动</div>
                  <div className="text-[10px] text-gray-500">在系统启动时自动运行流光</div>
                </div>
                <Toggle
                  checked={config?.LaunchAtStartup ?? false}
                  onChange={(val) => updateConfig({ LaunchAtStartup: val })}
                />
              </div>

              <div className="pt-2 border-t border-gray-100 dark:border-white/5">
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
            <p className="text-[10px] text-gray-400 leading-relaxed">
              流光是一款 B站直播间 AI 互动助手，支持欢迎、礼物感谢、AI 问答等自动化功能。
            </p>
          </div>
        )}

      </div>
    </Modal>
  );
}
