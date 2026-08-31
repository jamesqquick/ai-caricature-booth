import { useRef, useState } from 'react';
import { Button } from '../ui/button';
import { ConfirmationDialog } from '../ui/confirmation-dialog';

type EventDeleteControlProps = {
  eventName: string;
  endpoint: string;
};

type DeleteEventResult = {
  error?: string;
  redirectTo?: string;
};

class EventDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventDeletionError';
  }
}

export function EventDeleteControl({ eventName, endpoint }: EventDeleteControlProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const showDialog = () => {
    setError('');
    setOpen(true);
  };

  const deleteEvent = async () => {
    setPending(true);
    setError('');
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      const result = await response.json<DeleteEventResult>().catch((): DeleteEventResult => ({}));
       if (!response.ok) throw new EventDeletionError(result.error ?? "Couldn't delete the event. Try again.");
      window.location.assign(result.redirectTo ?? '/admin/events');
    } catch (cause) {
       setError(cause instanceof EventDeletionError ? cause.message : "Couldn't delete the event. Check your connection and try again.");
      setPending(false);
    }
  };

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        className="border-destructive/50 text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={showDialog}
      >
        Delete event
      </Button>
      <ConfirmationDialog
        open={open}
        title={`Delete ${eventName}`}
        confirmLabel="Permanently delete event"
        pendingLabel="Deleting event..."
        pending={pending}
        error={error}
        returnFocusRef={triggerRef}
        onClose={() => setOpen(false)}
        onConfirm={deleteEvent}
      >
        <p className="m-0">This permanently deletes <strong className="text-foreground">{eventName}</strong>, including all sessions, scenes, and stored images. This cannot be undone.</p>
      </ConfirmationDialog>
    </>
  );
}
