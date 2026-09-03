import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeEnv = vi.hoisted(() => ({
  DB: {},
  SELFIES: { delete: vi.fn() },
}));
const loadEventBySlug = vi.hoisted(() => vi.fn());
const deleteEventWithSessions = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/events', async () => {
  const actual = await vi.importActual<typeof import('../src/db/events')>('../src/db/events');
  return { ...actual, loadEventBySlug, deleteEventWithSessions };
});

import { DELETE } from '../src/pages/api/admin/events/[slug]';

afterEach(() => {
  vi.clearAllMocks();
});

describe('event deletion API', () => {
  it('rejects unauthenticated deletion requests', async () => {
    const response = await DELETE({
      request: new Request('https://booth.test/api/admin/events/demo-event', { method: 'DELETE' }),
      params: { slug: 'demo-event' },
    });

    expect(response.status).toBe(403);
  });

  it('deletes database records and only event-owned R2 objects', async () => {
    loadEventBySlug.mockResolvedValue({
      id: 7,
      slug: 'demo-event',
      watermark_image_key: 'events/7/watermarks/right.png',
      watermark_image_key_left: 'events/other/watermarks/left.png',
    });
    deleteEventWithSessions.mockResolvedValue({
      deleted: true,
      sessions: [{
        id: 'session-1',
        objectKeys: [
          'sessions/session-1/selfie.jpg',
          'sessions/session-1/workflow-1/caricature.jpg',
          'sessions/session-1/workflow-1/postcard.jpg',
          'sessions/other/postcard.jpg',
        ],
      }],
    });

    const response = await DELETE({
      request: new Request('https://booth.test/api/admin/events/demo-event', {
        method: 'DELETE',
        headers: { 'x-booth-admin-email': 'admin@example.com' },
      }),
      params: { slug: 'demo-event' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, redirectTo: '/admin/events' });
    expect(deleteEventWithSessions).toHaveBeenCalledWith(fakeEnv.DB, 7);
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledWith([
      'events/7/watermarks/right.png',
      'sessions/session-1/selfie.jpg',
      'sessions/session-1/workflow-1/caricature.jpg',
      'sessions/session-1/workflow-1/postcard.jpg',
    ]);
  });
});
