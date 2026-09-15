import { Copy } from 'lucide-react';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Button } from '../ui/button';
import { PopupOverlay } from '../ui/popup-overlay';

type EventDuplicateControlProps = {
  eventName: string;
  endpoint: string;
};

type DuplicateEventResult = {
  error?: string;
  fields?: Record<string, string>;
  redirectTo?: string;
};

class EventDuplicationError extends Error {
  constructor(message: string, readonly fieldMessage = '') {
    super(message);
    this.name = 'EventDuplicationError';
  }
}

function copyName(name: string) {
  return `${name.slice(0, 113).trimEnd()} (Copy)`;
}

export function EventDuplicateControl({ eventName, endpoint }: EventDuplicateControlProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState({ name: eventName, endpoint });
  const [name, setName] = useState(copyName(eventName));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const updateSource = (event: Event) => {
      const detail = (event as CustomEvent<{ name: string; slug: string }>).detail;
      if (detail?.name && detail.slug) {
        setSource({
          name: detail.name,
          endpoint: `/api/admin/events/${encodeURIComponent(detail.slug)}/duplicate`,
        });
      }
    };
    window.addEventListener('event-details-updated', updateSource);
    return () => window.removeEventListener('event-details-updated', updateSource);
  }, []);

  const showDialog = () => {
    setName(copyName(source.name));
    setError('');
    setOpen(true);
  };

  const closeDialog = () => {
    if (!pending) setOpen(false);
  };

  const duplicateEvent = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(source.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const result = await response.json<DuplicateEventResult>().catch((): DuplicateEventResult => ({}));
      if (!response.ok) {
        throw new EventDuplicationError(
          result.error ?? "Couldn't duplicate the event. Try again.",
          result.fields?.name,
        );
      }
      if (!result.redirectTo) throw new EventDuplicationError("Couldn't open the duplicated event. Try again.");
      window.location.assign(result.redirectTo);
    } catch (cause) {
      const message = cause instanceof EventDuplicationError
        ? cause.fieldMessage || cause.message
        : "Couldn't duplicate the event. Check your connection and try again.";
      setError(message);
      setPending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        size="sm"
        className="size-11 p-0 sm:h-auto sm:w-auto sm:px-4"
        aria-label={`Duplicate ${source.name}`}
        onClick={showDialog}
      >
        <Copy aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Duplicate event</span>
      </Button>
      <PopupOverlay
        open={open}
        label={`Duplicate ${source.name}`}
        closeLabel="Close duplicate event dialog"
        size="compact"
        onClose={closeDialog}
        initialFocusRef={inputRef}
        returnFocusRef={triggerRef}
      >
        <form aria-label="Duplicate event" onSubmit={duplicateEvent}>
          <div className="pr-12">
            <p className="m-0 font-label text-xs font-extrabold uppercase tracking-[.14em] text-primary">Create a draft copy</p>
            <h2 className="mb-0 mt-3 font-display text-3xl font-semibold tracking-[-.04em]">Duplicate {source.name}</h2>
          </div>
          <p className="mb-0 mt-5 text-sm leading-[1.65] text-muted-foreground">
            Event settings, prompts, scenes, and watermark files will be copied. Sessions and print history will not.
          </p>
          <label className="mt-5 grid gap-2 font-label text-sm font-bold" htmlFor="duplicate-event-name">
            Event name
            <input
              ref={inputRef}
              className="min-h-12 rounded-xl border border-border bg-card px-4 font-sans font-normal text-foreground"
              id="duplicate-event-name"
              name="name"
              value={name}
              required
              maxLength={120}
              autoComplete="off"
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'duplicate-event-error' : undefined}
              disabled={pending}
              onChange={(event) => {
                setName(event.target.value);
                setError('');
              }}
            />
          </label>
          {error && <p className="mb-0 mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" id="duplicate-event-error" role="alert">{error}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-border pt-5">
            <Button type="button" variant="secondary" disabled={pending} onClick={closeDialog}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? 'Duplicating event...' : 'Create duplicate'}</Button>
          </div>
        </form>
      </PopupOverlay>
    </>
  );
}
