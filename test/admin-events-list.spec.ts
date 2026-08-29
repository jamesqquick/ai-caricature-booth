import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { loadAdminEvents } from '../src/db/events';

const files = [
  'src/pages/admin/events/index.astro',
  'src/components/admin/EventTable.astro',
];

describe('admin events list', () => {
  it('loads every event and maps activity aggregates without filtering status', async () => {
    const calls: string[] = [];
    const database = {
      prepare(sql: string) {
        calls.push(sql);
        return {
          async all() {
            return {
              results: [
                {
                  id: 2,
                  slug: 'archived-event',
                  name: 'Archived Event',
                  status: 'archived',
                  session_count: 0,
                  last_activity: null,
                },
                {
                  id: 1,
                  slug: 'live-event',
                  name: 'Live Event',
                  status: 'active',
                  session_count: 3,
                  last_activity: 1_750_000_000,
                },
              ],
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(loadAdminEvents(database)).resolves.toEqual([
      {
        id: 2,
        slug: 'archived-event',
        name: 'Archived Event',
        status: 'archived',
        sessionCount: 0,
        lastActivity: null,
      },
      {
        id: 1,
        slug: 'live-event',
        name: 'Live Event',
        status: 'active',
        sessionCount: 3,
        lastActivity: 1_750_000_000,
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('LEFT JOIN sessions s ON s.event_id = e.id');
    expect(calls[0]).toContain('COUNT(s.id) AS session_count');
    expect(calls[0]).toContain('MAX(s.updated_at) AS last_activity');
    expect(calls[0]).not.toMatch(/WHERE\s+e\.status/);
  });

  it('compiles the events page and table', async () => {
    const results = await Promise.all(files.map(async (filename) => {
      const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
      return transform(source, { filename });
    }));

    expect(results.flatMap((result) => result.diagnostics)).toEqual([]);
  });

  it('exposes attendee links from event names and admin details links from actions', async () => {
    const source = await readFile(new URL('../src/components/admin/EventTable.astro', import.meta.url), 'utf8');

    expect(source).toContain('/e/${encodeURIComponent(event.slug)}');
    expect(source).toContain('Details <span');
    expect(source).toContain('/admin/events/${encodeURIComponent(event.slug)}');
    expect(source).not.toContain('Attendee link');
    expect(source).toContain('draft');
    expect(source).toContain('archived');
    expect(source).toContain('No events yet');
    expect(source).toContain('inline-flex min-h-11 items-center text-foreground');
    expect(source).toContain('<h2 class="m-0 font-display text-xl">No events yet</h2>');
  });

  it('renders an actionable safe state when the event query fails', async () => {
    const source = await readFile(new URL('../src/pages/admin/events/index.astro', import.meta.url), 'utf8');
    expect(source).toContain("console.error('Admin events list load failed'");
    expect(source).toContain('Unable to load events');
    expect(source).toContain('href="/admin/events">Retry</a>');
  });

  it('links to event creation from the page header', async () => {
    const source = await readFile(new URL('../src/pages/admin/events/index.astro', import.meta.url), 'utf8');

    expect(source).toContain('slot="actions"');
    expect(source).toContain('href="/admin/events/new"');
    expect(source).toContain('New event');
  });

  it('does not render removed timezone data', async () => {
    const source = await readFile(new URL('../src/components/admin/EventTable.astro', import.meta.url), 'utf8');

    expect(source).not.toContain('Timezone');
    expect(source).not.toContain('event.timezone');
  });
});
