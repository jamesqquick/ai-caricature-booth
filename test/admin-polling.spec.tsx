/** @vitest-environment jsdom */

import { StrictMode } from 'react';
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
  pageSize: 10,
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
      initialFilters={{ page: 1, pageSize: 10 }}
      initialSessionResult={initialSessionResult}
      initialStats={initialStats}
    />,
  );
}

function renderFilteredDashboard() {
  return render(
    <OperationsDashboard
      events={[{ id: 7, name: 'Demo Event', slug: 'demo-event', status: 'active' }]}
      statuses={['pending', 'completed']}
      initialFilters={{
        eventId: 7,
        status: 'completed',
        from: 86_400,
        to: 172_799,
        page: 1,
        pageSize: 10,
      }}
      initialSessionResult={{ ...initialSessionResult, totalPages: 4 }}
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
    expect(fetch).toHaveBeenCalledWith('/api/admin/sessions?pageSize=10', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetch).toHaveBeenCalledWith('/api/admin/stats', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(within(screen.getByRole('row', { name: /session-1/ })).getByText('Completed')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('renders a neutral placeholder when a session has no postcard', () => {
    renderDashboard();

    const row = screen.getByRole('row', { name: /session-1/ });
    expect(within(row).getByRole('img', { name: 'No postcard preview for session session-1' }).querySelector('svg')).toBeTruthy();
    expect(within(row).queryByText('Not available')).toBeNull();
  });

  it('exposes View and Delete actions for live session rows', () => {
    renderDashboard();

    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeTruthy();
    const row = screen.getByRole('row', { name: /session-1/ });
    expect(within(row).getByRole('link', { name: 'View session session-1' }).getAttribute('href')).toBe('/admin/sessions/session-1');
    expect(within(row).getByRole('button', { name: 'Delete session session-1' })).toBeTruthy();
  });

  it('hides dashboard pagination even when the session result has multiple pages', () => {
    render(
      <OperationsDashboard
        events={[]}
        statuses={['pending', 'completed']}
        initialFilters={{ page: 1, pageSize: 10 }}
        initialSessionResult={{ ...initialSessionResult, total: 21, totalPages: 3 }}
        initialStats={initialStats}
      />,
    );

    expect(screen.queryByRole('navigation', { name: 'Sessions pagination' })).toBeNull();
    expect(screen.queryByText('Page 1 of 3')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull();
  });

  it('ignores and removes an incoming hidden page query', async () => {
    window.history.replaceState(null, '', '/admin?eventId=7&page=2');
    render(
      <OperationsDashboard
        events={[]}
        statuses={['pending', 'completed']}
        initialFilters={{ eventId: 7, page: 2, pageSize: 10 }}
        initialSessionResult={{ ...initialSessionResult, page: 1, total: 21, totalPages: 3 }}
        initialStats={initialStats}
      />,
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?eventId=7');

    await act(async () => vi.advanceTimersByTimeAsync(15_000));

    expect(fetch).toHaveBeenCalledWith('/api/admin/sessions?eventId=7&pageSize=10', expect.any(Object));
    expect(fetch).toHaveBeenCalledWith('/api/admin/stats?eventId=7', expect.any(Object));
  });

  it('uses a page-1 delete redirect that preserves nonempty filters', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ deleted: true, redirectTo: '/admin' }),
      { headers: { 'content-type': 'application/json' } },
    )));
    renderFilteredDashboard();

    fireEvent.click(screen.getByRole('button', { name: 'Delete session session-1' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });

    const redirect = new URL(assign.mock.calls[0]?.[0], 'https://booth.test');
    expect(redirect.pathname).toBe('/admin');
    expect(Object.fromEntries(redirect.searchParams)).toEqual({
      eventId: '7',
      status: 'completed',
      from: '1970-01-02T00:00:00.000Z',
      to: '1970-01-02T23:59:59.000Z',
    });
    expect(redirect.searchParams.has('page')).toBe(false);
  });

  it('renders a postcard thumbnail and opens the full postcard preview', () => {
    render(
      <OperationsDashboard
        events={[]}
        statuses={['pending', 'completed']}
        initialFilters={{ page: 1, pageSize: 10 }}
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
    expect(fetch).toHaveBeenCalledWith('/api/admin/sessions?eventId=8&pageSize=10', expect.any(Object));
    expect(fetch).toHaveBeenCalledWith('/api/admin/stats?eventId=8', expect.any(Object));
    expect(window.location.pathname).toBe('/admin');
    expect(window.location.search).toBe('?eventId=8');
  });

  it('preserves the server snapshot through StrictMode replay and still refreshes filters immediately', async () => {
    render(
      <StrictMode>
        <OperationsDashboard
          events={[{ id: 8, name: 'Second Event', slug: 'second-event', status: 'draft' }]}
          statuses={['pending', 'completed']}
          initialFilters={{ page: 1, pageSize: 10 }}
          initialSessionResult={initialSessionResult}
          initialStats={initialStats}
        />
      </StrictMode>,
    );

    await act(async () => Promise.resolve());
    expect(fetch).not.toHaveBeenCalled();
    expect(within(screen.getByRole('row', { name: /session-1/ })).getByText('Generating')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Event'), { target: { value: '8' } });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenCalledWith('/api/admin/sessions?eventId=8&pageSize=10', expect.any(Object));
    expect(fetch).toHaveBeenCalledWith('/api/admin/stats?eventId=8', expect.any(Object));
  });

  it('keeps the last successful rows and shows a stale warning after a failed poll', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    renderDashboard();

    await act(async () => vi.advanceTimersByTimeAsync(15_000));

    expect(screen.getByText('session-1')).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /session-1/ })).getByText('Generating')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Showing the most recent data/);
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy();
  });

  it('retains the prior paired snapshot when sessions succeed but statistics fail after a filter change', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(url.startsWith('/api/admin/stats')
        ? new Response('{}', { status: 503 })
        : new Response(JSON.stringify({
          ...initialSessionResult,
          sessions: [{ ...initialSession, status: 'completed', completedAt: 400 }],
        })));
    }));
    renderDashboard();

    fireEvent.change(screen.getByLabelText('Event'), { target: { value: '8' } });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(within(screen.getByRole('row', { name: /session-1/ })).getByText('Generating')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Showing the most recent data/));
  });

  it('retains the prior paired snapshot when statistics succeed but sessions fail after a filter change', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(url.startsWith('/api/admin/sessions')
        ? new Response('{}', { status: 503 })
        : new Response(JSON.stringify(completedStats)));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDashboard();

    fireEvent.change(screen.getByLabelText('Event'), { target: { value: '8' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(screen.getByRole('row', { name: /session-1/ })).getByText('Generating')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Showing the most recent data/));
  });

  it('retries both resources atomically and announces recovery after a statistics-only failure', async () => {
    let statsShouldFail = true;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/admin/stats')) {
        return Promise.resolve(statsShouldFail
          ? new Response('{}', { status: 503 })
          : new Response(JSON.stringify(completedStats)));
      }
      return Promise.resolve(new Response(JSON.stringify({
        ...initialSessionResult,
        sessions: [{ ...initialSession, status: 'completed', completedAt: 400 }],
      })));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDashboard();

    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(within(screen.getByRole('row', { name: /session-1/ })).getByText('Generating')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();

    statsShouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/sessions'))).toHaveLength(2);
      expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/stats'))).toHaveLength(2);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByText('Dashboard data is current again.')).toBeTruthy();
      expect(within(screen.getByRole('row', { name: /session-1/ })).getByText('Completed')).toBeTruthy();
      expect(screen.getByText('100%')).toBeTruthy();
    });
  });

  it('marks refreshes busy and announces recovery while keeping the last good snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderDashboard();

    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByText('session-1')).toBeTruthy();

    fetchMock.mockImplementation(successfulFetch);
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    const sessionsList = container.querySelector('[aria-busy="true"]');
    expect(sessionsList).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Dashboard data is current again.')).toBeTruthy());
    expect(sessionsList?.getAttribute('aria-busy')).toBe('false');
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
