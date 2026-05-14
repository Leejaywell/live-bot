import { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { ChevronRight, LogIn, Home } from 'lucide-react';
import { Toaster } from 'sonner';
import { ThemeProvider } from './context/ThemeContext';
import { LoginContext } from './context/LoginContext';
import { BackgroundBlobs } from './components/BackgroundBlobs';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { ThemePanel } from './components/ThemePanel';
import { NotificationPanel } from './components/NotificationPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { IconButton } from './components/IconButton';
import { GlassCard } from './components/GlassCard';
import { Button } from './components/Button';
import { Dashboard } from './pages/Dashboard';
import { Monitor } from './pages/Monitor';
import { AutoReply } from './pages/AutoReply';
import { AI } from './pages/AI';
import { Voice } from './pages/Voice';
import { Models } from './pages/Models';
import { Stats } from './pages/Stats';
import { api, UserInfo, RoomInfo, AnchorInfo } from './lib/api';
import { invoke } from '@tauri-apps/api/core';
import QRCode from 'react-qr-code';
import { toast } from 'sonner';
import { RefreshCw, X, QrCode } from 'lucide-react';

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginChecked, setLoginChecked] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [autoRoom, setAutoRoom] = useState<{ roomId: string; liveStatus: number; liveTime: string } | null>(null);
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginUrl, setLoginUrl] = useState('');
  const [loginKey, setLoginKey] = useState('');
  const [loginStatus, setLoginStatus] = useState<'pending' | 'expired' | 'success' | 'idle'>('pending');
  const [loadingQr, setLoadingQr] = useState(false);
  const [hasConnectedRoom, setHasConnectedRoom] = useState(false);
  const [userRoom, setUserRoom] = useState<RoomInfo | null>(null);
  const [anchorInfo, setAnchorInfo] = useState<AnchorInfo | null>(null);
  const [showConnectHint, setShowConnectHint] = useState(false);
  const connectHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          setHasConnectedRoom(true);
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
      const info = await api.getUserInfo();
      if (!info.is_login) {
        setIsLoggedIn(false);
        setUserInfo(null);
        setHasConnectedRoom(false);
        setShowLoginModal(true);
        fetchLoginQr();
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [isLoggedIn, loginChecked, refreshUserInfo]);

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
            setHasConnectedRoom(false);
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
    setHasConnectedRoom(false);
    window.location.reload();
  }, []);

  // 未连接时点击交互元素，弹出提示
  const triggerConnectHint = useCallback(() => {
    toast.success('请连接房间');
  }, []);

  // 连接房间成功
  const handleRoomConnected = useCallback((roomId: string, liveStatus: number, liveTime: string, roomUid?: number) => {
    const id = parseInt(roomId);
    setAutoRoom({ roomId, liveStatus, liveTime });
    setShowRoomModal(false);
    setHasConnectedRoom(true);
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
    setHasConnectedRoom(false);
    setAnchorInfo(null);
    api.stopMonitor().catch(() => {});
    api.setConnectedRoom(null).catch(() => {});
  }, []);

  if (!loginChecked) return null;

  return (
    <ThemeProvider>
      <Toaster
        position="top-right"
        richColors
        duration={2000}
        closeButton
        containerStyle={{
          right: '20px',
          top: '64px',
          pointerEvents: 'none'
        }}
        toastOptions={{
          style: { 
            fontSize: '11px',
            fontWeight: 600,
            background: 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.4)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
            borderRadius: '16px',
            padding: '6px 14px',
            width: 'fit-content',
            pointerEvents: 'auto'
          },
        }}
      />
      <LoginContext.Provider value={isLoggedIn}>
      <HashRouter>
        <div 
          className="w-full h-screen overflow-hidden flex relative" 
          style={{ background: 'var(--background)' }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <BackgroundBlobs />
          <Sidebar
            collapsed={sidebarCollapsed}
            connected={hasConnectedRoom}
            onToggleThemePanel={() => setThemePanelOpen(!themePanelOpen)}
            onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
            onToggleSettings={() => setSettingsPanelOpen(!settingsPanelOpen)}
            onBlockedClick={triggerConnectHint}
          />
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {sidebarCollapsed && (
              <div className="absolute left-4 top-4 z-10">
                <IconButton onClick={() => setSidebarCollapsed(false)}>
                  <ChevronRight className="w-4 h-4" />
                </IconButton>
              </div>
            )}
            <TopBar
              onToggleNotifications={() => setNotificationPanelOpen(!notificationPanelOpen)}
              sidebarCollapsed={sidebarCollapsed}
              isLoggedIn={isLoggedIn}
              userInfo={userInfo}
              userRoom={userRoom}
              anchorInfo={anchorInfo}
              onRequireLogin={openLoginModal}
              onLogout={handleLogout}
              autoRoom={autoRoom}
              onAutoRoomConsumed={() => setAutoRoom(null)}
              onDisconnect={handleDisconnect}
              onOpenRoomModal={() => setShowRoomModal(true)}
              onRefreshUserInfo={refreshUserInfo}
              showConnectHint={showConnectHint}
            />
            <main className="flex-1 overflow-y-auto relative">
              {/* 已登录但未连接房间：透明拦截层 */}
              {isLoggedIn && !hasConnectedRoom && (
                <div className="absolute inset-0 z-10" onClick={triggerConnectHint} />
              )}
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
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/monitor" element={<Monitor />} />
                <Route path="/auto-reply" element={<AutoReply />} />
                <Route path="/ai" element={<AI />} />
                <Route path="/voice" element={<Voice />} />
                <Route path="/models" element={<Models />} />
                <Route path="/stats" element={<Stats />} />
              </Routes>
            </main>
          </div>

          {themePanelOpen && <ThemePanel onClose={() => setThemePanelOpen(false)} />}
          {notificationPanelOpen && <NotificationPanel onClose={() => setNotificationPanelOpen(false)} />}
          {settingsPanelOpen && <SettingsPanel onClose={() => setSettingsPanelOpen(false)} />}

          {/* 连接直播间弹窗 */}
          {showRoomModal && isLoggedIn && (
            <div
              className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[9998]"
              onClick={() => setShowRoomModal(false)}
            >
              <div onClick={(e) => e.stopPropagation()}><GlassCard className="w-[400px] p-6">
                <RoomConnectForm
                  userRoom={userRoom}
                  onSuccess={handleRoomConnected}
                />
              </GlassCard></div>
            </div>
          )}

          {/* 登录二维码弹窗 */}
          {showLoginModal && (
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[9999]">
              <GlassCard className="w-[340px] p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-[15px] font-semibold">扫码登录</h2>
                  <button onClick={() => { setShowLoginModal(false); setLoginUrl(''); }} className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors">
                    <X className="w-4 h-4" />
                  </button>
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
              </GlassCard>
            </div>
          )}
        </div>
      </HashRouter>
      </LoginContext.Provider>
    </ThemeProvider>
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
