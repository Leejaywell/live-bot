import { OverlayMotion } from './types';

export function resolveMotion(value: string | null): OverlayMotion {
  const requested: OverlayMotion =
    value === 'reduced' || value === 'off' || value === 'full' ? value : 'full';
  if (requested === 'off') return 'off';
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return 'reduced';
  }
  return requested;
}

export function motionClass(motion: OverlayMotion): string {
  return `motion-${motion}`;
}
