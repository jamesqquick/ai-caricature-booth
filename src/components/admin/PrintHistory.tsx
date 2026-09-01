import { useEffect, useRef, useState } from 'react';
import type { AdminPrintJob } from '../../db/print-jobs';
import { fetchWithDeadline } from '../../lib/fetch-with-deadline';
import { Button } from '../ui/button';

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 8_000;
const ACTIVE_STATUSES = ['pending', 'printing'];
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

class PrintHistoryError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'PrintHistoryError';
  }
}

type DisplayPrintJob = Omit<AdminPrintJob, 'status'> & { status: string };

function parseJob(value: unknown): DisplayPrintJob {
  if (!value || typeof value !== 'object') throw new PrintHistoryError("Couldn't read the print history response.");
  const job = value as Partial<AdminPrintJob>;
  if (
    typeof job.id !== 'string'
    || typeof job.sessionId !== 'string'
    || typeof job.eventId !== 'number'
    || typeof job.sceneName !== 'string'
    || typeof job.postcardUrl !== 'string'
    || typeof job.createdAt !== 'number'
    || typeof job.status !== 'string'
    || job.status.length === 0
    || (job.printedAt !== null && typeof job.printedAt !== 'number')
    || (job.error !== null && typeof job.error !== 'string')
  ) {
    throw new PrintHistoryError("Couldn't read the print history response.");
  }
  return job as DisplayPrintJob;
}

async function readBody(response: Response) {
  return await response.json().catch(() => null) as { error?: unknown; job?: unknown; jobs?: unknown } | null;
}

async function readJobs(response: Response) {
  const body = await readBody(response);
  if (!response.ok) {
    throw new PrintHistoryError(typeof body?.error === 'string' ? body.error : "Couldn't refresh print history.", response.status);
  }
  if (!Array.isArray(body?.jobs)) throw new PrintHistoryError("Couldn't read the print history response.");
  return body.jobs.map(parseJob).sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
}

async function readMutation(response: Response) {
  const body = await readBody(response);
  if (!response.ok) {
    throw new PrintHistoryError(typeof body?.error === 'string' ? body.error : "Couldn't update the print queue.", response.status);
  }
  return parseJob(body?.job);
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusTone(status: string) {
  if (status === 'printed') return 'border-success/35 bg-success/10 text-success';
  if (status === 'failed') return 'border-destructive/35 bg-destructive/10 text-destructive';
  return 'border-primary/35 bg-primary/10 text-primary';
}

function formattedTime(timestamp: number) {
  return `${dateFormatter.format(new Date(timestamp * 1000))} UTC`;
}

type Props = {
  sessionId: string;
  hasPostcard: boolean;
  initialJobs: AdminPrintJob[];
};

export function PrintHistory({ sessionId, hasPostcard, initialJobs }: Props) {
  const [jobs, setJobs] = useState<DisplayPrintJob[]>(initialJobs);
  const [alert, setAlert] = useState('');
  const [isMutating, setIsMutating] = useState(false);
  const mutationInFlight = useRef(false);
  const mutationController = useRef<AbortController | null>(null);
  const mutationRequest = useRef<{ operation: string; key: string } | null>(null);
  const endpoint = `/api/admin/sessions/${encodeURIComponent(sessionId)}/print-jobs`;
  const activeJob = jobs.find((job) => ACTIVE_STATUSES.includes(job.status));

  useEffect(() => () => mutationController.current?.abort(), []);

  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);

  useEffect(() => {
    if (!activeJob) return;
    let disposed = false;
    let timeout: number | undefined;
    let delay = POLL_INTERVAL_MS;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const response = await fetchWithDeadline(endpoint, { signal: controller.signal });
        const nextJobs = await readJobs(response);
        if (disposed) return;
        setJobs(nextJobs);
        setAlert('');
        delay = POLL_INTERVAL_MS;
      } catch (cause) {
        if (disposed || controller.signal.aborted) return;
        setAlert("Couldn't refresh print history. Showing the most recent print history.");
        delay = Math.min(delay * 2, MAX_POLL_INTERVAL_MS);
      } finally {
        if (!disposed) timeout = window.setTimeout(poll, delay);
      }
    };

    timeout = window.setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeJob?.id, activeJob?.status, endpoint]);

  const refreshAfterConflict = async (signal: AbortSignal) => {
    try {
      const response = await fetchWithDeadline(endpoint, { signal });
      setJobs(await readJobs(response));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
    }
  };

  const mutate = async (action: 'queue' | 'retry', jobId?: string) => {
    if (mutationInFlight.current || activeJob) return;
    mutationInFlight.current = true;
    mutationController.current?.abort();
    const controller = new AbortController();
    mutationController.current = controller;
    setIsMutating(true);
    setAlert('');

    const operation = `${action}:${jobId ?? ''}`;
    if (mutationRequest.current?.operation !== operation) {
      mutationRequest.current = { operation, key: crypto.randomUUID() };
    }

    try {
      const response = await fetchWithDeadline(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'retry'
          ? { action, jobId, idempotencyKey: mutationRequest.current.key }
          : { action, idempotencyKey: mutationRequest.current.key }),
        signal: controller.signal,
      });
      const job = await readMutation(response);
      setJobs((current) => (action === 'retry'
        ? current.map((item) => item.id === job.id ? job : item)
        : [job, ...current]
      ).sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id)));
      mutationRequest.current = null;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      const error = cause instanceof PrintHistoryError ? cause : new PrintHistoryError("Couldn't reach the print queue. Check your connection and try again.");
      setAlert(error.message);
      if (error.status === 409) await refreshAfterConflict(controller.signal);
    } finally {
      if (mutationController.current === controller) mutationController.current = null;
      mutationInFlight.current = false;
      setIsMutating(false);
    }
  };

  const refreshNow = async () => {
    const controller = new AbortController();
    mutationController.current?.abort();
    mutationController.current = controller;
    try {
      const response = await fetchWithDeadline(endpoint, { signal: controller.signal });
      setJobs(await readJobs(response));
      setAlert('');
    } catch {
      if (!controller.signal.aborted) setAlert("Couldn't refresh print history. Showing the most recent print history.");
    } finally {
      if (mutationController.current === controller) mutationController.current = null;
    }
  };

  const actionsDisabled = Boolean(activeJob) || isMutating;
  const queueLabel = jobs.length === 0 ? 'Queue first print' : 'Reprint postcard';

  return (
    <section className="mt-6 rounded-[var(--radius-surface)] border border-border bg-card p-6" aria-labelledby="print-history-heading" aria-busy={isMutating}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="m-0 font-label text-[.68rem] font-extrabold uppercase tracking-[.14em] text-primary">Physical output</p>
          <h2 className="mt-2 mb-0 font-display text-2xl tracking-[-.04em]" id="print-history-heading">Print history</h2>
          <p className="mb-0 mt-2 text-sm text-muted-foreground">Printing jobs are never retried while their physical outcome is unknown.</p>
        </div>
        {hasPostcard && (
          <Button type="button" disabled={actionsDisabled} onClick={() => mutate('queue')} aria-label={queueLabel}>
            {isMutating ? 'Updating queue...' : queueLabel}
          </Button>
        )}
      </div>

      {alert && (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground" role="alert">
          {alert} <button type="button" className="font-bold underline" onClick={refreshNow}>Check print history</button>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">{isMutating ? 'Updating print queue.' : ''}</span>

      {jobs.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
          <p className="m-0 font-semibold">No print requests yet</p>
          <p className="mb-0 mt-1 text-sm text-muted-foreground">{hasPostcard ? 'Queue the first physical postcard when the printer is ready.' : 'Printing becomes available after the postcard is created.'}</p>
        </div>
      ) : (
        <ol className="mt-5 grid list-none gap-3 p-0" aria-label="Print job history">
          {jobs.map((job) => (
            <li className="rounded-xl border border-border bg-muted/20 p-4" key={job.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 font-label text-[.62rem] font-extrabold uppercase tracking-[.08em] ${statusTone(job.status)}`}>{statusLabel(job.status)}</span>
                  <p className="mb-0 mt-2 font-label text-xs text-muted-foreground">
                    {job.printedAt ? 'Completed' : 'Requested'}{' '}
                    <time dateTime={new Date((job.printedAt ?? job.createdAt) * 1000).toISOString()}>{formattedTime(job.printedAt ?? job.createdAt)}</time>
                  </p>
                  {job.error && <p className="mb-0 mt-2 text-sm text-destructive">{job.error}</p>}
                </div>
                {job.status === 'failed' && (
                  <Button type="button" variant="secondary" disabled={actionsDisabled} onClick={() => mutate('retry', job.id)} aria-label={`Retry failed print requested ${formattedTime(job.createdAt)}`}>
                    Retry
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
