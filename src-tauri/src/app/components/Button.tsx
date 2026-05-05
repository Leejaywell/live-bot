import { ReactNode, ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'default' | 'ghost' | 'destructive';
  size?: 'sm' | 'md';
}

export function Button({
  children,
  variant = 'default',
  size = 'md',
  className,
  disabled,
  ...props
}: ButtonProps) {
  const baseClasses = 'inline-flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden font-medium';

  const sizeClasses = {
    sm: 'h-[28px] px-4 rounded-[14px] text-[12px]',
    md: 'h-[34px] px-6 rounded-[17px] text-[13px]',
  };

  const variantClasses = {
    primary: 'bg-[var(--primary-color)] text-white hover:opacity-90',
    default: 'bg-white/60 dark:bg-white/10 border border-gray-200 dark:border-white/20 text-gray-700 dark:text-white hover:bg-white/80 dark:hover:bg-white/15',
    ghost: 'text-gray-600 dark:text-gray-300 hover:bg-white/10',
    destructive: 'bg-red-500 text-white hover:bg-red-600',
  };

  return (
    <button
      className={cn(
        baseClasses,
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
