import { toast, type ExternalToast } from 'sonner';
import type { ReactNode } from 'react';

// 重要事件 toast helper：自动落到屏幕顶部正中、更大尺寸、6s 停留、带关闭按钮
// 适用：房间断连、登录失效、更新可用、保存失败等需要用户注意的事件
// 不重要的提示继续用 `import { toast } from 'sonner'`，会出现在右下角
const importantDefaults: ExternalToast = {
  position: 'top-center',
  duration: 6000,
  closeButton: true,
  className: 'toast-important',
  style: {
    fontSize: '13px',
    fontWeight: 600,
    padding: '12px 18px',
    minWidth: '320px',
    maxWidth: '460px',
  },
};

type Msg = string | ReactNode;
const merge = (opts?: ExternalToast): ExternalToast => ({ ...importantDefaults, ...opts });

export const notifyImportant = {
  info:    (msg: Msg, opts?: ExternalToast) => toast(msg, merge(opts)),
  success: (msg: Msg, opts?: ExternalToast) => toast.success(msg, merge(opts)),
  warning: (msg: Msg, opts?: ExternalToast) => toast.warning(msg, merge(opts)),
  error:   (msg: Msg, opts?: ExternalToast) => toast.error(msg, merge(opts)),
};
