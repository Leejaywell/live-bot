import { ReactNode, ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  active?: boolean;
}

export function IconButton({ children, active, className, ...props }: IconButtonProps) {
  return (
    <button
      className={cn(
        'w-[30px] h-[30px] rounded-full flex items-center justify-center transition-all',
        'bg-[var(--button-default-bg)] border text-[var(--button-default-text)] border-[var(--button-default-border)]',
        'hover:bg-[var(--button-default-hover)]',
        active && 'bg-[var(--button-primary-bg)] !border-[var(--button-primary-bg)] text-white',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
