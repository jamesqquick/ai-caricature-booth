import { useEffect, useRef, useState } from 'react';
import type { PrintJobStatus } from '../db/print-jobs';

const POLL_INTERVAL_MS = 2_000;
const JOB_ID_PATTERN = /^[0-9a-f]{32}$/i;
const ACTIVE_STATUSES: readonly PrintJobStatus[] = ['pending', 'printing'];

type PrintState = 'idle' | 'submitting' | PrintJobStatus | 'error';
type Job = { id: string; status: PrintJobStatus; printedAt: number | null };

class PrintRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrintRequestError';
  }
}

function isStatus(value: unknown): value is PrintJobStatus {
  return value === 'pending' || value === 'printing' || value === 'printed' || value === 'failed';
}

function parseJob(value: unknown, requireId: boolean): Job {
  if (!value || typeof value !== 'object') throw new PrintRequestError("We couldn't read the printer response. Try again.");
  const job = (value as { job?: unknown }).job;
  if (!job || typeof job !== 'object') throw new PrintRequestError("We couldn't read the printer response. Try again.");
  const candidate = job as Partial<Job>;
  if (!isStatus(candidate.status) || (requireId && (typeof candidate.id !== 'string' || !JOB_ID_PATTERN.test(candidate.id)))) {
    throw new PrintRequestError("We couldn't read the printer response. Try again.");
  }
  if (candidate.printedAt !== null && typeof candidate.printedAt !== 'number') {
    throw new PrintRequestError("We couldn't read the printer response. Try again.");
  }
  return { id: typeof candidate.id === 'string' ? candidate.id : '', status: candidate.status, printedAt: candidate.printedAt };
}

async function responseJob(response: Response, requireId: boolean) {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    throw new PrintRequestError(typeof body?.error === 'string' ? body.error : "We couldn't request a print. Try again.");
  }
  return parseJob(body, requireId);
}

function announcePrintActive(active: boolean) {
  window.dispatchEvent(new CustomEvent('print-job-active', { detail: { active } }));
}

const buttonCopy: Record<PrintState, string> = {
  idle: 'Print postcard',
  submitting: 'Requesting print...',
  pending: 'Print queued',
  printing: 'Printing postcard',
  printed: 'Postcard printed',
  failed: 'Try print again',
  error: 'Try print again',
};

const statusCopy: Record<PrintState, string> = {
  idle: '',
  submitting: 'Sending your postcard to the printer.',
  pending: 'Your postcard is queued for printing.',
  printing: 'Your postcard is printing. Please wait for it to finish.',
  printed: 'Your postcard has been printed.',
  failed: 'The print failed. You can send a fresh print request.',
  error: '',
};

type Props = {
  eventId: number;
  sessionId: string;
};

export function AttendeePrintControl({ eventId, sessionId }: Props) {
  const [state, setState] = useState<PrintState>('idle');
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState('');
  const requestInFlight = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const endpoint = `/api/events/${eventId}/sessions/${encodeURIComponent(sessionId)}/print-jobs`;

  useEffect(() => () => requestController.current?.abort(), []);

  useEffect(() => {
    if (!ACTIVE_STATUSES.includes(state as PrintJobStatus) || !jobId) {
      announcePrintActive(false);
      return;
    }

    let disposed = false;
    let timeout: number | undefined;
    const controller = new AbortController();
    announcePrintActive(true);

    const poll = async () => {
      try {
        const response = await fetch(`${endpoint}/${jobId}`, { signal: controller.signal });
        const nextJob = await responseJob(response, false);
        if (disposed) return;
        setState(nextJob.status);
        if (ACTIVE_STATUSES.includes(nextJob.status)) timeout = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (cause) {
        if (disposed || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setError(cause instanceof PrintRequestError ? cause.message : "We lost the printer connection. Try again.");
        setState('error');
      }
    };

    timeout = window.setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
      announcePrintActive(false);
    };
  }, [endpoint, jobId, state]);

  const requestPrint = async () => {
    if (requestInFlight.current || state === 'pending' || state === 'printing' || state === 'printed') return;
    requestInFlight.current = true;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setError('');
    setJobId('');
    setState('submitting');

    try {
      const response = await fetch(endpoint, { method: 'POST', signal: controller.signal });
      const nextJob = await responseJob(response, true);
      setJobId(nextJob.id);
      setState(nextJob.status);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof PrintRequestError ? cause.message : "We couldn't reach the printer. Check your connection and try again.");
      setState('error');
    } finally {
      if (requestController.current === controller) requestController.current = null;
      requestInFlight.current = false;
    }
  };

  const disabled = state === 'submitting' || state === 'pending' || state === 'printing' || state === 'printed';

  return (
    <div className="contents">
      <button
        className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-[oklch(76%_.14_150)] bg-[oklch(76%_.14_150)] px-[1.15rem] font-bold text-[oklch(16%_.025_55)] transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:rotate-[.5deg] hover:border-[oklch(82%_.12_150)] hover:bg-[oklch(82%_.12_150)] hover:shadow-[0_.75rem_2rem_oklch(60%_.14_150_/.25)] active:translate-y-0 disabled:pointer-events-none disabled:cursor-default disabled:opacity-60 max-[600px]:w-full"
        type="button"
        disabled={disabled}
        onClick={requestPrint}
        aria-label={buttonCopy[state]}
      >
        <svg className="size-[1.15rem] fill-none stroke-current stroke-2 stroke-linecap-round stroke-linejoin-round" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z" />
        </svg>
        <span>{buttonCopy[state]}</span>
      </button>
      {error ? (
        <span className="order-last m-0 basis-full pt-1 text-center text-[.82rem] text-destructive" role="alert">{error}</span>
      ) : (
        <span className="order-last m-0 basis-full pt-1 text-center text-[.82rem] text-muted-foreground" role="status" aria-live="polite">{statusCopy[state]}</span>
      )}
    </div>
  );
}
