import type { AdminFilters } from '../lib/admin-filters';
import type { SessionStatus } from './sessions';

export type AdminSessionSummary = {
  id: string;
  eventId: number;
  eventName: string;
  eventSlug: string;
  sceneId: string;
  sceneName: string | null;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  errorMessage: string | null;
  workflowId: string | null;
  hasSelfie: boolean;
  hasCaricature: boolean;
  hasPostcard: boolean;
};

export type AdminSessionDetail = AdminSessionSummary;

export type AdminSessionStats = {
  total: number;
  completed: number;
  errored: number;
  inFlight: number;
  completionRate: number;
};

export type AdminEventOption = {
  id: number;
  name: string;
  slug: string;
  status: string;
};

type AdminSessionRow = {
  session_id: string;
  event_id: number;
  event_name: string;
  event_slug: string;
  scene_id: string;
  scene_name: string | null;
  status: SessionStatus;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  error_message: string | null;
  workflow_id: string | null;
  has_selfie: number;
  has_caricature: number;
  has_postcard: number;
};

type CountRow = { total: number };

type StatsRow = {
  total: number;
  completed: number;
  errored: number;
  in_flight: number;
  completion_rate: number;
};

type AdminEventOptionRow = {
  id: number;
  name: string;
  slug: string;
  status: string;
};

function buildSessionFilter(filters: AdminFilters) {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filters.eventId !== undefined) {
    clauses.push('s.event_id = ?');
    values.push(filters.eventId);
  }
  if (filters.status !== undefined) {
    clauses.push('s.status = ?');
    values.push(filters.status);
  }
  if (filters.from !== undefined) {
    clauses.push('s.created_at >= ?');
    values.push(filters.from);
  }
  if (filters.to !== undefined) {
    clauses.push('s.created_at <= ?');
    values.push(filters.to);
  }

  return {
    sql: clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`,
    values,
  };
}

function mapSession(row: AdminSessionRow): AdminSessionSummary {
  return {
    id: row.session_id,
    eventId: row.event_id,
    eventName: row.event_name,
    eventSlug: row.event_slug,
    sceneId: row.scene_id,
    sceneName: row.scene_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    workflowId: row.workflow_id,
    hasSelfie: Boolean(row.has_selfie),
    hasCaricature: Boolean(row.has_caricature),
    hasPostcard: Boolean(row.has_postcard),
  };
}

export async function loadAdminSession(
  database: D1Database,
  sessionId: string,
): Promise<AdminSessionDetail | null> {
  const row = await database.prepare(`
    SELECT
      s.id AS session_id,
      e.id AS event_id,
      e.name AS event_name,
      e.slug AS event_slug,
      s.scene_id,
      s.scene_name,
      s.status,
      s.created_at,
      s.updated_at,
      s.completed_at,
      s.error_msg AS error_message,
      s.workflow_instance_id AS workflow_id,
      CASE WHEN s.selfie_key <> '' THEN 1 ELSE 0 END AS has_selfie,
      CASE WHEN s.caricature_key IS NOT NULL AND s.caricature_key <> '' THEN 1 ELSE 0 END AS has_caricature,
      CASE WHEN s.postcard_key IS NOT NULL AND s.postcard_key <> '' THEN 1 ELSE 0 END AS has_postcard
    FROM sessions s
    INNER JOIN events e ON e.id = s.event_id
    WHERE s.id = ?
    LIMIT 1
  `).bind(sessionId).first<AdminSessionRow>();

  return row ? mapSession(row) : null;
}

export async function loadAdminEventOptions(database: D1Database): Promise<AdminEventOption[]> {
  const result = await database.prepare(`
    SELECT id, name, slug, status
    FROM events
    ORDER BY name COLLATE NOCASE ASC, id ASC
  `).all<AdminEventOptionRow>();

  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
  }));
}

export async function loadAdminSessions(database: D1Database, filters: AdminFilters) {
  const filter = buildSessionFilter(filters);
  const offset = (filters.page - 1) * filters.pageSize;
  const sessionStatement = database.prepare(`
    SELECT
      s.id AS session_id,
      e.id AS event_id,
      e.name AS event_name,
      e.slug AS event_slug,
      s.scene_id,
      s.scene_name,
      s.status,
      s.created_at,
      s.updated_at,
      s.completed_at,
      s.error_msg AS error_message,
      s.workflow_instance_id AS workflow_id,
      CASE WHEN s.selfie_key <> '' THEN 1 ELSE 0 END AS has_selfie,
      CASE WHEN s.caricature_key IS NOT NULL AND s.caricature_key <> '' THEN 1 ELSE 0 END AS has_caricature,
      CASE WHEN s.postcard_key IS NOT NULL AND s.postcard_key <> '' THEN 1 ELSE 0 END AS has_postcard
    FROM sessions s
    INNER JOIN events e ON e.id = s.event_id
    ${filter.sql}
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ? OFFSET ?
  `).bind(...filter.values, filters.pageSize, offset);
  const countStatement = database.prepare(`
    SELECT COUNT(*) AS total
    FROM sessions s
    ${filter.sql}
  `).bind(...filter.values);

  const [sessionResult, countRow] = await Promise.all([
    sessionStatement.all<AdminSessionRow>(),
    countStatement.first<CountRow>(),
  ]);
  const total = Number(countRow?.total ?? 0);

  return {
    sessions: sessionResult.results.map(mapSession),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.ceil(total / filters.pageSize),
  };
}

export async function loadAdminSessionStats(
  database: D1Database,
  filters: AdminFilters,
): Promise<AdminSessionStats> {
  const filter = buildSessionFilter(filters);
  const row = await database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN s.status = 'errored' THEN 1 ELSE 0 END) AS errored,
      SUM(CASE WHEN s.status NOT IN ('completed', 'errored') THEN 1 ELSE 0 END) AS in_flight,
      COALESCE(
        ROUND(100.0 * SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1),
        0
      ) AS completion_rate
    FROM sessions s
    ${filter.sql}
  `).bind(...filter.values).first<StatsRow>();

  return {
    total: Number(row?.total ?? 0),
    completed: Number(row?.completed ?? 0),
    errored: Number(row?.errored ?? 0),
    inFlight: Number(row?.in_flight ?? 0),
    completionRate: Number(row?.completion_rate ?? 0),
  };
}
