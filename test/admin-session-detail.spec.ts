import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadAdminSession } from '../src/db/admin';

const sessionDetailSource = new URL('../src/pages/admin/sessions/[sessionId].astro', import.meta.url);
const timelineSource = new URL('../src/components/admin/SessionTimeline.astro', import.meta.url);

function createDatabase(row: unknown) {
  return {
    prepare(sql: string) {
      expect(sql).toContain('WHERE s.id = ?');
      return {
        bind(id: string) {
          expect(id).toBe('admin-demo-001');
          return this;
        },
        async first() {
          return row;
        },
      };
    },
  } as unknown as D1Database;
}

describe('admin session detail', () => {
  it('loads one session as a safe detail model without raw image keys', async () => {
    const result = await loadAdminSession(createDatabase({
      session_id: 'admin-demo-001',
      event_id: 7,
      event_name: 'Demo Event',
      event_slug: 'demo-event',
      scene_id: 'subway',
      scene_name: 'Subway Platform',
      status: 'errored',
      created_at: 100,
      updated_at: 300,
      completed_at: null,
      error_message: 'Moderation failed',
      workflow_id: 'workflow-2',
      has_selfie: 1,
      has_caricature: 0,
      has_postcard: 0,
      selfie_key: 'must-not-leak',
    }), 'admin-demo-001');

    expect(result).toMatchObject({ id: 'admin-demo-001', status: 'errored', hasSelfie: true, hasCaricature: false });
    expect(result).not.toHaveProperty('selfieKey');
    expect(result).not.toHaveProperty('selfie_key');
  });

  it('returns null for an unknown session', async () => {
    await expect(loadAdminSession(createDatabase(null), 'admin-demo-001')).resolves.toBeNull();
  });

  it('compiles the detail route and timeline', async () => {
    const sources = await Promise.all([sessionDetailSource, timelineSource].map((url) => readFile(url, 'utf8')));
    const results = await Promise.all(sources.map((source, index) => transform(source, { filename: index === 0 ? 'session-detail.astro' : 'session-timeline.astro' })));
    expect(results.flatMap((result) => result.diagnostics)).toEqual([]);
  });

  it('documents observed state and absent persisted stage timestamps', async () => {
    const source = await readFile(timelineSource, 'utf8');
    expect(source).toContain('Observed current state');
    expect(source).toContain('No persisted timestamp for this stage');
    expect(source).toContain('Not recorded');
    expect(source).not.toContain('Date.now');
  });

  it('keeps image URLs out of the detail route until the proxy exists', async () => {
    const source = await readFile(sessionDetailSource, 'utf8');
    expect(source).toContain('Image previews will be available after the authenticated image proxy is added.');
    expect(source).not.toMatch(/<img\b/);
    expect(source).not.toContain('selfie_key');
    expect(source).not.toContain('caricature_key');
    expect(source).not.toContain('postcard_key');
  });
});
