// 全局触发"再看一次启动页"。App.tsx 注册，SettingsPanel 调用。
let triggerFn: (() => void) | null = null;

export function registerSplashTrigger(fn: () => void) {
  triggerFn = fn;
}

export function showSplashAgain() {
  triggerFn?.();
}
