import { useState, useEffect, useRef, useCallback } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { Play, RefreshCw, Square } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useLoggedIn } from '../context/LoginContext';
import { cn } from '../lib/utils';

type LogType = 'danmu' | 'gift' | 'interact' | 'other' | 'system';

interface LogEntry {
  id: number;
  type: LogType;
  text: string;
  user?: string;
  content?: string;
  time: string;
}

let _logId = 0;

function parseMonitorLog(text: string): LogEntry | null {
  if (!text) return null;
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const id = _logId++;

  if (text.startsWith('弹幕 ')) {
    const rest = text.slice(3);
    const colonIdx = rest.indexOf(': ');
    if (colonIdx >= 0) {
      return { id, type: 'danmu', text, user: rest.slice(0, colonIdx), content: rest.slice(colonIdx + 2), time };
    }
    return { id, type: 'danmu', text, time };
  }
  if (text.startsWith('礼物 ') || text.startsWith('大航海 ')) {
    return { id, type: 'gift', text, time };
  }
  if (
    text.startsWith('进场 ') || text.startsWith('进场特效 ') ||
    text.startsWith('关注 ') || text.startsWith('分享 ') || text.startsWith('互动 ')
  ) {
    return { id, type: 'interact', text, time };
  }
  if (text.startsWith('禁言 ') || text.startsWith('PK ') || text.startsWith('红包 ') || text.startsWith('天选 ')) {
    return { id, type: 'other', text, time };
  }
  if (text.startsWith('人气 ')) return null;
  return { id, type: 'system', text, time };
}

const typeBadge: Record<LogType, string> = {
  danmu: '弹幕',
  gift: '礼物',
  interact: '互动',
  other: '其他',
  system: '系统',
};

export function Monitor() {
  const [filter, setFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<LogEntry[]>([]);
  const loggedIn = useLoggedIn();

  const flushLogs = useCallback(() => {
    if (bufferRef.current.length === 0) return;
    setLogs(prev => {
      const next = [...prev, ...bufferRef.current];
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
    bufferRef.current = [];
  }, []);

  useEffect(() => {
    checkMonitorStatus();
    
    api.getMonitorLogs().then(rawLogs => {
      bufferRef.current = (rawLogs || [])
        .map(parseMonitorLog)
        .filter((e): e is LogEntry => e !== null)
        .slice(-200);
      flushLogs();
    }).catch(console.error);

    const pollTimer = setInterval(async () => {
      try {
        const lines = await api.getRecentDanmaku();
        if (lines && lines.length > 0) {
          for (const line of lines) {
            const entry = parseMonitorLog(line);
            if (entry) bufferRef.current.push(entry);
          }
        }
      } catch {}
    }, 150);

    const flushTimer = setInterval(flushLogs, 200);

    let unlistenLog: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    const setup = async () => {
      try {
        unlistenLog = await api.onMonitorLog((text) => {
          const entry = parseMonitorLog(text);
          if (entry) bufferRef.current.push(entry);
        });
        unlistenStatus = await api.onMonitorStatus((status) => {
          setIsMonitoring(status === '运行中');
        });
      } catch (err) {
        console.error(err);
      }
    };
    setup();

    return () => {
      clearInterval(pollTimer);
      clearInterval(flushTimer);
      if (unlistenLog) unlistenLog();
      if (unlistenStatus) unlistenStatus();
    };
  }, [flushLogs]);

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
    if (!loggedIn) { toast.info('请先登录'); return; }
    try {
      if (isMonitoring) {
        await api.stopMonitor();
        setIsMonitoring(false);
        toast.success('停止获取消息');
      } else {
        await api.startMonitor();
        setIsMonitoring(true);
        toast.success('开始获取消息');
      }
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const sendDanmu = async () => {
    if (!loggedIn) { toast.info('请先登录'); return; }
    if (!message.trim()) return;
    try {
      await api.sendDanmu(message);
      setMessage('');
    } catch (err) {
      toast.error(`发送失败: ${err}`);
    }
  };

  const filters = [
    { id: 'all', label: '全部' },
    { id: 'danmaku', label: '弹幕' },
    { id: 'gift', label: '礼物' },
    { id: 'interact', label: '互动' },
    { id: 'other', label: '其他' },
  ];

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    if (filter === 'danmaku') return log.type === 'danmu';
    if (filter === 'gift') return log.type === 'gift';
    if (filter === 'interact') return log.type === 'interact';
    if (filter === 'other') return log.type === 'other' || log.type === 'system';
    return true;
  });

  return (
    <div className="p-5 h-full flex flex-col gap-4 overflow-hidden">
      <GlassCard className="flex-1 flex flex-col overflow-hidden border-white/60 dark:border-white/10 shadow-xl">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-black/5 dark:border-white/5 bg-white/30 dark:bg-black/10 shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/50 dark:bg-white/5 border border-white/20">
              <div className={`w-2 h-2 rounded-full ${isMonitoring ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-gray-400'}`} />
              <span className="text-[11px] font-black text-gray-600 dark:text-gray-300">同步</span>
            </div>

            <button
              onClick={() => {
                 if (isMonitoring) toggleMonitor();
              }}
              className="h-[30px] px-4 rounded-full text-[11px] font-black bg-[#ff950015] border border-[#ff950030] text-[#ff9500] hover:bg-[#ff9500] hover:text-white transition-all active:scale-95"
            >
              暂停读取
            </button>

            <div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-1" />

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">读取弹幕</span>
              <Toggle checked={isMonitoring} onChange={toggleMonitor} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex p-1 rounded-full bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
              {filters.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`px-4 py-1.5 rounded-full text-[11px] font-black transition-all ${
                    filter === f.id
                      ? 'bg-[var(--primary-color)] text-white shadow-md'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setLogs([])}
              className="h-[32px] px-4 rounded-full text-[11px] font-black border border-gray-200 dark:border-white/20 text-gray-500 hover:bg-white/60 transition-all ml-2 active:scale-95"
            >
              清空记录
            </button>
          </div>
        </div>

        {/* Log Content */}
        <div className="flex-1 overflow-y-auto bg-white/20 dark:bg-transparent scrollbar-none">
          <div className="divide-y divide-black/5 dark:divide-white/5">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-center gap-4 px-6 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group"
              >
                <span className="text-[11px] text-gray-400 font-mono w-14 shrink-0 font-bold">{log.time}</span>
                <div className={cn(
                  "px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider shrink-0 text-center min-w-[40px] shadow-sm",
                  log.type === 'danmu' ? 'bg-blue-500/10 text-blue-500' :
                  log.type === 'gift' ? 'bg-amber-500/10 text-amber-500' :
                  log.type === 'interact' ? 'bg-green-500/10 text-green-500' :
                  'bg-gray-500/10 text-gray-500'
                )}>
                  {typeBadge[log.type]}
                </div>
                <div className="flex-1 min-w-0 text-[12px] leading-relaxed">
                  {log.type === 'danmu' ? (
                    <div className="flex items-center gap-2">
                      <span className="font-black text-gray-700 dark:text-gray-200 shrink-0">{log.user}</span>
                      <span className="text-gray-500 dark:text-gray-400 break-all font-medium">{log.content}</span>
                    </div>
                  ) : (
                    <span className={cn(
                      "font-bold",
                      log.type === 'system' ? 'text-gray-400 italic' : 'text-gray-600 dark:text-gray-300'
                    )}>
                      {log.text}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div ref={logEndRef} />
          {filteredLogs.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-5 py-20 opacity-40">
              <div className="w-14 h-14 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center border border-black/5">
                <RefreshCw className={cn("w-7 h-7 text-gray-300", isMonitoring && "animate-spin")} />
              </div>
              <p className="text-[13px] text-gray-400 font-black italic tracking-widest">
                {isMonitoring ? '正在同步最新动态...' : '同步已暂停'}
              </p>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Input Area */}
      <GlassCard className="p-4 border-white/60 dark:border-white/10 shadow-lg bg-white/60">
        <div className="flex gap-3 items-center">
          <div className="flex-1 relative group">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendDanmu()}
              placeholder="输入要发送的弹幕 (最多 30 字) ..."
              className="w-full h-[48px] px-6 pr-14 rounded-[24px] bg-black/5 dark:bg-white/5 border-transparent focus:bg-white dark:focus:bg-white/10 text-[13px] font-bold shadow-inner transition-all"
              maxLength={30}
            />
            <div className="absolute right-5 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-300 pointer-events-none select-none group-focus-within:text-[var(--primary-color)] transition-colors">
              {message.length}/30
            </div>
          </div>
          <button
            onClick={sendDanmu}
            disabled={!message.trim()}
            className={cn(
              "h-[48px] px-10 rounded-[24px] text-[13px] font-black transition-all active:scale-95 shadow-lg",
              message.trim() 
                ? "bg-[var(--primary-color)] text-white shadow-[0_8px_20px_-4px_rgba(var(--primary-rgb),0.5)]"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            )}
          >
            {message.trim() ? '发送' : '未输入'}
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
