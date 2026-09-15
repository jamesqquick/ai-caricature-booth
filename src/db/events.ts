import { sql } from 'drizzle-orm';
import { createDb } from './index';
import {
  eventSlugFromName,
  EventSlugConflictError,
  type CreateCompleteEventInput,
  type CreateEventInput,
  type EventPromptInput,
  type EventStatus,
  type EventUpdateInput,
} from '../lib/event-validation';

export type EventRecord = {
  id: number;
  slug: string;
  name: string;
  status: string;
  watermark_image_key: string | null;
  watermark_image_key_left: string | null;
  tagline: string;
  kiosk_idle_subhead: string;
  scene_picker_heading: string;
  scene_style_preamble: string | null;
  scene_constraints: string | null;
  created_at: number;
  created_by: string | null;
  watermark_w: number | null;
  watermark_x: number;
  watermark_y: number;
  watermark_left_w: number | null;
  watermark_left_x: number;
  watermark_left_y: number;
};

export type AdminEventSummary = {
  id: number;
  slug: string;
  name: string;
  status: string;
  sessionCount: number;
  lastActivity: number | null;
};

export type EventListOptions = {
  limit?: number;
  cursor?: { createdAt: number; id: number };
};

type AdminEventSummaryRow = {
  id: number;
  slug: string;
  name: string;
  status: string;
  session_count: number;
  last_activity: number | null;
};

export async function loadActiveEventBySlug(
  database: D1Database,
  slug: string,
): Promise<EventRecord | null> {
  const db = createDb(database);

  return db.get<EventRecord>(sql`
    SELECT *
    FROM events
    WHERE slug = ${slug} AND status = 'active'
    LIMIT 1
  `);
}

export async function loadEventBySlug(database: D1Database, slug: string): Promise<EventRecord | null> {
  const db = createDb(database);
  return db.get<EventRecord>(sql`SELECT * FROM events WHERE slug = ${slug} LIMIT 1`);
}

export async function loadActiveEventById(database: D1Database, id: number): Promise<EventRecord | null> {
  const db = createDb(database);
  return db.get<EventRecord>(sql`SELECT * FROM events WHERE id = ${id} AND status = 'active' LIMIT 1`);
}

export async function loadEventById(database: D1Database, id: number): Promise<EventRecord | null> {
  const db = createDb(database);
  return db.get<EventRecord>(sql`SELECT * FROM events WHERE id = ${id} LIMIT 1`);
}

export class EventIdConflictError extends Error {
  name = 'EventIdConflictError';

  constructor(public readonly eventId: number) {
    super(`Event ID ${eventId} was allocated concurrently.`);
  }
}

export async function allocateEventId(database: D1Database): Promise<number> {
  const row = await database.prepare(`
    SELECT COALESCE(MAX(id), 0) + 1 AS id
    FROM events
  `).first<{ id: number }>();
  return Number(row?.id ?? 1);
}

export async function insertCompleteEvent(
  database: D1Database,
  id: number,
  input: CreateCompleteEventInput,
  createdBy: string,
  createdAt: number,
): Promise<void> {
  const statements = [
    database.prepare(`
      INSERT INTO events (
        id, slug, name, status, tagline,
        kiosk_idle_subhead, scene_picker_heading, scene_style_preamble,
        scene_constraints, created_at, created_by, watermark_w,
        watermark_x, watermark_y, watermark_left_x, watermark_left_y
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 50, 50, 50, 50)
    `).bind(
      id,
      input.slug,
      input.name,
      input.status,
      input.tagline,
      input.kioskIdleSubhead,
      input.scenePickerHeading,
      input.sceneStylePreamble,
      input.sceneConstraints,
      createdAt,
      createdBy,
    ),
    ...input.scenes.map((scene, sortOrder) => database.prepare(`
      INSERT INTO event_scenes (
        event_id, id, name, description, prompt, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      scene.id,
      scene.name,
      scene.description,
      scene.prompt,
      sortOrder,
    )),
  ];

  try {
    await database.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/unique constraint failed:\s*events\.id\b|primary key constraint failed:\s*events\.id\b/i.test(message)) {
      throw new EventIdConflictError(id);
    }
    if (/unique constraint failed:\s*events\.slug\b/i.test(message)) {
      throw new EventSlugConflictError(input.slug);
    }
    throw error;
  }
}

export async function loadEvents(
  database: D1Database,
  status?: EventStatus,
  options: EventListOptions = {},
): Promise<EventRecord[]> {
  const filters: string[] = [];
  const bindings: Array<string | number> = [];
  if (status) {
    filters.push('status = ?');
    bindings.push(status);
  }
  if (options.cursor) {
    filters.push('(created_at < ? OR (created_at = ? AND id < ?))');
    bindings.push(options.cursor.createdAt, options.cursor.createdAt, options.cursor.id);
  }
  if (options.limit !== undefined) bindings.push(options.limit);

  const statement = database.prepare(`
    SELECT *
    FROM events
    ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY created_at DESC, id DESC
    ${options.limit === undefined ? '' : 'LIMIT ?'}
  `);
  const result = bindings.length > 0
    ? await statement.bind(...bindings).all<EventRecord>()
    : await statement.all<EventRecord>();
  return result.results;
}

export async function createEvent(database: D1Database, input: CreateEventInput, createdBy: string) {
  if (input.status === 'active') throw new EventActivationError();
  try {
    const result = await database.prepare(`
      INSERT INTO events (
        slug, name, status, tagline, created_by,
        watermark_x, watermark_y, watermark_left_x, watermark_left_y
      ) VALUES (?, ?, ?, ?, ?, 50, 50, 50, 50)
    `).bind(
      input.slug,
      input.name,
      input.status,
      'Take a selfie, choose a scene, and download your caricature postcard.',
      createdBy,
    ).run();

    const id = Number(result.meta.last_row_id);
    return { id, ...input, createdBy };
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new EventSlugConflictError(input.slug);
    }
    throw error;
  }
}

export class EventDuplicationConflictError extends Error {
  name = 'EventDuplicationConflictError';

  constructor() {
    super('Could not generate a unique URL for the duplicated event.');
  }
}

export class EventDuplicationStateError extends Error {
  name = 'EventDuplicationStateError';
}

function isConstraintError(error: unknown) {
  return error instanceof Error && /unique.*events\.slug|events\.slug.*unique/i.test(error.message);
}

export async function duplicateEventConfiguration(
  database: D1Database,
  source: EventRecord,
  name: string,
  createdBy: string,
) {
  const baseSlug = eventSlugFromName(name);
  let duplicatedId: number | null = null;
  let slug = baseSlug;

  try {
    for (let suffix = 1; suffix <= 100; suffix += 1) {
      slug = suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;
      try {
        const [result] = await database.batch([
          database.prepare(`
            INSERT INTO events (
              slug, name, status, tagline, kiosk_idle_subhead,
              scene_picker_heading, scene_style_preamble, scene_constraints, created_by
            )
            SELECT ?, ?, 'draft', tagline, kiosk_idle_subhead,
              scene_picker_heading, scene_style_preamble, scene_constraints, ?
            FROM events
            WHERE id = ?
          `).bind(slug, name, createdBy, source.id),
          database.prepare(`
            INSERT INTO event_scenes (event_id, id, name, description, prompt, sort_order)
            SELECT duplicate.id, source.id, source.name, source.description, source.prompt, source.sort_order
            FROM event_scenes AS source
            JOIN events AS duplicate ON duplicate.slug = ?
            WHERE source.event_id = ?
          `).bind(slug, source.id),
        ]);
        if (result.meta.changes !== 1) throw new EventDuplicationStateError('Source event no longer exists.');
        duplicatedId = Number(result.meta.last_row_id);
        break;
      } catch (error) {
        if (!isConstraintError(error)) throw error;
      }
    }

    if (duplicatedId === null) throw new EventDuplicationConflictError();
  } catch (error) {
    if (duplicatedId !== null) await deleteDuplicatedEvent(database, duplicatedId);
    throw error;
  }

  return { id: duplicatedId, name, slug, status: 'draft' as const };
}

type DuplicatedEventWatermarks = Pick<EventRecord,
  | 'watermark_image_key'
  | 'watermark_image_key_left'
  | 'watermark_w'
  | 'watermark_x'
  | 'watermark_y'
  | 'watermark_left_w'
  | 'watermark_left_x'
  | 'watermark_left_y'>;

export async function updateDuplicatedEventWatermarks(
  database: D1Database,
  id: number,
  watermarks: DuplicatedEventWatermarks,
) {
  const result = await database.prepare(`
    UPDATE events
    SET watermark_image_key = ?, watermark_image_key_left = ?,
      watermark_w = ?, watermark_x = ?, watermark_y = ?,
      watermark_left_w = ?, watermark_left_x = ?, watermark_left_y = ?
    WHERE id = ?
  `).bind(
    watermarks.watermark_image_key,
    watermarks.watermark_image_key_left,
    watermarks.watermark_w,
    watermarks.watermark_x,
    watermarks.watermark_y,
    watermarks.watermark_left_w,
    watermarks.watermark_left_x,
    watermarks.watermark_left_y,
    id,
  ).run();
  if (result.meta.changes !== 1) throw new EventDuplicationStateError('Duplicated event no longer exists.');
}

export async function deleteDuplicatedEvent(database: D1Database, id: number) {
  await database.batch([
    database.prepare('DELETE FROM event_scenes WHERE event_id = ?').bind(id),
    database.prepare('DELETE FROM events WHERE id = ?').bind(id),
  ]);
}

export async function updateEvent(database: D1Database, id: number, input: EventUpdateInput) {
  try {
    const brandingFields = ['tagline', 'kiosk_idle_subhead', 'scene_picker_heading', 'scene_style_preamble', 'scene_constraints']
      .filter((field) => input[field as keyof EventUpdateInput] !== undefined);
    const fields = ['slug', 'name', 'status', ...brandingFields];
    const values = fields.map((field) => input[field as keyof EventUpdateInput]);
    const result = await database.prepare(`
      UPDATE events
      SET ${fields.map((field) => `${field} = ?`).join(', ')}
      WHERE id = ? AND (
        ? != 'active'
        OR EXISTS (SELECT 1 FROM event_scenes WHERE event_id = ?)
      )
    `).bind(...values, id, input.status, id).run();
    if (result.meta?.changes === 0 && input.status === 'active') throw new EventActivationError();
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new EventSlugConflictError(input.slug);
    }
    throw error;
  }

  return { id, ...input };
}

export async function updateEventPrompts(database: D1Database, id: number, input: EventPromptInput) {
  await database.prepare(`
    UPDATE events
    SET scene_style_preamble = ?, scene_constraints = ?
    WHERE id = ?
  `).bind(input.scene_style_preamble, input.scene_constraints, id).run();

  return { id, ...input };
}

type EventSessionAssetRow = {
  id: string;
  selfie_key: string;
  caricature_key: string | null;
  postcard_key: string | null;
};

export class EventDeletionConflictError extends Error {
  name = 'EventDeletionConflictError';

  constructor() {
    super('This event has print job history and cannot be deleted.');
  }
}

export async function deleteEventWithSessions(database: D1Database, id: number) {
  const printJob = await database.prepare(
    'SELECT id FROM print_jobs WHERE event_id = ? LIMIT 1',
  ).bind(id).first<{ id: string }>();
  if (printJob) throw new EventDeletionConflictError();

  const sessionResult = await database.prepare(`
    SELECT id, selfie_key, caricature_key, postcard_key
    FROM sessions
    WHERE event_id = ?
  `).bind(id).all<EventSessionAssetRow>();

  const results = await database.batch([
    database.prepare('DELETE FROM sessions WHERE event_id = ?').bind(id),
    database.prepare('DELETE FROM event_scenes WHERE event_id = ?').bind(id),
    database.prepare('DELETE FROM events WHERE id = ?').bind(id),
  ]);

  return {
    deleted: results[2]?.meta.changes === 1,
    sessions: sessionResult.results.map((session) => ({
      id: session.id,
      objectKeys: [session.selfie_key, session.caricature_key, session.postcard_key].filter((key): key is string => Boolean(key)),
    })),
  };
}

export class EventActivationError extends Error {
  name = 'EventActivationError';

  constructor() {
    super('Add at least one scene before activating this event.');
  }
}

export type WatermarkSide = 'left' | 'right';

function watermarkColumns(side: WatermarkSide) {
  return side === 'left'
    ? { key: 'watermark_image_key_left', width: 'watermark_left_w', x: 'watermark_left_x', y: 'watermark_left_y' }
    : { key: 'watermark_image_key', width: 'watermark_w', x: 'watermark_x', y: 'watermark_y' };
}

export async function replaceEventWatermark(
  database: D1Database,
  id: number,
  expectedKey: string | null,
  expectedWidth: number | null,
  expectedX: number,
  expectedY: number,
  key: string,
  width: number,
  x: number,
  y: number,
  side: WatermarkSide = 'right',
) {
  const columns = watermarkColumns(side);
  const result = await database.prepare(`
    UPDATE events
    SET ${columns.key} = ?, ${columns.width} = ?, ${columns.x} = ?, ${columns.y} = ?
    WHERE id = ?
      AND ${columns.key} IS ?
      AND ${columns.width} IS ?
      AND ${columns.x} = ?
      AND ${columns.y} = ?
  `).bind(key, width, x, y, id, expectedKey, expectedWidth, expectedX, expectedY).run();
  return result.meta.changes === 1;
}

export async function updateEventWatermarkPlacement(
  database: D1Database,
  id: number,
  expectedKey: string,
  expectedWidth: number | null,
  expectedX: number,
  expectedY: number,
  width: number,
  x: number,
  y: number,
  side: WatermarkSide = 'right',
) {
  const columns = watermarkColumns(side);
  const result = await database.prepare(`
    UPDATE events
    SET ${columns.width} = ?, ${columns.x} = ?, ${columns.y} = ?
    WHERE id = ?
      AND ${columns.key} = ?
      AND ${columns.width} IS ?
      AND ${columns.x} = ?
      AND ${columns.y} = ?
  `).bind(width, x, y, id, expectedKey, expectedWidth, expectedX, expectedY).run();
  return result.meta.changes === 1;
}

export async function clearEventWatermark(
  database: D1Database,
  id: number,
  expectedKey: string,
  expectedWidth: number | null,
  expectedX: number,
  expectedY: number,
  side: WatermarkSide = 'right',
) {
  const columns = watermarkColumns(side);
  const result = await database.prepare(`
    UPDATE events
    SET ${columns.key} = NULL, ${columns.width} = NULL, ${columns.x} = 50, ${columns.y} = 50
    WHERE id = ?
      AND ${columns.key} = ?
      AND ${columns.width} IS ?
      AND ${columns.x} = ?
      AND ${columns.y} = ?
  `).bind(id, expectedKey, expectedWidth, expectedX, expectedY).run();
  return result.meta.changes === 1;
}

export async function restoreEventWatermark(
  database: D1Database,
  id: number,
  expectedKey: string | null,
  expectedWidth: number | null,
  expectedX: number,
  expectedY: number,
  key: string,
  width: number | null,
  x: number,
  y: number,
  side: WatermarkSide = 'right',
) {
  const columns = watermarkColumns(side);
  const result = await database.prepare(`
    UPDATE events
    SET ${columns.key} = ?, ${columns.width} = ?, ${columns.x} = ?, ${columns.y} = ?
    WHERE id = ?
      AND ${columns.key} IS ?
      AND ${columns.width} IS ?
      AND ${columns.x} = ?
      AND ${columns.y} = ?
  `).bind(key, width, x, y, id, expectedKey, expectedWidth, expectedX, expectedY).run();
  return result.meta.changes === 1;
}

export async function loadActiveEvents(database: D1Database): Promise<EventRecord[]> {
  const db = createDb(database);
  const events = await db.all<EventRecord>(sql`
    SELECT *
    FROM events
    WHERE status = 'active'
    ORDER BY created_at DESC, id DESC
  `);

  return events;
}

export async function loadAdminEvents(database: D1Database): Promise<AdminEventSummary[]> {
  const result = await database.prepare(`
    SELECT
      e.id,
      e.slug,
      e.name,
      e.status,
      COUNT(s.id) AS session_count,
      MAX(s.updated_at) AS last_activity
    FROM events e
    LEFT JOIN sessions s ON s.event_id = e.id
    GROUP BY e.id, e.slug, e.name, e.status, e.created_at
    ORDER BY e.created_at DESC, e.id DESC
  `).all<AdminEventSummaryRow>();

  return result.results.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    sessionCount: Number(row.session_count),
    lastActivity: row.last_activity === null ? null : Number(row.last_activity),
  }));
}
