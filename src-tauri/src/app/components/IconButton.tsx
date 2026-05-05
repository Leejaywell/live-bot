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
        'bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20',
        'hover:bg-white/80 dark:hover:bg-white/15',
        active && 'bg-[var(--primary-color)] !border-[var(--primary-color)] text-white',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
