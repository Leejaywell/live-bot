import { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
}

export function GlassCard({ children, className }: GlassCardProps) {
  return (
    <div
      className={cn(
        'glass-card rounded-[18px] backdrop-blur-xl',
        className
      )}
    >
      {children}
    </div>
  );
}
