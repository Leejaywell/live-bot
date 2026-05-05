import { useState, useEffect, useRef } from 'react';
import { Bell, User, LogIn, Link as LinkIcon, X, QrCode, RefreshCw, LogOut } from 'lucide-react';
import { IconButton } from './IconButton';
import { Button } from './Button';
import { Input } from './Input';
import { GlassCard } from './GlassCard';
import { Chip } from './Chip';

interface TopBarProps {
  onToggleNotifications?: () => void;
  sidebarCollapsed?: boolean;
}

export function TopBar({ onToggleNotifications, sidebarCollapsed }: TopBarProps) {
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [currentRoom, setCurrentRoom] = useState('');
  const [currentUser, setCurrentUser] = useState('花花直播姬');
  const [roomCategory, setRoomCategory] = useState('娱乐');
  const [liveDuration, setLiveDuration] = useState(0);
  const [cookieExpireDate, setCookieExpireDate] = useState<Date | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭用户菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  // 模拟扫码登录
  const handleScanLogin = () => {
    setTimeout(() => {
      setIsLoggedIn(true);
      setCurrentUser('花花直播姬');
      // 设置 Cookie 过期时间为 30 天后
      const expireDate = new Date();
      expireDate.setDate(expireDate.getDate() + 30);
      setCookieExpireDate(expireDate);
      setShowLoginModal(false);
    }, 2000);
  };

  // 退出登录
  const handleLogout = () => {
    setIsLoggedIn(false);
    setCurrentUser('');
    setCookieExpireDate(null);
    setShowUserMenu(false);
    if (isConnected) {
      handleDisconnect();
    }
  };

  const handleConnect = () => {
    // 模拟连接房间
    if (roomId) {
      setIsConnected(true);
      setCurrentRoom(roomId);
      setRoomCategory('娱乐');
      setLiveDuration(0);
      setShowRoomModal(false);
      setRoomId('');
    }
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setCurrentRoom('');
    setLiveDuration(0);
  };

  // 直播时长计时器
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isConnected) {
      timer = setInterval(() => {
        setLiveDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isConnected]);

  // 格式化时长
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 格式化日期
  const formatDate = (date: Date) => {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <>
      <div
        className="h-[52px] glass-topbar backdrop-blur-xl flex items-center justify-between pr-4"
        style={{ paddingLeft: sidebarCollapsed ? '60px' : '16px' }}
      >
        <div className="flex items-center gap-3">
          {isConnected ? (
            <>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <div className="w-[7px] h-[7px] rounded-full bg-green-500 animate-pulse" />
                <span>房间 {currentRoom}</span>
                <span className="text-gray-400">·</span>
                <span>{currentUser}</span>
                <span className="text-gray-400">·</span>
                <span>{roomCategory}</span>
                <span className="text-gray-400">·</span>
                <span>{formatDuration(liveDuration)}</span>
                <Chip variant="success">直播中</Chip>
              </div>
              <Button size="sm" variant="ghost" onClick={handleDisconnect}>
                断开
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="default"
              onClick={() => setShowRoomModal(true)}
            >
              <LinkIcon className="w-3.5 h-3.5 mr-1.5" />
              连接直播间
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <IconButton onClick={onToggleNotifications}>
            <Bell className="w-4 h-4" />
          </IconButton>
          {isLoggedIn ? (
            <div className="relative" ref={userMenuRef}>
              <div
                className="w-[32px] h-[32px] rounded-full flex items-center justify-center cursor-pointer transition-all hover:opacity-80"
                style={{ background: 'var(--primary-color)' }}
                title={currentUser}
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                <User className="w-4 h-4 text-white" />
              </div>

              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-64 glass-card backdrop-blur-xl rounded-xl overflow-hidden shadow-lg border border-white/10">
                  <div className="p-4 border-b border-white/10">
                    <div className="text-[13px] font-semibold mb-1">{currentUser}</div>
                    <div className="text-[11px] text-gray-500">
                      Cookie 过期时间
                    </div>
                    <div className="text-[11px] font-mono text-gray-700 dark:text-gray-300 mt-1">
                      {cookieExpireDate ? formatDate(cookieExpireDate) : '未知'}
                    </div>
                  </div>
                  <div className="p-2">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="text-[12px] font-medium">退出登录</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setShowLoginModal(true)}
            >
              <LogIn className="w-3.5 h-3.5 mr-1.5" />
              登录
            </Button>
          )}
        </div>
      </div>

      {/* 登录弹窗 */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
          <GlassCard className="w-[340px] p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[15px] font-semibold">扫码登录</h2>
              <button
                onClick={() => setShowLoginModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col items-center">
              <div className="w-52 h-52 bg-white rounded-xl flex items-center justify-center mb-4 border border-gray-200">
                <QrCode className="w-40 h-40 text-gray-400" />
              </div>

              <div className="w-full space-y-2 mb-4">
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-gray-500 flex-shrink-0">1.</span>
                  <span className="text-[11px] text-gray-500">打开哔哩哔哩 App</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-gray-500 flex-shrink-0">2.</span>
                  <span className="text-[11px] text-gray-500">点击右上角扫一扫</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-gray-500 flex-shrink-0">3.</span>
                  <span className="text-[11px] text-gray-500">确认登录</span>
                </div>
              </div>

              <div className="flex gap-2 w-full">
                <Button variant="default" className="flex-1" onClick={handleScanLogin}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  刷新二维码
                </Button>
                <Button variant="primary" className="flex-1" onClick={handleScanLogin}>
                  模拟登录
                </Button>
              </div>
            </div>
          </GlassCard>
        </div>
      )}

      {/* 连接直播间弹窗 */}
      {showRoomModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
          <GlassCard className="w-[400px] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold">连接直播间</h2>
              <button
                onClick={() => setShowRoomModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 block">房间号</label>
                <Input
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="请输入直播间房间号"
                  className="w-full"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleConnect();
                    }
                  }}
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <Button variant="default" className="flex-1" onClick={() => setShowRoomModal(false)}>
                取消
              </Button>
              <Button variant="primary" className="flex-1" onClick={handleConnect}>
                连接
              </Button>
            </div>
          </GlassCard>
        </div>
      )}
    </>
  );
}
