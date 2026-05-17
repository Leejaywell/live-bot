import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api, AppConfig } from '../lib/api';
import { toast } from 'sonner';

export interface DlState {
  active: boolean;
  pct: number;
  downloaded_mb?: string;
  total_mb?: string;
  stage?: string;
}

interface ConfigContextType {
  config: AppConfig | null;
  loading: boolean;
  refreshConfig: () => Promise<void>;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  updateConfigImmediate: (patch: Partial<AppConfig>) => void;
  modelDl: Record<string, DlState>;
  downloadModel: (modelId: string) => Promise<void>;
  cancelModel: (modelId: string) => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [modelDl, setModelDl] = useState<Record<string, DlState>>({});

  const refreshConfig = useCallback(async () => {
    try {
      const cfg = await api.loadConfig();
      setConfig(cfg);
    } catch (err) {
      console.error('Failed to load config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(async (patch: Partial<AppConfig>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    setConfig(next);
    try {
      await api.saveConfig(next);
    } catch (err) {
      toast.error(`保存配置失败: ${err}`);
      refreshConfig();
      throw err;
    }
  }, [config, refreshConfig]);

  const updateConfigImmediate = useCallback((patch: Partial<AppConfig>) => {
    setConfig(prev => prev ? { ...prev, ...patch } : null);
  }, []);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  // Single listener for all model download progress
  useEffect(() => {
    let unsub: (() => void) | undefined;
    api.onModelDlProgress(data => {
      const { model_id, stage, pct, downloaded_mb, total_mb } = data;
      if (stage === 'done') {
        setModelDl(prev => ({ ...prev, [model_id]: { active: false, pct: 100 } }));
      } else if (stage === 'cancelled') {
        setModelDl(prev => ({ ...prev, [model_id]: { active: false, pct: 0 } }));
      } else {
        setModelDl(prev => ({ ...prev, [model_id]: { active: true, pct, downloaded_mb, total_mb, stage } }));
      }
    }).then(u => { unsub = u; });
    return () => { unsub?.(); };
  }, []);

  const downloadModel = async (modelId: string) => {
    setModelDl(prev => ({ ...prev, [modelId]: { active: true, pct: 0, stage: 'downloading' } }));
    try {
      await api.downloadModel(modelId);
      setModelDl(prev => ({ ...prev, [modelId]: { active: false, pct: 100, stage: 'done' } }));
      toast.success('模型下载完成');
    } catch (e) {
      setModelDl(prev => ({ ...prev, [modelId]: { active: false, pct: 0, stage: 'failed' } }));
      const msg = String(e);
      if (!msg.includes('已取消')) toast.error(`下载失败: ${e}`);
    }
  };

  const cancelModel = async (modelId: string) => {
    try {
      await api.cancelModelDownload(modelId);
      setModelDl(prev => ({ ...prev, [modelId]: { active: false, pct: 0, stage: 'cancelled' } }));
    } catch (e) {
      console.error('cancel model failed:', e);
    }
  };

  return (
    <ConfigContext.Provider value={{
      config, loading, refreshConfig, updateConfig, updateConfigImmediate,
      modelDl, downloadModel, cancelModel,
    }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}
