import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { toast } from 'sonner';

interface RoomContextValue {
  connected: boolean;
  setConnected: (v: boolean) => void;
  /** 需要连接房间才能执行的操作。已连接直接调用 fn，否则弹可关闭提示。 */
  requireRoom: (fn?: () => void) => void;
  /** 由 App 注册，用于在提示弹窗中直接打开连接房间对话框 */
  registerOpenRoomModal: (fn: () => void) => void;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const openRoomModalRef = useRef<(() => void) | null>(null);

  const registerOpenRoomModal = useCallback((fn: () => void) => {
    openRoomModalRef.current = fn;
  }, []);

  const requireRoom = useCallback((fn?: () => void) => {
    if (connected) {
      fn?.();
      return;
    }
    toast.warning('需要连接直播间', {
      description: '此功能需要先连接直播间才能使用',
      closeButton: true,
      duration: 6000,
      action: openRoomModalRef.current
        ? {
            label: '立即连接',
            onClick: () => openRoomModalRef.current?.(),
          }
        : undefined,
    });
  }, [connected]);

  return (
    <RoomContext.Provider value={{ connected, setConnected, requireRoom, registerOpenRoomModal }}>
      {children}
    </RoomContext.Provider>
  );
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used within RoomProvider');
  return ctx;
}
