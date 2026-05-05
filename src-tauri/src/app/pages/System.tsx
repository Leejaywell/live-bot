import { FolderOpen, RefreshCw } from 'lucide-react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { Chip } from '../components/Chip';
import { useState, useEffect } from 'react';
import { api, SystemInfo } from '../lib/api';

export function System() {
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    api.getSystemInfo().then(setInfo).catch(console.error);
  }, []);

  return (
    <div className="p-[18px] space-y-4 max-w-3xl">
      <GlassCard className="p-5">
        <h2 className="text-[12px] font-semibold mb-4">版本</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <label className="w-24 text-[11px] text-gray-500">当前版本</label>
            <span className="font-mono text-[12px]">v{info?.version || '0.0.0'}</span>
          </div>
          <div className="flex items-center gap-4">
            <label className="w-24 text-[11px] text-gray-500">最新版本</label>
            <span className="font-mono text-[12px]">v{info?.version || '0.0.0'}</span>
            <Chip variant="success">已是最新</Chip>
          </div>
        </div>
        <Button variant="primary" className="w-full mt-4">
          <RefreshCw className="w-3.5 h-3.5" />
          检查更新
        </Button>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-[12px] font-semibold mb-4">配置</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <label className="w-24 text-[11px] text-gray-500">路径</label>
            <span className="font-mono text-[11px]">{info?.config_path || '加载中...'}</span>
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <div className="flex flex-col items-center gap-1">
            <IconButton onClick={() => info && api.openUrl('.')}>
              <FolderOpen className="w-4 h-4" />
            </IconButton>
            <span className="text-[9px] text-gray-500">打开目录</span>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-[12px] font-semibold mb-4">数据</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <label className="w-24 text-[11px] text-gray-500">DB 路径</label>
            <span className="font-mono text-[11px]">{info?.db_path || '加载中...'}</span>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
