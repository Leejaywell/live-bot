import { useState, useEffect, useRef, useCallback } from 'react';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Play, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useLoggedIn } from '../context/LoginContext';

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
  console.log('[Monitor] Parsing log:', text);
  const time = new Date().toLocaleTimeString();
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
  // Skip high-frequency popularity heartbeats
  if (text.startsWith('人气 ')) return null;
  // All other messages (system/connection/status)
  return { id, type: 'system', text, time };
}

const typeColors: Record<LogType, string> = {
  danmu: 'text-sky-600 dark:text-sky-400',
  gift: 'text-amber-600 dark:text-amber-400',
  interact: 'text-green-600 dark:text-green-400',
  other: 'text-purple-600 dark:text-purple-400',
  system: 'text-gray-400',
};

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

  // Flush buffered log entries every 200ms for smooth real-time display
  const flushLogs = useCallback(() => {
    if (bufferRef.current.length === 0) return;
    console.log('[Monitor] Flushing logs:', bufferRef.current.length);
    setLogs(prev => {
      const next = [...prev, ...bufferRef.current];
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
    bufferRef.current = [];
  }, []);

  useEffect(() => {
    console.log('[Monitor] Component mounted');
    // Add a local log to verify rendering
    bufferRef.current.push({ id: _logId++, type: 'system', text: '前端监控组件已就绪', time: new Date().toLocaleTimeString() });
    flushLogs();
    
    checkMonitorStatus();
    // ... rest of the logic

    // Load buffered history immediately so page shows logs on first open
    api.getMonitorLogs().then(rawLogs => {
      bufferRef.current = rawLogs
        .map(parseMonitorLog)
        .filter((e): e is LogEntry => e !== null)
        .slice(-200);
      flushLogs();
    }).catch(console.error);

    // Poll danmaku buffer every 150ms (direct mpsc channel, no Tauri broadcast overhead)
    const pollTimer = setInterval(async () => {
      try {
        const lines = await api.getRecentDanmaku();
        if (lines.length > 0) {
          for (const line of lines) {
            const entry = parseMonitorLog(line);
            if (entry) bufferRef.current.push(entry);
          }
        }
      } catch {}
    }, 150);

    // Batch flush to React state every 200ms
    const flushTimer = setInterval(flushLogs, 200);

    let unlistenLog: (() => void) | undefined;
    let unlistenLive: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    const setup = async () => {
      unlistenLog = await api.onMonitorLog((text) => {
        console.log('[Monitor] Log received:', text);
        const entry = parseMonitorLog(text);
        if (entry) bufferRef.current.push(entry);
      });
      unlistenLive = await api.onLiveEvent((parsed: any) => {
        console.log('[Monitor] Event received:', parsed);
        const event = parsed?.event ?? parsed;
        const time = new Date().toLocaleTimeString();
        const type = event?.type || event?.cmd;
        if (type === 'Danmu' || type === 'DANMU_MSG') {
          const user = event.user || event.info?.[2]?.[1] || '未知';
          const text = event.text || event.info?.[1] || '';
          if (text) {
            bufferRef.current.push({ id: _logId++, type: 'danmu', text: `弹幕 ${user}: ${text}`, user, content: text, time });
          }
        }
      });
      unlistenStatus = await api.onMonitorStatus((status) => {
        if (status === '已停止') { setIsMonitoring(false); }
        else if (status === '运行中') { setIsMonitoring(true); }
      });
    };
    setup();

    return () => {
      clearInterval(pollTimer);
      clearInterval(flushTimer);
      if (unlistenLog) unlistenLog();
      if (unlistenLive) unlistenLive();
      if (unlistenStatus) unlistenStatus();
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
    if (!loggedIn) { toast.info('请先登录'); return; }
    try {
      if (isMonitoring) {
        await api.stopMonitor();
        setIsMonitoring(false);
      } else {
        await api.startMonitor();
        setIsMonitoring(true);
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
    <div className="p-4 h-full flex flex-col gap-4 overflow-hidden">
      <GlassCard className="flex-1 p-4 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${isMonitoring ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            <span className="text-[11px] text-gray-500">{isMonitoring ? '监听中' : '未监听'}</span>
          </div>
          <div className="flex gap-1.5">
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

        <div className="flex-1 overflow-y-auto space-y-0.5 bg-black/5 dark:bg-black/20 p-3 rounded-lg">
          {filteredLogs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-2 py-1 border-b border-black/5 dark:border-white/5 text-[11px]"
            >
              <span className="text-gray-400 shrink-0 font-mono w-[52px]">{log.time}</span>
              <span className={`shrink-0 font-semibold w-[28px] ${typeColors[log.type]}`}>
                {typeBadge[log.type]}
              </span>
              <span className="break-all">
                {log.type === 'danmu' ? (
                  <>
                    <span className="font-medium">{log.user}</span>
                    <span className="text-gray-400 mx-1">:</span>
                    <span>{log.content}</span>
                  </>
                ) : (
                  <span className={log.type === 'system' ? 'text-gray-400 italic' : ''}>{log.text}</span>
                )}
              </span>
            </div>
          ))}
          <div ref={logEndRef} />
          {filteredLogs.length === 0 && (
            <div className="text-gray-400 text-center py-10 italic text-[11px]">
              {isMonitoring ? '监听中，等待弹幕...' : '点击右下角 ▶ 开始获取'}
            </div>
          )}
        </div>
      </GlassCard>

      <GlassCard className="p-4">
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
          {!isMonitoring && (
            <button
              onClick={toggleMonitor}
              title="开始获取"
              className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 hover:bg-white/80 transition-all flex-shrink-0"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={checkMonitorStatus}
            title="刷新状态"
            className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 hover:bg-white/80 transition-all flex-shrink-0"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="text-[10px] text-gray-400 mt-2 text-right">
          {message.length}/30
        </div>
      </GlassCard>
    </div>
  );
}
