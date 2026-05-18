import { ReactNode } from 'react';
import { motionClass } from '../runtime/motion';
import { OverlayRuntimeConfig } from '../runtime/types';

interface OverlayFrameProps {
  config: OverlayRuntimeConfig;
  plugin: string;
  view: string;
  children: ReactNode;
}

export function OverlayFrame({ config, plugin, view, children }: OverlayFrameProps) {
  const style = {
    '--overlay-scale': String(config.scale),
    '--overlay-primary': config.primaryColor || '#8b5cf6',
  } as React.CSSProperties;

  return (
    <main
      className={[
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
