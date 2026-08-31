import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { ImagePlaceholder, ImagePreview } from './ImagePreview';
import type { AdminEventOption, AdminStatistics } from '../../db/admin';
import type { SessionStatus } from '../../db/sessions';
import { ADMIN_PAGE_SIZE, type AdminFilters } from '../../lib/admin-filters';
import type { AdminSessionListItem } from '../../lib/admin-session-list';

const POLL_INTERVAL_MS = 15_000;
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function dateInputValue(timestamp: number | undefined) {
  return timestamp === undefined ? '' : new Date(timestamp * 1000).toISOString().slice(0, 10);
}
type SessionResult = {
  sessions: AdminSessionListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type Props = {
  events: AdminEventOption[];
  statuses: readonly SessionStatus[];
  initialFilters: AdminFilters;
  initialSessionResult: SessionResult;
  initialStats: AdminStatistics;
};

function formatStatus(status: SessionStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function filtersToSearchParams(filters: AdminFilters) {
  const params = new URLSearchParams();
  if (filters.eventId !== undefined) params.set('eventId', String(filters.eventId));
  if (filters.status !== undefined) params.set('status', filters.status);
  if (filters.from !== undefined) params.set('from', new Date(filters.from * 1000).toISOString());
  if (filters.to !== undefined) params.set('to', new Date(filters.to * 1000).toISOString());
  if (filters.page > 1) params.set('page', String(filters.page));
  return params;
}

function statusTone(status: SessionStatus) {
  if (status === 'completed') return 'border-success/35 bg-success/10 text-success';
  if (status === 'errored') return 'border-destructive/35 bg-destructive/10 text-destructive';
  return 'border-primary/35 bg-primary/10 text-primary';
}

function formatPipelineDuration(durationMs: number | null) {
  if (durationMs === null) return 'No data';
  const seconds = durationMs / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function postcardImageUrl(sessionId: string, variant: 'full' | 'thumbnail' = 'full') {
  const suffix = variant === 'thumbnail' ? '?variant=thumbnail' : '';
  return `/api/admin/sessions/${encodeURIComponent(sessionId)}/images/postcard${suffix}`;
}

export function OperationsDashboard({
  events,
  statuses,
  initialFilters,
  initialSessionResult,
  initialStats,
}: Props) {
  const [filters, setFilters] = useState(initialFilters);
  const [sessionResult, setSessionResult] = useState(initialSessionResult);
  const [stats, setStats] = useState(initialStats);
  const [isStale, setIsStale] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recoveryAnnouncement, setRecoveryAnnouncement] = useState('');
  const [retrySequence, setRetrySequence] = useState(0);
  const isInitialRender = useRef(true);
  const staleRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let timeout: number | undefined;
    let controller: AbortController | undefined;

    const schedulePoll = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      timeout = window.setTimeout(async () => {
        await refresh();
        schedulePoll();
      }, POLL_INTERVAL_MS);
    };

    const refresh = async () => {
      if (disposed || document.visibilityState === 'hidden') return;
      setIsRefreshing(true);
      controller?.abort();
      const refreshController = new AbortController();
      controller = refreshController;
      const query = filtersToSearchParams(filters).toString();
      const suffix = query ? `?${query}` : '';

      try {
        const [sessionsResponse, statsResponse] = await Promise.all([
          fetch(`/api/admin/sessions${suffix}`, { signal: refreshController.signal }),
          fetch(`/api/admin/stats${suffix}`, { signal: refreshController.signal }),
        ]);
        if (!sessionsResponse.ok || !statsResponse.ok) {
          throw new Error('Admin polling request failed.');
        }

        const [nextSessionResult, nextStats] = await Promise.all([
          sessionsResponse.json() as Promise<SessionResult>,
          statsResponse.json() as Promise<AdminStatistics>,
        ]);
        if (disposed) return;

        setSessionResult(nextSessionResult);
        setStats(nextStats);
        setRecoveryAnnouncement(staleRef.current ? 'Live dashboard data recovered.' : '');
        staleRef.current = false;
        setIsStale(false);
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === 'AbortError')) return;
        staleRef.current = true;
        setRecoveryAnnouncement('');
        setIsStale(true);
      } finally {
        if (!disposed && controller === refreshController) setIsRefreshing(false);
      }
    };

    const handleVisibilityChange = () => {
      const visible = document.visibilityState !== 'hidden';
      window.clearTimeout(timeout);

      if (!visible) {
        controller?.abort();
        return;
      }

      void refresh().finally(schedulePoll);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (isInitialRender.current) {
      isInitialRender.current = false;
      schedulePoll();
    } else {
      void refresh().finally(schedulePoll);
    }

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [filters, retrySequence]);

  const replaceFilters = (nextFilters: AdminFilters) => {
    const params = filtersToSearchParams(nextFilters);
    const query = params.toString();
    window.history.replaceState(null, '', query ? `/admin?${query}` : '/admin');
    setFilters(nextFilters);
  };

  const updateEvent = (value: string) => {
    replaceFilters({
      ...filters,
      ...(value ? { eventId: Number(value) } : { eventId: undefined }),
      page: 1,
    });
  };

  const updateStatus = (value: string) => {
    replaceFilters({
      ...filters,
      ...(value ? { status: value as SessionStatus } : { status: undefined }),
      page: 1,
    });
  };

  const updateDate = (field: 'from' | 'to', value: string) => {
    const timestamp = value
      ? Date.parse(`${value}T${field === 'to' ? '23:59:59' : '00:00:00'}Z`) / 1000
      : undefined;
    replaceFilters({ ...filters, [field]: timestamp, page: 1 });
  };

  const resetFilters = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    replaceFilters({ page: 1, pageSize: ADMIN_PAGE_SIZE });
  };

  const updatePage = (event: MouseEvent<HTMLAnchorElement>, page: number) => {
    event.preventDefault();
    replaceFilters({ ...filters, page });
  };

  const pageHref = (page: number) => {
    const params = filtersToSearchParams({ ...filters, page });
    const query = params.toString();
    return query ? `/admin?${query}` : '/admin';
  };

  const cards = [
    { label: 'Total', value: stats.total.toLocaleString('en-US') },
    { label: 'Completed', value: stats.completed.toLocaleString('en-US') },
    { label: 'Errored', value: stats.errored.toLocaleString('en-US') },
    { label: 'Completion rate', value: `${stats.completionRate}%` },
    { label: 'Average duration', value: formatPipelineDuration(stats.averagePipelineMs) },
  ];

  return (
    <div aria-busy={isRefreshing}>
      <form
        className="mt-8 grid grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_repeat(2,minmax(8rem,1fr))_auto] items-end gap-3 rounded-[var(--radius-surface)] border border-border bg-card p-5 max-[980px]:grid-cols-2 max-[560px]:grid-cols-1"
        method="get"
        action="/admin"
        aria-label="Dashboard filters"
      >
        <label className="grid gap-2 font-label text-[.68rem] font-extrabold uppercase tracking-[.1em] text-muted-foreground">
          Event
          <Select
            className="min-h-11 rounded-lg border border-input bg-background px-3 font-sans text-sm normal-case tracking-normal text-foreground focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            name="eventId"
            value={filters.eventId ?? ''}
            onChange={(event) => updateEvent(event.target.value)}
          >
            <option value="">All events</option>
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </Select>
        </label>

        <label className="grid gap-2 font-label text-[.68rem] font-extrabold uppercase tracking-[.1em] text-muted-foreground">
          From
          <Input
            className="min-h-11 w-full rounded-lg border border-input bg-background px-3 font-sans text-sm normal-case tracking-normal text-foreground focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            name="from"
            type="date"
            value={dateInputValue(filters.from)}
            onChange={(event) => updateDate('from', event.target.value)}
          />
        </label>

        <label className="grid gap-2 font-label text-[.68rem] font-extrabold uppercase tracking-[.1em] text-muted-foreground">
          To
          <Input
            className="min-h-11 w-full rounded-lg border border-input bg-background px-3 font-sans text-sm normal-case tracking-normal text-foreground focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            name="to"
            type="date"
            value={dateInputValue(filters.to)}
            onChange={(event) => updateDate('to', event.target.value)}
          />
        </label>

        <label className="grid gap-2 font-label text-[.68rem] font-extrabold uppercase tracking-[.1em] text-muted-foreground">
          Status
          <Select
            className="min-h-11 rounded-lg border border-input bg-background px-3 font-sans text-sm normal-case tracking-normal text-foreground focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            name="status"
            value={filters.status ?? ''}
            onChange={(event) => updateStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}
          </Select>
        </label>

        <a
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-border px-5 text-sm font-bold text-muted-foreground no-underline hover:border-primary hover:text-foreground"
          href="/admin"
          onClick={resetFilters}
        >
          Reset
        </a>
      </form>

      <span className="sr-only" role="status" aria-live="polite">{isRefreshing ? 'Refreshing dashboard data...' : ''}</span>
      <span className="sr-only" role="status" aria-live="polite">{recoveryAnnouncement}</span>

      {isStale && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground" role="alert">
          <span>Live data could not be refreshed. Showing the last successful update.</span>
          <button className="inline-flex min-h-11 items-center rounded-full border border-foreground/40 px-4 font-bold hover:border-foreground" type="button" onClick={() => setRetrySequence((value) => value + 1)}>
            Retry now
          </button>
        </div>
      )}

      <section className="mt-6 grid grid-cols-5 gap-px overflow-hidden rounded-[var(--radius-surface)] border border-border bg-border max-[900px]:grid-cols-2 max-[520px]:grid-cols-1" aria-labelledby="dashboard-stats-heading">
        <h2 className="sr-only" id="dashboard-stats-heading">Generation statistics</h2>
        {cards.map((card) => (
          <article className="bg-card p-5" key={card.label}>
            <p className="m-0 font-label text-[.65rem] font-extrabold uppercase tracking-[.12em] text-muted-foreground">{card.label}</p>
            <p className="mt-3 mb-0 font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold leading-none tracking-[-.045em]">{card.value}</p>
          </article>
        ))}
      </section>

      <div className="mt-8 grid grid-cols-[minmax(0,1.35fr)_minmax(16rem,1fr)] items-start gap-6 max-[800px]:grid-cols-1">
        <section className="rounded-[var(--radius-surface)] border border-border bg-card p-6" aria-labelledby="volume-heading">
          <div>
            <p className="mb-2 font-label text-[.68rem] font-extrabold uppercase tracking-[.14em] text-primary">Volume over time</p>
            <h2 className="m-0 font-display text-2xl font-semibold" id="volume-heading">Generation activity</h2>
          </div>
          {stats.volume.length > 0 ? (
            <div className="mt-6 overflow-x-auto" role="list" aria-label="Daily generation volume">
              <div className="grid min-w-[34rem] grid-flow-col auto-cols-fr items-end gap-2 border-b border-border pb-2" style={{ height: '15rem' }}>
                {stats.volume.map((bucket) => (
                  <div className="flex h-full flex-col items-center justify-end gap-2 text-sm" role="listitem" key={bucket.bucket}>
                    <strong>{bucket.count}</strong>
                    <div className="w-full max-w-12 rounded-t-lg bg-primary" style={{ height: `${Math.max((bucket.count / Math.max(...stats.volume.map((item) => item.count), 1)) * 100, 3)}%` }}></div>
                    <span className="font-label text-[.62rem] text-muted-foreground">{bucket.bucket.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="mt-6 mb-0 text-sm text-muted-foreground">No generation activity in this window.</p>}
        </section>

        <section className="rounded-[var(--radius-surface)] border border-border bg-card p-6" aria-labelledby="scene-heading">
          <p className="mb-2 font-label text-[.68rem] font-extrabold uppercase tracking-[.14em] text-primary">Scene usage</p>
          <h2 className="m-0 font-display text-2xl font-semibold" id="scene-heading">Most-used scenes</h2>
          {stats.sceneUsage.length > 0 ? (
            <div className="mt-6 grid gap-4" role="list" aria-label="Scene usage counts">
              {stats.sceneUsage.map((scene) => (
                <div role="listitem" key={scene.sceneId}>
                  <div className="flex justify-between gap-3 text-sm"><span className="font-semibold">{scene.sceneName}</span><strong>{scene.count}</strong></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(scene.count / Math.max(...stats.sceneUsage.map((item) => item.count), 1)) * 100}%` }}></div></div>
                </div>
              ))}
            </div>
          ) : <p className="mt-6 mb-0 text-sm text-muted-foreground">No scenes have been used in this window.</p>}
        </section>
      </div>

      <section className="mt-8" aria-labelledby="latest-jobs-heading">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="m-0 font-display text-[clamp(1.75rem,4vw,2.5rem)] tracking-[-.04em]" id="latest-jobs-heading">Latest jobs</h2>
          </div>
          <p className="m-0 text-sm text-muted-foreground">{sessionResult.total.toLocaleString('en-US')} {sessionResult.total === 1 ? 'job' : 'jobs'}</p>
        </div>

        {sessionResult.sessions.length === 0 ? (
          <div className="rounded-[var(--radius-surface)] border border-dashed border-border bg-card p-8 text-center">
            <h3 className="m-0 font-display text-xl">No generation jobs found</h3>
            <p className="mt-2 mb-0 text-sm leading-[1.6] text-muted-foreground">No sessions match the current event and status filters.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-[var(--radius-surface)] border border-border bg-card">
              <table className="w-full min-w-[62rem] border-collapse text-left text-sm">
                <caption className="sr-only">Latest filtered generation jobs</caption>
                <thead className="border-b border-border bg-muted">
                  <tr>
                    {['Postcard', 'Session', 'Event', 'Scene', 'Status', 'Updated', 'Details'].map((heading) => (
                      <th className="px-4 py-3 font-label text-[.62rem] font-extrabold uppercase tracking-[.1em] text-muted-foreground" key={heading} scope="col">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sessionResult.sessions.map((session) => {
                    const updatedAt = new Date(session.updatedAt * 1000);
                    return (
                      <tr className="align-top hover:bg-muted/50" key={session.id}>
                        <td className="px-4 py-4">
                          {session.hasPostcard ? (
                            <div className="w-28">
                              <ImagePreview
                                src={postcardImageUrl(session.id, 'thumbnail')}
                                fullSrc={postcardImageUrl(session.id)}
                                alt={`Final postcard for session ${session.id}`}
                                compact
                                showDownload={false}
                              />
                            </div>
                          ) : (
                            <ImagePlaceholder label={`No postcard preview for session ${session.id}`} compact />
                          )}
                        </td>
                        <th className="max-w-44 px-4 py-4 font-label text-xs font-semibold" scope="row">
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={session.id}>{session.id}</span>
                        </th>
                        <td className="px-4 py-4">
                          <span className="block font-semibold">{session.eventName}</span>
                          <span className="mt-1 block font-label text-[.62rem] text-muted-foreground">{session.eventSlug}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="block">{session.sceneName ?? 'Unnamed scene'}</span>
                          <span className="mt-1 block font-label text-[.62rem] text-muted-foreground">{session.sceneId}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 font-label text-[.62rem] font-extrabold uppercase tracking-[.08em] ${statusTone(session.status)}`}>
                            {formatStatus(session.status)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">
                          <time dateTime={updatedAt.toISOString()}>{dateFormatter.format(updatedAt)} UTC</time>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-right">
                          <a className="inline-flex min-h-11 items-center gap-1 rounded-sm px-2 text-sm font-bold text-primary no-underline hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href={`/admin/sessions/${encodeURIComponent(session.id)}`} aria-label={`View details for session ${session.id}`}>
                            View <span aria-hidden="true">&rarr;</span>
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {sessionResult.totalPages > 1 && (
              <nav className="mt-4 flex items-center justify-between gap-4" aria-label="Generation jobs pagination">
                {sessionResult.page > 1 ? (
                  <a className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-bold text-foreground no-underline hover:border-primary" href={pageHref(sessionResult.page - 1)} onClick={(event) => updatePage(event, sessionResult.page - 1)}>Previous</a>
                ) : <span />}
                <span className="text-sm text-muted-foreground">Page {sessionResult.page} of {sessionResult.totalPages}</span>
                {sessionResult.page < sessionResult.totalPages ? (
                  <a className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-bold text-foreground no-underline hover:border-primary" href={pageHref(sessionResult.page + 1)} onClick={(event) => updatePage(event, sessionResult.page + 1)}>Next</a>
                ) : <span />}
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
