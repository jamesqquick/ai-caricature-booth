/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintHistory } from '../src/components/admin/PrintHistory';
import type { AdminPrintJob } from '../src/db/print-jobs';

const sessionId = '00000000-0000-4000-8000-000000000001';
const endpoint = `/api/admin/sessions/${sessionId}/print-jobs`;
const failedJob: AdminPrintJob = {
  id: '1'.repeat(32),
  sessionId,
  eventId: 7,
  sceneName: 'Subway Platform',
  postcardUrl: '/api/events/7/sessions/example/postcard',
  status: 'failed',
  createdAt: 100,
  printedAt: null,
  error: 'Paper jam',
};
const printedJob: AdminPrintJob = {
  ...failedJob,
  id: '2'.repeat(32),
  status: 'printed',
  createdAt: 200,
  printedAt: 220,
  error: null,
};

describe('PrintHistory', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders newest-first status, timestamps, errors, and distinct Retry/Reprint actions', () => {
    render(<PrintHistory sessionId={sessionId} hasPostcard initialJobs={[printedJob, failedJob]} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Printed')).toBeTruthy();
    expect(within(rows[0]!).getByText(/Jan 1, 1970/)).toBeTruthy();
    expect(within(rows[1]!).getByText('Failed')).toBeTruthy();
    expect(within(rows[1]!).getByText('Paper jam')).toBeTruthy();
    expect(within(rows[1]!).getByRole('button', { name: 'Retry failed print' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reprint postcard' })).toBeTruthy();
  });

  it('offers only the first-print action when history is empty and a postcard exists', () => {
    render(<PrintHistory sessionId={sessionId} hasPostcard initialJobs={[]} />);
    expect(screen.getByRole('button', { name: 'Queue first print' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reprint postcard' })).toBeNull();
  });

  it('hides queue actions without a postcard and disables all competing actions while active', () => {
    const pending = { ...failedJob, id: '3'.repeat(32), status: 'pending' as const, error: null, createdAt: 300 };
    const { rerender } = render(<PrintHistory sessionId={sessionId} hasPostcard={false} initialJobs={[]} />);
    expect(screen.queryByRole('button', { name: /print/i })).toBeNull();

    rerender(<PrintHistory sessionId={sessionId} hasPostcard initialJobs={[pending, failedJob]} />);
    expect(screen.getByRole('button', { name: 'Reprint postcard' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry failed print' }).hasAttribute('disabled')).toBe(true);
    expect(within(screen.getAllByRole('listitem')[0]!).queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('queues a first print, retries the same failed row, and reprints with new queue requests', async () => {
    const pending = { ...failedJob, id: '3'.repeat(32), status: 'pending' as const, error: null, createdAt: 300 };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: pending })));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<PrintHistory sessionId={sessionId} hasPostcard initialJobs={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Queue first print' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'queue' }) })));

    fetchMock.mockClear();
    rerender(<PrintHistory sessionId={sessionId} hasPostcard initialJobs={[failedJob]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed print' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ body: JSON.stringify({ action: 'retry', jobId: failedJob.id }) })));

    fetchMock.mockClear();
    rerender(<PrintHistory sessionId={sessionId} hasPostcard initialJobs={[printedJob]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reprint postcard' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ body: JSON.stringify({ action: 'queue' }) })));
  });

  it('polls only while active, preserves stale rows on errors, and resumes with fresh history', async () => {
    const pending = { ...failedJob, id: '3'.repeat(32), status: 'pending' as const, error: null, createdAt: 300 };
    const printing = { ...pending, status: 'printing' as const };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [printing, printedJob, failedJob] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [{ ...printing, status: 'printed', printedAt: 400 }, printedJob, failedJob] })));
    vi.stubGlobal('fetch', fetchMock);
    render(<PrintHistory sessionId={sessionId} hasPostcard initialJobs={[pending, printedJob, failedJob]} />);

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/most recent print history/i);

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByText('Printing')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getAllByText('Printed')).toHaveLength(2);
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refreshes after a 409 and shows the server conflict inline', async () => {
    const pending = { ...failedJob, id: '3'.repeat(32), status: 'pending' as const, error: null, createdAt: 300 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'This session already has an active print job.' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [pending, failedJob] })));
    vi.stubGlobal('fetch', fetchMock);
    render(<PrintHistory sessionId={sessionId} hasPostcard initialJobs={[failedJob]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reprint postcard' }));

    expect((await screen.findByRole('alert')).textContent).toContain('already has an active print job');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(endpoint);
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('aborts an in-flight poll on cleanup', async () => {
    const pending = { ...failedJob, id: '3'.repeat(32), status: 'pending' as const, error: null, createdAt: 300 };
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init?.signal;
      return new Promise(() => undefined);
    }));
    const { unmount } = render(<PrintHistory sessionId={sessionId} hasPostcard initialJobs={[pending]} />);

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
