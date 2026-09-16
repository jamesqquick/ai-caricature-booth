import { Eye } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Button, buttonVariants } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { ImagePlaceholder, ImagePreview } from './ImagePreview';
import { SessionDeleteControl } from './SessionDeleteControl';
import type { AdminEventOption } from '../../db/admin';
import type { SessionStatus } from '../../db/sessions';
import { adminSessionsPublicSearchParams, type AdminFilters } from '../../lib/admin-filters';
import type { AdminSessionListItem } from '../../lib/admin-session-list';

const POLL_INTERVAL_MS = 15_000;
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export type AdminSessionResult = {
  sessions: AdminSessionListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AdminLoadErrorRecovery =
  | { type: 'refresh' }
  | { type: 'reload' };

type RelatedDataRefresh<RelatedData> = {
  load: (filters: AdminFilters, signal: AbortSignal) => Promise<RelatedData>;
  commit: (data: RelatedData) => void;
};

type Props<RelatedData = never> = {
  events: AdminEventOption[];
  statuses: readonly SessionStatus[];
  initialFilters: AdminFilters;
  initialSessionResult: AdminSessionResult | null;
  initialLoadError?: string | null;
  initialLoadErrorRecovery?: AdminLoadErrorRecovery;
  relatedData?: RelatedDataRefresh<RelatedData>;
  showPagination?: boolean;
  onFiltersChange?: (filters: AdminFilters) => void;
  basePath?: string;
  dataLabel?: string;
  sessionsAction?: ReactNode;
  children?: ReactNode;
};

function dateInputValue(timestamp: number | undefined) {
  return timestamp === undefined ? '' : new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function formatStatus(status: SessionStatus) {
  if (status === 'errored') return 'Failed';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function sessionsSearchParams(filters: AdminFilters, includePage: boolean) {
  const params = adminSessionsPublicSearchParams(filters, includePage);
  params.set('pageSize', String(filters.pageSize));
  return params;
}

function statusTone(status: SessionStatus) {
  if (status === 'completed') return 'border-success/35 bg-success/10 text-success';
  if (status === 'errored') return 'border-destructive/35 bg-destructive/10 text-destructive';
  return 'border-primary/35 bg-primary/10 text-primary';
}

function postcardImageUrl(sessionId: string, variant: 'full' | 'thumbnail' = 'full') {
  const suffix = variant === 'thumbnail' ? '?variant=thumbnail' : '';
  return `/api/admin/sessions/${encodeURIComponent(sessionId)}/images/postcard${suffix}`;
}

export function AdminSessionsList<RelatedData = never>({
  events,
  statuses,
  initialFilters,
  initialSessionResult,
  initialLoadError = null,
  initialLoadErrorRecovery = { type: 'refresh' },
  relatedData,
  showPagination = true,
  onFiltersChange,
  basePath = '/admin',
  dataLabel = 'Dashboard',
  sessionsAction,
  children,
}: Props<RelatedData>) {
  const [filters, setFilters] = useState({
    ...initialFilters,
    page: showPagination ? initialFilters.page : 1,
  });
  const [sessionResult, setSessionResult] = useState<AdminSessionResult | null>(initialSessionResult);
  const [loadError, setLoadError] = useState(initialLoadError);
  const [isStale, setIsStale] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recoveryAnnouncement, setRecoveryAnnouncement] = useState('');
  const [retrySequence, setRetrySequence] = useState(0);
  const previousRefreshInputs = useRef({ filters, retrySequence });
  const staleRef = useRef(initialLoadError !== null);
  const loadRelatedData = relatedData?.load;
  const commitRelatedData = relatedData?.commit;
  const requiresReload = initialLoadErrorRecovery.type === 'reload';

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
      const query = sessionsSearchParams(filters, showPagination).toString();

      try {
        const sessionsRequest = fetch(`/api/admin/sessions?${query}`, { signal: refreshController.signal })
          .then(async (response) => {
            if (!response.ok) throw new Error('Admin sessions polling request failed.');
            return response.json() as Promise<AdminSessionResult>;
          });
        const [nextSessionResult, nextRelatedData] = await Promise.all([
          sessionsRequest,
          loadRelatedData?.(filters, refreshController.signal),
        ]);
        if (disposed) return;

        const lastValidPage = Math.max(1, nextSessionResult.totalPages);
        if (showPagination && filters.page > lastValidPage) {
          const nextFilters = { ...filters, page: lastValidPage };
          const browserQuery = adminSessionsPublicSearchParams(nextFilters).toString();
          window.history.replaceState(null, '', browserQuery ? `${basePath}?${browserQuery}` : basePath);
          setFilters(nextFilters);
          onFiltersChange?.(nextFilters);
          return;
        }

        setSessionResult(nextSessionResult);
        if (loadRelatedData && commitRelatedData) commitRelatedData(nextRelatedData as RelatedData);
        if (!requiresReload) {
          setLoadError(null);
          setRecoveryAnnouncement(staleRef.current ? `${dataLabel} data is current again.` : '');
          staleRef.current = false;
          setIsStale(false);
        }
      } catch (error) {
        if (
          disposed
          || refreshController.signal.aborted
          || (error instanceof DOMException && error.name === 'AbortError')
        ) return;
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

    const shouldRefreshImmediately = previousRefreshInputs.current.filters !== filters
      || previousRefreshInputs.current.retrySequence !== retrySequence;
    previousRefreshInputs.current = { filters, retrySequence };

    if (!shouldRefreshImmediately) {
      if (!showPagination && new URLSearchParams(window.location.search).has('page')) {
        const query = adminSessionsPublicSearchParams(filters, false).toString();
        window.history.replaceState(null, '', query ? `${basePath}?${query}` : basePath);
      }
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
  }, [basePath, commitRelatedData, dataLabel, filters, loadRelatedData, requiresReload, retrySequence, showPagination]);

  const filterUrl = (nextFilters: AdminFilters) => {
    const query = adminSessionsPublicSearchParams(nextFilters, showPagination).toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const replaceFilters = (nextFilters: AdminFilters) => {
    window.history.replaceState(null, '', filterUrl(nextFilters));
    setFilters(nextFilters);
    onFiltersChange?.(nextFilters);
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
    replaceFilters({ page: 1, pageSize: initialFilters.pageSize });
  };

  const updatePage = (event: MouseEvent<HTMLAnchorElement>, page: number) => {
    event.preventDefault();
    replaceFilters({ ...filters, page });
  };

  const pageHref = (page: number) => filterUrl({ ...filters, page });
  const errorMessage = loadError ?? (isStale
    ? `${dataLabel} data couldn't be refreshed. Showing the most recent data.`
    : null);
  const showReloadRecovery = requiresReload && sessionResult !== null;

  return (
    <div aria-busy={isRefreshing}>
      <form
        className="mt-8 grid grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_repeat(2,minmax(8rem,1fr))_auto] items-end gap-3 rounded-[var(--radius-surface)] border border-border bg-card p-5 max-[980px]:grid-cols-2 max-[560px]:grid-cols-1"
        method="get"
        action={basePath}
        aria-label={`${dataLabel} filters`}
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
            className="rounded-lg px-3 font-sans text-sm normal-case tracking-normal"
            name="from"
            size="sm"
            type="date"
            value={dateInputValue(filters.from)}
            onChange={(event) => updateDate('from', event.target.value)}
          />
        </label>

        <label className="grid gap-2 font-label text-[.68rem] font-extrabold uppercase tracking-[.1em] text-muted-foreground">
          To
          <Input
            className="rounded-lg px-3 font-sans text-sm normal-case tracking-normal"
            name="to"
            size="sm"
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

        <div className="flex flex-wrap gap-2">
          <Button
            variant="unstyled"
            size="unstyled"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
            type="submit"
          >
            Apply filters
          </Button>
          <a
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-border px-5 text-sm font-bold text-muted-foreground no-underline hover:border-primary hover:text-foreground"
            href={basePath}
            onClick={resetFilters}
          >
            Reset
          </a>
        </div>
      </form>

      <span className="sr-only" role="status" aria-live="polite">{isRefreshing ? `Refreshing ${dataLabel.toLowerCase()} data...` : ''}</span>
      <span className="sr-only" role="status" aria-live="polite">{recoveryAnnouncement}</span>

      {errorMessage && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground" role="alert">
          <span>{errorMessage}</span>
          {showReloadRecovery ? (
            <a
              className="inline-flex min-h-11 items-center rounded-full border border-foreground/40 px-4 font-bold text-foreground no-underline hover:border-foreground"
              href={filterUrl(filters)}
            >
              Retry now
            </a>
          ) : (
            <Button
              variant="unstyled"
              size="unstyled"
              className="inline-flex min-h-11 items-center rounded-full border border-foreground/40 px-4 font-bold hover:border-foreground"
              type="button"
              onClick={() => setRetrySequence((value) => value + 1)}
            >
              Retry now
            </Button>
          )}
        </div>
      )}

      {children}

      {sessionResult !== null && (
        <section className="mt-8" aria-labelledby="latest-jobs-heading">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="m-0 font-display text-[clamp(1.75rem,4vw,2.5rem)] tracking-[-.04em]" id="latest-jobs-heading">Recent sessions</h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <p className="m-0 text-sm text-muted-foreground">{sessionResult.total.toLocaleString('en-US')} {sessionResult.total === 1 ? 'session' : 'sessions'}</p>
              {sessionsAction}
            </div>
          </div>

          {sessionResult.sessions.length === 0 ? (
            <div className="rounded-[var(--radius-surface)] border border-dashed border-border bg-card p-8 text-center">
              <h3 className="m-0 font-display text-xl">No sessions found</h3>
              <p className="mt-2 mb-0 text-sm leading-[1.6] text-muted-foreground">No sessions match the selected event, status, or dates.</p>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto rounded-[var(--radius-surface)] border border-border bg-card">
              <table className="w-full min-w-[62rem] border-collapse text-left text-sm">
                <caption className="sr-only">Filtered booth sessions</caption>
                <thead className="border-b border-border bg-muted">
                  <tr>
                    {['Postcard', 'Session', 'Event', 'Scene', 'Status', 'Updated', 'Actions'].map((heading) => (
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
                          <div className="flex justify-end gap-2">
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <a
                                    className={buttonVariants({ variant: 'outline', size: 'icon' })}
                                    href={`/admin/sessions/${encodeURIComponent(session.id)}`}
                                    aria-label={`View session ${session.id}`}
                                  >
                                    <Eye aria-hidden="true" />
                                  </a>
                                </TooltipTrigger>
                                <TooltipContent side="top">View session</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <SessionDeleteControl
                              sessionId={session.id}
                              endpoint={`/api/admin/sessions/${encodeURIComponent(session.id)}`}
                              redirectTo={pageHref(1)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {showPagination && sessionResult.totalPages > 1 && (
              <nav className="mt-4 flex items-center justify-between gap-4" aria-label="Sessions pagination">
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
      )}
    </div>
  );
}
