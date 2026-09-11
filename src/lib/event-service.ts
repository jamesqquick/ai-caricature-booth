import {
  allocateEventId,
  EventIdConflictError,
  insertCompleteEvent,
  loadEventBySlug,
  loadEvents,
  type EventRecord,
} from '../db/events';
import { loadAdminScenesByEvent } from '../db/scenes';
import {
  CompleteEventValidationError,
  EVENT_STATUSES,
  type CreateCompleteEventInput,
  type EventStatus,
  validateCompleteEvent,
} from './event-validation';
import {
  assertPng,
  deleteEventWatermark,
  isEventOwnedWatermark,
  MAX_WATERMARK_BYTES,
  putEventWatermark,
} from './event-watermark';

const MAX_EVENT_ID_ATTEMPTS = 3;
const PNG_CONTENT_TYPE = 'image/png';

export type EventSummary = {
  id: number;
  slug: string;
  name: string;
  status: EventStatus;
  createdAt: number;
};

export type CompleteEventDto = EventSummary & {
  accentColor: string;
  tagline: string;
  kioskIdleSubhead: string;
  scenePickerHeading: string;
  sceneStylePreamble: string | null;
  sceneConstraints: string | null;
  scenes: Array<{
    id: string;
    name: string;
    description: string;
    prompt: string;
  }>;
  watermark: {
    contentType: typeof PNG_CONTENT_TYPE;
    width: number | null;
    bytes?: Uint8Array;
  } | null;
};

export type EventServiceContext = {
  database: D1Database;
  bucket: R2Bucket;
  createdBy: string;
};

export class CompleteEventReadError extends Error {
  name = 'CompleteEventReadError';

  constructor(
    public readonly slug: string,
    public readonly reason: 'unsafe-watermark' | 'missing-watermark' | 'invalid-watermark' | 'oversized-watermark',
  ) {
    super(`The watermark for event "${slug}" could not be read safely.`);
  }
}

export class CompleteEventCompensationError extends Error {
  name = 'CompleteEventCompensationError';

  constructor(
    public readonly eventId: number,
    public readonly watermarkKey: string,
    public readonly operationError: unknown,
    public readonly cleanupError: unknown,
  ) {
    super(`Event ${eventId} failed and its staged watermark could not be cleaned up.`);
  }
}

export async function listEvents(database: D1Database, status?: EventStatus): Promise<EventSummary[]> {
  if (status !== undefined && !EVENT_STATUSES.includes(status)) {
    throw new CompleteEventValidationError({ status: 'Choose draft, active, or archived.' });
  }
  return (await loadEvents(database, status)).map(toEventSummary);
}

export async function getCompleteEvent(
  database: D1Database,
  bucket: R2Bucket,
  slug: string,
  options: { includeWatermarkData?: boolean } = {},
): Promise<CompleteEventDto | null> {
  const event = await loadEventBySlug(database, slug);
  if (!event) return null;

  const scenes = await loadAdminScenesByEvent(database, event.id);
  const watermark = await loadWatermark(event, bucket, options.includeWatermarkData === true);
  return {
    ...toEventSummary(event),
    accentColor: event.accent_color,
    tagline: event.tagline,
    kioskIdleSubhead: event.kiosk_idle_subhead,
    scenePickerHeading: event.scene_picker_heading,
    sceneStylePreamble: event.scene_style_preamble,
    sceneConstraints: event.scene_constraints,
    scenes: scenes.map(({ id, name, description, prompt }) => ({ id, name, description, prompt })),
    watermark,
  };
}

export async function createCompleteEvent(
  service: EventServiceContext,
  input: unknown,
): Promise<CompleteEventDto> {
  const validated = validateCompleteEvent(input);
  if (typeof service.createdBy !== 'string' || !service.createdBy.trim()) {
    throw new CompleteEventValidationError({ 'context.createdBy': 'A creator is required.' });
  }
  const createdAt = Math.floor(Date.now() / 1_000);

  let attempt = 1;
  while (true) {
    const eventId = await allocateEventId(service.database);
    let watermarkKey: string | null = null;

    if (validated.watermark) {
      watermarkKey = await putEventWatermark(service.bucket, eventId, validated.watermark.bytes);
    }

    try {
      await insertCompleteEvent(service.database, eventId, validated, service.createdBy, createdAt, watermarkKey);
    } catch (error) {
      if (watermarkKey) await compensateWatermark(service.bucket, eventId, watermarkKey, error);
      if (error instanceof EventIdConflictError && attempt < MAX_EVENT_ID_ATTEMPTS) {
        attempt += 1;
        continue;
      }
      throw error;
    }

    return toCompleteEventDto(eventId, createdAt, validated);
  }
}

function toEventSummary(event: EventRecord): EventSummary {
  return {
    id: Number(event.id),
    slug: event.slug,
    name: event.name,
    status: event.status as EventStatus,
    createdAt: Number(event.created_at),
  };
}

async function loadWatermark(
  event: EventRecord,
  bucket: R2Bucket,
  includeData: boolean,
): Promise<CompleteEventDto['watermark']> {
  const key = event.watermark_image_key;
  if (!key) return null;
  if (!isEventOwnedWatermark(event.id, key)) {
    if (includeData) throw new CompleteEventReadError(event.slug, 'unsafe-watermark');
    return null;
  }

  const metadata: NonNullable<CompleteEventDto['watermark']> = {
    contentType: PNG_CONTENT_TYPE,
    width: event.watermark_w === null ? null : Number(event.watermark_w),
  };
  if (!includeData) return metadata;

  const object = await bucket.get(key);
  if (!object) throw new CompleteEventReadError(event.slug, 'missing-watermark');
  if (object.httpMetadata?.contentType !== PNG_CONTENT_TYPE) {
    throw new CompleteEventReadError(event.slug, 'unsafe-watermark');
  }
  if (object.size > MAX_WATERMARK_BYTES) {
    throw new CompleteEventReadError(event.slug, 'oversized-watermark');
  }

  const bytes = new Uint8Array(await object.arrayBuffer());
  try {
    assertPng(bytes);
  } catch {
    throw new CompleteEventReadError(event.slug, 'invalid-watermark');
  }
  return { ...metadata, bytes };
}

async function compensateWatermark(bucket: R2Bucket, eventId: number, key: string, operationError: unknown) {
  try {
    await deleteEventWatermark(bucket, key);
  } catch (cleanupError) {
    throw new CompleteEventCompensationError(eventId, key, operationError, cleanupError);
  }
}

function toCompleteEventDto(
  eventId: number,
  createdAt: number,
  event: CreateCompleteEventInput,
): CompleteEventDto {
  return {
    id: eventId,
    slug: event.slug,
    name: event.name,
    status: event.status,
    createdAt,
    accentColor: event.accentColor,
    tagline: event.tagline,
    kioskIdleSubhead: event.kioskIdleSubhead,
    scenePickerHeading: event.scenePickerHeading,
    sceneStylePreamble: event.sceneStylePreamble,
    sceneConstraints: event.sceneConstraints,
    scenes: event.scenes.map(({ id, name, description, prompt }) => ({ id, name, description, prompt })),
    watermark: event.watermark
      ? { contentType: PNG_CONTENT_TYPE, width: event.watermark.width }
      : null,
  };
}
