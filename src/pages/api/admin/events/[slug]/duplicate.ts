import { env } from 'cloudflare:workers';
import {
  deleteDuplicatedEvent,
  duplicateEventConfiguration,
  EventDuplicationConflictError,
  loadEventBySlug,
  updateDuplicatedEventWatermarks,
  type EventRecord,
} from '../../../../../db/events';
import { ADMIN_EMAIL_HEADER } from '../../../../../lib/admin-access';
import { EventValidationError, validateDuplicateEvent } from '../../../../../lib/event-validation';

export const prerender = false;

type RouteContext = { request: Request; params: { slug?: string } };

class EventWatermarkCopyError extends Error {
  constructor(key: string) {
    super(`Watermark object not found: ${key}`);
    this.name = 'EventWatermarkCopyError';
  }
}

async function copyWatermark(sourceKey: string | null, destinationKey: string) {
  if (!sourceKey) return null;
  const object = await env.SELFIES.get(sourceKey);
  if (!object) throw new EventWatermarkCopyError(sourceKey);
  await env.SELFIES.put(destinationKey, object.body, {
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  });
  return destinationKey;
}

async function cleanupDuplicate(id: number, objectKeys: string[]) {
  async function retry(label: string, operation: () => Promise<unknown>) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await operation();
        return;
      } catch (error) {
        console.error(`${label} cleanup failed (attempt ${attempt})`, error);
      }
    }
  }

  if (objectKeys.length > 0) {
    await retry('Duplicated event R2', () => env.SELFIES.delete(objectKeys));
  }
  await retry('Duplicated event D1', () => deleteDuplicatedEvent(env.DB, id));
}

function watermarkDestination(id: number, side: 'right' | 'left') {
  return `events/${id}/watermarks/${side}.png`;
}

async function duplicateWatermarks(source: EventRecord, duplicateId: number, copiedKeys: string[]) {
  const rightDestination = watermarkDestination(duplicateId, 'right');
  if (source.watermark_image_key) copiedKeys.push(rightDestination);
  const right = await copyWatermark(source.watermark_image_key, rightDestination);
  const leftDestination = watermarkDestination(duplicateId, 'left');
  if (source.watermark_image_key_left) copiedKeys.push(leftDestination);
  const left = await copyWatermark(source.watermark_image_key_left, leftDestination);
  await updateDuplicatedEventWatermarks(env.DB, duplicateId, {
    watermark_image_key: right,
    watermark_image_key_left: left,
    watermark_w: right ? source.watermark_w : null,
    watermark_x: source.watermark_x,
    watermark_y: source.watermark_y,
    watermark_left_w: left ? source.watermark_left_w : null,
    watermark_left_x: source.watermark_left_x,
    watermark_left_y: source.watermark_left_y,
  });
}

export async function POST({ request, params }: RouteContext) {
  const createdBy = request.headers.get(ADMIN_EMAIL_HEADER)?.trim();
  if (!createdBy) return Response.json({ error: 'Forbidden' }, { status: 403 });

  let duplicate: Awaited<ReturnType<typeof duplicateEventConfiguration>> | null = null;
  const copiedKeys: string[] = [];
  try {
    const source = await loadEventBySlug(env.DB, params.slug ?? '');
    if (!source) return Response.json({ error: 'Event not found.' }, { status: 404 });
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return Response.json({ error: 'Enter a valid JSON request body.' }, { status: 400 });
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return Response.json({ error: 'Enter a valid JSON request body.' }, { status: 400 });
    }
    const { name } = validateDuplicateEvent(input as Record<string, unknown>);
    duplicate = await duplicateEventConfiguration(env.DB, source, name, createdBy);
    await duplicateWatermarks(source, duplicate.id, copiedKeys);
    return Response.json({
      event: duplicate,
      redirectTo: `/admin/events/${encodeURIComponent(duplicate.slug)}`,
    }, { status: 201 });
  } catch (error) {
    if (duplicate) await cleanupDuplicate(duplicate.id, copiedKeys);
    if (error instanceof EventValidationError) {
      return Response.json({ error: error.message, fields: error.fields }, { status: 400 });
    }
    if (error instanceof EventDuplicationConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error('Admin event duplication failed', error);
    return Response.json({ error: "Couldn't duplicate the event." }, { status: 500 });
  }
}
