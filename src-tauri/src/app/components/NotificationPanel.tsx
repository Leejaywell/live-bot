import { useEffect, useRef } from 'react';
import { Check, AlertCircle, Info, Gift, Bell } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { Button } from './Button';
import { cn } from '../lib/utils';
import { AppNotif } from '../App';

interface NotificationPanelProps {
  notifications: AppNotif[];
  onClose: () => void;
  onMarkAllRead: () => void;
}

const TYPE_META: Record<AppNotif['type'], { icon: React.ElementType; color: string; bg: string }> = {
  success: { icon: Check,        color: 'text-green-500',  bg: 'bg-green-500/10'  },
  gift:    { icon: Gift,         color: 'text-pink-500',   bg: 'bg-pink-500/10'   },
  warning: { icon: AlertCircle,  color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  error:   { icon: AlertCircle,  color: 'text-red-500',    bg: 'bg-red-500/10'    },
  info:    { icon: Info,         color: 'text-blue-500',   bg: 'bg-blue-500/10'   },
};

function timeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)   return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400)return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export function NotificationPanel({ notifications, onClose, onMarkAllRead }: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = notifications.filter(n => !n.read).length;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end pointer-events-none">
      <div ref={panelRef} className="pointer-events-auto mt-[60px] mr-4 w-[360px] animate-in slide-in-from-top-2 fade-in duration-200">
        <GlassCard className="max-h-[calc(100vh-80px)] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-bold">通知</h2>
              {unread > 0 && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-red-500 text-white animate-in zoom-in duration-200">
                  {unread}
                </span>
              )}
            </div>
            {unread > 0 && (
              <Button size="sm" variant="ghost" className="text-[10px] h-7" onClick={onMarkAllRead}>
                全部已读
              </Button>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto scrollbar-none">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 opacity-40">
                <Bell className="w-10 h-10 text-gray-400" />
                <p className="text-[12px] font-semibold text-gray-500">暂无通知</p>
                <p className="text-[10px] text-gray-400">监听直播间后，关注、礼物等事件将在此显示</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {notifications.map((n, i) => {
                  const { icon: Icon, color, bg } = TYPE_META[n.type];
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        'flex items-start gap-3 px-3 py-2.5 rounded-xl transition-colors cursor-default',
                        'animate-item-in',
                        n.read
                          ? 'opacity-60 hover:opacity-80 hover:bg-black/3 dark:hover:bg-white/3'
                          : 'bg-[var(--primary-color)]/4 hover:bg-[var(--primary-color)]/8',
                      )}
                      style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                    >
                      <div className={cn('w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 transition-transform hover:scale-110', bg)}>
                        <Icon className={cn('w-3.5 h-3.5', color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-[11px] font-bold truncate">{n.title}</span>
                          <span className="text-[9px] text-gray-400 shrink-0">{timeAgo(n.time)}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">{n.message}</p>
                      </div>
                      {!n.read && (
                        <div className="w-1.5 h-1.5 rounded-full bg-[var(--primary-color)] shrink-0 mt-1.5" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
