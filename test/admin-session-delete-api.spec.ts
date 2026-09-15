import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeEnv = vi.hoisted(() => ({
  DB: {},
  SELFIES: { delete: vi.fn() },
}));
const deleteSessionWithAssets = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/sessions', async () => {
  const actual = await vi.importActual<typeof import('../src/db/sessions')>('../src/db/sessions');
  return { ...actual, deleteSessionWithAssets };
});

import { SessionDeletionConflictError } from '../src/db/sessions';
import { DELETE } from '../src/pages/api/admin/sessions/[sessionId]';

function request(authenticated = true) {
  return new Request('https://booth.test/api/admin/sessions/session-1', {
    method: 'DELETE',
    headers: authenticated ? { 'x-booth-admin-email': 'admin@example.com' } : {},
  });
}

function deletedSession(overrides: Record<string, unknown> = {}) {
  return {
    deleted: true,
    session: {
      id: 'session-1',
      status: 'completed',
      selfie_key: 'sessions/session-1/selfie.jpg',
      caricature_key: 'sessions/session-1/workflow-1/caricature.jpg',
      postcard_key: 'sessions/session-1/workflow-1/postcard.jpg',
      ...overrides,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('admin session deletion API', () => {
  it('rejects a malformed session ID', async () => {
    const response = await DELETE({ request: request(), params: { sessionId: '../session-1' } });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid session ID.' });
    expect(deleteSessionWithAssets).not.toHaveBeenCalled();
  });

  it('rejects requests without the verified admin identity header', async () => {
    const response = await DELETE({ request: request(false), params: { sessionId: 'session-1' } });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(deleteSessionWithAssets).not.toHaveBeenCalled();
  });

  it('returns 404 when the session is missing', async () => {
    deleteSessionWithAssets.mockResolvedValue({ deleted: false, session: null });

    const response = await DELETE({ request: request(), params: { sessionId: 'missing-session' } });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Session not found.' });
  });

  it.each([
    ['active', 'Only completed or errored sessions can be deleted.'],
    ['print-history', 'This session has print job history and cannot be deleted.'],
  ] as const)('maps the %s deletion conflict to 409', async (reason, message) => {
    deleteSessionWithAssets.mockRejectedValue(new SessionDeletionConflictError(reason));

    const response = await DELETE({ request: request(), params: { sessionId: 'session-1' } });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: message });
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalled();
  });

  it('maps a conditional-delete race to 409', async () => {
    deleteSessionWithAssets.mockResolvedValue({ ...deletedSession(), deleted: false });

    const response = await DELETE({ request: request(), params: { sessionId: 'session-1' } });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Session changed in another request. Refresh and try again.' });
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalled();
  });

  it('deletes only unique, nonempty, session-owned asset keys', async () => {
    deleteSessionWithAssets.mockResolvedValue(deletedSession({
      caricature_key: 'sessions/other-session/workflow-1/caricature.jpg',
      postcard_key: 'sessions/session-1/selfie.jpg',
    }));

    const response = await DELETE({ request: request(), params: { sessionId: 'session-1' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, redirectTo: '/admin' });
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledTimes(1);
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledWith(['sessions/session-1/selfie.jpg']);
  });

  it('keeps successful D1 deletion successful when R2 cleanup fails', async () => {
    const cleanupError = new Error('R2 unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    deleteSessionWithAssets.mockResolvedValue(deletedSession());
    fakeEnv.SELFIES.delete.mockRejectedValue(cleanupError);

    const response = await DELETE({ request: request(), params: { sessionId: 'session-1' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, redirectTo: '/admin' });
    expect(consoleError).toHaveBeenCalledWith('Deleted session R2 cleanup failed', cleanupError);
  });

  it('returns a safe 500 for an unexpected D1 failure', async () => {
    const databaseError = new Error('D1 host details');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    deleteSessionWithAssets.mockRejectedValue(databaseError);

    const response = await DELETE({ request: request(), params: { sessionId: 'session-1' } });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Couldn't delete the session." });
    expect(consoleError).toHaveBeenCalledWith('Admin session deletion failed', databaseError);
  });
});
