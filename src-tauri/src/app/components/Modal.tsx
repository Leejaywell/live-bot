import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

export const MODAL_W = 'w-[480px]';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  zIndex?: number;
}

export function Modal({ open, onClose, children, className, zIndex = 500 }: ModalProps) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const [nudging, setNudging] = useState(false);
  const nudgeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
    } else if (rendered) {
      setClosing(true);
      const t = setTimeout(() => { setRendered(false); setClosing(false); }, 240);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleBackdropClick = () => {
    if (nudging) return;
    setNudging(true);
  };

  if (!rendered) return null;

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex }}>
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 backdrop-blur-sm',
          closing ? 'animate-backdrop-out' : 'animate-backdrop-in'
        )}
        style={{ background: 'var(--modal-backdrop)' }}
        onClick={handleBackdropClick}
      />
      {/* Nudge wrapper */}
      <div
        className={nudging ? 'animate-modal-nudge' : ''}
        onAnimationEnd={() => setNudging(false)}
        onClick={e => e.stopPropagation()}
      >
        {/* Card */}
        <div className={cn(
          'glass-card rounded-[18px] backdrop-blur-xl shadow-2xl overflow-hidden relative',
          MODAL_W,
          closing ? 'animate-modal-out' : 'animate-modal-in',
          className
        )}>
          {/* Sheen sweep on entry */}
          {!closing && (
            <div className="animate-modal-sheen absolute inset-0 z-[1]" />
          )}
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ModalCloseButton({ onClose, className }: { onClose: () => void; className?: string }) {
  return (
    <button
      onClick={onClose}
      className={cn(
        'w-7 h-7 rounded-lg flex items-center justify-center',
        'hover:bg-black/5 dark:hover:bg-white/10',
        'hover:bg-[var(--button-ghost-hover)] text-[var(--button-ghost-text)]',
        'transition-[transform,background] duration-200 hover:rotate-90',
        className
      )}
    >
      <X className="w-4 h-4" />
    </button>
  );
}
