import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadAdminEventOptions } from '../src/db/admin';

const files = {
  page: 'src/pages/admin/index.astro',
  filters: 'src/components/admin/AdminFilters.astro',
  stats: 'src/components/admin/StatCards.astro',
  table: 'src/components/admin/SessionTable.astro',
  badge: 'src/components/admin/StatusBadge.astro',
} as const;

async function readSource(file: keyof typeof files) {
  return readFile(new URL(`../${files[file]}`, import.meta.url), 'utf8');
}

describe('admin dashboard', () => {
  it('loads and maps all event options in a predictable order', async () => {
    const calls: string[] = [];
    const database = {
      prepare(sql: string) {
        calls.push(sql);
        return {
          async all() {
            return {
              results: [
                { id: 2, name: 'Archived Event', slug: 'archived-event', status: 'archived' },
                { id: 1, name: 'Live Event', slug: 'live-event', status: 'active' },
              ],
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(loadAdminEventOptions(database)).resolves.toEqual([
      { id: 2, name: 'Archived Event', slug: 'archived-event', status: 'archived' },
      { id: 1, name: 'Live Event', slug: 'live-event', status: 'active' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/SELECT\s+id, name, slug, status\s+FROM events\s+ORDER BY name COLLATE NOCASE ASC, id ASC/);
    expect(calls[0]).not.toMatch(/WHERE\s+status/);
  });

  it('compiles every dashboard Astro template', async () => {
    const results = await Promise.all(Object.values(files).map(async (filename) => {
      const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
      return transform(source, { filename });
    }));

    expect(results.flatMap((result) => result.diagnostics)).toEqual([]);
  });

  it('loads filters, events, rows, and stats on the server in parallel', async () => {
    const source = await readSource('page');

    expect(source).toContain("import { env } from 'cloudflare:workers'");
    expect(source).toContain('normalizeAdminFilters(params)');
    expect(source).not.toContain('setUTCDate');
    expect(source).toMatch(/Promise\.all\(\[\s*loadAdminEventOptions\(env\.DB\),\s*loadAdminSessions\(env\.DB, filters\),\s*loadAdminStatistics\(env\.DB, filters\),/);
    expect(source).toContain('title="Dashboard"');
    expect(source).not.toContain('Monitor completion health');
    expect(source).toContain('<OperationsDashboard');
    expect(source).toContain('client:load');
    expect(source).toContain('initialFilters={dashboard.filters}');
    expect(source).toContain('initialSessionResult={dashboard.sessionResult}');
    expect(source).toContain('initialStats={dashboard.stats}');
  });

  it('renders GET filters and all requested statistics', async () => {
    const filters = await readSource('filters');
    const stats = await readSource('stats');

    expect(filters).toContain('method="get"');
    expect(filters).toContain('name="eventId"');
    expect(filters).toContain('All events');
    expect(filters).toContain('name="status"');
    expect(filters).toContain('All statuses');
    expect(filters).toContain('data-admin-filters');
    expect(filters).toContain("form.requestSubmit()");
    expect(filters.match(/focus-visible:outline-2/g)).toHaveLength(2);
    expect(filters.match(/focus-visible:outline-offset-2/g)).toHaveLength(2);
    expect(filters.match(/focus-visible:outline-primary/g)).toHaveLength(2);
    expect(stats).toContain("label: 'Total'");
    expect(stats).toContain("label: 'Completed'");
    expect(stats).not.toContain("label: 'In progress'");
    expect(stats).toContain("label: 'Failed'");
    expect(stats).toContain("label: 'Completion rate'");
  });

  it('renders the semantic session table, detail links, and empty state without images', async () => {
    const source = await readSource('table');

    expect(source).toContain('<table');
    expect(source).toContain('<caption');
    expect(source).toContain('<thead');
    expect(source).toContain('<tbody');
    expect(source).toContain("['Session', 'Event', 'Scene', 'Status', 'Updated', 'Details']");
    expect(source).not.toContain("'Error', 'Details'");
    expect(source).toContain('/admin/sessions/${encodeURIComponent(session.id)}');
    expect(source).toContain('aria-label={`View details for session ${session.id}`}');
    expect(source).toContain('&rarr;');
    expect(source).toContain('No sessions found');
    expect(source).toContain('No sessions match the selected event, status, or dates.');
    expect(source).not.toMatch(/<img\b/);
  });

  it('renders an explicit recoverable query-error state', async () => {
    const source = await readSource('page');

    expect(source).toContain('error instanceof AdminFilterValidationError');
    expect(source).toContain('role="alert"');
    expect(source).toContain('Unable to load the dashboard');
    expect(source).toContain('Clear filters');
  });
});
