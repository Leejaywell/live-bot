import { InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, mono, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'h-[32px] px-3 rounded-lg',
          'bg-[var(--control-bg)] border border-[var(--control-border)] text-[var(--control-text)]',
          'focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50',
          'placeholder:text-gray-400 dark:placeholder:text-gray-500',
          mono && 'font-mono text-[11px]',
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
