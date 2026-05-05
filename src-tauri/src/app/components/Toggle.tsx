import { cn } from '../lib/utils';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex h-[20px] w-[36px] rounded-full transition-all disabled:opacity-50',
        checked
          ? 'bg-gradient-to-b from-[var(--primary-color)] to-[var(--primary-color)] shadow-[0_2px_8px_var(--primary-color)]'
          : 'bg-gradient-to-b from-[#d9d9de] to-[#d4d4d9]'
      )}
    >
      <span
        className={cn(
          'inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow-md transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
          'translate-y-[2px]'
        )}
      />
    </button>
  );
}
