import { useEffect, useRef } from 'react';
import { Check, AlertCircle, Info, Gift } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { Button } from './Button';

interface NotificationPanelProps {
  onClose: () => void;
}

export function NotificationPanel({ onClose }: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);
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
      <div ref={panelRef} className="pointer-events-auto mt-[60px] mr-4 w-[360px]">
        <GlassCard className="p-4 max-h-[calc(100vh-80px)] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[17px] font-bold">通知</h2>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                {notifications.filter(n => !n.read).length} 条未读
              </p>
            </div>
            <Button size="sm" variant="ghost" className="text-[11px]">
              全部已读
            </Button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center space-y-4 opacity-60">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-gray-400" />
            </div>
            <div className="text-center">
              <h3 className="text-[14px] font-semibold text-gray-500">功能待开发</h3>
              <p className="text-[11px] text-gray-400 mt-1">通知中心功能正在建设中，敬请期待...</p>
            </div>
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
