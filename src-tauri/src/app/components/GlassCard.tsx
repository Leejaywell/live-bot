import { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hoverable?: boolean;
  onClick?: () => void;
}

export function GlassCard({ children, className, hoverable, onClick }: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'glass-card rounded-[18px] backdrop-blur-xl',
        hoverable && 'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-2xl',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  );
}
