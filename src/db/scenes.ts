import { sql } from 'drizzle-orm';
import type { Scene } from '../data/scenes';
import { createDb } from './index';

export async function loadActiveScenesByEvent(database: D1Database, eventId: number): Promise<Scene[]> {
  const db = createDb(database);
  return db.all<Scene>(sql`
    SELECT id, name, description, emoji, accent, backdrop, prompt
    FROM event_scenes
    WHERE event_id = ${eventId} AND active = 1
    ORDER BY sort_order ASC, id ASC
  `);
}

export async function loadActiveEventScene(database: D1Database, eventId: number, sceneId: string): Promise<Scene | null> {
  const db = createDb(database);
  return await db.get<Scene>(sql`
    SELECT id, name, description, emoji, accent, backdrop, prompt
    FROM event_scenes
    WHERE event_id = ${eventId} AND id = ${sceneId} AND active = 1
    LIMIT 1
  `) ?? null;
}

export async function loadEventScene(database: D1Database, eventId: number, sceneId: string): Promise<Scene | null> {
  const db = createDb(database);
  return await db.get<Scene>(sql`
    SELECT id, name, description, emoji, accent, backdrop, prompt
    FROM event_scenes
    WHERE event_id = ${eventId} AND id = ${sceneId}
    LIMIT 1
  `) ?? null;
}
