/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSessionsList } from '../src/components/admin/AdminSessionsList';

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
  total: 61,
  totalPages: 3,
};

function renderSessionsList(overrides: Partial<React.ComponentProps<typeof AdminSessionsList>> = {}) {
  return render(
    <AdminSessionsList
      events={[
        { id: 7, name: 'Demo Event', slug: 'demo-event', status: 'active' },
        { id: 8, name: 'Second Event', slug: 'second-event', status: 'draft' },
      ]}
      statuses={['pending', 'uploading', 'moderating', 'generating', 'compositing', 'completed', 'errored']}
      initialFilters={{ page: 1, pageSize: 30 }}
      initialSessionResult={initialSessionResult}
      basePath="/admin/sessions"
      dataLabel="Session"
      {...overrides}
    />,
  );
}

describe('AdminSessionsList', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(initialSessionResult))));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.history.replaceState(null, '', '/admin/sessions');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders the initial snapshot independently without an initial request', () => {
    renderSessionsList();

    expect(screen.getByRole('form', { name: 'Session filters' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /session-1/ })).getByText('Generating')).toBeTruthy();
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Sessions pagination' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Next' }).getAttribute('href')).toBe('/admin/sessions?page=2');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('polls sessions after 15 seconds with its initial page size', async () => {
    renderSessionsList();

    await act(async () => vi.advanceTimersByTimeAsync(15_000));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/sessions?pageSize=30',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('resets to page 1 when filtering and keeps pageSize out of the browser URL', async () => {
    const onFiltersChange = vi.fn();
    renderSessionsList({
      initialFilters: { eventId: 7, status: 'completed', page: 3, pageSize: 30 },
      initialSessionResult: { ...initialSessionResult, page: 3 },
      onFiltersChange,
    });

    fireEvent.change(screen.getByLabelText('Event'), { target: { value: '8' } });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/sessions?eventId=8&status=completed&pageSize=30',
      expect.any(Object),
    );
    expect(window.location.pathname).toBe('/admin/sessions');
    expect(window.location.search).toBe('?eventId=8&status=completed');
    expect(onFiltersChange).toHaveBeenLastCalledWith({ eventId: 8, status: 'completed', page: 1, pageSize: 30 });

    fireEvent.click(screen.getByRole('link', { name: 'Reset' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenLastCalledWith('/api/admin/sessions?pageSize=30', expect.any(Object));
    expect(window.location.search).toBe('');
    expect(onFiltersChange).toHaveBeenLastCalledWith({ page: 1, pageSize: 30 });
  });

  it('preserves server-normalized filters and page through hydration without exposing pageSize', () => {
    window.history.replaceState(
      null,
      '',
      '/admin/sessions?eventId=7&status=completed&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-16T23%3A59%3A59.000Z&page=2',
    );

    renderSessionsList({
      initialFilters: {
        eventId: 7,
        status: 'completed',
        from: Date.parse('2026-09-01T00:00:00.000Z') / 1000,
        to: Date.parse('2026-09-16T23:59:59.000Z') / 1000,
        page: 2,
        pageSize: 30,
      },
      initialSessionResult: { ...initialSessionResult, page: 2 },
    });

    expect(window.location.pathname).toBe('/admin/sessions');
    expect(window.location.search).toBe('?eventId=7&status=completed&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-16T23%3A59%3A59.000Z&page=2');
    expect(window.location.search).not.toContain('pageSize');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('changes only the page and can hide pagination completely', async () => {
    const { rerender } = renderSessionsList();

    fireEvent.click(screen.getByRole('link', { name: 'Next' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith('/api/admin/sessions?page=2&pageSize=30', expect.any(Object));
    expect(window.location.search).toBe('?page=2');

    rerender(
      <AdminSessionsList
        events={[]}
        statuses={['pending', 'completed']}
        initialFilters={{ page: 1, pageSize: 30 }}
        initialSessionResult={initialSessionResult}
        basePath="/admin/sessions"
        showPagination={false}
      />,
    );
    expect(screen.queryByRole('navigation', { name: 'Sessions pagination' })).toBeNull();
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull();
  });

  it('renders recoverable errors and preserves session row actions', async () => {
    renderSessionsList({ initialLoadError: "Sessions couldn't be loaded." });

    expect(screen.getByRole('alert').textContent).toMatch(/Sessions couldn't be loaded/);
    const row = screen.getByRole('row', { name: /session-1/ });
    expect(within(row).getByRole('link', { name: 'View session session-1' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Delete session session-1' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Sessions couldn't be loaded.")).toBeNull();
  });

  it('represents unavailable initial sessions without rendering a false empty state and populates them on retry', async () => {
    renderSessionsList({
      initialSessionResult: null,
      initialLoadError: "Sessions couldn't be loaded.",
    });

    expect(screen.getByRole('alert').textContent).toMatch(/Sessions couldn't be loaded/);
    expect(screen.queryByText('0 sessions')).toBeNull();
    expect(screen.queryByText('No sessions found')).toBeNull();
    expect(screen.queryByRole('row', { name: /session-1/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));

    await waitFor(() => expect(screen.getByRole('row', { name: /session-1/ })).toBeTruthy());
    expect(screen.getByText('61 sessions')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps an event-options error visible and offers a full current-route reload', async () => {
    renderSessionsList({
      initialFilters: { eventId: 7, status: 'completed', page: 1, pageSize: 30 },
      initialLoadError: "Some session data couldn't be loaded. Try again.",
      initialLoadErrorRecovery: { type: 'reload' },
    });

    const retry = screen.getByRole('link', { name: 'Retry now' });
    expect(retry.getAttribute('href')).toBe('/admin/sessions?eventId=7&status=completed');
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull();

    await act(async () => vi.advanceTimersByTimeAsync(15_000));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toMatch(/Some session data couldn't be loaded/);
  });

  it('keeps event-options reload recovery synchronized with changed public filters', async () => {
    renderSessionsList({
      initialFilters: {
        eventId: 7,
        status: 'pending',
        from: Date.parse('2026-09-01T00:00:00.000Z') / 1000,
        to: Date.parse('2026-09-16T23:59:59.000Z') / 1000,
        page: 2,
        pageSize: 30,
      },
      initialSessionResult: { ...initialSessionResult, page: 2 },
      initialLoadError: "Some session data couldn't be loaded. Try again.",
      initialLoadErrorRecovery: { type: 'reload' },
    });

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'completed' } });

    const expectedSearch = '?eventId=7&status=completed&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-16T23%3A59%3A59.000Z';
    expect(window.location.search).toBe(expectedSearch);
    expect(screen.getByRole('link', { name: 'Retry now' }).getAttribute('href'))
      .toBe(`/admin/sessions${expectedSearch}`);
    expect(window.location.search).not.toContain('pageSize');
  });

  it('recovers unavailable sessions in place before offering reload for unavailable event options', async () => {
    renderSessionsList({
      initialSessionResult: null,
      initialLoadError: "Some session data couldn't be loaded. Try again.",
      initialFilters: { status: 'completed', page: 1, pageSize: 30 },
      initialLoadErrorRecovery: { type: 'reload' },
    });

    expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Retry now' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));

    await waitFor(() => expect(screen.getByRole('row', { name: /session-1/ })).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/Some session data couldn't be loaded/);
    expect(screen.getByRole('link', { name: 'Retry now' }).getAttribute('href'))
      .toBe('/admin/sessions?status=completed');
  });

  it('refetches the last valid page without committing related data from the mismatched page', async () => {
    const nextSession = { ...initialSession, id: 'session-2', status: 'completed' as const };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...initialSessionResult,
        sessions: [],
        page: 3,
        total: 31,
        totalPages: 2,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...initialSessionResult,
        sessions: [nextSession],
        page: 2,
        total: 31,
        totalPages: 2,
      })));
    const load = vi.fn()
      .mockResolvedValueOnce('mismatched stats')
      .mockResolvedValueOnce('current stats');
    const commit = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/admin/sessions?page=3');
    renderSessionsList({
      initialFilters: { page: 3, pageSize: 30 },
      initialSessionResult: { ...initialSessionResult, page: 3 },
      relatedData: { load, commit },
    });

    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/sessions?page=3&pageSize=30',
      '/api/admin/sessions?page=2&pageSize=30',
    ]);
    expect(window.location.search).toBe('?page=2');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('current stats');
    expect(screen.getByText('session-2')).toBeTruthy();
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
  });

  it('treats a non-DOMException rejection as cancellation when the refresh signal is aborted', async () => {
    let refreshSignal: AbortSignal | undefined;
    const load = vi.fn((_filters, signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      refreshSignal = signal;
      signal.addEventListener('abort', () => reject(new Error('Related refresh cancelled.')), { once: true });
    }));
    renderSessionsList({ relatedData: { load, commit: vi.fn() } });

    act(() => vi.advanceTimersByTime(15_000));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));

    await waitFor(() => expect(refreshSignal?.aborted).toBe(true));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
