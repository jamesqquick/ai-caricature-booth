import { describe, expect, it } from 'vitest';
import { loadAdminStatistics } from '../src/db/admin';
import { normalizeAdminFilters } from '../src/lib/admin-filters';

function createDatabase(statsRow: Record<string, unknown>) {
  const calls: string[] = [];
  const database = {
    prepare(sql: string) {
      calls.push(sql);
      return {
        bind() { return this; },
        async first() { return statsRow; },
        async all() { return { results: [] }; },
      };
    },
  };
  return { database: database as unknown as D1Database, calls };
}

describe('admin pipeline duration', () => {
  it('averages completed rows with measured durations', async () => {
    const { database, calls } = createDatabase({
      total: 3,
      completed: 2,
      errored: 1,
      in_flight: 0,
      completion_rate: 66.7,
      average_pipeline_ms: 2250,
    });

    const stats = await loadAdminStatistics(database, normalizeAdminFilters(new URLSearchParams()));

    expect(stats.averagePipelineMs).toBe(2250);
    expect(calls[0]).toContain('pipeline_ms IS NOT NULL');
  });

  it('keeps duration metrics null when no completed duration exists', async () => {
    const { database } = createDatabase({
      total: 1,
      completed: 0,
      errored: 1,
      in_flight: 0,
      completion_rate: 0,
      average_pipeline_ms: null,
    });

    const stats = await loadAdminStatistics(database, normalizeAdminFilters(new URLSearchParams()));

    expect(stats.averagePipelineMs).toBeNull();
  });
});
