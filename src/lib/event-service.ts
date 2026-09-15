import {
  allocateEventId,
  EventIdConflictError,
  insertCompleteEvent,
  loadEventBySlug,
  loadEvents,
  type EventListOptions,
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
import { isEventOwnedWatermark } from './event-watermark';

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
  } | null;
};

export type EventServiceContext = {
  database: D1Database;
  createdBy: string;
};

export async function listEvents(
  database: D1Database,
  status?: EventStatus,
  options: EventListOptions = {},
): Promise<EventSummary[]> {
  if (status !== undefined && !EVENT_STATUSES.includes(status)) {
    throw new CompleteEventValidationError({ status: 'Choose draft, active, or archived.' });
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 101)) {
    throw new CompleteEventValidationError({ limit: 'Choose a limit from 1 to 101.' });
  }
  if (options.cursor && (
    !Number.isInteger(options.cursor.createdAt)
    || options.cursor.createdAt < 0
    || !Number.isInteger(options.cursor.id)
    || options.cursor.id < 1
  )) {
    throw new CompleteEventValidationError({ cursor: 'Use a valid event cursor.' });
  }
  return (await loadEvents(database, status, options)).map(toEventSummary);
}

export async function getCompleteEvent(
  database: D1Database,
  slug: string,
): Promise<CompleteEventDto | null> {
  const event = await loadEventBySlug(database, slug);
  if (!event) return null;

  const scenes = await loadAdminScenesByEvent(database, event.id);
  const watermark = loadWatermarkMetadata(event);
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

    try {
      await insertCompleteEvent(service.database, eventId, validated, service.createdBy, createdAt);
    } catch (error) {
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

function loadWatermarkMetadata(event: EventRecord): CompleteEventDto['watermark'] {
  const key = event.watermark_image_key;
  if (!key) return null;
  if (!isEventOwnedWatermark(event.id, key)) return null;
  return {
    contentType: PNG_CONTENT_TYPE,
    width: event.watermark_w === null ? null : Number(event.watermark_w),
  };
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
    watermark: null,
  };
}
