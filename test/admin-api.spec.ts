import { describe, expect, it, vi } from 'vitest';
import { AdminFilterValidationError } from '../src/lib/admin-filters';

const fakeEnv = vi.hoisted(() => ({ DB: {} }));
const loadAdminSessions = vi.hoisted(() => vi.fn());
const loadAdminSessionStats = vi.hoisted(() => vi.fn());
const loadAdminStatistics = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/admin', () => ({ loadAdminSessions, loadAdminSessionStats, loadAdminStatistics }));

import { GET as getSessions } from '../src/pages/api/admin/sessions';
import { GET as getStats } from '../src/pages/api/admin/stats';
import { adminErrorResponse } from '../src/lib/admin-response';

const sessionResult = {
  sessions: [{
    id: 'session-1',
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
    workflowId: 'workflow-1',
    hasSelfie: true,
    hasCaricature: true,
    hasPostcard: false,
  }],
  page: 1,
  pageSize: 30,
  total: 1,
  totalPages: 1,
};

const statsResult = { total: 1, completed: 1, errored: 0, inFlight: 0, completionRate: 100 };

describe('admin APIs', () => {
  it('returns only the fields rendered by the polling dashboard', async () => {
    loadAdminSessions.mockResolvedValue(sessionResult);

    const response = await getSessions({ url: new URL('https://booth.test/api/admin/sessions?eventId=7&status=completed&page=2') });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual({
      sessions: [{
        id: 'session-1',
        eventName: 'Demo Event',
        eventSlug: 'demo-event',
        sceneId: 'subway',
        sceneName: 'Subway Platform',
        status: 'completed',
        updatedAt: 300,
      }],
      page: 1,
      pageSize: 30,
      total: 1,
      totalPages: 1,
    });
    expect(Object.keys(body as object)).toEqual(['sessions', 'page', 'pageSize', 'total', 'totalPages']);
    expect(Object.keys((body as typeof sessionResult).sessions[0])).toEqual([
      'id',
      'eventName',
      'eventSlug',
      'sceneId',
      'sceneName',
      'status',
      'updatedAt',
    ]);
    expect(loadAdminSessions).toHaveBeenCalledWith(fakeEnv.DB, {
      eventId: 7,
      status: 'completed',
      page: 2,
      pageSize: 30,
    });
    expect(JSON.stringify(body)).not.toMatch(/eventId|createdAt|completedAt|errorMessage|workflowId|hasSelfie|hasCaricature|hasPostcard|(?:selfie|caricature|postcard)Key/);
  });

  it('returns stats using the same normalized filter contract', async () => {
    loadAdminStatistics.mockResolvedValue(statsResult);

    const response = await getStats({ url: new URL('https://booth.test/api/admin/stats?eventId=7&status=completed&page=2') });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(statsResult);
    expect(loadAdminStatistics).toHaveBeenCalledWith(fakeEnv.DB, {
      eventId: 7,
      status: 'completed',
      page: 2,
      pageSize: 30,
    });
  });

  it('returns a cache-disabled 400 response for invalid filters', async () => {
    const response = await getSessions({ url: new URL('https://booth.test/api/admin/sessions?status=unknown') });

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: 'status must be a valid session status.',
      field: 'status',
    });
  });

  it('maps unexpected failures to a safe 500 response', async () => {
    const response = adminErrorResponse(new Error('database details'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Couldn't load admin data." });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('maps validation errors consistently', async () => {
    const response = adminErrorResponse(new AdminFilterValidationError('page', 'page must be a positive integer.'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'page must be a positive integer.',
      field: 'page',
    });
  });
});
