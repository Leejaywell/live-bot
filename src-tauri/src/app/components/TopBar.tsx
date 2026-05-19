import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Bell, User, LogIn, X, RefreshCw, Unplug, Play, Square, Copy, Radio } from 'lucide-react';
import { IconButton } from './IconButton';
import { Button } from './Button';
import { UserInfo, RoomInfo, AnchorInfo, api } from '../lib/api';
import { toast } from 'sonner';

function useProxiedImage(url: string | undefined) {
  const [src, setSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!url) { setSrc(undefined); return; }
    api.proxyImage(url).then(setSrc).catch(() => setSrc(undefined));
  }, [url]);
  return src;
}

interface TopBarProps {
  onToggleNotifications?: () => void;
  isLoggedIn: boolean;
  userInfo: UserInfo | null;
  userRoom: RoomInfo | null;
  anchorInfo: AnchorInfo | null;
  onRequireLogin: () => void;
  onLogout: () => void;
  autoRoom?: { roomId: string; liveStatus: number; liveTime: string } | null;
  onAutoRoomConsumed?: () => void;
  onDisconnect: () => void;
  onOpenRoomModal: () => void;
  onRefreshUserInfo: () => Promise<UserInfo | null>;
  unreadCount?: number;
}

function formatNum(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

export function TopBar({ onToggleNotifications, isLoggedIn, userInfo, userRoom, anchorInfo, onRequireLogin, onLogout, autoRoom, onAutoRoomConsumed, onDisconnect, onOpenRoomModal, onRefreshUserInfo, unreadCount = 0 }: TopBarProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [currentRoom, setCurrentRoom] = useState('');
  const [roomCategory, setRoomCategory] = useState('未开播');
  const [liveDuration, setLiveDuration] = useState(0);
  const [onlineCount, setOnlineCount] = useState(0);
  const avatarSrc = useProxiedImage(userInfo?.face || undefined);
  const anchorFace = useProxiedImage(anchorInfo?.face || undefined);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  // 从开播时间字符串（北京时间）计算已过秒数
  const calcElapsed = (liveTime: string): number => {
    if (!liveTime || liveTime.startsWith('0000')) return 0;
    const start = new Date(liveTime.replace(' ', 'T') + '+08:00');
    const elapsed = Math.floor((Date.now() - start.getTime()) / 1000);
    return elapsed > 0 ? elapsed : 0;
  };

  // 自动连接房间（不再在此 toast：启动恢复时静默，用户主动连接由 handleRoomConnected 自己提示）
  useEffect(() => {
    if (autoRoom && isLoggedIn) {
      const live = autoRoom.liveStatus === 1;
      setCurrentRoom(autoRoom.roomId);
      setIsConnected(true);
      setIsLive(live);
      setRoomCategory(live ? '直播中' : '未开播');
      setLiveDuration(live ? calcElapsed(autoRoom.liveTime) : 0);
      onAutoRoomConsumed?.();
    }
  }, [autoRoom, isLoggedIn]);

  // 监听 WebSocket 实时状态更新
  useEffect(() => {
    if (!isConnected) return;
    let unlistenStatus: (() => void) | undefined;
    let unlistenOnline: (() => void) | undefined;
    api.onRoomStatus((data) => {
      const live = data.live_status === 1;
      setIsLive(live);
      setRoomCategory(live ? '直播中' : '未开播');
      setOnlineCount(data.online);
      if (live && data.live_time) setLiveDuration(calcElapsed(data.live_time));
    }).then(fn => { unlistenStatus = fn; });
    api.onRoomOnline((data) => {
      setOnlineCount(data.count);
    }).then(fn => { unlistenOnline = fn; });
    return () => { unlistenStatus?.(); unlistenOnline?.(); };
  }, [isConnected]);

  // 点击外部关闭用户菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideAvatar = userMenuRef.current?.contains(target);
      const insidePanel = menuPanelRef.current?.contains(target);
      if (!insideAvatar && !insidePanel) {
        setShowUserMenu(false);
      }
    };
    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu]);

  useEffect(() => {
    if (!isConnected) { setIsMonitoring(false); return; }
    api.getMonitorStatus().then(setIsMonitoring).catch(() => {});
    const interval = setInterval(() => {
      api.getMonitorStatus().then(setIsMonitoring).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const handleToggleMonitor = async () => {
    try {
      if (isMonitoring) {
        await api.stopMonitor();
        setIsMonitoring(false);
        toast.success('停止获取消息');
      } else {
        await api.startMonitor();
        setIsMonitoring(true);
      }
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setIsLive(false);
    setCurrentRoom('');
    setLiveDuration(0);
    setOnlineCount(0);
    setIsMonitoring(false);
    toast.success('已退出直播间');
    onDisconnect();
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isConnected && isLive) {
      timer = setInterval(() => setLiveDuration((prev) => prev + 1), 1000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [isConnected, isLive]);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatCookieTime = (savedAt: number) => {
    if (!savedAt) return '未知';
    const date = new Date(savedAt * 1000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <>
      <div
        className="h-[56px] glass-topbar flex items-center justify-between pl-3 pr-4 relative"
      >
        <div className="flex items-center gap-4 flex-1 ml-4">
          {isConnected ? (
            <>
              <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-[var(--surface-subtle)] border border-[var(--surface-border)]">
                {/* 主播头像 */}
                {anchorFace ? (
                  <img src={anchorFace} className="w-12 h-12 rounded-full border-2 border-white/50 flex-shrink-0 object-cover shadow-sm" />
                ) : (
                  <div className="w-12 h-12 rounded-full border-2 border-white/20 bg-white/10 flex-shrink-0" />
                )}
                {/* 主播名 + 勋章 */}
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-black tracking-tight">{anchorInfo?.uname || `房间 ${currentRoom}`}</span>
                    {anchorInfo?.medal_name && (
                      <span className="px-2 py-0.5 rounded-md text-[9px] font-black bg-gradient-to-br from-pink-500 to-rose-500 text-white shadow-sm leading-none">
                        {anchorInfo.medal_name}
                      </span>
                    )}
                  </div>
                  {/* 直播状态行 */}
                  <div className="flex items-center gap-1.5">
                    <div className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${isLive ? 'bg-green-500 animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-gray-400'}`} />
                    <span className={`text-[11px] font-semibold ${isLive ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>{roomCategory}</span>
                    {isLive && onlineCount > 0 && (
                      <span className="text-[10px] text-gray-400 font-medium">· {formatNum(onlineCount)} 人气</span>
                    )}
                  </div>
                </div>

                <span className="w-px h-6 bg-black/10 dark:bg-white/10 mx-0.5" />

                {/* 直播时长 */}
                {isLive && (
                  <div className="text-[12px] font-mono font-bold text-gray-600 dark:text-gray-300">
                    {formatDuration(liveDuration)}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 ml-1">
                {/* 停止/获取事件 */}
                {isMonitoring ? (
                  <button
                    onClick={handleToggleMonitor}
                    className="inline-flex items-center justify-center gap-1.5 h-[32px] px-4 rounded-full text-[12px] font-bold transition-all bg-red-500 text-white border border-red-500 hover:bg-red-600 hover:border-red-600 shadow-sm active:scale-95"
                  >
                    <Square className="w-3 h-3 fill-current" />停止监听
                  </button>
                ) : (
                  <button
                    onClick={handleToggleMonitor}
                    className="inline-flex items-center justify-center gap-1.5 h-[32px] px-4 rounded-full text-[12px] font-bold text-white transition-all hover:opacity-90 shadow-md active:scale-95"
                    style={{ background: 'var(--primary-color)' }}
                  >
                    <Play className="w-3 h-3 fill-current" />开始监听
                  </button>
                )}

                {/* 断开连接 */}
                <button
                  onClick={handleDisconnect}
                  className="inline-flex items-center justify-center gap-1.5 h-[32px] px-4 rounded-full text-[12px] font-bold transition-all bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-400 hover:bg-red-500 hover:text-white hover:border-transparent shadow-sm"
                >
                  <Unplug className="w-3.5 h-3.5" />断开连接
                </button>
              </div>
            </>
          ) : (
            isLoggedIn && (
              <Button
                size="sm"
                variant="primary"
                onClick={onOpenRoomModal}
                className="font-bold shadow-sm"
              >
                <Radio className="w-3.5 h-3.5" />
                连接房间
              </Button>
            )
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <IconButton onClick={onToggleNotifications} title="通知">
              <Bell className={`w-[18px] h-[18px] transition-transform duration-300 ${unreadCount > 0 ? 'animate-[bell-shake_0.6s_ease_both]' : ''}`} />
            </IconButton>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 animate-in zoom-in duration-200 pointer-events-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          {isLoggedIn ? (
            <div className="relative" ref={userMenuRef}>
              <div
                ref={avatarRef}
                className="w-[36px] h-[36px] rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 overflow-hidden border-2 border-white shadow-md"
                onClick={() => {
                  if (!showUserMenu && avatarRef.current) {
                    const rect = avatarRef.current.getBoundingClientRect();
                    setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
                  }
                  setShowUserMenu(!showUserMenu);
                }}
              >
                {avatarSrc ? (
                  <img src={avatarSrc} alt="face" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[var(--primary-color)] text-white">
                    <User className="w-5 h-5" />
                  </div>
                )}
              </div>

              {showUserMenu && createPortal(
                <div ref={menuPanelRef} className="fixed w-72 glass-card backdrop-blur-xl rounded-2xl overflow-hidden shadow-2xl border z-[9999]" style={{ top: menuPos.top, right: menuPos.right, borderColor: 'var(--surface-border)' }}>
                  <div className="p-5 border-b bg-[var(--surface-subtle)]" style={{ borderColor: 'var(--surface-border)' }}>
                    {/* 头像 + 昵称 */}
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white shadow-md flex-shrink-0">
                        {avatarSrc ? (
                          <img src={avatarSrc} alt="face" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-[var(--primary-color)] text-white">
                            <User className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-[14px] font-bold truncate tracking-tight"
                          style={userInfo?.vip_nickname_color ? { color: userInfo.vip_nickname_color } : undefined}
                        >
                          {userInfo?.uname || '未获取到昵称'}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {userInfo?.level != null && userInfo.level > 0 && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-black bg-blue-500/10 text-blue-500 border border-blue-500/20">
                              Lv.{userInfo.level}
                            </span>
                          )}
                          {userInfo?.vip_status === 1 && (
                            <span className={`px-2 py-0.5 rounded-md text-[9px] font-black border ${userInfo.vip_type >= 2 ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' : 'bg-pink-500/10 text-pink-500 border-pink-500/20'}`}>
                              {userInfo.vip_type >= 2 ? '年度大会员' : '大会员'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2 text-[11px] text-[var(--muted-text)]">
                      <button
                        className="w-full flex justify-between items-center px-2 py-1 rounded-lg bg-[var(--surface-subtle)] hover:bg-[var(--surface-subtle-strong)] transition-colors group cursor-copy"
                        onClick={() => { navigator.clipboard.writeText(String(userInfo?.uid ?? '')); toast.success('UID 已复制'); }}
                        title="点击复制 UID"
                      >
                        <span className="font-bold">UID</span>
                        <span className="flex items-center gap-1.5 font-mono text-gray-600 dark:text-gray-300">
                          {userInfo?.uid || '---'}
                          <Copy className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                        </span>
                      </button>
                      {userRoom && (
                        <>
                          <button
                            className="w-full flex justify-between items-center px-2 py-1 rounded-lg bg-[var(--surface-subtle)] hover:bg-[var(--surface-subtle-strong)] transition-colors group cursor-copy"
                            onClick={() => { navigator.clipboard.writeText(String(userRoom.room_id)); toast.success('房间号已复制'); }}
                            title="点击复制房间号"
                          >
                            <span className="font-bold">直播间</span>
                            <span className="flex items-center gap-1.5 font-mono text-gray-600 dark:text-gray-300">
                              {userRoom.room_id}
                              <Copy className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                            </span>
                          </button>
                          <div className="flex justify-between items-center px-2 py-1 rounded-lg bg-[var(--surface-subtle)]">
                            <span className="font-bold">状态</span>
                            <span className={`flex items-center gap-1.5 font-bold ${userRoom.live_status === 1 ? 'text-green-500' : 'text-gray-400'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full inline-block ${userRoom.live_status === 1 ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                              {userRoom.live_status === 1 ? `正在直播` : '未开播'}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="p-2.5 space-y-1 bg-white/20 dark:bg-black/5">
                    <button
                      onClick={async () => {
                        if (refreshing) return;
                        setRefreshing(true);
                        try {
                          await onRefreshUserInfo();
                          toast.success('用户信息已刷新');
                        } finally {
                          setRefreshing(false);
                        }
                      }}
                      disabled={refreshing}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl hover:bg-white/60 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 transition-all active:scale-[0.98] disabled:opacity-60"
                    >
                      <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                      <span className="text-[12px] font-bold">{refreshing ? '正在同步...' : '同步云端信息'}</span>
                    </button>
                    <button
                      onClick={onLogout}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl hover:bg-red-500 hover:text-white dark:hover:bg-red-500/20 dark:hover:text-red-400 text-red-500 transition-all active:scale-[0.98]"
                    >
                      <X className="w-4 h-4" />
                      <span className="text-[12px] font-bold">退出当前账号</span>
                    </button>
                  </div>
                </div>,
                document.body
              )}
            </div>
          ) : (
            <Button size="sm" variant="primary" onClick={onRequireLogin} className="font-bold shadow-md">
              <LogIn className="w-3.5 h-3.5 mr-1.5" />
              立即登录
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
