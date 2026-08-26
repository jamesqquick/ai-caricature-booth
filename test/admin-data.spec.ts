import { describe, expect, it } from 'vitest';
import { loadAdminSessions, loadAdminSessionStats } from '../src/db/admin';
import { normalizeAdminFilters } from '../src/lib/admin-filters';

type QueryCall = {
  sql: string;
  values: unknown[];
};

function createFakeDatabase() {
  const calls: QueryCall[] = [];
  const sessionRow = {
    session_id: 'session-2',
    event_id: 7,
    event_name: 'Demo Event',
    event_slug: 'demo-event',
    scene_id: 'subway',
    scene_name: 'Subway Platform',
    status: 'completed',
    created_at: 100,
    updated_at: 300,
    completed_at: 250,
    error_message: null,
    workflow_id: 'workflow-2',
    has_selfie: 1,
    has_caricature: 1,
    has_postcard: 0,
  };

  const database = {
    prepare(sql: string) {
      const call: QueryCall = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values: unknown[]) {
          call.values = values;
          return this;
        },
        async all() {
          return { results: [sessionRow] };
        },
        async first() {
          if (sql.includes('completion_rate')) {
            return {
              total: 8,
              completed: 4,
              errored: 2,
              in_flight: 2,
              completion_rate: 50,
            };
          }
          return { total: 8 };
        },
      };
    },
  };

  return { database: database as unknown as D1Database, calls };
}

describe('admin session data', () => {
  it('maps newest-first session rows without exposing raw image keys', async () => {
    const { database, calls } = createFakeDatabase();
    const filters = normalizeAdminFilters(new URLSearchParams({
      eventId: '7',
      status: 'completed',
      from: '2026-08-01',
      to: '2026-08-21',
      page: '2',
    }));

    const result = await loadAdminSessions(database, filters);

    expect(result).toEqual({
      sessions: [{
        id: 'session-2',
        eventId: 7,
        eventName: 'Demo Event',
        eventSlug: 'demo-event',
        sceneId: 'subway',
        sceneName: 'Subway Platform',
        status: 'completed',
        createdAt: 100,
        updatedAt: 300,
        completedAt: 250,
        errorMessage: null,
        workflowId: 'workflow-2',
        hasSelfie: true,
        hasCaricature: true,
        hasPostcard: false,
      }],
      page: 2,
      pageSize: 30,
      total: 8,
      totalPages: 1,
    });

    const sessionQuery = calls.find((call) => call.sql.includes('ORDER BY'));
    const countQuery = calls.find((call) => call.sql.includes('COUNT(*) AS total'));
    expect(sessionQuery?.sql).toContain('ORDER BY s.created_at DESC, s.id DESC');
    expect(sessionQuery?.sql).not.toMatch(/selfie_key\s+AS|caricature_key\s+AS|postcard_key\s+AS/);
    expect(sessionQuery?.values).toEqual([
      7,
      'completed',
      filters.from,
      Date.parse('2026-08-21T23:59:59Z') / 1000,
      30,
      30,
    ]);
    expect(countQuery?.values).toEqual([7, 'completed', filters.from, filters.to]);
    expect(result.sessions[0]).not.toHaveProperty('selfieKey');
    expect(result.sessions[0]).not.toHaveProperty('caricatureKey');
    expect(result.sessions[0]).not.toHaveProperty('postcardKey');
  });

  it('uses the same normalized filters for aggregate statistics', async () => {
    const { database, calls } = createFakeDatabase();
    const filters = normalizeAdminFilters(new URLSearchParams({
      eventId: '7',
      status: 'completed',
      from: '2026-08-01',
      to: '2026-08-21',
      page: '2',
    }));

    await loadAdminSessions(database, filters);
    const stats = await loadAdminSessionStats(database, filters);

    expect(stats).toEqual({
      total: 8,
      completed: 4,
      errored: 2,
      inFlight: 2,
      completionRate: 50,
    });
    const statsQuery = calls.find((call) => call.sql.includes('completion_rate'));
    expect(statsQuery?.values).toEqual([7, 'completed', filters.from, filters.to]);
  });
});
