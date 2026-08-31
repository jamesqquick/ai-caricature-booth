import { env } from 'cloudflare:workers';
import {
  clearEventWatermark,
  loadEventBySlug,
  replaceEventWatermark,
  restoreEventWatermark,
  updateEventWatermarkWidth,
  type EventRecord,
} from '../../../../../db/events';
import { ADMIN_EMAIL_HEADER } from '../../../../../lib/admin-access';

export const prerender = false;

export const MAX_WATERMARK_BYTES = 2 * 1024 * 1024;
export const MAX_WATERMARK_DIMENSION = 4096;
export const MIN_WATERMARK_WIDTH = 120;
export const MAX_WATERMARK_WIDTH = 900;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

class WatermarkValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'WatermarkValidationError';
  }
}

class WatermarkConflictError extends Error {
  constructor(message = 'Watermark changed in another request. Refresh and try again.') {
    super(message);
    this.name = 'WatermarkConflictError';
  }
}

type RouteContext = { request: Request; params: { slug?: string } };

function forbidden(request: Request) {
  if (request.headers.get(ADMIN_EMAIL_HEADER)?.trim()) return null;
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}

function ownedWatermarkPrefix(eventId: number) {
  return `events/${eventId}/watermarks/`;
}

function isEventOwnedWatermark(eventId: number, key: string) {
  return key.startsWith(ownedWatermarkPrefix(eventId));
}

async function loadEvent(slug: string) {
  return loadEventBySlug(env.DB, slug);
}

function requireEvent(event: EventRecord | null) {
  if (!event) throw new WatermarkValidationError('Event not found.', 404);
  return event;
}

function validateWidth(value: unknown) {
  const width = Number(value);
  if (value === null || value === '' || !Number.isInteger(width) || width < MIN_WATERMARK_WIDTH || width > MAX_WATERMARK_WIDTH) {
    throw new WatermarkValidationError(`Width must be a whole number from ${MIN_WATERMARK_WIDTH} to ${MAX_WATERMARK_WIDTH}.`);
  }
  return width;
}

function parseWidth(request: Request) {
  return validateWidth(new URL(request.url).searchParams.get('width'));
}

async function readBoundedPng(request: Request) {
  if (request.headers.get('content-type') !== 'image/png') {
    throw new WatermarkValidationError('Watermark must use the image/png content type.');
  }

  const declaredSize = Number(request.headers.get('x-watermark-bytes') ?? request.headers.get('content-length'));
  if (!Number.isInteger(declaredSize) || declaredSize <= 0) {
    throw new WatermarkValidationError('A positive Content-Length header is required.', 411);
  }
  if (declaredSize > MAX_WATERMARK_BYTES) {
    throw new WatermarkValidationError('Watermark must be 2 MB or smaller.', 413);
  }
  if (!request.body) throw new WatermarkValidationError('Watermark image is required.');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WATERMARK_BYTES) {
      await reader.cancel();
      throw new WatermarkValidationError('Watermark must be 2 MB or smaller.', 413);
    }
    chunks.push(value);
  }
  if (size !== declaredSize) throw new WatermarkValidationError('Content-Length does not match the uploaded image.');

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  assertPng(bytes);
  return bytes;
}

function assertPng(bytes: Uint8Array) {
  if (bytes.byteLength < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new WatermarkValidationError('Watermark must be a valid PNG image.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrLength = view.getUint32(8);
  const ihdrType = String.fromCharCode(...bytes.subarray(12, 16));
  if (ihdrLength !== 13 || ihdrType !== 'IHDR') {
    throw new WatermarkValidationError('Watermark PNG is missing a valid IHDR header.');
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0 || width > MAX_WATERMARK_DIMENSION || height > MAX_WATERMARK_DIMENSION) {
    throw new WatermarkValidationError(`Watermark dimensions must be between 1 and ${MAX_WATERMARK_DIMENSION} pixels.`);
  }
}

async function deleteWithRetry(bucket: R2Bucket, key: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await bucket.delete(key);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Watermark object could not be deleted.');
}

function errorResponse(error: unknown) {
  if (error instanceof WatermarkConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof WatermarkValidationError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error('Admin watermark request failed', error);
  return Response.json({ error: "Couldn't update the watermark." }, { status: 500 });
}

export async function PUT({ request, params }: RouteContext) {
  const denied = forbidden(request);
  if (denied) return denied;

  try {
    const event = requireEvent(await loadEvent(params.slug ?? ''));
    const width = parseWidth(request);
    const bytes = await readBoundedPng(request);
    const key = `${ownedWatermarkPrefix(event.id)}${crypto.randomUUID()}.png`;

    await env.SELFIES.put(key, bytes, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { eventId: String(event.id) },
    });
    try {
      const replaced = await replaceEventWatermark(
        env.DB,
        event.id,
        event.watermark_image_key,
        event.watermark_w,
        key,
        width,
      );
      if (!replaced) {
        await deleteWithRetry(env.SELFIES, key);
        throw new WatermarkConflictError();
      }
    } catch (error) {
      if (!(error instanceof WatermarkConflictError)) await deleteWithRetry(env.SELFIES, key);
      throw error;
    }

    if (event.watermark_image_key && isEventOwnedWatermark(event.id, event.watermark_image_key)) {
      try {
        await deleteWithRetry(env.SELFIES, event.watermark_image_key);
      } catch (error) {
        const restored = await restoreEventWatermark(
          env.DB,
          event.id,
          key,
          width,
          event.watermark_image_key,
          event.watermark_w,
        );
        if (restored) {
          try {
            await deleteWithRetry(env.SELFIES, key);
          } catch (rollbackError) {
            console.error('Admin watermark rollback cleanup failed', rollbackError);
          }
        }
        throw error;
      }
    }
    return Response.json({ width });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET({ request, params }: RouteContext) {
  const denied = forbidden(request);
  if (denied) return denied;

  try {
    const event = requireEvent(await loadEvent(params.slug ?? ''));
    if (!event.watermark_image_key || !isEventOwnedWatermark(event.id, event.watermark_image_key)) {
      return new Response('Not found', { status: 404 });
    }
    const watermark = await env.SELFIES.get(event.watermark_image_key);
    if (!watermark || watermark.httpMetadata?.contentType !== 'image/png') return new Response('Not found', { status: 404 });
    return new Response(watermark.body, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'image/png',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

export async function PATCH({ request, params }: RouteContext) {
  const denied = forbidden(request);
  if (denied) return denied;

  try {
    const event = requireEvent(await loadEvent(params.slug ?? ''));
    if (!event.watermark_image_key) throw new WatermarkValidationError('Upload a watermark before setting its width.', 409);
    const input = await request.json<{ width?: unknown }>().catch(() => {
      throw new WatermarkValidationError('A JSON watermark width is required.');
    });
    const width = validateWidth(input.width);
    const updated = await updateEventWatermarkWidth(env.DB, event.id, event.watermark_image_key, width);
    if (!updated) throw new WatermarkConflictError();
    return Response.json({ width });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE({ request, params }: RouteContext) {
  const denied = forbidden(request);
  if (denied) return denied;

  try {
    const event = requireEvent(await loadEvent(params.slug ?? ''));
    if (!event.watermark_image_key) return Response.json({ removed: true });
    const cleared = await clearEventWatermark(env.DB, event.id, event.watermark_image_key, event.watermark_w);
    if (!cleared) throw new WatermarkConflictError();
    if (event.watermark_image_key && isEventOwnedWatermark(event.id, event.watermark_image_key)) {
      try {
        await deleteWithRetry(env.SELFIES, event.watermark_image_key);
      } catch (error) {
        await restoreEventWatermark(
          env.DB,
          event.id,
          null,
          null,
          event.watermark_image_key,
          event.watermark_w,
        );
        throw error;
      }
    }
    return Response.json({ removed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
