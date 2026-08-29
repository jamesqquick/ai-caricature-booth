import type { ReactNode, RefObject } from 'react';
import { Button } from './button';
import { PopupOverlay } from './popup-overlay';

type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
};

export function ConfirmationDialog({
  open,
  title,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  returnFocusRef,
  onClose,
  onConfirm,
  children,
}: ConfirmationDialogProps) {
  const close = () => {
    if (!pending) onClose();
  };

  return (
    <PopupOverlay
      open={open}
      label={title}
      closeLabel="Close confirmation"
      size="compact"
      onClose={close}
      returnFocusRef={returnFocusRef}
    >
      <div className="pr-12">
        <p className="m-0 font-label text-xs font-extrabold uppercase tracking-[.14em] text-destructive">Permanent action</p>
        <h2 className="mb-0 mt-3 font-display text-3xl font-semibold tracking-[-.04em]">{title}</h2>
      </div>
      <div className="mt-5 text-sm leading-[1.65] text-muted-foreground">{children}</div>
      {error && <p className="mb-0 mt-5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-border pt-5">
        <Button type="button" variant="secondary" disabled={pending} onClick={close}>Cancel</Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </PopupOverlay>
  );
}
