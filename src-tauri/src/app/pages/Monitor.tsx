import { useState, useEffect, useRef } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { MessageCircle, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from 'sonner';

export function Monitor() {
  const [filter, setFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkMonitorStatus();
    
    let unlisten: (() => void) | undefined;
    
    const setupListener = async () => {
      unlisten = await api.onMonitorLog((log) => {
        setLogs(prev => [...prev, log].slice(-200));
      });
    };
    
    setupListener();
    
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const checkMonitorStatus = async () => {
    try {
      const status = await api.getMonitorStatus();
      setIsMonitoring(status);
    } catch (err) {
      console.error('Failed to check monitor status:', err);
    }
  };

  const toggleMonitor = async () => {
    try {
      if (isMonitoring) {
        await api.stopMonitor();
        setIsMonitoring(false);
        toast.success('已停止监听');
      } else {
        await api.startMonitor();
        setIsMonitoring(true);
        toast.success('已开始监听');
      }
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const sendDanmu = async () => {
    if (!message.trim()) return;
    try {
      await api.sendDanmu(message);
      setMessage('');
      toast.success('弹幕已发送');
    } catch (err) {
      toast.error(`发送失败: ${err}`);
    }
  };

  const filters = [
    { id: 'all', label: '全部' },
    { id: 'danmaku', label: '弹幕' },
    { id: 'gift', label: '礼物' },
    { id: 'other', label: '其他' },
  ];

  return (
    <div className="p-4 h-full flex flex-col gap-4 overflow-hidden">
      <GlassCard className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex gap-8">
            <div>
              <div className="text-[11px] text-gray-500 mb-1">状态</div>
              <div className="font-mono text-[15px] font-semibold flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isMonitoring ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                {isMonitoring ? '运行中' : '未运行'}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant={isMonitoring ? 'primary' : 'default'}
              size="md"
              onClick={toggleMonitor}
            >
              {isMonitoring ? '停止监听' : '开始监听'}
            </Button>
            <Button variant="default" size="md" onClick={checkMonitorStatus}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="flex-1 p-5 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold">运行日志</h2>
          <div className="flex gap-2">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1 rounded-lg text-[11px] transition-all ${
                  filter === f.id
                    ? 'bg-[var(--primary-color)] text-white'
                    : 'bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 hover:bg-white/80'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button 
              onClick={() => setLogs([])}
              className="px-3 py-1 rounded-lg text-[11px] bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 hover:bg-white/80"
            >
              清空
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[11px] bg-black/5 dark:bg-black/20 p-3 rounded-lg">
          {logs.map((log, i) => (
            <div key={i} className="py-0.5 border-b border-black/5 dark:border-white/5 break-all">
              {log}
            </div>
          ))}
          <div ref={logEndRef} />
          {logs.length === 0 && <div className="text-gray-400 text-center py-10 italic">暂无日志</div>}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="flex gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendDanmu()}
            placeholder="输入要发送的弹幕（最多 30 字）…"
            className="flex-1"
            maxLength={30}
          />
          <Button variant="primary" onClick={sendDanmu} disabled={!message.trim()}>
            发送
          </Button>
        </div>
        <div className="text-[10px] text-gray-400 mt-2 text-right">
          {message.length}/30
        </div>
      </GlassCard>
    </div>
  );
}
