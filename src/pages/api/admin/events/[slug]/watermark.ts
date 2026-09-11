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
import {
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

function parseWidth(request: Request) {
  return validateWatermarkWidth(new URL(request.url).searchParams.get('width'));
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
    const key = await putEventWatermark(env.SELFIES, event.id, bytes);
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
          width,
          event.watermark_image_key,
          event.watermark_w,
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
    const width = validateWatermarkWidth(input.width);
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
        await deleteEventWatermark(env.SELFIES, event.watermark_image_key);
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
