import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button';

type PopupOverlayProps = {
  open: boolean;
  label: string;
  closeLabel?: string;
  size?: 'compact' | 'wide';
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

export function PopupOverlay({ open, label, closeLabel = 'Close dialog', size = 'wide', onClose, initialFocusRef, returnFocusRef, children }: PopupOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      returnFocusRef?.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (!open) return;

    (initialFocusRef?.current ?? dialogRef.current)?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [initialFocusRef, onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-background/90 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className={`relative max-h-[calc(100dvh-2rem)] w-full ${size === 'compact' ? 'max-w-lg' : 'max-w-5xl'} cursor-default overflow-y-auto rounded-[var(--radius-surface)] border border-border bg-card p-4 shadow-2xl outline-none sm:p-6`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          className="absolute right-3 top-3 z-10 inline-flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
        >
          <X aria-hidden="true" size={18} strokeWidth={2.5} />
        </Button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
