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
        'relative inline-block h-[20px] w-[36px] rounded-full transition-colors duration-200 disabled:opacity-50',
        checked
          ? 'bg-[var(--primary-color)] shadow-[0_2px_8px_rgba(var(--primary-rgb),0.4)]'
          : 'bg-[var(--toggle-off-bg)]'
      )}
    >
      <span
        className="absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white"
        style={{
          left: checked ? '18px' : '2px',
          transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
        }}
      />
    </button>
  );
}
