import { env } from 'cloudflare:workers';
import {
  clearEventWatermark,
  loadEventBySlug,
  replaceEventWatermark,
  restoreEventWatermark,
  updateEventWatermarkPlacement,
  type EventRecord,
} from '../../../../../db/events';
import { ADMIN_EMAIL_HEADER } from '../../../../../lib/admin-access';
import {
  DEFAULT_WATERMARK_X,
  DEFAULT_WATERMARK_Y,
  POSTCARD_HEIGHT,
  POSTCARD_WIDTH,
} from '../../../../../lib/postcard';

export const prerender = false;

export const MAX_WATERMARK_BYTES = 2 * 1024 * 1024;
export const MAX_WATERMARK_DIMENSION = 4096;
export const MIN_WATERMARK_WIDTH = 120;
export const MAX_WATERMARK_WIDTH = 900;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

class WatermarkValidationError extends Error {
  constructor(message: string, readonly status = 400, readonly field?: string) {
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
    throw new WatermarkValidationError(`Width must be a whole number from ${MIN_WATERMARK_WIDTH} to ${MAX_WATERMARK_WIDTH}.`, 400, 'width');
  }
  return width;
}

function validateOffset(value: unknown, field: 'x' | 'y', max: number) {
  const offset = Number(value);
  if (value === null || value === '' || !Number.isInteger(offset) || offset < 0 || offset > max) {
    throw new WatermarkValidationError(`${field.toUpperCase()} offset must be a whole number from 0 to ${max}.`, 400, field);
  }
  return offset;
}

type WatermarkDimensions = { width: number; height: number };
type WatermarkPlacement = { width: number; x: number; y: number };

function validatePlacement(input: Record<'width' | 'x' | 'y', unknown>, dimensions: WatermarkDimensions): WatermarkPlacement {
  const width = validateWidth(input.width);
  const x = validateOffset(input.x, 'x', POSTCARD_WIDTH);
  const y = validateOffset(input.y, 'y', POSTCARD_HEIGHT);
  const renderedHeight = Math.ceil(width * dimensions.height / dimensions.width);

  if (x + width > POSTCARD_WIDTH) {
    throw new WatermarkValidationError('X offset and logo width must fit inside the postcard.', 400, 'x');
  }
  if (renderedHeight > POSTCARD_HEIGHT) {
    throw new WatermarkValidationError('Logo width makes this image taller than the postcard.', 400, 'width');
  }
  if (y + renderedHeight > POSTCARD_HEIGHT) {
    throw new WatermarkValidationError('Y offset and logo height must fit inside the postcard.', 400, 'y');
  }
  return { width, x, y };
}

function parsePlacement(request: Request, dimensions: WatermarkDimensions) {
  const search = new URL(request.url).searchParams;
  return validatePlacement({ width: search.get('width'), x: search.get('x'), y: search.get('y') }, dimensions);
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
  const dimensions = assertPng(bytes);
  return { bytes, dimensions };
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
  return { width, height };
}

async function loadStoredDimensions(event: EventRecord) {
  if (!event.watermark_image_key || !isEventOwnedWatermark(event.id, event.watermark_image_key)) {
    throw new WatermarkValidationError('Upload a watermark before setting its placement.', 409);
  }
  const watermark = await env.SELFIES.get(event.watermark_image_key);
  if (!watermark || watermark.httpMetadata?.contentType !== 'image/png') {
    throw new WatermarkValidationError('The stored watermark is unavailable. Upload it again.', 409);
  }
  try {
    return assertPng(new Uint8Array(await watermark.arrayBuffer()));
  } catch {
    throw new WatermarkValidationError('The stored watermark is invalid. Upload it again.', 409);
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
    return Response.json({ error: error.message, field: error.field }, { status: error.status });
  }
  console.error('Admin watermark request failed', error);
  return Response.json({ error: "Couldn't update the watermark." }, { status: 500 });
}

export async function PUT({ request, params }: RouteContext) {
  const denied = forbidden(request);
  if (denied) return denied;

  try {
    const event = requireEvent(await loadEvent(params.slug ?? ''));
    const { bytes, dimensions } = await readBoundedPng(request);
    const placement = parsePlacement(request, dimensions);
    const key = `${ownedWatermarkPrefix(event.id)}${crypto.randomUUID()}.png`;

    await env.SELFIES.put(key, bytes, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: {
        eventId: String(event.id),
        imageWidth: String(dimensions.width),
        imageHeight: String(dimensions.height),
      },
    });
    try {
      const replaced = await replaceEventWatermark(
        env.DB,
        event.id,
        event.watermark_image_key,
        event.watermark_w,
        event.watermark_x,
        event.watermark_y,
        key,
        placement.width,
        placement.x,
        placement.y,
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
          placement.width,
          placement.x,
          placement.y,
          event.watermark_image_key,
          event.watermark_w,
          event.watermark_x,
          event.watermark_y,
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
    return Response.json(placement);
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
    const dimensions = await loadStoredDimensions(event);
    const input = await request.json<{ width?: unknown; x?: unknown; y?: unknown }>().catch(() => {
      throw new WatermarkValidationError('JSON watermark placement is required.');
    });
    const placement = validatePlacement({ width: input.width, x: input.x, y: input.y }, dimensions);
    const updated = await updateEventWatermarkPlacement(
      env.DB,
      event.id,
      event.watermark_image_key!,
      event.watermark_w,
      event.watermark_x,
      event.watermark_y,
      placement.width,
      placement.x,
      placement.y,
    );
    if (!updated) throw new WatermarkConflictError();
    return Response.json(placement);
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
    const cleared = await clearEventWatermark(
      env.DB,
      event.id,
      event.watermark_image_key,
      event.watermark_w,
      event.watermark_x,
      event.watermark_y,
    );
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
          DEFAULT_WATERMARK_X,
          DEFAULT_WATERMARK_Y,
          event.watermark_image_key,
          event.watermark_w,
          event.watermark_x,
          event.watermark_y,
        );
        throw error;
      }
    }
    return Response.json({ removed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
