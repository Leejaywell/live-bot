import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { LogIn, Home, Radio } from 'lucide-react';
import { Toaster } from 'sonner';
import { ThemeProvider } from './context/ThemeContext';
import { ConfigProvider } from './context/ConfigContext';
import { LoginContext } from './context/LoginContext';
import { RoomProvider, useRoom } from './context/RoomContext';
import { BackgroundManager } from './components/BackgroundEffects';
import { DanmuOverlay } from './components/DanmuOverlay';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { ThemePanel } from './components/ThemePanel';
import { NotificationPanel } from './components/NotificationPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { GlassCard } from './components/GlassCard';
import { Button } from './components/Button';
import { Dashboard } from './pages/Dashboard';
import { Monitor } from './pages/Monitor';
import { AutoReply } from './pages/AutoReply';
import { AI } from './pages/AI';
import { Voice } from './pages/Voice';
import { VoiceChanger } from './pages/VoiceChanger';
import { Models } from './pages/Models';
import { Stats } from './pages/Stats';
import { api, UserInfo, RoomInfo, AnchorInfo } from './lib/api';
import { invoke } from '@tauri-apps/api/core';
import QRCode from 'react-qr-code';
import { toast } from 'sonner';
import { RefreshCw, X, QrCode } from 'lucide-react';
import { Modal, ModalCloseButton } from './components/Modal';

export interface AppNotif {
  id: string;
  type: 'success' | 'info' | 'warning' | 'gift' | 'error';
  title: string;
  message: string;
  time: Date;
  read: boolean;
}

function parseNotification(log: string): AppNotif | null {
  if (log.startsWith('弹幕 ')) return null;
  if (log.startsWith('正在获取') || log.startsWith('连接弹幕流') || log.startsWith('已发送登场语')) return null;

  const id = `${Date.now()}-${Math.random()}`;
  const time = new Date();
  const base = { id, time, read: false };

  if (/^感谢.+的关注/.test(log)) return { ...base, type: 'success', title: '新增关注', message: log };
  if (/^感谢.+的 SC/.test(log) || /SC \(¥/.test(log)) return { ...base, type: 'gift', title: 'SC 消息', message: log };
  if (/^感谢.+(电池|舰长|提督|总督)/.test(log)) return { ...base, type: 'gift', title: '收到礼物', message: log };
  if (/^感谢.+的 /.test(log)) return { ...base, type: 'gift', title: '收到礼物', message: log };
  if (/.+被禁言$/.test(log)) return { ...base, type: 'warning', title: '用户禁言', message: log };
  if (log === '直播间监听已启动') return { ...base, type: 'info', title: '监听已启动', message: log };
  if (log === '监听已停止') return { ...base, type: 'info', title: '监听已停止', message: log };
  if (log.startsWith('直播场次') || log.startsWith('直播状态变更')) return { ...base, type: 'info', title: '直播状态', message: log };
  if (log.includes('失败') || log.includes('错误')) return { ...base, type: 'error', title: '错误', message: log };

  return null;
}

export default function App() {
  return (
    <ThemeProvider>
      <RoomProvider>
        <AppContent />
      </RoomProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  const { connected, setConnected, requireRoom, registerOpenRoomModal } = useRoom();
  const [sidebarMode, setSidebarMode] = useState<'expanded' | 'icon' | 'hidden'>('expanded');
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginChecked, setLoginChecked] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [autoRoom, setAutoRoom] = useState<{ roomId: string; liveStatus: number; liveTime: string } | null>(null);
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // 注册到 RoomContext，让 requireRoom 弹窗可以直接打开连接对话框
  useEffect(() => {
    registerOpenRoomModal(() => setShowRoomModal(true));
  }, [registerOpenRoomModal]);
  const [loginUrl, setLoginUrl] = useState('');
  const [loginKey, setLoginKey] = useState('');
  const [loginStatus, setLoginStatus] = useState<'pending' | 'expired' | 'success' | 'idle'>('pending');
  const [loadingQr, setLoadingQr] = useState(false);
  const [userRoom, setUserRoom] = useState<RoomInfo | null>(null);
  const [anchorInfo, setAnchorInfo] = useState<AnchorInfo | null>(null);
  const [notifications, setNotifications] = useState<AppNotif[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // 刷新用户信息（返回最新 info）
  const refreshUserInfo = useCallback(async () => {
    try {
      const info = await api.getUserInfo();
      setUserInfo(info);
      setIsLoggedIn(info.is_login);
      return info;
    } catch {
      setIsLoggedIn(false);
      setUserInfo(null);
      return null;
    }
  }, []);

  // 禁用浏览器/手势返回上一页
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const handler = () => window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  // 监听 monitor-log 生成通知
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    api.onMonitorLog((log) => {
      const notif = parseNotification(log);
      if (!notif) return;
      setNotifications(prev => [notif, ...prev].slice(0, 50));
      setUnreadCount(c => c + 1);
    }).then(f => { unlisten = f; }).catch(() => {});
    return () => unlisten?.();
  }, []);

  // 启动时检查登录状态
  useEffect(() => {
    (async () => {
      await refreshUserInfo();
      setLoginChecked(true);
    })();
  }, [refreshUserInfo]);

  // 登录后拉取自己的直播间信息，并尝试恢复上次连接的房间
  useEffect(() => {
    if (isLoggedIn && userInfo?.uid) {
      api.getRoomByUid(userInfo.uid).then(setUserRoom).catch(() => {});
      // 恢复上次连接的房间
      api.getConnectedRoom().then(async (savedRoomId) => {
        if (!savedRoomId) return;
        try {
          const room = await api.checkRoom(savedRoomId);
          setAutoRoom({ roomId: String(room.room_id), liveStatus: room.live_status, liveTime: room.live_time ?? '' });
          setConnected(true);
          if (room.uid) {
            api.getAnchorInfo(room.uid).then(setAnchorInfo).catch(() => {});
          }
          api.startMonitor(room.room_id).catch(() => {});
        } catch {}
      }).catch(() => {});
    } else {
      setUserRoom(null);
    }
  }, [isLoggedIn, userInfo?.uid]);

  // 定期检查 cookie 有效性，失效直接提示重新登录
  useEffect(() => {
    if (!isLoggedIn || !loginChecked) return;
    const timer = setInterval(async () => {
      try {
        const info = await api.getUserInfo();
        if (!info.is_login) {
          setIsLoggedIn(false);
          setUserInfo(null);
          setConnected(false);
          setShowLoginModal(true);
          fetchLoginQr();
        }
      } catch {
        // 网络错误 — session 可能仍有效，不弹出重新登录
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [isLoggedIn, loginChecked]);

  const fetchLoginQr = async () => {
    setLoadingQr(true);
    setLoginStatus('pending');
    try {
      const data = await api.startLogin();
      setLoginUrl(data.url);
      setLoginKey(data.qrcode_key);
    } catch (err) {
      console.error('获取二维码失败:', err);
    } finally {
      setLoadingQr(false);
    }
  };

  // 轮询登录状态
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showLoginModal && loginKey && loginStatus !== 'success' && loginStatus !== 'expired') {
      timer = setInterval(async () => {
        try {
          const res = await invoke<any>('poll_login', { key: loginKey });
          if (res.status === 'Success') {
            setLoginStatus('success');
            setShowLoginModal(false);
            setLoginUrl('');
            setLoginKey('');
            if (res.uid) {
              setUserInfo({
                uid: res.uid, uname: res.uname, face: res.face,
                level: res.level ?? 0, vip_status: res.vip_status ?? 0,
                vip_type: res.vip_type ?? 0, coins: res.coins ?? 0,
                vip_nickname_color: res.vip_nickname_color ?? '',
                is_login: true, saved_at: Math.floor(Date.now() / 1000)
              });
            }
            setIsLoggedIn(true);
            setConnected(false);
          } else if (res.status === 'Expired') {
            setLoginStatus('expired');
          }
        } catch (err) {
          console.error('Poll login error:', err);
        }
      }, 2000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [showLoginModal, loginKey, loginStatus]);

  const openLoginModal = () => {
    setShowLoginModal(true);
    setLoginUrl('');
    setLoginKey('');
    setLoginStatus('pending');
    fetchLoginQr();
  };

  // 退出登录
  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => {});
    setIsLoggedIn(false);
    setUserInfo(null);
    setAutoRoom(null);
    setConnected(false);
    window.location.reload();
  }, []);

  // 连接房间成功
  const handleRoomConnected = useCallback((roomId: string, liveStatus: number, liveTime: string, roomUid?: number) => {
    const id = parseInt(roomId);
    setAutoRoom({ roomId, liveStatus, liveTime });
    setShowRoomModal(false);
    setConnected(true);
    // 持久化已连接的房间
    api.setConnectedRoom(id).catch(() => {});
    // 拉取主播信息
    if (roomUid) {
      api.getAnchorInfo(roomUid).then(setAnchorInfo).catch(() => {});
    }
    // 自动启动 WebSocket 监听
    api.startMonitor(id).catch(() => {});
  }, []);

  // 断开房间
  const handleDisconnect = useCallback(() => {
    setConnected(false);
    setAnchorInfo(null);
    api.stopMonitor().catch(() => {});
    api.setConnectedRoom(null).catch(() => {});
  }, []);

  return (
    <>
      <Toaster
        position="top-right"
        richColors
        gap={6}
        visibleToasts={4}
        duration={2500}
        containerStyle={{
          right: '0px',
          top: '64px',
        }}
        toastOptions={{
          className: 'toast-edge',
          style: {
            fontSize: '11px',
            fontWeight: 600,
            background: 'var(--surface-bg)',
            color: 'var(--foreground)',
            backdropFilter: 'blur(var(--glass-blur))',
            border: '1px solid var(--surface-border)',
            borderRight: 'none',
            boxShadow: '-4px 6px 20px rgba(0, 0, 0, 0.07)',
            borderRadius: '14px 0 0 14px',
            padding: '7px 14px',
            width: 'fit-content',
            minWidth: '160px',
          },
        }}
      />
      <LoginContext.Provider value={{
        isLoggedIn, setIsLoggedIn, userInfo, setUserInfo, loginChecked,
        refreshUserInfo, openLoginModal: () => setShowLoginModal(true)
      }}>
      <ConfigProvider>
      <HashRouter>
        <BackgroundManager />
        <DanmuOverlay />
        {loginChecked && <div
          className="w-full h-screen overflow-hidden flex relative z-[1]"
          onContextMenu={(e) => e.preventDefault()}
        >
          <Sidebar
            mode={sidebarMode}
            onToggleThemePanel={() => setThemePanelOpen(!themePanelOpen)}
            onToggleSidebar={() => setSidebarMode(m => m === 'expanded' ? 'icon' : 'expanded')}
            onToggleSettings={() => setSettingsPanelOpen(!settingsPanelOpen)}
          />

          <div className="flex-1 flex flex-col overflow-hidden relative">
            <TopBar
              onToggleNotifications={() => setNotificationPanelOpen(!notificationPanelOpen)}
              isLoggedIn={isLoggedIn}
              userInfo={userInfo}
              userRoom={userRoom}
              anchorInfo={anchorInfo}
              onRequireLogin={openLoginModal}
              onLogout={handleLogout}
              autoRoom={autoRoom}
              onAutoRoomConsumed={() => setAutoRoom(null)}
              onDisconnect={handleDisconnect}
              onRefreshUserInfo={refreshUserInfo}
              unreadCount={unreadCount}
            />
            <main className="flex-1 overflow-hidden relative">
              {!isLoggedIn && (
                <div className="absolute inset-0 flex items-center justify-center z-20 bg-[var(--background)]/80 backdrop-blur-sm">
                  <GlassCard className="p-8 flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-[var(--primary-color)]/10 flex items-center justify-center">
                      <LogIn className="w-8 h-8 text-[var(--primary-color)]" />
                    </div>
                    <div className="text-[15px] font-semibold">请先登录</div>
                    <div className="text-[12px] text-gray-400">登录后即可使用所有功能</div>
                    <Button variant="primary" onClick={openLoginModal}>
                      <LogIn className="w-3.5 h-3.5 mr-1.5" />
                      扫码登录
                    </Button>
                  </GlassCard>
                </div>
              )}
              <AnimatedRoutes />
            </main>
          </div>

          {themePanelOpen && <ThemePanel onClose={() => setThemePanelOpen(false)} />}
          {notificationPanelOpen && (
            <NotificationPanel
              notifications={notifications}
              onClose={() => setNotificationPanelOpen(false)}
              onMarkAllRead={() => {
                setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                setUnreadCount(0);
              }}
            />
          )}
          {settingsPanelOpen && <SettingsPanel onClose={() => setSettingsPanelOpen(false)} />}

          {/* 连接直播间弹窗 */}
          <Modal open={showRoomModal && isLoggedIn} onClose={() => setShowRoomModal(false)} className="p-6" zIndex={9998}>
            <RoomConnectForm
              userRoom={userRoom}
              onSuccess={handleRoomConnected}
            />
          </Modal>

          {/* 登录二维码弹窗 */}
          <Modal open={showLoginModal} onClose={() => { setShowLoginModal(false); setLoginUrl(''); }} className="p-6" zIndex={9999}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[15px] font-semibold">扫码登录</h2>
              <ModalCloseButton onClose={() => { setShowLoginModal(false); setLoginUrl(''); }} className="w-8 h-8" />
            </div>
            <div className="flex flex-col items-center">
              <div className="w-52 h-52 bg-white rounded-xl flex items-center justify-center mb-4 border border-gray-200 p-2 relative overflow-hidden">
                {loadingQr ? (
                  <RefreshCw className="w-8 h-8 text-gray-300 animate-spin" />
                ) : loginUrl ? (
                  <>
                    <QRCode value={loginUrl} size={180} />
                    {loginStatus === 'expired' && (
                      <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center gap-2 cursor-pointer" onClick={fetchLoginQr}>
                        <RefreshCw className="w-6 h-6 text-gray-500" />
                        <span className="text-[12px] text-gray-600">二维码已过期</span>
                        <span className="text-[10px] text-blue-500">点击刷新</span>
                      </div>
                    )}
                  </>
                ) : (
                  <QrCode className="w-40 h-40 text-gray-200" />
                )}
              </div>
              <div className="w-full space-y-2 mb-4">
                <div className="flex items-start gap-2"><span className="text-[11px] text-gray-500 flex-shrink-0">1.</span><span className="text-[11px] text-gray-500">打开哔哩哔哩 App</span></div>
                <div className="flex items-start gap-2"><span className="text-[11px] text-gray-500 flex-shrink-0">2.</span><span className="text-[11px] text-gray-500">点击右上角扫一扫</span></div>
                <div className="flex items-start gap-2"><span className="text-[11px] text-gray-500 flex-shrink-0">3.</span><span className="text-[11px] text-gray-500">确认登录</span></div>
              </div>
              <Button variant="default" className="w-full" onClick={fetchLoginQr} disabled={loadingQr}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingQr ? 'animate-spin' : ''}`} />
                刷新二维码
              </Button>
            </div>
          </Modal>
        </div>}
      </HashRouter>
      </ConfigProvider>
      </LoginContext.Provider>
    </>
  );
}

// 带页面过渡的路由容器
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <div key={location.pathname} className="animate-page-in h-full overflow-y-auto">
      <Routes location={location}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/auto-reply" element={<AutoReply />} />
        <Route path="/ai" element={<AI />} />
        <Route path="/voice" element={<Voice />} />
        <Route path="/voice-changer" element={<VoiceChanger />} />
        <Route path="/models" element={<Models />} />
        <Route path="/stats" element={<Stats />} />
      </Routes>
    </div>
  );
}

// 连接直播间表单
function RoomConnectForm({ userRoom, onSuccess }: { userRoom: RoomInfo | null; onSuccess: (roomId: string, liveStatus: number, liveTime: string, uid?: number) => void }) {
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const info = await api.checkRoom(parseInt(roomId));
      onSuccess(String(info.room_id), info.live_status, info.live_time ?? '', info.uid);
    } catch (err: any) {
      toast.error(`连接失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleMyRoom = () => {
    if (!userRoom) { toast.error('用户信息未加载'); return; }
    setRoomId(String(userRoom.room_id));
    onSuccess(String(userRoom.room_id), userRoom.live_status, userRoom.live_time ?? '', userRoom.uid);
  };

  return (
    <>
      <h2 className="text-[15px] font-semibold mb-4">连接直播间</h2>
      <div className="space-y-4">
        <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">房间号</label>
          <div className="flex gap-2">
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="请输入直播间房间号"
              className="flex-1 h-[34px] px-3 rounded-lg bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-[12px] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50"
              onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
              autoFocus
            />
            <button
              onClick={handleMyRoom}
              disabled={!userRoom}
              className="h-[34px] px-3 rounded-lg bg-[var(--primary-color)]/10 border border-[var(--primary-color)]/30 text-[var(--primary-color)] text-[11px] font-medium flex items-center gap-1 hover:bg-[var(--primary-color)]/20 transition-colors disabled:opacity-50"
              title="连接我的直播间"
            >
              <Home className="w-3.5 h-3.5" />
              我的房间
            </button>
          </div>
        </div>
      </div>
      <div className="mt-6">
        <Button variant="primary" className="w-full" onClick={handleConnect} disabled={loading || !roomId}>
          {loading ? '连接中...' : '连接'}
        </Button>
      </div>
    </>
  );
}
