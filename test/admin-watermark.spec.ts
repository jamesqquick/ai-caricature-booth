import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
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
const updateEventWatermarkPlacement = vi.hoisted(() => vi.fn(async () => { operations.push('db:place'); return true; }));
const clearEventWatermark = vi.hoisted(() => vi.fn(async () => { operations.push('db:clear'); return true; }));
const restoreEventWatermark = vi.hoisted(() => vi.fn(async () => { operations.push('db:restore'); return true; }));

vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/events', () => ({
  clearEventWatermark,
  loadEventBySlug,
  replaceEventWatermark,
  restoreEventWatermark,
  updateEventWatermarkPlacement,
}));

import {
  DELETE,
  GET,
  PATCH,
  PUT,
} from '../src/pages/api/admin/events/[slug]/watermark';
import { buildPostcard } from '../src/lib/postcard';
import { ADMIN_EMAIL_HEADER } from '../src/lib/admin-access';
import { MAX_WATERMARK_BYTES, MAX_WATERMARK_DIMENSION } from '../src/lib/event-watermark';

const event = {
  id: 7,
  slug: 'launch-night',
  watermark_image_key: 'events/7/watermarks/old.png',
  watermark_image_key_left: 'events/7/watermarks/old-left.png',
  watermark_w: 540,
  watermark_x: 56,
  watermark_y: 56,
  watermark_left_w: 480,
  watermark_left_x: 72,
  watermark_left_y: 64,
};

function png(width = 800, height = 300) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function request(method: string, body?: Uint8Array, headers: Record<string, string> = {}) {
  return new Request('https://booth.test/api/admin/events/launch-night/watermark?width=620&x=80&y=96', {
    method,
    body: body ? body.slice().buffer as ArrayBuffer : undefined,
    headers: {
      [ADMIN_EMAIL_HEADER]: 'admin@example.com',
      ...(body ? { 'Content-Length': String(body.byteLength), 'Content-Type': 'image/png' } : {}),
      ...headers,
    },
  });
}

function leftRequest(method: string, body?: Uint8Array, headers: Record<string, string> = {}) {
  return new Request('https://booth.test/api/admin/events/launch-night/watermark?side=left&width=620&x=80&y=96', {
    method,
    body: body ? body.slice().buffer as ArrayBuffer : undefined,
    headers: {
      [ADMIN_EMAIL_HEADER]: 'admin@example.com',
      ...(body ? { 'Content-Length': String(body.byteLength), 'Content-Type': 'image/png' } : {}),
      ...headers,
    },
  });
}

function imageObject(bytes = png()) {
  return {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    }),
    httpMetadata: { contentType: 'image/png' },
    arrayBuffer: vi.fn(async () => bytes.slice().buffer),
  };
}

describe('admin event watermark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operations.length = 0;
    loadEventBySlug.mockResolvedValue(event);
    replaceEventWatermark.mockImplementation(async () => { operations.push('db:replace'); return true; });
    updateEventWatermarkPlacement.mockImplementation(async () => { operations.push('db:place'); return true; });
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
    const result = await response.json<{ width: number; x: number; y: number }>();
    const generatedKey = fakeEnv.SELFIES.put.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(result).toEqual({ width: 620, x: 80, y: 96 });
    expect(generatedKey).toMatch(/^events\/7\/watermarks\/[\w-]+\.png$/);
    expect(fakeEnv.SELFIES.put).toHaveBeenCalledWith(generatedKey, bytes, expect.objectContaining({
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { eventId: '7', imageWidth: '800', imageHeight: '300' },
    }));
    expect(replaceEventWatermark).toHaveBeenCalledWith(
      fakeEnv.DB,
      7,
      event.watermark_image_key,
      event.watermark_w,
      event.watermark_x,
      event.watermark_y,
      generatedKey,
      620,
      80,
      96,
    );
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledWith(event.watermark_image_key);
    expect(operations).toEqual(['r2:put', 'db:replace', 'r2:delete']);
  });

  it('uploads and replaces the left watermark independently', async () => {
    const bytes = png();
    const response = await PUT({ request: leftRequest('PUT', bytes), params: { slug: event.slug } });
    const generatedKey = fakeEnv.SELFIES.put.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(replaceEventWatermark).toHaveBeenCalledWith(
      fakeEnv.DB,
      7,
      event.watermark_image_key_left,
      event.watermark_left_w,
      event.watermark_left_x,
      event.watermark_left_y,
      generatedKey,
      620,
      80,
      96,
      'left',
    );
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledWith(event.watermark_image_key_left);
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalledWith(event.watermark_image_key);
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

  it('streams the selected left preview independently', async () => {
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject());

    const response = await GET({ request: leftRequest('GET'), params: { slug: event.slug } });

    expect(response.status).toBe(200);
    expect(fakeEnv.SELFIES.get).toHaveBeenCalledWith(event.watermark_image_key_left);
  });

  it('returns selector validation errors from GET before hiding valid-side lookup failures', async () => {
    const invalidRequest = new Request('https://booth.test/api/admin/events/launch-night/watermark?side=center', {
      headers: { [ADMIN_EMAIL_HEADER]: 'admin@example.com' },
    });

    const response = await GET({ request: invalidRequest, params: { slug: event.slug } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Watermark side must be left or right.',
      field: 'side',
    });
    expect(loadEventBySlug).not.toHaveBeenCalled();
  });

  it('rejects a left watermark key owned by another event without reading R2', async () => {
    loadEventBySlug.mockResolvedValue({ ...event, watermark_image_key_left: 'events/8/watermarks/other.png' });

    const response = await GET({ request: leftRequest('GET'), params: { slug: event.slug } });

    expect(response.status).toBe(404);
    expect(fakeEnv.SELFIES.get).not.toHaveBeenCalled();
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

  it('updates an existing watermark placement without replacing its object', async () => {
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject());
    const resizeRequest = new Request('https://booth.test/api/admin/events/launch-night/watermark', {
      method: 'PATCH',
      headers: { [ADMIN_EMAIL_HEADER]: 'admin@example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 700, x: 70, y: 44 }),
    });

    const response = await PATCH({ request: resizeRequest, params: { slug: event.slug } });

    expect(response.status).toBe(200);
    expect(updateEventWatermarkPlacement).toHaveBeenCalledWith(
      fakeEnv.DB,
      7,
      event.watermark_image_key,
      event.watermark_w,
      event.watermark_x,
      event.watermark_y,
      700,
      70,
      44,
    );
    expect(fakeEnv.SELFIES.put).not.toHaveBeenCalled();
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalled();
  });

  it('updates left placement without changing right placement', async () => {
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject());
    const resizeRequest = new Request('https://booth.test/api/admin/events/launch-night/watermark?side=left', {
      method: 'PATCH',
      headers: { [ADMIN_EMAIL_HEADER]: 'admin@example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 700, x: 70, y: 44 }),
    });

    const response = await PATCH({ request: resizeRequest, params: { slug: event.slug } });

    expect(response.status).toBe(200);
    expect(updateEventWatermarkPlacement).toHaveBeenCalledWith(
      fakeEnv.DB,
      7,
      event.watermark_image_key_left,
      event.watermark_left_w,
      event.watermark_left_x,
      event.watermark_left_y,
      700,
      70,
      44,
      'left',
    );
  });

  it('returns 409 when resize loses an upload or delete race without restoring a stale key', async () => {
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject());
    updateEventWatermarkPlacement.mockResolvedValue(false);
    const resizeRequest = new Request('https://booth.test/api/admin/events/launch-night/watermark', {
      method: 'PATCH',
      headers: { [ADMIN_EMAIL_HEADER]: 'admin@example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 700, x: 70, y: 44 }),
    });

    const response = await PATCH({ request: resizeRequest, params: { slug: event.slug } });

    expect(response.status).toBe(409);
    expect(restoreEventWatermark).not.toHaveBeenCalled();
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalled();
  });

  it('returns 409 when a left resize loses a race without touching either object', async () => {
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject());
    updateEventWatermarkPlacement.mockResolvedValue(false);
    const resizeRequest = new Request('https://booth.test/api/admin/events/launch-night/watermark?side=left', {
      method: 'PATCH',
      headers: { [ADMIN_EMAIL_HEADER]: 'admin@example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 700, x: 70, y: 44 }),
    });

    const response = await PATCH({ request: resizeRequest, params: { slug: event.slug } });

    expect(response.status).toBe(409);
    expect(restoreEventWatermark).not.toHaveBeenCalled();
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalled();
  });

  it('clears D1 first and deletes only an event-owned object', async () => {
    const response = await DELETE({ request: request('DELETE'), params: { slug: event.slug } });

    expect(response.status).toBe(200);
    expect(clearEventWatermark).toHaveBeenCalledWith(
      fakeEnv.DB,
      7,
      event.watermark_image_key,
      event.watermark_w,
      event.watermark_x,
      event.watermark_y,
    );
    expect(operations).toEqual(['db:clear', 'r2:delete']);

    operations.length = 0;
    loadEventBySlug.mockResolvedValue({ ...event, watermark_image_key: 'sessions/other/postcard.jpg' });
    await DELETE({ request: request('DELETE'), params: { slug: event.slug } });
    expect(operations).toEqual(['db:clear']);
  });

  it('removes only the selected left watermark', async () => {
    const response = await DELETE({ request: leftRequest('DELETE'), params: { slug: event.slug } });

    expect(response.status).toBe(200);
    expect(clearEventWatermark).toHaveBeenCalledWith(
      fakeEnv.DB,
      7,
      event.watermark_image_key_left,
      event.watermark_left_w,
      event.watermark_left_x,
      event.watermark_left_y,
      'left',
    );
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledWith(event.watermark_image_key_left);
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalledWith(event.watermark_image_key);
  });

  it('returns 409 without deleting when removal loses a replace or resize race', async () => {
    clearEventWatermark.mockImplementation(async () => { operations.push('db:clear'); return false; });

    const response = await DELETE({ request: request('DELETE'), params: { slug: event.slug } });

    expect(response.status).toBe(409);
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalled();
    expect(restoreEventWatermark).not.toHaveBeenCalled();
  });

  it('returns 409 without deleting when left removal loses a race', async () => {
    clearEventWatermark.mockImplementation(async () => { operations.push('db:clear'); return false; });

    const response = await DELETE({ request: leftRequest('DELETE'), params: { slug: event.slug } });

    expect(response.status).toBe(409);
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalled();
    expect(restoreEventWatermark).not.toHaveBeenCalled();
  });

  it('deletes a failed left upload without deleting the persisted object', async () => {
    replaceEventWatermark.mockRejectedValue(new Error('D1 unavailable'));

    const response = await PUT({ request: leftRequest('PUT', png()), params: { slug: event.slug } });
    const uploadedKey = fakeEnv.SELFIES.put.mock.calls[0][0];

    expect(response.status).toBe(500);
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledWith(uploadedKey);
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalledWith(event.watermark_image_key_left);
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalledWith(event.watermark_image_key);
  });

  it('deletes a conflicting left upload without deleting either persisted object', async () => {
    replaceEventWatermark.mockImplementation(async () => { operations.push('db:replace'); return false; });

    const response = await PUT({ request: leftRequest('PUT', png()), params: { slug: event.slug } });
    const generatedKey = fakeEnv.SELFIES.put.mock.calls[0][0];

    expect(response.status).toBe(409);
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledWith(generatedKey);
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalledWith(event.watermark_image_key_left);
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalledWith(event.watermark_image_key);
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
    expect(restoreEventWatermark).toHaveBeenCalledWith(
      fakeEnv.DB,
      7,
      generatedKey,
      620,
      80,
      96,
      event.watermark_image_key,
      event.watermark_w,
      event.watermark_x,
      event.watermark_y,
    );
    expect(operations).toEqual(['r2:put', 'db:replace', 'db:restore', 'r2:delete-new']);
  });

  it('restores the left snapshot when prior-object cleanup fails', async () => {
    fakeEnv.SELFIES.delete
      .mockRejectedValueOnce(new Error('R2 unavailable'))
      .mockRejectedValueOnce(new Error('R2 unavailable'))
      .mockRejectedValueOnce(new Error('R2 unavailable'))
      .mockImplementationOnce(async () => { operations.push('r2:delete-new'); });

    const response = await PUT({ request: leftRequest('PUT', png()), params: { slug: event.slug } });
    const generatedKey = fakeEnv.SELFIES.put.mock.calls[0][0];

    expect(response.status).toBe(500);
    expect(restoreEventWatermark).toHaveBeenCalledWith(
      fakeEnv.DB,
      7,
      generatedKey,
      620,
      80,
      96,
      event.watermark_image_key_left,
      event.watermark_left_w,
      event.watermark_left_x,
      event.watermark_left_y,
      'left',
    );
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalledWith(event.watermark_image_key);
    expect(operations).toEqual(['r2:put', 'db:replace', 'db:restore', 'r2:delete-new']);
  });

  it('retries failed removal cleanup and conditionally restores the exact snapshot', async () => {
    fakeEnv.SELFIES.delete.mockRejectedValue(new Error('R2 unavailable'));

    const response = await DELETE({ request: request('DELETE'), params: { slug: event.slug } });

    expect(response.status).toBe(500);
    expect(fakeEnv.SELFIES.delete).toHaveBeenCalledTimes(3);
    expect(restoreEventWatermark).toHaveBeenCalledWith(
      fakeEnv.DB,
      7,
      null,
      null,
      50,
      50,
      event.watermark_image_key,
      event.watermark_w,
      event.watermark_x,
      event.watermark_y,
    );
    expect(operations).toEqual(['db:clear', 'db:restore']);
  });

  it('restores the exact left snapshot when removal cleanup fails', async () => {
    fakeEnv.SELFIES.delete.mockRejectedValue(new Error('R2 unavailable'));

    const response = await DELETE({ request: leftRequest('DELETE'), params: { slug: event.slug } });

    expect(response.status).toBe(500);
    expect(restoreEventWatermark).toHaveBeenCalledWith(
      fakeEnv.DB,
      7,
      null,
      null,
      50,
      50,
      event.watermark_image_key_left,
      event.watermark_left_w,
      event.watermark_left_x,
      event.watermark_left_y,
      'left',
    );
    expect(fakeEnv.SELFIES.delete).not.toHaveBeenCalledWith(event.watermark_image_key);
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

    await actual.replaceEventWatermark(database, 7, 'old', 540, 56, 56, 'new', 620, 80, 96);
    await actual.updateEventWatermarkPlacement(database, 7, 'new', 620, 80, 96, 700, 70, 44);
    await actual.clearEventWatermark(database, 7, 'new', 700, 70, 44);
    await actual.replaceEventWatermark(database, 7, 'old-left', 480, 72, 64, 'new-left', 620, 80, 96, 'left');
    await actual.updateEventWatermarkPlacement(database, 7, 'new-left', 620, 80, 96, 700, 70, 44, 'left');
    await actual.clearEventWatermark(database, 7, 'new-left', 700, 70, 44, 'left');

    expect(calls[0][0]).toContain('watermark_image_key IS ?');
    expect(calls[0][0]).toContain('watermark_w IS ?');
    expect(calls[0][0]).toContain('watermark_x = ?');
    expect(calls[1][0]).toContain('watermark_x = ?');
    expect(calls[1][0]).toContain('watermark_y = ?');
    expect(calls[1][0]).not.toContain('SET watermark_image_key');
    expect(calls[1][0]).toContain('watermark_image_key = ?');
    expect(calls[2][0]).toContain('watermark_image_key = ?');
    expect(calls[2][0]).toContain('watermark_w IS ?');
    expect(calls[3][0]).toContain('watermark_image_key_left IS ?');
    expect(calls[3][0]).toContain('watermark_left_x = ?');
    expect(calls[4][0]).toContain('SET watermark_left_w = ?');
    expect(calls[4][0]).not.toContain('SET watermark_image_key_left');
    expect(calls[5][0]).toContain('watermark_image_key_left = NULL');
    expect(calls[5][0]).toContain('watermark_left_y = 50');
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
        .mockReturnValueOnce(watermarkInput)
        .mockReturnValueOnce(pipeline)
        .mockReturnValueOnce(watermarkInput),
    };
    const postcardEnv = {
      IMAGES: images,
      SELFIES: { get: vi.fn().mockResolvedValue({ body: new Uint8Array([1]) }) },
    } as unknown as Env;
    const caricature = { body: new Uint8Array([2]) } as unknown as R2ObjectBody;

    await buildPostcard(postcardEnv, caricature, 'watermark.png', 620, 80, 96, 'watermark-left.png', 480, 72, 64);
    await buildPostcard(postcardEnv, caricature, 'watermark.png', null, null, null, null, null, null, null);

    expect(transform).toHaveBeenCalledWith({ width: 620 });
    expect(transform).toHaveBeenCalledWith({ width: 540 });
    expect(draw).toHaveBeenCalledWith(watermarkInput, { bottom: 96, right: 80, opacity: 0.95 });
    expect(draw).toHaveBeenCalledWith(watermarkInput, { bottom: 64, left: 72, opacity: 0.95 });
    expect(draw).toHaveBeenCalledWith(watermarkInput, { bottom: 50, right: 50, opacity: 0.95 });
    expect(postcardEnv.SELFIES.get).toHaveBeenCalledTimes(3);
    expect(postcardEnv.SELFIES.get).not.toHaveBeenCalledWith(null);
  });

  it('reads both watermarks concurrently and draws right before left', async () => {
    const draw = vi.fn().mockReturnThis();
    const pipeline = {
      draw,
      output: vi.fn().mockResolvedValue({ response: () => new Response('postcard') }),
      transform: vi.fn().mockReturnThis(),
    };
    const watermarkInput = { transform: vi.fn().mockReturnThis() };
    const images = { input: vi.fn().mockReturnValueOnce(pipeline).mockReturnValue(watermarkInput) };
    let resolveRight!: (value: { body: Uint8Array }) => void;
    let resolveLeft!: (value: { body: Uint8Array }) => void;
    const right = new Promise<{ body: Uint8Array }>((resolve) => { resolveRight = resolve; });
    const left = new Promise<{ body: Uint8Array }>((resolve) => { resolveLeft = resolve; });
    const get = vi.fn((key: string) => key === 'right.png' ? right : left);
    const postcardEnv = { IMAGES: images, SELFIES: { get } } as unknown as Env;
    const caricature = { body: new Uint8Array([2]) } as unknown as R2ObjectBody;

    const postcard = buildPostcard(postcardEnv, caricature, 'right.png', 620, 80, 96, 'left.png', 480, 72, 64);
    expect(get).toHaveBeenCalledTimes(2);
    resolveLeft({ body: new Uint8Array([1]) });
    await Promise.resolve();
    expect(draw).not.toHaveBeenCalled();
    resolveRight({ body: new Uint8Array([1]) });
    await postcard;

    expect(draw).toHaveBeenNthCalledWith(1, watermarkInput, { bottom: 96, right: 80, opacity: 0.95 });
    expect(draw).toHaveBeenNthCalledWith(2, watermarkInput, { bottom: 64, left: 72, opacity: 0.95 });
  });

  it('compiles the editor and propagates the selected configuration to the workflow', async () => {
    const editor = await readFile(new URL('../src/pages/admin/events/[slug].astro', import.meta.url), 'utf8');
    const dropzones = await readFile(new URL('../src/components/admin/WatermarkDropzones.tsx', import.meta.url), 'utf8');
    const action = await readFile(new URL('../src/actions/index.ts', import.meta.url), 'utf8');
    const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
    const result = await transform(editor, { filename: 'src/pages/admin/events/[slug].astro' });

    expect(result.diagnostics).toEqual([]);
    expect(editor).toContain('/watermark');
    expect(editor).toContain("import { WatermarkDropzones } from '../../../components/admin/WatermarkDropzones'");
    expect(editor).toContain('<WatermarkDropzones');
    expect(editor).toContain('leftHasWatermark={Boolean(event.watermark_image_key_left)}');
    expect(editor).toContain('rightHasWatermark={Boolean(event.watermark_image_key)}');
    expect(editor).not.toContain('name="watermark" type="file"');
    expect(dropzones).toContain("accept: { 'image/png': ['.png'] }");
    expect(dropzones).toContain('maxSize: 2 * 1024 * 1024');
    expect(editor).toContain('aspect-[3/2]');
    expect(editor).not.toContain('>3:2 aspect ratio</p>');
    expect(editor).not.toContain('>1800 × 1200 px</p>');
    expect(dropzones).toContain('Max 2 MB.');
    expect(editor).not.toContain('Uploads automatically.');
    expect(editor).toContain('data-tab-panel="watermark"');
    expect(editor).not.toContain('grid max-w-3xl gap-5 rounded-[var(--radius-surface)] border border-border bg-card/40 p-5" aria-labelledby="watermark-heading" data-tab-panel="watermark"');
    expect(editor).toContain('lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]');
    expect(editor.match(/class="grid grid-cols-3 gap-3"/g)).toHaveLength(2);
    expect(editor.match(/>Width<\/label>/g)).toHaveLength(2);
    expect(editor.match(/>X offset<\/label>/g)).toHaveLength(2);
    expect(editor.match(/>Y offset<\/label>/g)).toHaveLength(2);
    expect(editor).toContain('text="Distance from the left edge in pixels."');
    expect(editor).toContain('text="Distance from the right edge in pixels."');
    expect(editor.match(/text="Distance from the bottom edge in pixels\."/g)).toHaveLength(2);
    expect(editor.match(/data-watermark-card-header/g)).toHaveLength(2);
    expect(editor).toContain("class={cn(buttonVariants({ variant: 'destructiveOutline', size: 'sm' }), 'shrink-0', !event.watermark_image_key_left && 'hidden')} data-remove-watermark type=\"button\"");
    expect(editor).toContain("class={cn(buttonVariants({ variant: 'destructiveOutline', size: 'sm' }), 'shrink-0', !event.watermark_image_key && 'hidden')} id=\"remove-watermark\" data-remove-watermark type=\"button\"");
    expect(editor.match(/<X aria-hidden="true" \/>/g)).toHaveLength(2);
    expect(editor.match(/^\s+Remove$/gm)).toHaveLength(2);
    expect(editor).toContain('data-watermark-side="left"');
    expect(editor).toContain('data-watermark-side="right"');
    expect(editor).toContain('Postcard preview');
    expect(editor).toContain('id="watermark-empty">Choose PNGs to preview and upload them.</p>');
    expect(editor).toContain('syncWatermarkEmptyState');
    expect(editor).toContain("class={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'shrink-0')} id=\"save-watermarks\" type=\"button\" disabled");
    expect(editor).toContain("<Save className={event.watermark_image_key || event.watermark_image_key_left ? undefined : 'hidden'} aria-hidden=\"true\" data-watermark-save-icon />");
    expect(editor).toContain("<Upload className={event.watermark_image_key || event.watermark_image_key_left ? 'hidden' : undefined} aria-hidden=\"true\" data-watermark-upload-icon />");
    expect(editor).toContain("<span data-watermark-save-label>{event.watermark_image_key || event.watermark_image_key_left ? 'Save' : 'Upload watermark'}</span>");
    expect(editor).toContain('const hasAnyWatermark = watermarkSectionState.hasAnyWatermark');
    expect(editor).toContain("watermarkSaveIcon?.classList.toggle('hidden', !hasAnyWatermark)");
    expect(editor).toContain("watermarkUploadIcon?.classList.toggle('hidden', hasAnyWatermark)");
    expect(editor).toContain("watermarkSaveLabel.textContent = hasAnyWatermark ? 'Save' : 'Upload watermark'");
    expect(editor).not.toContain('Use the left dropzone in the preview to add or replace this PNG.');
    expect(editor).not.toContain('Use the right dropzone in the preview to add or replace this PNG.');
    expect(editor).not.toContain('Save placement');
    expect(editor.match(/id="save-watermarks"/g)).toHaveLength(1);
    expect(editor.match(/data-watermark-side="(?:left|right)"[^>]*\bnovalidate\b/g)).toHaveLength(2);
    expect(editor.match(/\bnovalidate\b/g)).toHaveLength(2);
    expect(editor).toContain('side=left');
    expect(editor).toContain('style.left');
    expect(editor).toContain('style.right');
    expect(editor).toContain('<Input className="bg-card px-3" id="watermark-width"');
    expect(editor).toContain('<Input className="bg-card px-3" id="watermark-x"');
    expect(editor).toContain('<Input className="bg-card px-3" id="watermark-y"');
    expect(editor).toContain('defaultValue={event.watermark_image_key_left ? event.watermark_left_w ?? 540 : 540} disabled={!event.watermark_image_key_left}');
    expect(editor).toContain('defaultValue={event.watermark_image_key_left ? event.watermark_left_x : 50} disabled={!event.watermark_image_key_left}');
    expect(editor).toContain('defaultValue={event.watermark_image_key_left ? event.watermark_left_y : 50} disabled={!event.watermark_image_key_left}');
    expect(editor).toContain('defaultValue={event.watermark_image_key ? event.watermark_w ?? 540 : 540} disabled={!event.watermark_image_key}');
    expect(editor).toContain('defaultValue={event.watermark_image_key ? event.watermark_x : 50} disabled={!event.watermark_image_key}');
    expect(editor).toContain('defaultValue={event.watermark_image_key ? event.watermark_y : 50} disabled={!event.watermark_image_key}');
    expect(editor).toContain('input.disabled = !persistedPreviewSrc');
    expect(editor).toContain('removeWatermark?.classList.remove(\'hidden\');\n        syncPlacementInputs()');
    expect(editor).toContain('async function uploadWatermark(file: File)');
    expect(editor).toContain('WATERMARK_FILE_SELECTED_EVENT');
    expect(editor).toContain('const uploadOperations = createLatestOperationToken()');
    expect(editor).toContain('const detachedPreview = new Image()');
    expect(editor).toContain('if (!uploadOperations.isCurrent(operation)) return');
    expect(editor).toContain('() => uploadOperations.isCurrent(operation)');
    expect(editor).toContain('if (!isCurrent()) return null');
    const watermarkRemove = editor.slice(
      editor.indexOf("removeWatermark?.addEventListener('click'"),
      editor.indexOf('watermarkControls.push({'),
    );
    expect(watermarkRemove).toContain('uploadOperations.invalidate()');
    expect(watermarkRemove).toContain('activeUploadController?.abort()');
    expect(watermarkRemove).toContain('syncPlacementInputs()');
    expect(watermarkRemove.indexOf('uploadOperations.invalidate()')).toBeLessThan(watermarkRemove.indexOf("method: 'DELETE'"));
    expect(editor).toContain("input.addEventListener('input', () => {");
    expect(editor).toContain('watermarkSectionState.markChanged()');
    expect(editor).toContain("input.addEventListener('blur', constrainPlacement)");
    expect(editor).not.toContain("input.addEventListener('input', constrainPlacement)");
    expect(editor).toContain('width: widthInput.valueAsNumber');
    expect(editor).toContain('input.validity.valid');
    expect(editor).toContain("watermarkUploadUrl(watermarkForm.dataset.endpoint ?? '', uploadPlacement");
    expect(editor).toContain('if (watermarkPreview.complete) syncWatermarkAspectRatio()');
    expect(editor).toContain('watermarkControls.forEach((control) => control.updateEndpoint(encodedSlug))');
    expect(editor).not.toContain('id="watermark-status"');
    expect(editor).not.toContain('<p class="m-0 min-h-5 text-sm text-muted-foreground" role="status" aria-live="polite"></p>');
    expect(editor).not.toContain("watermarkForm.querySelector<HTMLElement>('[role=\"status\"]')");
    expect(editor).toContain('if (error instanceof FormSubmissionError && !form.dataset.watermarkSide) showFieldErrors(form, error.fields)');
    expect(editor).toContain('output.dataset.generatedFieldError');
    expect(editor).toContain("toast.error('Choose a valid PNG image.')");
    expect(editor).toContain('watermarkControls.forEach((control) => control.normalize())');
    expect(editor).toContain('watermarkControls.filter((control) => watermarkSectionState.hasWatermark(control.side))');
    expect(editor).toContain('Promise.allSettled(required.map((control) => control.savePlacement()))');
    expect(editor).toContain("toast.success('Watermark settings saved.')");
    expect(editor).toContain("toast.error('Watermark settings could not be saved.')");
    expect(editor).not.toContain('Watermark placement saved.');
    expect(editor).toContain('watermarkSectionState.markChanged(side, true)');
    expect(editor).toContain('watermarkSectionState.markChanged(side, false)');
    expect(editor).toContain('watermarkSectionState.beginOperation()');
    expect(editor).toContain('watermarkSectionState.endOperation()');
    expect(editor).toContain('watermarkSectionState.saved()');
    expect(action).toContain('watermarkWidth');
    expect(action).toContain('watermarkX');
    expect(action).toContain('watermarkY');
    expect(action).toContain('watermarkLeftKey');
    expect(action).toContain('watermarkLeftWidth');
    expect(action).toContain('watermarkLeftX');
    expect(action).toContain('watermarkLeftY');
    expect(worker).toContain('watermarkLeftKey');
    expect(worker).toContain('buildPostcard(');
  });

  it('adds left watermark position columns in a new migration', async () => {
    const migration = await readFile(new URL('../drizzle/migrations/0017_left_watermark_position.sql', import.meta.url), 'utf8');
    const appliedDefaultMigration = await readFile(new URL('../drizzle/migrations/0019_empty_left_watermark_position_defaults.sql', import.meta.url), 'utf8');

    expect(migration).toContain('watermark_left_x INTEGER NOT NULL DEFAULT 50');
    expect(migration).toContain('watermark_left_y INTEGER NOT NULL DEFAULT 50');
    expect(appliedDefaultMigration).toContain('watermark_image_key_left IS NULL');
    expect(appliedDefaultMigration).toContain('watermark_left_x = 50');
    expect(appliedDefaultMigration).toContain('watermark_left_y = 50');
  });

  it('migrates only untouched empty right watermark positions to 50', async () => {
    const migration = await readFile(new URL('../drizzle/migrations/0018_empty_watermark_position_defaults.sql', import.meta.url), 'utf8');
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        watermark_image_key TEXT,
        watermark_x INTEGER NOT NULL DEFAULT 56,
        watermark_y INTEGER NOT NULL DEFAULT 56
      );
      INSERT INTO events (id) VALUES (1);
      INSERT INTO events (id, watermark_x, watermark_y) VALUES (2, 70, 56);
      INSERT INTO events (id, watermark_image_key) VALUES (3, 'configured.png');
    `);

    sqlite.exec(migration);
    const rows = sqlite.prepare('SELECT id, watermark_x, watermark_y FROM events ORDER BY id').all();
    sqlite.close();

    expect(rows).toEqual([
      { id: 1, watermark_x: 50, watermark_y: 50 },
      { id: 2, watermark_x: 70, watermark_y: 56 },
      { id: 3, watermark_x: 56, watermark_y: 56 },
    ]);
  });

  it('rejects placement that would move the rendered watermark outside the postcard', async () => {
    const response = await PUT({
      request: new Request('https://booth.test/api/admin/events/launch-night/watermark?width=900&x=901&y=0', {
        method: 'PUT',
        body: png().slice().buffer as ArrayBuffer,
        headers: {
          [ADMIN_EMAIL_HEADER]: 'admin@example.com',
          'Content-Length': String(png().byteLength),
          'Content-Type': 'image/png',
        },
      }),
      params: { slug: event.slug },
    });

    expect(response.status).toBe(400);
    expect(fakeEnv.SELFIES.put).not.toHaveBeenCalled();
  });
});
