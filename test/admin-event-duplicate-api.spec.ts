import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeEnv = vi.hoisted(() => ({
  DB: {},
  SELFIES: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
const loadEventBySlug = vi.hoisted(() => vi.fn());
const duplicateEventConfiguration = vi.hoisted(() => vi.fn());
const updateDuplicatedEventWatermarks = vi.hoisted(() => vi.fn());
const deleteDuplicatedEvent = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/events', async () => {
  const actual = await vi.importActual<typeof import('../src/db/events')>('../src/db/events');
  return {
    ...actual,
    loadEventBySlug,
    duplicateEventConfiguration,
    updateDuplicatedEventWatermarks,
    deleteDuplicatedEvent,
  };
});

import { POST } from '../src/pages/api/admin/events/[slug]/duplicate';

const sourceEvent = {
  id: 7,
  slug: 'demo-event',
  name: 'Demo Event',
  watermark_image_key: 'events/7/watermarks/right.png',
  watermark_image_key_left: 'events/7/watermarks/left.png',
  watermark_w: 540,
  watermark_x: 56,
  watermark_y: 64,
  watermark_left_w: 300,
  watermark_left_x: 72,
  watermark_left_y: 80,
};

function request(name = 'Demo Event (Copy)', authenticated = true) {
  return new Request('https://booth.test/api/admin/events/demo-event/duplicate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { 'x-booth-admin-email': 'admin@example.com' } : {}),
    },
    body: JSON.stringify({ name }),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('event duplication API', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await POST({ request: request('Copy', false), params: { slug: 'demo-event' } });
    expect(response.status).toBe(403);
    expect(duplicateEventConfiguration).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON requests', async () => {
    const malformed = new Request('https://booth.test/api/admin/events/demo-event/duplicate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-booth-admin-email': 'admin@example.com' },
      body: '{',
    });
    loadEventBySlug.mockResolvedValue(sourceEvent);

    const response = await POST({ request: malformed, params: { slug: 'demo-event' } });

    expect(response.status).toBe(400);
    expect(duplicateEventConfiguration).not.toHaveBeenCalled();
  });

  it('copies both watermark objects and returns the draft event destination', async () => {
    loadEventBySlug.mockResolvedValue(sourceEvent);
    duplicateEventConfiguration.mockResolvedValue({ id: 12, name: 'Demo Event (Copy)', slug: 'demo-event-copy', status: 'draft' });
    fakeEnv.SELFIES.get
      .mockResolvedValueOnce({ body: 'right-body', httpMetadata: { contentType: 'image/png' }, customMetadata: { side: 'right' } })
      .mockResolvedValueOnce({ body: 'left-body', httpMetadata: { contentType: 'image/png' }, customMetadata: { side: 'left' } });

    const response = await POST({ request: request(), params: { slug: 'demo-event' } });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      event: { id: 12, name: 'Demo Event (Copy)', slug: 'demo-event-copy', status: 'draft' },
      redirectTo: '/admin/events/demo-event-copy',
    });
    expect(duplicateEventConfiguration).toHaveBeenCalledWith(fakeEnv.DB, sourceEvent, 'Demo Event (Copy)', 'admin@example.com');
    expect(fakeEnv.SELFIES.put).toHaveBeenNthCalledWith(1, 'events/12/watermarks/right.png', 'right-body', {
      httpMetadata: { contentType: 'image/png' }, customMetadata: { side: 'right' },
    });
    expect(fakeEnv.SELFIES.put).toHaveBeenNthCalledWith(2, 'events/12/watermarks/left.png', 'left-body', {
      httpMetadata: { contentType: 'image/png' }, customMetadata: { side: 'left' },
    });
    expect(updateDuplicatedEventWatermarks).toHaveBeenCalledWith(fakeEnv.DB, 12, {
      watermark_image_key: 'events/12/watermarks/right.png',
      watermark_image_key_left: 'events/12/watermarks/left.png',
      watermark_w: 540,
      watermark_x: 56,
      watermark_y: 64,
      watermark_left_w: 300,
      watermark_left_x: 72,
      watermark_left_y: 80,
    });
    expect(loadEventBySlug).toHaveBeenCalledTimes(1);
  });

  it('removes partial R2 and D1 copies when watermark duplication fails', async () => {
    loadEventBySlug.mockResolvedValue(sourceEvent);
    duplicateEventConfiguration.mockResolvedValue({ id: 12, name: 'Copy', slug: 'copy', status: 'draft' });
    fakeEnv.SELFIES.get
      .mockResolvedValueOnce({ body: 'right-body', httpMetadata: {}, customMetadata: {} })
      .mockResolvedValueOnce(null);

    const response = await POST({ request: request('Copy'), params: { slug: 'demo-event' } });

    expect(response.status).toBe(500);
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledWith([
      'events/12/watermarks/right.png',
      'events/12/watermarks/left.png',
    ]);
    expect(deleteDuplicatedEvent).toHaveBeenCalledWith(fakeEnv.DB, 12);
    expect(updateDuplicatedEventWatermarks).not.toHaveBeenCalled();
  });
});
