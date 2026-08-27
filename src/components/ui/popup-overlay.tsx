import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

type PopupOverlayProps = {
  open: boolean;
  label: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

export function PopupOverlay({ open, label, onClose, returnFocusRef, children }: PopupOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      returnFocusRef?.current?.focus();
      return;
    }

    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, open, returnFocusRef]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-5xl rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-2xl outline-none sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-3 top-3 z-10 inline-flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          onClick={onClose}
          aria-label="Close preview"
          title="Close preview"
        >
          <X aria-hidden="true" size={18} strokeWidth={2.5} />
        </button>
        {children}
      </div>
    </div>
  );
}
