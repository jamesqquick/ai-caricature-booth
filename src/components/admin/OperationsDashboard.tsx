import { useState } from 'react';
import { AdminSessionsList, type AdminSessionResult } from './AdminSessionsList';
import { buttonVariants } from '../ui/button';
import type { AdminEventOption, AdminStatistics } from '../../db/admin';
import type { SessionStatus } from '../../db/sessions';
import type { AdminFilters } from '../../lib/admin-filters';

type Props = {
  events: AdminEventOption[];
  statuses: readonly SessionStatus[];
  initialFilters: AdminFilters;
  initialSessionResult: AdminSessionResult;
  initialStats: AdminStatistics;
  initialSessionsLoadError?: string | null;
};

function statsSearchParams(filters: AdminFilters) {
  const params = new URLSearchParams();
  if (filters.eventId !== undefined) params.set('eventId', String(filters.eventId));
  if (filters.status !== undefined) params.set('status', filters.status);
  if (filters.from !== undefined) params.set('from', new Date(filters.from * 1000).toISOString());
  if (filters.to !== undefined) params.set('to', new Date(filters.to * 1000).toISOString());
  return params;
}

async function loadDashboardStats(filters: AdminFilters, signal: AbortSignal) {
  const query = statsSearchParams(filters).toString();
  const response = await fetch(`/api/admin/stats${query ? `?${query}` : ''}`, { signal });
  if (!response.ok) throw new Error('Admin statistics polling request failed.');
  return response.json() as Promise<AdminStatistics>;
}

function formatPipelineDuration(durationMs: number | null) {
  if (durationMs === null) return 'Not available';
  const seconds = durationMs / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function OperationsDashboard({
  events,
  statuses,
  initialFilters,
  initialSessionResult,
  initialStats,
  initialSessionsLoadError = null,
}: Props) {
  const [stats, setStats] = useState(initialStats);

  const cards = [
    { label: 'Total', value: stats.total.toLocaleString('en-US') },
    { label: 'Completed', value: stats.completed.toLocaleString('en-US') },
    { label: 'Failed', value: stats.errored.toLocaleString('en-US') },
    { label: 'Completion rate', value: `${stats.completionRate}%` },
    { label: 'Average duration', value: formatPipelineDuration(stats.averagePipelineMs) },
  ];

  return (
    <div>
      <AdminSessionsList
        events={events}
        statuses={statuses}
        initialFilters={initialFilters}
        initialSessionResult={initialSessionResult}
        initialLoadError={initialSessionsLoadError}
        relatedData={{ load: loadDashboardStats, commit: setStats }}
        showPagination={false}
        sessionsAction={(
          <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/admin/sessions">
            View all sessions
          </a>
        )}
      >
      <section className="mt-6 grid grid-cols-5 gap-px overflow-hidden rounded-[var(--radius-surface)] border border-border bg-border max-[900px]:grid-cols-2 max-[520px]:grid-cols-1" aria-labelledby="dashboard-stats-heading">
        <h2 className="sr-only" id="dashboard-stats-heading">Session statistics</h2>
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
            <p className="mb-2 font-label text-[.68rem] font-extrabold uppercase tracking-[.14em] text-primary">Sessions over time</p>
            <h2 className="m-0 font-display text-2xl font-semibold" id="volume-heading">Sessions by day</h2>
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
          <h2 className="m-0 font-display text-2xl font-semibold" id="scene-heading">Sessions by scene</h2>
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
      </AdminSessionsList>
    </div>
  );
}
