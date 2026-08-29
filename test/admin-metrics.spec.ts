import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadAdminStatistics } from '../src/db/admin';
import { normalizeAdminFilters } from '../src/lib/admin-filters';

function createDatabase() {
  const calls: { sql: string; values: unknown[] }[] = [];
  const database = {
    prepare(sql: string) {
      const call = { sql, values: [] as unknown[] };
      calls.push(call);
      return {
        bind(...values: unknown[]) { call.values = values; return this; },
        async first() { return { total: 4, completed: 2, errored: 1, in_flight: 1, completion_rate: 50, average_pipeline_ms: 1250 }; },
        async all() {
          if (sql.includes('GROUP BY s.status')) return { results: [{ status: 'completed', count: 2 }, { status: 'errored', count: 1 }] };
          if (sql.includes('GROUP BY s.scene_id')) return { results: [{ scene_id: 'subway', scene_name: 'Subway Platform', count: 4 }] };
          return { results: [{ bucket: '2026-08-27', count: 4 }] };
        },
      };
    },
  };
  return { database: database as unknown as D1Database, calls };
}

describe('admin metrics', () => {
  it('normalizes preset ranges into explicit UTC bounds', () => {
    expect(normalizeAdminFilters(new URLSearchParams({ range: '24h' }), Date.parse('2026-08-27T12:00:00Z'))).toMatchObject({
      range: '24h',
      from: Date.parse('2026-08-26T12:00:00Z') / 1000,
      to: Date.parse('2026-08-27T12:00:00Z') / 1000,
    });
  });

  it('rejects unknown preset ranges', () => {
    expect(() => normalizeAdminFilters(new URLSearchParams({ range: '2d' }))).toThrow('range must be 24h, 7d, 30d, or all.');
  });

  it('returns status, scene, and volume statistics from the same filters', async () => {
    const { database, calls } = createDatabase();
    const filters = normalizeAdminFilters(new URLSearchParams({ eventId: '7', range: '7d' }), Date.parse('2026-08-27T12:00:00Z'));
    await expect(loadAdminStatistics(database, filters)).resolves.toEqual({
      total: 4,
      completed: 2,
      errored: 1,
      inFlight: 1,
      completionRate: 50,
      averagePipelineMs: 1250,
      statusBreakdown: [{ status: 'completed', count: 2 }, { status: 'errored', count: 1 }],
      sceneUsage: [{ sceneId: 'subway', sceneName: 'Subway Platform', count: 4 }],
      volume: [{ bucket: '2026-08-27', count: 4 }],
      volumeGranularity: 'day',
    });
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.values.length > 0)).toBe(true);
    expect(calls[0].values).toEqual([7, filters.from, filters.to]);
  });

  it('reconciles all-event and single-event totals against the fixture counts', async () => {
    const allEvents = await loadAdminStatistics(createDatabase().database, normalizeAdminFilters(new URLSearchParams(), Date.parse('2026-08-27T12:00:00Z')));
    const oneEvent = await loadAdminStatistics(createDatabase().database, normalizeAdminFilters(new URLSearchParams({ eventId: '7' }), Date.parse('2026-08-27T12:00:00Z')));

    expect(allEvents.total).toBe(4);
    expect(oneEvent.total).toBe(4);
    expect(allEvents.completed + allEvents.errored + allEvents.inFlight).toBe(allEvents.total);
    expect(oneEvent.completed + oneEvent.errored + oneEvent.inFlight).toBe(oneEvent.total);
  });

  it('compiles the metrics route and overview', async () => {
    const files = ['src/pages/admin/index.astro', 'src/components/admin/MetricsOverview.astro'];
    const results = await Promise.all(files.map(async (file) => transform(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), { filename: file })));
    expect(results.flatMap((result) => result.diagnostics)).toEqual([]);
  });

  it('allows metric panels to size independently', async () => {
    const files = [
      'src/components/admin/OperationsDashboard.tsx',
      'src/components/admin/MetricsOverview.astro',
    ];

    for (const file of files) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(source).toContain('grid-cols-[minmax(0,1.35fr)_minmax(16rem,1fr)] items-start');
    }
  });
});
