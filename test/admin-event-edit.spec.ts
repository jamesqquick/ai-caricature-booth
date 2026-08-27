import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { loadEventBySlug, updateEvent } from '../src/db/events';

describe('admin event editing', () => {
  it('loads draft and archived events by slug for admin editing', async () => {
    const queries: string[] = [];
    const database = {
      prepare(query: string) {
        queries.push(query);
        return {
          bind() {
            return {
              async all() {
                return { results: [{ id: 3, slug: 'draft-event', status: 'draft' }] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(loadEventBySlug(database, 'draft-event')).resolves.toMatchObject({ status: 'draft' });
    expect(queries[0]).not.toContain("status = 'active'");
  });

  it('updates only core fields and maps slug conflicts', async () => {
    const calls: unknown[][] = [];
    const database = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            calls.push([query, ...values]);
            return { async run() { return {}; } };
          },
        };
      },
    } as unknown as D1Database;

    await expect(updateEvent(database, 3, { name: 'Updated', slug: 'updated', status: 'active' })).resolves.toEqual({
      id: 3, name: 'Updated', slug: 'updated', status: 'active',
    });
    expect(calls[0]).toEqual(expect.arrayContaining(['updated', 'Updated', 'active', 3]));
    expect(calls[0][0]).toContain('SET slug = ?, name = ?, status = ?');
  });

  it('compiles the editor and update endpoint', async () => {
    const files = [
      'src/pages/admin/events/[slug].astro',
      'src/pages/api/admin/events/[slug].ts',
    ];
    const results = await Promise.all(files.map(async (filename) => {
      const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
      return filename.endsWith('.astro') ? transform(source, { filename }) : { diagnostics: [] };
    }));

    expect(results.flatMap((result) => result.diagnostics)).toEqual([]);
  });

  it('keeps attendee access active-only', async () => {
    const source = await readFile(new URL('../src/db/events.ts', import.meta.url), 'utf8');
    expect(source).toContain("WHERE slug = ${slug} AND status = 'active'");
  });
});
