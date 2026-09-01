import { sql } from 'drizzle-orm';
import type { GenerationFailureCode } from '../lib/generation-errors';
import { createDb } from './index';

export const SESSION_STATUSES = [
  'pending',
  'uploading',
  'moderating',
  'generating',
  'compositing',
  'completed',
  'errored',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type SessionRecord = {
  id: string;
  event_id: number;
  status: SessionStatus;
  scene_id: string;
  scene_name: string | null;
  selfie_key: string;
  selfie_sha256: string;
  caricature_key: string | null;
  postcard_key: string | null;
  workflow_instance_id: string | null;
  error_code: GenerationFailureCode | null;
  error_msg: string | null;
  created_at: number;
  completed_at: number | null;
  pipeline_ms: number | null;
  updated_at: number;
};

export function isTerminalSessionStatus(status: SessionStatus) {
  return status === 'completed' || status === 'errored';
}

export async function loadSession(database: D1Database, id: string) {
  const db = createDb(database);
  return db.get<SessionRecord>(sql`
    SELECT id, event_id, status, scene_id, scene_name, selfie_key, selfie_sha256,
           caricature_key, postcard_key, workflow_instance_id, error_code, error_msg,
           created_at, completed_at, pipeline_ms, updated_at
    FROM sessions
    WHERE id = ${id}
    LIMIT 1
  `);
}

export async function createPendingSession(
  database: D1Database,
  input: Pick<SessionRecord, 'id' | 'event_id' | 'scene_id' | 'scene_name' | 'selfie_key' | 'selfie_sha256'>,
) {
  const db = createDb(database);
  const result = await db.run(sql`
    INSERT INTO sessions (id, event_id, status, scene_id, scene_name, selfie_key, selfie_sha256, updated_at)
    VALUES (${input.id}, ${input.event_id}, 'pending', ${input.scene_id}, ${input.scene_name}, ${input.selfie_key}, ${input.selfie_sha256}, unixepoch())
    ON CONFLICT(id) DO NOTHING
  `);
  return { session: await loadSession(database, input.id), created: result.meta.changes === 1 };
}

export async function transitionSession(
  database: D1Database,
  id: string,
  nextStatus: SessionStatus,
  fields: Partial<Pick<SessionRecord, 'scene_name' | 'caricature_key' | 'postcard_key' | 'workflow_instance_id' | 'error_code' | 'error_msg' | 'pipeline_ms'>> = {},
) {
  const current = await loadSession(database, id);
  if (!current || isTerminalSessionStatus(current.status)) return current;
  const predecessors: Record<SessionStatus, SessionStatus[]> = {
    pending: [],
    uploading: ['pending'],
    moderating: ['pending', 'uploading'],
    generating: ['pending', 'uploading', 'moderating'],
    compositing: ['generating'],
    completed: ['compositing'],
    errored: ['pending', 'uploading', 'moderating', 'generating', 'compositing'],
  };
  if (!predecessors[nextStatus].includes(current.status)) return current;

  const db = createDb(database);
  await db.run(sql`
    UPDATE sessions
    SET status = ${nextStatus},
        scene_name = COALESCE(${fields.scene_name ?? null}, scene_name),
        caricature_key = COALESCE(${fields.caricature_key ?? null}, caricature_key),
        postcard_key = COALESCE(${fields.postcard_key ?? null}, postcard_key),
        workflow_instance_id = COALESCE(${fields.workflow_instance_id ?? null}, workflow_instance_id),
        error_code = ${fields.error_code ?? null},
        error_msg = ${fields.error_msg ?? null},
        completed_at = CASE WHEN ${nextStatus} = 'completed' THEN unixepoch() ELSE completed_at END,
        pipeline_ms = CASE WHEN ${nextStatus} = 'completed' THEN ${fields.pipeline_ms ?? null} ELSE pipeline_ms END,
        updated_at = unixepoch()
    WHERE id = ${id}
      AND status IN (${sql.join(predecessors[nextStatus].map((status) => sql`${status}`), sql`, `)})
  `);
  return loadSession(database, id);
}
