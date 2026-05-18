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
    primary: 'bg-[var(--button-primary-bg)] text-[var(--button-primary-text)] hover:bg-[var(--button-primary-hover)] shadow-[0_8px_20px_-8px_rgba(var(--primary-rgb),0.5)]',
    default: 'bg-[var(--button-default-bg)] border text-[var(--button-default-text)] hover:bg-[var(--button-default-hover)]',
    ghost: 'text-[var(--button-ghost-text)] hover:bg-[var(--button-ghost-hover)]',
    destructive: 'bg-red-500 text-white hover:bg-red-600',
  };

  return (
    <button
      data-fx="btn"
      className={cn(
        baseClasses,
        sizeClasses[size],
        variantClasses[variant],
        variant === 'default' && 'border-[var(--button-default-border)]',
        className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
