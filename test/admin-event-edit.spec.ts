import { transform } from '@astrojs/compiler';
import react from '@astrojs/react';
import { getViteConfig } from 'astro/config';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';

import { deleteEventWithSessions, loadEventBySlug, updateEvent } from '../src/db/events';

function asD1(sqlite: DatabaseSync) {
  return {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      let values: SQLInputValue[] = [];
      const prepared = {
        bind(...bindings: unknown[]) {
          values = bindings as SQLInputValue[];
          return prepared;
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async first() {
          return statement.get(...values) ?? null;
        },
      };
      return prepared;
    },
  } as unknown as D1Database;
}

async function renderEventEditor(error: string) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      accent_color TEXT NOT NULL,
      watermark_image_key TEXT,
      watermark_image_key_left TEXT,
      tagline TEXT NOT NULL,
      kiosk_idle_subhead TEXT NOT NULL,
      scene_picker_heading TEXT NOT NULL,
      scene_style_preamble TEXT,
      scene_constraints TEXT,
      created_at INTEGER NOT NULL,
      created_by TEXT,
      watermark_w INTEGER,
      watermark_left_w INTEGER
    );
    CREATE TABLE event_scenes (
      event_id INTEGER NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      prompt TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    INSERT INTO events VALUES (
      1, 'demo-event', 'Demo Event', 'draft', '#ff0000', NULL, NULL,
      'Tagline', 'Subhead', 'Pick a scene', NULL, NULL, 1, 'admin@example.com', NULL, NULL
    );
  `);
  const envModuleId = '\0event-feedback-test-cloudflare-workers';
  const createViteConfig = getViteConfig(
    {
      logLevel: 'silent',
      plugins: [{
        name: 'event-feedback-test-cloudflare-workers',
        resolveId(id) {
          if (id === 'cloudflare:workers') return envModuleId;
        },
        load(id) {
          if (id === envModuleId) return 'export const env = globalThis.__EVENT_FEEDBACK_TEST_ENV__';
        },
      }],
    },
    {
      configFile: false,
      root: fileURLToPath(new URL('../', import.meta.url)),
      integrations: [react()],
    },
  );
  const viteConfig = await createViteConfig({ command: 'serve', mode: 'test' });
  const server = await createServer({
    ...viteConfig,
    configFile: false,
    server: { middlewareMode: true, hmr: false },
  });
  const testGlobal = globalThis as typeof globalThis & { __EVENT_FEEDBACK_TEST_ENV__?: { DB: D1Database } };
  testGlobal.__EVENT_FEEDBACK_TEST_ENV__ = { DB: asD1(sqlite) };

  try {
    const [page, { default: reactRenderer }] = await Promise.all([
      server.ssrLoadModule('/src/pages/admin/events/[slug].astro'),
      server.ssrLoadModule('@astrojs/react/server.js'),
    ]);
    const container = await AstroContainer.create();
    container.addServerRenderer({ renderer: reactRenderer });
    container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
    return await container.renderToString(page.default, {
      params: { slug: 'demo-event' },
      request: new Request(`https://booth.test/admin/events/demo-event?error=${encodeURIComponent(error)}`, {
        headers: { 'x-booth-admin-email': 'admin@example.com' },
      }),
      partial: false,
    });
  } finally {
    delete testGlobal.__EVENT_FEEDBACK_TEST_ENV__;
    sqlite.close();
    await server.close();
  }
}

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

  it('does not serialize arbitrary error query values into admin HTML', async () => {
    const sentinel = 'query-error-secret-sentinel-24b9f1';
    const html = await renderEventEditor(sentinel);

    expect(html).toContain('Demo Event');
    expect(html).not.toContain(sentinel);
  });

  it('keeps attendee access active-only', async () => {
    const source = await readFile(new URL('../src/db/events.ts', import.meta.url), 'utf8');
    expect(source).toContain("WHERE slug = ${slug} AND status = 'active'");
  });

  it('deletes session history and the event in one D1 batch', async () => {
    const statements: { query: string; values: unknown[] }[] = [];
    const database = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            const statement = { query, values };
            statements.push(statement);
            return {
              ...statement,
              async all() {
                return { results: [{ id: 'session-1', selfie_key: 'sessions/session-1/selfie.jpg', caricature_key: null, postcard_key: null }] };
              },
            };
          },
        };
      },
      async batch(batchStatements: unknown[]) {
        expect(batchStatements).toHaveLength(3);
        return [{ meta: { changes: 1 } }, { meta: { changes: 2 } }, { meta: { changes: 1 } }];
      },
    } as unknown as D1Database;

    await expect(deleteEventWithSessions(database, 7)).resolves.toEqual({
      deleted: true,
      sessions: [{ id: 'session-1', objectKeys: ['sessions/session-1/selfie.jpg'] }],
    });
    expect(statements.map(({ query }) => query)).toEqual(expect.arrayContaining([
      expect.stringContaining('SELECT id, selfie_key, caricature_key, postcard_key'),
      expect.stringContaining('DELETE FROM sessions WHERE event_id = ?'),
      expect.stringContaining('DELETE FROM event_scenes WHERE event_id = ?'),
      expect.stringContaining('DELETE FROM events WHERE id = ?'),
    ]));
  });

  it('wires the reusable event delete control into the page header', async () => {
    const source = await readFile(new URL('../src/pages/admin/events/[slug].astro', import.meta.url), 'utf8');

    expect(source).toContain("import { EventDeleteControl }");
    expect(source).toContain('<EventDeleteControl');
    expect(source).toContain('slot="actions"');
    expect(source).toContain('client:load');
  });
});
