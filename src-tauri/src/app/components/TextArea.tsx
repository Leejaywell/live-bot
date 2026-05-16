import { TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils';

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'px-3 py-2 rounded-lg resize-none',
          'bg-[var(--control-bg)] border border-[var(--control-border)] text-[var(--control-text)]',
          'focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50',
          'placeholder:text-gray-400 dark:placeholder:text-gray-500',
          className
        )}
        {...props}
      />
    );
  }
);

TextArea.displayName = 'TextArea';
