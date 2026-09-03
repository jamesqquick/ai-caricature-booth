import { sql } from 'drizzle-orm';
import type { PublicScene, Scene } from '../data/scenes';
import type { SceneInput } from '../lib/event-validation';
import { createDb } from './index';

export type AdminScene = Scene & {
  sort_order: number;
};

export class SceneConflictError extends Error {
  name = 'SceneConflictError';

  constructor(message: string) {
    super(message);
  }
}

export async function loadScenesByEvent(database: D1Database, eventId: number): Promise<PublicScene[]> {
  const db = createDb(database);
  return db.all<PublicScene>(sql`
    SELECT id, name, description
    FROM event_scenes
    WHERE event_id = ${eventId}
    ORDER BY sort_order ASC, id ASC
  `);
}

export async function loadEventScene(database: D1Database, eventId: number, sceneId: string): Promise<Scene | null> {
  const db = createDb(database);
  return await db.get<Scene>(sql`
    SELECT id, name, description, prompt
    FROM event_scenes
    WHERE event_id = ${eventId} AND id = ${sceneId}
    LIMIT 1
  `) ?? null;
}

export async function loadAdminScenesByEvent(database: D1Database, eventId: number): Promise<AdminScene[]> {
  const result = await database.prepare(`
    SELECT id, name, description, prompt, sort_order
    FROM event_scenes
    WHERE event_id = ?
    ORDER BY sort_order ASC, id ASC
  `).bind(eventId).all<AdminScene>();
  return result.results;
}

export async function createEventScene(database: D1Database, eventId: number, input: SceneInput) {
  try {
    await database.prepare(`
      INSERT INTO event_scenes (
        event_id, id, name, description, prompt, sort_order
      )
      SELECT ?, ?, ?, ?, ?, COALESCE(MAX(sort_order), 0) + 1
      FROM event_scenes
      WHERE event_id = ?
    `).bind(
      eventId,
      input.id,
      input.name,
      input.description,
      input.prompt,
      eventId,
    ).run();
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new SceneConflictError(`A scene with ID "${input.id}" already exists.`);
    }
    throw error;
  }
  return loadAdminScene(database, eventId, input.id);
}

export async function updateEventScene(database: D1Database, eventId: number, sceneId: string, input: SceneInput) {
  const result = await database.prepare(`
    UPDATE event_scenes
    SET name = ?, description = ?, prompt = ?
    WHERE event_id = ? AND id = ?
  `).bind(
    input.name,
    input.description,
    input.prompt,
    eventId,
    sceneId,
  ).run();

  if (result.meta.changes === 1) return loadAdminScene(database, eventId, sceneId);
  return loadAdminScene(database, eventId, sceneId);
}

async function loadAdminScene(database: D1Database, eventId: number, sceneId: string): Promise<AdminScene | null> {
  const row = await database.prepare(`
    SELECT id, name, description, prompt, sort_order
    FROM event_scenes
    WHERE event_id = ? AND id = ?
    LIMIT 1
  `).bind(eventId, sceneId).first<AdminScene>();
  return row ?? null;
}
