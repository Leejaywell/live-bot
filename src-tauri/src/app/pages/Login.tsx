import { useState, useEffect, useRef } from 'react';
import QRCode from 'react-qr-code';
import { GlassCard } from '../components/GlassCard';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Chip } from '../components/Chip';
import { X, RefreshCw } from 'lucide-react';
import { api, UserInfo, RoomInfo, LoginChallenge, PlatformId } from '../lib/api';
import { toast } from 'sonner';

export function Login() {
  const [showQRModal, setShowQRModal] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [roomId, setRoomId] = useState<string>('');
  const [loginUrl, setLoginUrl] = useState<LoginChallenge | null>(null);
  const [loginPlatformId, setLoginPlatformId] = useState<PlatformId>('bilibili');
  const [loginStatus, setLoginStatus] = useState<string>('等待扫码…');
  const [loading, setLoading] = useState(false);
  const pollingRef = useRef(false);

  useEffect(() => {
    refreshUserInfo();
    loadRoomId();
  }, []);

  const refreshUserInfo = async () => {
    try {
      const info = await api.getUserInfo();
      setUserInfo(info);
    } catch (err) {
      console.error('Failed to get user info:', err);
      setUserInfo(null);
    }
  };

  const loadRoomId = async () => {
    try {
      const config = await api.loadConfig();
      setRoomId(config.RoomId > 0 ? config.RoomId.toString() : '');
      if (config.RoomId > 0) {
        checkRoom(config.RoomId);
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  };

  const checkRoom = async (id?: number) => {
    const rId = id || parseInt(roomId);
    if (isNaN(rId)) {
      toast.error('请输入正确的房间号');
      return;
    }
    setLoading(true);
    try {
      const info = await api.checkRoom(rId);
      setRoomInfo(info);
    } catch (err) {
      toast.error(`查询房间失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const saveRoomId = async () => {
    if (!roomId.trim()) {
      try {
        const config = await api.loadConfig();
        config.RoomId = 0;
        await api.saveConfig(config);
        setRoomInfo(null);
        toast.success('已清空房间号');
      } catch (err) {
        toast.error(`保存失败: ${err}`);
      }
      return;
    }

    const rId = parseInt(roomId);
    if (isNaN(rId)) {
      toast.error('请输入正确的房间号');
      return;
    }
    try {
      const config = await api.loadConfig();
      config.RoomId = rId;
      await api.saveConfig(config);
      toast.success('保存成功');
      checkRoom(rId);
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    }
  };

  const startLogin = async () => {
    try {
      const room = await api.getConnectedRoom().catch(() => null);
      const platformId = room?.platform_id ?? 'bilibili';
      const url = await api.createPlatformLoginChallenge(platformId);
      setLoginUrl(url);
      setLoginPlatformId(url.platform_id);
      setShowQRModal(true);
      setLoginStatus('等待扫码…');
    } catch (err) {
      toast.error(`获取登录二维码失败: ${err}`);
    }
  };

  // 二维码轮询
  useEffect(() => {
    if (!showQRModal || !loginUrl) return;
    pollingRef.current = true;

    const poll = async () => {
      while (pollingRef.current) {
        try {
          const res = await api.pollPlatformLogin(loginPlatformId, loginUrl.challenge_id);
          if (!pollingRef.current) break;
          if (res.status === 'Success') {
            setLoginStatus('登录成功');
            setTimeout(() => { setShowQRModal(false); refreshUserInfo(); }, 1500);
            break;
          } else if (res.status === 'Expired') {
            setLoginStatus('二维码已过期，请刷新');
            break;
          }
        } catch (err) {
          console.error('poll_login error:', err);
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    };
    poll();
    return () => { pollingRef.current = false; };
  }, [showQRModal, loginPlatformId, loginUrl]);

  return (
    <div className="p-[18px]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard className="p-5">
          <div className="flex items-center gap-4 mb-4">
            {userInfo ? (
              <img src={userInfo.face} className="w-16 h-16 rounded-full border-2 border-purple-200" alt={userInfo.uname} />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-400 to-purple-500" />
            )}
            <div>
              <div className="text-[17px] font-bold mb-1">{userInfo?.uname || '未登录'}</div>
              <div className="font-mono text-[11px] text-gray-500">UID: {userInfo?.uid || '---'}</div>
            </div>
          </div>

          <div className="space-y-3 mb-4">
            <div className="flex items-center gap-2">
              <Chip variant={userInfo ? "success" : "error"}>
                {userInfo ? "Cookie 有效" : "未登录 / Cookie 失效"}
              </Chip>
            </div>
            <p className="text-[11px] text-gray-500">
              登录用于读取账号信息，并在你配置默认房间后快速连接直播间。
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="primary" onClick={startLogin}>
              {userInfo ? '切换账号' : '立即登录'}
            </Button>
            <Button onClick={refreshUserInfo}>刷新状态</Button>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-[11px] font-bold text-gray-500 tracking-wider mb-4">默认房间配置</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-gray-500 w-16">房号</label>
              <Input 
                mono 
                value={roomId} 
                onChange={(e) => setRoomId(e.target.value)} 
                className="flex-1"
                placeholder="留空表示暂不设置"
              />
              <Button variant="primary" size="sm" onClick={saveRoomId}>保存</Button>
            </div>
            {!roomInfo && !roomId.trim() && (
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-white/15 bg-white/30 dark:bg-white/5 px-3 py-3 text-[11px] text-gray-500">
                未设置默认房间号。首次使用可以先登录，之后再填写房间号。
              </div>
            )}
            {roomInfo && (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-gray-500 w-16">主播</label>
                  <span className="text-[12px]">{roomInfo.uname}</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-gray-500 w-16">标题</label>
                  <span className="text-[12px] line-clamp-1">{roomInfo.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-gray-500 w-16">分区</label>
                  <span className="text-[12px]">{roomInfo.parent_area_name} · {roomInfo.area_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-gray-500 w-16">状态</label>
                  <div className={`w-[7px] h-[7px] rounded-full ${roomInfo.live_status === 1 ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <Chip variant={roomInfo.live_status === 1 ? "success" : "secondary"}>
                    {roomInfo.live_status === 1 ? "直播中" : "未开播"}
                  </Chip>
                </div>
              </>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={() => checkRoom()} disabled={loading || !roomId.trim()}>
              {loading ? '查询中...' : '刷新状态'}
            </Button>
          </div>
        </GlassCard>
      </div>

      {showQRModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
          <GlassCard className="w-[440px] p-6 relative">
            <button
              onClick={() => setShowQRModal(false)}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-[17px] font-bold mb-6">扫码登录</h2>

            <div className="flex flex-col items-center mb-4">
              <div className="w-[200px] h-[200px] bg-white rounded-2xl flex items-center justify-center mb-3 p-2">
                {loginUrl ? (
                  <div className="text-center">
                    <QRCode value={loginUrl.url} size={180} />
                  </div>
                ) : (
                  <div className="text-center text-gray-400 text-sm">加载中...</div>
                )}
              </div>
            </div>

            <div className="space-y-2 text-[11px] text-gray-600 mb-4">
              <div>1. 打开手机 B 站 App</div>
              <div>2. 点击右上角扫一扫</div>
              <div>3. 确认登录</div>
            </div>

            <div className="flex items-center justify-center gap-2 mb-4">
              <div className={`w-2 h-2 rounded-full ${loginStatus === '登录成功' ? 'bg-green-500' : 'bg-blue-400'}`} />
              <span className="text-[11px] text-gray-500">{loginStatus}</span>
              {loginStatus !== '登录成功' && <RefreshCw className="w-3 h-3 animate-spin text-gray-400" />}
            </div>

            <Button variant="ghost" className="w-full" onClick={startLogin}>刷新二维码</Button>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
