/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationsDashboard } from '../src/components/admin/OperationsDashboard';

const initialSession = {
  id: 'session-1',
  eventId: 7,
  eventName: 'Demo Event',
  eventSlug: 'demo-event',
  sceneId: 'subway',
  sceneName: 'Subway Platform',
  status: 'generating' as const,
  createdAt: 100,
  updatedAt: 300,
  completedAt: null,
  errorMessage: null,
  workflowId: 'workflow-1',
  hasSelfie: true,
  hasCaricature: false,
  hasPostcard: false,
};

const initialSessionResult = {
  sessions: [initialSession],
  page: 1,
  pageSize: 30,
  total: 1,
  totalPages: 1,
};
const initialStats = {
  total: 1,
  completed: 0,
  errored: 0,
  inFlight: 1,
  completionRate: 0,
  averagePipelineMs: null,
  statusBreakdown: [{ status: 'generating' as const, count: 1 }],
  sceneUsage: [{ sceneId: 'subway', sceneName: 'Subway Platform', count: 1 }],
  volume: [{ bucket: '1970-01-01', count: 1 }],
  volumeGranularity: 'day' as const,
};
const completedStats = {
  ...initialStats,
  completed: 1,
  inFlight: 0,
  completionRate: 100,
  statusBreakdown: [{ status: 'completed' as const, count: 1 }],
};

function renderDashboard() {
  return render(
    <OperationsDashboard
      events={[
        { id: 7, name: 'Demo Event', slug: 'demo-event', status: 'active' },
        { id: 8, name: 'Second Event', slug: 'second-event', status: 'draft' },
      ]}
      statuses={['pending', 'uploading', 'moderating', 'generating', 'compositing', 'completed', 'errored']}
      initialFilters={{ page: 1, pageSize: 30 }}
      initialSessionResult={initialSessionResult}
      initialStats={initialStats}
    />,
  );
}

function successfulFetch(url: string | URL | Request) {
  const href = String(url);
  if (href.startsWith('/api/admin/sessions')) {
    return Promise.resolve(new Response(JSON.stringify({
      ...initialSessionResult,
      sessions: [{ ...initialSession, status: 'completed', completedAt: 400 }],
    })));
  }
  return Promise.resolve(new Response(JSON.stringify(completedStats)));
}

describe('OperationsDashboard polling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn(successfulFetch));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.history.replaceState(null, '', '/admin');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders the server snapshot and refreshes it after 15 seconds', async () => {
    renderDashboard();

    expect(within(screen.getByRole('row', { name: /session-1/ })).getByText('Generating')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(15_000));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith('/api/admin/sessions', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetch).toHaveBeenCalledWith('/api/admin/stats', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(within(screen.getByRole('row', { name: /session-1/ })).getByText('Completed')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('renders a neutral placeholder when a session has no postcard', () => {
    renderDashboard();

    expect(screen.getByRole('img', { name: 'No postcard preview for session session-1' }).querySelector('svg')).toBeTruthy();
    expect(screen.queryByText('Not available')).toBeNull();
  });

  it('renders a postcard thumbnail and opens the full postcard preview', () => {
    render(
      <OperationsDashboard
        events={[]}
        statuses={['pending', 'completed']}
        initialFilters={{ page: 1, pageSize: 30 }}
        initialSessionResult={{ ...initialSessionResult, sessions: [{ ...initialSession, status: 'completed', hasPostcard: true }] }}
        initialStats={initialStats}
      />,
    );

    const row = screen.getByRole('row', { name: /session-1/ });
    const image = row.querySelector<HTMLImageElement>('img');
    if (!image) throw new Error('Expected a postcard thumbnail image.');
    expect(image.getAttribute('src')).toBe('/api/admin/sessions/session-1/images/postcard?variant=thumbnail');
    const trigger = within(row).getByRole('button', { name: 'Expand Final postcard for session session-1' });
    fireEvent.load(image);
    expect(within(row).getByAltText('Final postcard for session session-1')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe('/api/admin/sessions/session-1/images/postcard');
  });

  it('refreshes immediately on filter changes and replaces the dashboard URL', async () => {
    renderDashboard();

    fireEvent.change(screen.getByLabelText('Event'), { target: { value: '8' } });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenCalledWith('/api/admin/sessions?eventId=8', expect.any(Object));
    expect(window.location.pathname).toBe('/admin');
    expect(window.location.search).toBe('?eventId=8');
  });

  it('keeps the last successful rows and shows a stale warning after a failed poll', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    renderDashboard();

    await act(async () => vi.advanceTimersByTimeAsync(15_000));

    expect(screen.getByText('session-1')).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /session-1/ })).getByText('Generating')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Showing the last successful update/);
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy();
  });

  it('marks refreshes busy and announces recovery while keeping the last good snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderDashboard();

    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByText('session-1')).toBeTruthy();

    fetchMock.mockImplementation(successfulFetch);
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(container.firstElementChild?.getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(screen.getByText('Live dashboard data recovered.')).toBeTruthy());
    expect(container.firstElementChild?.getAttribute('aria-busy')).toBe('false');
    expect(screen.queryByText(/Last successful update:/)).toBeNull();
  });

  it('pauses while hidden, refreshes on visibility, and aborts an in-flight request on unmount', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const { unmount } = renderDashboard();

    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText('Updates paused while hidden')).toBeNull();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
