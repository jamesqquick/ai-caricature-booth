import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../ui/button';
import { ConfirmationDialog } from '../ui/confirmation-dialog';

type SessionDeleteControlProps = {
  sessionId: string;
  endpoint: string;
  redirectTo?: string;
};

type DeleteSessionResult = {
  error?: string;
  redirectTo?: string;
};

class SessionDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionDeletionError';
  }
}

export function SessionDeleteControl({ sessionId, endpoint, redirectTo }: SessionDeleteControlProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const showDialog = () => {
    setError('');
    setOpen(true);
  };

  const deleteSession = async () => {
    setPending(true);
    setError('');
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      const result = await response.json<DeleteSessionResult>().catch((): DeleteSessionResult => ({}));
      if (!response.ok) throw new SessionDeletionError(result.error ?? "Couldn't delete the session. Try again.");
      window.location.assign(redirectTo ?? result.redirectTo ?? '/admin');
    } catch (cause) {
      setError(cause instanceof SessionDeletionError ? cause.message : "Couldn't delete the session. Check your connection and try again.");
      setPending(false);
    }
  };

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="destructiveOutline"
        size="icon"
        aria-label={`Delete session ${sessionId}`}
        onClick={showDialog}
      >
        <Trash2 aria-hidden="true" />
      </Button>
      <ConfirmationDialog
        open={open}
        title="Delete session"
        confirmLabel={<><Trash2 aria-hidden="true" /> Delete</>}
        pendingLabel="Deleting session..."
        pending={pending}
        error={error}
        returnFocusRef={triggerRef}
        onClose={() => setOpen(false)}
        onConfirm={deleteSession}
      >
        <p className="m-0">This permanently deletes session <strong className="break-all text-foreground">{sessionId}</strong> and its saved selfie, caricature, and postcard. This cannot be undone.</p>
      </ConfirmationDialog>
    </>
  );
}
