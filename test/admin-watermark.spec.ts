import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const operations = vi.hoisted(() => [] as string[]);
const fakeEnv = vi.hoisted(() => ({
  DB: {},
  SELFIES: {
    delete: vi.fn(async () => { operations.push('r2:delete'); }),
    get: vi.fn(),
    put: vi.fn(async (_key: string, _value: unknown, _options?: unknown) => { operations.push('r2:put'); }),
  },
}));
const loadEventBySlug = vi.hoisted(() => vi.fn());
const replaceEventWatermark = vi.hoisted(() => vi.fn(async () => { operations.push('db:replace'); return true; }));
const updateEventWatermarkWidth = vi.hoisted(() => vi.fn(async () => { operations.push('db:resize'); return true; }));
const clearEventWatermark = vi.hoisted(() => vi.fn(async () => { operations.push('db:clear'); return true; }));
const restoreEventWatermark = vi.hoisted(() => vi.fn(async () => { operations.push('db:restore'); return true; }));

vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/events', () => ({
  clearEventWatermark,
  loadEventBySlug,
  replaceEventWatermark,
  restoreEventWatermark,
  updateEventWatermarkWidth,
}));

import {
  DELETE,
  GET,
  MAX_WATERMARK_BYTES,
  MAX_WATERMARK_DIMENSION,
  PATCH,
  PUT,
} from '../src/pages/api/admin/events/[slug]/watermark';
import { buildPostcard } from '../src/lib/postcard';
import { ADMIN_EMAIL_HEADER } from '../src/lib/admin-access';

const event = {
  id: 7,
  slug: 'launch-night',
  watermark_image_key: 'events/7/watermarks/old.png',
  watermark_w: 540,
};

function png(width = 800, height = 300) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function request(method: string, body?: Uint8Array, headers: Record<string, string> = {}) {
  return new Request('https://booth.test/api/admin/events/launch-night/watermark?width=620', {
    method,
    body: body ? body.slice().buffer as ArrayBuffer : undefined,
    headers: {
      [ADMIN_EMAIL_HEADER]: 'admin@example.com',
      ...(body ? { 'Content-Length': String(body.byteLength), 'Content-Type': 'image/png' } : {}),
      ...headers,
    },
  });
}

function imageObject() {
  return {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    }),
    httpMetadata: { contentType: 'image/png' },
  };
}

describe('admin event watermark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operations.length = 0;
    loadEventBySlug.mockResolvedValue(event);
    replaceEventWatermark.mockImplementation(async () => { operations.push('db:replace'); return true; });
    updateEventWatermarkWidth.mockImplementation(async () => { operations.push('db:resize'); return true; });
    clearEventWatermark.mockImplementation(async () => { operations.push('db:clear'); return true; });
    restoreEventWatermark.mockImplementation(async () => { operations.push('db:restore'); return true; });
  });

  it('requires the trusted admin identity header', async () => {
    const response = await PUT({
      request: new Request('https://booth.test/api/admin/events/launch-night/watermark?width=540', { method: 'PUT' }),
      params: { slug: 'launch-night' },
    });

    expect(response.status).toBe(403);
    expect(loadEventBySlug).not.toHaveBeenCalled();
  });

  it('uploads a validated PNG before updating D1, then deletes the prior event object', async () => {
    const bytes = png();
    const response = await PUT({ request: request('PUT', bytes), params: { slug: event.slug } });
    const result = await response.json<{ width: number }>();
    const generatedKey = fakeEnv.SELFIES.put.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(result).toEqual({ width: 620 });
    expect(generatedKey).toMatch(/^events\/7\/watermarks\/[\w-]+\.png$/);
    expect(fakeEnv.SELFIES.put).toHaveBeenCalledWith(generatedKey, bytes, expect.objectContaining({
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { eventId: '7' },
    }));
    expect(replaceEventWatermark).toHaveBeenCalledWith(fakeEnv.DB, 7, event.watermark_image_key, event.watermark_w, generatedKey, 620);
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledWith(event.watermark_image_key);
    expect(operations).toEqual(['r2:put', 'db:replace', 'r2:delete']);
  });

  it('deletes the new object when the D1 update fails', async () => {
    replaceEventWatermark.mockRejectedValue(new Error('D1 unavailable'));

    const response = await PUT({ request: request('PUT', png()), params: { slug: event.slug } });
    const uploadedKey = fakeEnv.SELFIES.put.mock.calls[0][0];

    expect(response.status).toBe(500);
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledWith(uploadedKey);
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalledWith(event.watermark_image_key);
  });

  it('deletes the new object and returns 409 when upload loses a replacement or resize race', async () => {
    replaceEventWatermark.mockImplementation(async () => { operations.push('db:replace'); return false; });

    const response = await PUT({ request: request('PUT', png()), params: { slug: event.slug } });
    const generatedKey = fakeEnv.SELFIES.put.mock.calls[0][0];

    expect(response.status).toBe(409);
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledWith(generatedKey);
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalledWith(event.watermark_image_key);
    expect(operations).toEqual(['r2:put', 'db:replace', 'r2:delete']);
  });

  it.each([
    ['content type', png(), { 'Content-Type': 'image/jpeg' }],
    ['signature', new Uint8Array(33), {}],
    ['zero dimensions', png(0, 100), {}],
    ['excessive dimensions', png(MAX_WATERMARK_DIMENSION + 1, 100), {}],
  ])('rejects invalid PNG %s', async (_label, bytes, headers) => {
    const response = await PUT({ request: request('PUT', bytes, headers), params: { slug: event.slug } });

    expect(response.status).toBe(400);
    expect(fakeEnv.SELFIES.put).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared body before reading it', async () => {
    const response = await PUT({
      request: request('PUT', png(), { 'Content-Length': String(MAX_WATERMARK_BYTES + 1) }),
      params: { slug: event.slug },
    });

    expect(response.status).toBe(413);
    expect(fakeEnv.SELFIES.put).not.toHaveBeenCalled();
  });

  it('streams the database-resolved preview privately', async () => {
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject());

    const response = await GET({ request: request('GET'), params: { slug: event.slug } });

    expect(response.status).toBe(200);
    expect(fakeEnv.SELFIES.get).toHaveBeenCalledWith(event.watermark_image_key);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it.each([
    ['cross-owned key', { ...event, watermark_image_key: 'events/8/watermarks/other.png' }, imageObject(), false],
    ['corrupted key', { ...event, watermark_image_key: 'sessions/session-1/postcard.jpg' }, imageObject(), false],
    ['unsafe content type', event, { ...imageObject(), httpMetadata: { contentType: 'text/html' } }, true],
  ])('returns an indistinguishable 404 for a %s', async (_label, storedEvent, object, readsObject) => {
    loadEventBySlug.mockResolvedValue(storedEvent);
    fakeEnv.SELFIES.get.mockResolvedValue(object);

    const response = await GET({ request: request('GET'), params: { slug: event.slug } });

    expect(response.status).toBe(404);
    expect(fakeEnv.SELFIES.get).toHaveBeenCalledTimes(readsObject ? 1 : 0);
  });

  it('resizes an existing watermark without replacing its object', async () => {
    const resizeRequest = new Request('https://booth.test/api/admin/events/launch-night/watermark', {
      method: 'PATCH',
      headers: { [ADMIN_EMAIL_HEADER]: 'admin@example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 700 }),
    });

    const response = await PATCH({ request: resizeRequest, params: { slug: event.slug } });

    expect(response.status).toBe(200);
    expect(updateEventWatermarkWidth).toHaveBeenCalledWith(fakeEnv.DB, 7, event.watermark_image_key, 700);
    expect(fakeEnv.SELFIES.put).not.toHaveBeenCalled();
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalled();
  });

  it('returns 409 when resize loses an upload or delete race without restoring a stale key', async () => {
    updateEventWatermarkWidth.mockResolvedValue(false);
    const resizeRequest = new Request('https://booth.test/api/admin/events/launch-night/watermark', {
      method: 'PATCH',
      headers: { [ADMIN_EMAIL_HEADER]: 'admin@example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 700 }),
    });

    const response = await PATCH({ request: resizeRequest, params: { slug: event.slug } });

    expect(response.status).toBe(409);
    expect(restoreEventWatermark).not.toHaveBeenCalled();
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalled();
  });

  it('clears D1 first and deletes only an event-owned object', async () => {
    const response = await DELETE({ request: request('DELETE'), params: { slug: event.slug } });

    expect(response.status).toBe(200);
    expect(clearEventWatermark).toHaveBeenCalledWith(fakeEnv.DB, 7, event.watermark_image_key, event.watermark_w);
    expect(operations).toEqual(['db:clear', 'r2:delete']);

    operations.length = 0;
    loadEventBySlug.mockResolvedValue({ ...event, watermark_image_key: 'sessions/other/postcard.jpg' });
    await DELETE({ request: request('DELETE'), params: { slug: event.slug } });
    expect(operations).toEqual(['db:clear']);
  });

  it('returns 409 without deleting when removal loses a replace or resize race', async () => {
    clearEventWatermark.mockImplementation(async () => { operations.push('db:clear'); return false; });

    const response = await DELETE({ request: request('DELETE'), params: { slug: event.slug } });

    expect(response.status).toBe(409);
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalled();
    expect(restoreEventWatermark).not.toHaveBeenCalled();
  });

  it('retries failed prior-object cleanup and conditionally rolls back without clobbering changes', async () => {
    fakeEnv.SELFIES.delete
      .mockRejectedValueOnce(new Error('R2 unavailable'))
      .mockRejectedValueOnce(new Error('R2 unavailable'))
      .mockRejectedValueOnce(new Error('R2 unavailable'))
      .mockImplementationOnce(async () => { operations.push('r2:delete-new'); });

    const response = await PUT({ request: request('PUT', png()), params: { slug: event.slug } });
    const generatedKey = fakeEnv.SELFIES.put.mock.calls[0][0];

    expect(response.status).toBe(500);
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledTimes(4);
    expect(restoreEventWatermark).toHaveBeenCalledWith(fakeEnv.DB, 7, generatedKey, 620, event.watermark_image_key, event.watermark_w);
    expect(operations).toEqual(['r2:put', 'db:replace', 'db:restore', 'r2:delete-new']);
  });

  it('retries failed removal cleanup and conditionally restores the exact snapshot', async () => {
    fakeEnv.SELFIES.delete.mockRejectedValue(new Error('R2 unavailable'));

    const response = await DELETE({ request: request('DELETE'), params: { slug: event.slug } });

    expect(response.status).toBe(500);
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledTimes(3);
    expect(restoreEventWatermark).toHaveBeenCalledWith(fakeEnv.DB, 7, null, null, event.watermark_image_key, event.watermark_w);
    expect(operations).toEqual(['db:clear', 'db:restore']);
  });

  it('uses narrow conditional D1 updates and never rewrites the key for width changes', async () => {
    const actual = await vi.importActual<typeof import('../src/db/events')>('../src/db/events');
    const calls: Array<[string, ...unknown[]]> = [];
    const database = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            calls.push([query, ...values]);
            return { async run() { return { meta: { changes: 1 } }; } };
          },
        };
      },
    } as unknown as D1Database;

    await actual.replaceEventWatermark(database, 7, 'old', 540, 'new', 620);
    await actual.updateEventWatermarkWidth(database, 7, 'new', 700);
    await actual.clearEventWatermark(database, 7, 'new', 700);

    expect(calls[0][0]).toContain('watermark_image_key IS ?');
    expect(calls[0][0]).toContain('watermark_w IS ?');
    expect(calls[1][0]).toContain('SET watermark_w = ?');
    expect(calls[1][0]).not.toContain('SET watermark_image_key');
    expect(calls[1][0]).toContain('watermark_image_key = ?');
    expect(calls[2][0]).toContain('watermark_image_key = ?');
    expect(calls[2][0]).toContain('watermark_w IS ?');
  });

  it('uses the selected width and preserves 540 as the null default', async () => {
    const draw = vi.fn().mockReturnThis();
    const transform = vi.fn().mockReturnThis();
    const pipeline = {
      draw,
      output: vi.fn().mockResolvedValue({ response: () => new Response('postcard') }),
      transform,
    };
    const watermarkInput = { transform };
    const images = {
      input: vi.fn()
        .mockReturnValueOnce(pipeline)
        .mockReturnValueOnce(watermarkInput)
        .mockReturnValueOnce(pipeline)
        .mockReturnValueOnce(watermarkInput),
    };
    const postcardEnv = {
      IMAGES: images,
      SELFIES: { get: vi.fn().mockResolvedValue({ body: new Uint8Array([1]) }) },
    } as unknown as Env;
    const caricature = { body: new Uint8Array([2]) } as unknown as R2ObjectBody;

    await buildPostcard(postcardEnv, caricature, 'watermark.png', 620);
    await buildPostcard(postcardEnv, caricature, 'watermark.png', null);

    expect(transform).toHaveBeenCalledWith({ width: 620 });
    expect(transform).toHaveBeenCalledWith({ width: 540 });
  });

  it('compiles the editor and propagates the selected configuration to the workflow', async () => {
    const editor = await readFile(new URL('../src/pages/admin/events/[slug].astro', import.meta.url), 'utf8');
    const action = await readFile(new URL('../src/actions/index.ts', import.meta.url), 'utf8');
    const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
    const result = await transform(editor, { filename: 'src/pages/admin/events/[slug].astro' });

    expect(result.diagnostics).toEqual([]);
    expect(editor).toContain('/watermark');
    expect(editor).toContain('accept="image/png"');
    expect(action).toContain('watermarkWidth');
    expect(worker).toContain('buildPostcard(this.env, caricature, watermarkKey, watermarkWidth)');
  });
});
