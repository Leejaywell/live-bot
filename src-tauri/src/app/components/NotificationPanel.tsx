import { X, Check, AlertCircle, Info, Gift } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { Button } from './Button';
import { Chip } from './Chip';

interface NotificationPanelProps {
  onClose: () => void;
}

export function NotificationPanel({ onClose }: NotificationPanelProps) {
  const notifications = [
    {
      id: 1,
      type: 'success',
      icon: Check,
      title: '登录成功',
      message: '已成功登录账号 花花直播姬',
      time: '2 分钟前',
      read: false,
    },
    {
      id: 2,
      type: 'info',
      icon: Info,
      title: '新增关注',
      message: '小迷妹 关注了你',
      time: '5 分钟前',
      read: false,
    },
    {
      id: 3,
      type: 'warning',
      icon: AlertCircle,
      title: '发送限速',
      message: '弹幕发送过快，已进入队列等待',
      time: '10 分钟前',
      read: true,
    },
    {
      id: 4,
      type: 'gift',
      icon: Gift,
      title: '收到礼物',
      message: '大老板 送出了 辣条 ×10',
      time: '15 分钟前',
      read: true,
    },
    {
      id: 5,
      type: 'info',
      icon: Info,
      title: '监听已启动',
      message: '成功连接到直播间 8792912',
      time: '1 小时前',
      read: true,
    },
  ];

  const getIconColor = (type: string) => {
    switch (type) {
      case 'success':
        return 'text-green-500';
      case 'warning':
        return 'text-yellow-500';
      case 'gift':
        return 'text-pink-500';
      default:
        return 'text-blue-500';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end pointer-events-none">
      <div className="pointer-events-auto mt-[60px] mr-4 w-[360px]">
        <GlassCard className="p-4 max-h-[calc(100vh-80px)] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[17px] font-bold">通知</h2>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                {notifications.filter(n => !n.read).length} 条未读
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-[11px]">
                全部已读
              </Button>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 -mx-2 px-2">
            {notifications.map((notification) => {
              const Icon = notification.icon;
              return (
                <div
                  key={notification.id}
                  className={`p-3 rounded-xl transition-all hover:bg-white/40 dark:hover:bg-white/10 ${
                    !notification.read ? 'bg-white/30 dark:bg-white/5' : ''
                  }`}
                >
                  <div className="flex gap-3">
                    <div className={`mt-0.5 ${getIconColor(notification.type)}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="text-[12px] font-semibold">{notification.title}</h3>
                        {!notification.read && (
                          <div className="w-2 h-2 rounded-full bg-[var(--primary-color)] flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                        {notification.message}
                      </p>
                      <span className="text-[10px] text-gray-500 dark:text-gray-500">
                        {notification.time}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-3 mt-3 border-t border-white/10">
            <Button variant="ghost" className="w-full text-[11px]">
              查看全部通知
            </Button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
