import { ReactNode } from 'react';
import { motionClass } from '../runtime/motion';
import { DanmakuChatRuntimeConfig } from '../runtime/types';

interface DanmakuChatFrameProps {
  config: DanmakuChatRuntimeConfig;
  plugin: string;
  view: string;
  children: ReactNode;
}

export function DanmakuChatFrame({ config, plugin, view, children }: DanmakuChatFrameProps) {
  const style = {
    '--danmaku-chat-scale': String(config.scale),
    '--danmaku-chat-primary': config.primaryColor || '#8b5cf6',
    '--overlay-scale': String(config.scale),
    '--overlay-primary': config.primaryColor || '#8b5cf6',
  } as React.CSSProperties;

  return (
    <main
      className={[
        'danmaku-chat-frame',
        'overlay-frame',
        `plugin-${plugin}`,
        `view-${view}`,
        `skin-${config.skin}`,
        config.transparent ? 'is-transparent' : 'has-background',
        motionClass(config.motion),
      ].join(' ')}
      style={style}
    >
      {children}
    </main>
  );
}
