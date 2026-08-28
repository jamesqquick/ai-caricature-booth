import { sql } from 'drizzle-orm';
import { createDb } from './index';
import { EventSlugConflictError, type CreateEventInput, type EventUpdateInput } from '../lib/event-validation';

export type EventRecord = {
  id: number;
  slug: string;
  name: string;
  status: string;
  accent_color: string;
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
  watermark_left_w: number | null;
};

export type AdminEventSummary = {
  id: number;
  slug: string;
  name: string;
  status: string;
  sessionCount: number;
  lastActivity: number | null;
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

export async function createEvent(database: D1Database, input: CreateEventInput, createdBy: string) {
  try {
    const result = await database.prepare(`
      INSERT INTO events (slug, name, status, created_by)
      VALUES (?, ?, ?, ?)
    `).bind(input.slug, input.name, input.status, createdBy).run();

    const id = Number(result.meta.last_row_id);
    return { id, ...input, createdBy };
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new EventSlugConflictError(input.slug);
    }
    throw error;
  }
}

export async function updateEvent(database: D1Database, id: number, input: EventUpdateInput) {
  try {
    const brandingFields = ['tagline', 'kiosk_idle_subhead', 'scene_picker_heading', 'accent_color']
      .filter((field) => input[field as keyof EventUpdateInput] !== undefined);
    const fields = ['slug', 'name', 'status', ...brandingFields];
    const values = fields.map((field) => input[field as keyof EventUpdateInput]);
    await database.prepare(`UPDATE events SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`)
      .bind(...values, id).run();
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new EventSlugConflictError(input.slug);
    }
    throw error;
  }

  return { id, ...input };
}

export async function replaceEventWatermark(
  database: D1Database,
  id: number,
  expectedKey: string | null,
  expectedWidth: number | null,
  key: string,
  width: number,
) {
  const result = await database.prepare(`
    UPDATE events
    SET watermark_image_key = ?, watermark_w = ?
    WHERE id = ? AND watermark_image_key IS ? AND watermark_w IS ?
  `).bind(key, width, id, expectedKey, expectedWidth).run();
  return result.meta.changes === 1;
}

export async function updateEventWatermarkWidth(
  database: D1Database,
  id: number,
  expectedKey: string,
  width: number,
) {
  const result = await database.prepare(`
    UPDATE events
    SET watermark_w = ?
    WHERE id = ? AND watermark_image_key = ?
  `).bind(width, id, expectedKey).run();
  return result.meta.changes === 1;
}

export async function clearEventWatermark(
  database: D1Database,
  id: number,
  expectedKey: string,
  expectedWidth: number | null,
) {
  const result = await database.prepare(`
    UPDATE events
    SET watermark_image_key = NULL, watermark_w = NULL
    WHERE id = ? AND watermark_image_key = ? AND watermark_w IS ?
  `).bind(id, expectedKey, expectedWidth).run();
  return result.meta.changes === 1;
}

export async function restoreEventWatermark(
  database: D1Database,
  id: number,
  expectedKey: string | null,
  expectedWidth: number | null,
  key: string,
  width: number | null,
) {
  const result = await database.prepare(`
    UPDATE events
    SET watermark_image_key = ?, watermark_w = ?
    WHERE id = ? AND watermark_image_key IS ? AND watermark_w IS ?
  `).bind(key, width, id, expectedKey, expectedWidth).run();
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
