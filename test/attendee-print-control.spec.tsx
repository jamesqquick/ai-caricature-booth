/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendeePrintControl } from '../src/components/AttendeePrintControl';

const sessionId = '00000000-0000-4000-8000-000000000001';
const jobId = '0123456789abcdef0123456789abcdef';
const endpoint = `/api/events/7/sessions/${sessionId}/print-jobs`;

function job(status: 'pending' | 'printing' | 'printed' | 'failed', printedAt: number | null = null) {
  return { job: { id: jobId, status, printedAt } };
}

describe('AttendeePrintControl', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('queues only after a user click, blocks double clicks, and follows pending through printed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(job('pending'))))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { status: 'printing', printedAt: null } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { status: 'printed', printedAt: 200 } })));
    vi.stubGlobal('fetch', fetchMock);
    render(<AttendeePrintControl eventId={7} sessionId={sessionId} />);

    expect(fetchMock).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: 'Print postcard' });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Print queued' }).hasAttribute('disabled')).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }));

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(await screen.findByRole('button', { name: 'Printing postcard' })).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(await screen.findByRole('button', { name: 'Postcard printed' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Your postcard has been printed.');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('allows a failed print to create a fresh request rather than retrying an ambiguous job', async () => {
    const secondJobId = 'fedcba9876543210fedcba9876543210';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(job('failed'))))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: secondJobId, status: 'pending', printedAt: null } })));
    vi.stubGlobal('fetch', fetchMock);
    render(<AttendeePrintControl eventId={7} sessionId={sessionId} />);

    fireEvent.click(screen.getByRole('button', { name: 'Print postcard' }));
    const retry = await screen.findByRole('button', { name: 'Try print again' });
    expect(screen.getByRole('status').textContent).toContain('The print failed');
    fireEvent.click(retry);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(endpoint);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
    expect(screen.getByRole('button', { name: 'Print queued' })).toBeTruthy();
  });

  it.each([
    ['malformed response', () => new Response('{', { status: 200 })],
    ['invalid payload', () => new Response(JSON.stringify({ job: { status: 'pending' } }))],
    ['server response', () => new Response(JSON.stringify({ error: 'Printer service unavailable.' }), { status: 503 })],
  ])('shows a recoverable error for a %s', async (_name, response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    render(<AttendeePrintControl eventId={7} sessionId={sessionId} />);

    fireEvent.click(screen.getByRole('button', { name: 'Print postcard' }));

    expect(await screen.findByRole('button', { name: 'Try print again' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/couldn't (?:request|read)|unavailable/i);
  });

  it('handles network errors and aborts active polling on cleanup', async () => {
    const pendingResponse = new Response(JSON.stringify(job('pending')));
    let pollSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(pendingResponse)
      .mockImplementationOnce((_url, init) => {
        pollSignal = init?.signal;
        return new Promise(() => undefined);
      });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<AttendeePrintControl eventId={7} sessionId={sessionId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Print postcard' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print queued' })).toBeTruthy());
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(pollSignal?.aborted).toBe(false);

    unmount();
    expect(pollSignal?.aborted).toBe(true);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    render(<AttendeePrintControl eventId={7} sessionId={sessionId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Print postcard' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/connection/i);
  });
});
