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
import {
  assertPng,
  WatermarkValidationError,
  deleteEventWatermark,
  isEventOwnedWatermark,
  putEventWatermark,
  readBoundedPng,
  validateWatermarkWidth,
} from '../../../../../lib/event-watermark';

export const prerender = false;

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

async function loadEvent(slug: string) {
  return loadEventBySlug(env.DB, slug);
}

function requireEvent(event: EventRecord | null) {
  if (!event) throw new WatermarkValidationError('Event not found.', 404);
  return event;
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

function validatePlacementWidth(value: unknown) {
  try {
    return validateWatermarkWidth(value);
  } catch (error) {
    if (error instanceof WatermarkValidationError) {
      throw new WatermarkValidationError(error.message, error.status, 'width');
    }
    throw error;
  }
}

function validatePlacement(input: Record<'width' | 'x' | 'y', unknown>, dimensions: WatermarkDimensions): WatermarkPlacement {
  const width = validatePlacementWidth(input.width);
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
    const bytes = await readBoundedPng(request);
    const dimensions = assertPng(bytes);
    const placement = parsePlacement(request, dimensions);
    const key = await putEventWatermark(env.SELFIES, event.id, bytes, dimensions);
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
        await deleteEventWatermark(env.SELFIES, key);
        throw new WatermarkConflictError();
      }
    } catch (error) {
      if (!(error instanceof WatermarkConflictError)) await deleteEventWatermark(env.SELFIES, key);
      throw error;
    }

    if (event.watermark_image_key && isEventOwnedWatermark(event.id, event.watermark_image_key)) {
      try {
        await deleteEventWatermark(env.SELFIES, event.watermark_image_key);
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
            await deleteEventWatermark(env.SELFIES, key);
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
        await deleteEventWatermark(env.SELFIES, event.watermark_image_key);
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
