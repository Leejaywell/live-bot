import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Bell, User, LogIn, Link as LinkIcon, X, RefreshCw, Unplug, Play, Square } from 'lucide-react';
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
  sidebarCollapsed?: boolean;
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
  showConnectHint?: boolean;
}

function formatNum(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

export function TopBar({ onToggleNotifications, sidebarCollapsed, isLoggedIn, userInfo, userRoom, anchorInfo, onRequireLogin, onLogout, autoRoom, onAutoRoomConsumed, onDisconnect, onOpenRoomModal, onRefreshUserInfo, showConnectHint }: TopBarProps) {
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

  // 自动连接房间
  useEffect(() => {
    if (autoRoom && isLoggedIn) {
      const live = autoRoom.liveStatus === 1;
      setCurrentRoom(autoRoom.roomId);
      setIsConnected(true);
      setIsLive(live);
      setRoomCategory(live ? '直播中' : '未开播');
      setLiveDuration(live ? calcElapsed(autoRoom.liveTime) : 0);
      onAutoRoomConsumed?.();
      toast.success(`已连接到直播间 ${autoRoom.roomId}`);
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

  // 点击外部关闭用户菜单（需同时排除 portal 中的面板内容）
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
    onDisconnect();
  };

  // 计时器：仅直播中时运行
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
        className="h-[52px] glass-topbar backdrop-blur-xl flex items-center justify-between pr-4 relative"
        style={{ paddingLeft: sidebarCollapsed ? '60px' : '16px' }}
      >
        <span
          className="absolute left-1/2 -translate-x-1/2 text-[12px] pointer-events-none transition-opacity duration-500 select-none"
          style={{ opacity: showConnectHint ? 1 : 0 }}
        >
          请先连接房间
        </span>
        <div className="flex items-center gap-3">
          {isConnected ? (
            <>
              <div className="flex items-center gap-2">
                {/* 主播头像 */}
                {anchorFace ? (
                  <img src={anchorFace} className="w-7 h-7 rounded-full border border-white/20 flex-shrink-0 object-cover" />
                ) : (
                  <div className="w-7 h-7 rounded-full border border-white/20 bg-white/10 flex-shrink-0" />
                )}
                {/* 主播名 + 勋章 */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold">{anchorInfo?.uname || `房间 ${currentRoom}`}</span>
                  {anchorInfo?.medal_name && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-pink-500/20 text-pink-400 border border-pink-500/30 leading-none">
                      {anchorInfo.medal_name}
                    </span>
                  )}
                </div>
                {/* 粉丝数 */}
                {anchorInfo && anchorInfo.follower_num > 0 && (
                  <>
                    <span className="text-gray-400 text-[11px]">·</span>
                    <span className="text-[11px] text-gray-400">{formatNum(anchorInfo.follower_num)}粉丝</span>
                  </>
                )}
                <span className="text-gray-400 text-[11px]">·</span>
                {/* 直播状态 + 时长 + 在线 */}
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <div className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                  <span>{roomCategory}</span>
                  {isLive && onlineCount > 0 && (
                    <span className="text-gray-400">{formatNum(onlineCount)}人</span>
                  )}
                  {isLive && (
                    <>
                      <span className="text-gray-400">·</span>
                      <span>{formatDuration(liveDuration)}</span>
                    </>
                  )}
                </div>
              </div>
              <Button size="sm" variant="primary" onClick={handleDisconnect}>
                <Unplug className="w-3.5 h-3.5 mr-1" />
                退出房间
              </Button>
              <Button size="sm" variant="primary" onClick={handleToggleMonitor}>
                {isMonitoring ? (
                  <><Square className="w-3 h-3 mr-1" />停止事件</>
                ) : (
                  <><Play className="w-3 h-3 mr-1" />获取事件</>
                )}
              </Button>
            </>
          ) : isLoggedIn ? (
            <Button size="sm" variant="primary" onClick={onOpenRoomModal}>
              <LinkIcon className="w-3.5 h-3.5 mr-1.5" />
              连接直播间
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <IconButton onClick={onToggleNotifications}>
            <Bell className="w-4 h-4" />
          </IconButton>
          {isLoggedIn ? (
            <div className="relative" ref={userMenuRef}>
              <div
                ref={avatarRef}
                className="w-[32px] h-[32px] rounded-full flex items-center justify-center cursor-pointer transition-all hover:opacity-80 overflow-hidden border border-white/20"
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
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>

              {showUserMenu && createPortal(
                <div ref={menuPanelRef} className="fixed w-72 glass-card backdrop-blur-xl rounded-xl overflow-hidden shadow-lg border border-white/10 z-[9999]" style={{ top: menuPos.top, right: menuPos.right }}>
                  <div className="p-4 border-b border-white/10">
                    {/* 头像 + 昵称 */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-full overflow-hidden border border-white/20 flex-shrink-0">
                        {avatarSrc ? (
                          <img src={avatarSrc} alt="face" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-[var(--primary-color)] text-white">
                            <User className="w-5 h-5" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-[13px] font-semibold truncate"
                          style={userInfo?.vip_nickname_color ? { color: userInfo.vip_nickname_color } : undefined}
                        >
                          {userInfo?.uname || '未获取到昵称'}
                        </div>
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {userInfo?.level != null && userInfo.level > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                              Lv.{userInfo.level}
                            </span>
                          )}
                          {userInfo?.vip_status === 1 && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${userInfo.vip_type >= 2 ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : 'bg-pink-500/20 text-pink-400 border-pink-500/30'}`}>
                              {userInfo.vip_type >= 2 ? '年度大会员' : '大会员'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5 text-[10px] text-gray-400">
                      <div className="flex justify-between items-center">
                        <span>UID</span>
                        <span className="font-mono text-gray-300 select-all">{userInfo?.uid || '---'}</span>
                      </div>
                      {userRoom && (
                        <>
                          <div className="flex justify-between items-center">
                            <span>直播间号</span>
                            <span className="font-mono text-gray-300 select-all">{userRoom.room_id}</span>
                          </div>
                          {userRoom.short_id > 0 && userRoom.short_id !== userRoom.room_id && (
                            <div className="flex justify-between items-center">
                              <span>短号</span>
                              <span className="font-mono text-gray-300">{userRoom.short_id}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center">
                            <span>直播状态</span>
                            <span className={`flex items-center gap-1 ${userRoom.live_status === 1 ? 'text-green-400' : 'text-gray-400'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full inline-block ${userRoom.live_status === 1 ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
                              {userRoom.live_status === 1 ? `直播中 · ${userRoom.online.toLocaleString()}人` : '未开播'}
                            </span>
                          </div>
                          {userRoom.title && (
                            <div className="flex justify-between items-center gap-2">
                              <span className="flex-shrink-0">标题</span>
                              <span className="text-gray-300 truncate text-right">{userRoom.title}</span>
                            </div>
                          )}
                        </>
                      )}
                      {userInfo?.coins != null && userInfo.coins > 0 && (
                        <div className="flex justify-between items-center">
                          <span>硬币</span>
                          <span className="text-yellow-400 font-mono">{userInfo.coins}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>账号状态</span>
                        <span className={userInfo?.is_login ? 'text-green-400' : 'text-red-400'}>
                          {userInfo?.is_login ? '已登录' : '未登录'}
                        </span>
                      </div>
                      {userInfo?.saved_at ? (
                        <div className="flex justify-between">
                          <span>Cookie 时间</span>
                          <span className="font-mono">{formatCookieTime(userInfo.saved_at)}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="p-2 space-y-0.5">
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
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 text-gray-600 dark:text-gray-300 transition-colors disabled:opacity-60"
                    >
                      <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                      <span className="text-[12px] font-medium">{refreshing ? '刷新中...' : '刷新信息'}</span>
                    </button>
                    <button
                      onClick={onLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                      <span className="text-[12px] font-medium">退出登录</span>
                    </button>
                  </div>
                </div>,
                document.body
              )}
            </div>
          ) : (
            <Button size="sm" variant="primary" onClick={onRequireLogin}>
              <LogIn className="w-3.5 h-3.5 mr-1.5" />
              登录
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
