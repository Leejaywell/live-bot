import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api, AppConfig } from '../lib/api';
import { toast } from 'sonner';

interface ConfigContextType {
  config: AppConfig | null;
  loading: boolean;
  refreshConfig: () => Promise<void>;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  updateConfigImmediate: (patch: Partial<AppConfig>) => void;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

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
    // 乐观更新 UI
    setConfig(next);
    try {
      await api.saveConfig(next);
    } catch (err) {
      toast.error(`保存配置失败: ${err}`);
      // 回滚
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

  return (
    <ConfigContext.Provider value={{ config, loading, refreshConfig, updateConfig, updateConfigImmediate }}>
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
