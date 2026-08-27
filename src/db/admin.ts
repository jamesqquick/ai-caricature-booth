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

export const ADMIN_IMAGE_KINDS = ['selfie', 'caricature', 'postcard'] as const;
export type AdminImageKind = (typeof ADMIN_IMAGE_KINDS)[number];

export type AdminSessionStats = {
  total: number;
  completed: number;
  errored: number;
  inFlight: number;
  completionRate: number;
};

export type AdminStatusCount = {
  status: SessionStatus;
  count: number;
};

export type AdminSceneUsage = {
  sceneId: string;
  sceneName: string;
  count: number;
};

export type AdminVolumeBucket = {
  bucket: string;
  count: number;
};

export type AdminStatistics = AdminSessionStats & {
  averagePipelineMs: number | null;
  statusBreakdown: AdminStatusCount[];
  sceneUsage: AdminSceneUsage[];
  volume: AdminVolumeBucket[];
  volumeGranularity: 'hour' | 'day';
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
  average_pipeline_ms: number | null;
};

type StatusCountRow = { status: SessionStatus; count: number };
type SceneUsageRow = { scene_id: string; scene_name: string | null; count: number };
type VolumeRow = { bucket: string; count: number };

type AdminEventOptionRow = {
  id: number;
  name: string;
  slug: string;
  status: string;
};

type AdminImageKeyRow = {
  image_key: string | null;
};

const ADMIN_IMAGE_KEY_COLUMNS: Record<AdminImageKind, string> = {
  selfie: 'selfie_key',
  caricature: 'caricature_key',
  postcard: 'postcard_key',
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

export async function loadAdminSessionImageKey(
  database: D1Database,
  sessionId: string,
  kind: AdminImageKind,
): Promise<string | null> {
  const column = ADMIN_IMAGE_KEY_COLUMNS[kind];
  const row = await database.prepare(`
    SELECT ${column} AS image_key
    FROM sessions
    WHERE id = ?
    LIMIT 1
  `).bind(sessionId).first<AdminImageKeyRow>();

  return row?.image_key || null;
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

export async function loadAdminStatistics(
  database: D1Database,
  filters: AdminFilters,
): Promise<AdminStatistics> {
  const filter = buildSessionFilter(filters);
  const volumeGranularity: AdminStatistics['volumeGranularity'] = 'day';
  const volumeExpression = "strftime('%Y-%m-%d', s.created_at, 'unixepoch')";

  const [statsRow, statusRows, sceneRows, volumeRows] = await Promise.all([
    database.prepare(`
      WITH filtered AS (
        SELECT s.*
        FROM sessions s
        ${filter.sql}
      )
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'errored' THEN 1 ELSE 0 END) AS errored,
        SUM(CASE WHEN status NOT IN ('completed', 'errored') THEN 1 ELSE 0 END) AS in_flight,
        COALESCE(
          ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1),
          0
        ) AS completion_rate,
        ROUND(AVG(CASE WHEN status = 'completed' AND pipeline_ms IS NOT NULL THEN pipeline_ms END), 0) AS average_pipeline_ms
      FROM filtered
    `).bind(...filter.values).first<StatsRow>(),
    database.prepare(`
      SELECT s.status, COUNT(*) AS count
      FROM sessions s
      ${filter.sql}
      GROUP BY s.status
      ORDER BY count DESC, s.status ASC
    `).bind(...filter.values).all<StatusCountRow>(),
    database.prepare(`
      SELECT s.scene_id, MAX(s.scene_name) AS scene_name, COUNT(*) AS count
      FROM sessions s
      ${filter.sql}
      GROUP BY s.scene_id
      ORDER BY count DESC, s.scene_id ASC
    `).bind(...filter.values).all<SceneUsageRow>(),
    database.prepare(`
      SELECT ${volumeExpression} AS bucket, COUNT(*) AS count
      FROM sessions s
      ${filter.sql}
      GROUP BY bucket
      ORDER BY bucket ASC
    `).bind(...filter.values).all<VolumeRow>(),
  ]);

  return {
    total: Number(statsRow?.total ?? 0),
    completed: Number(statsRow?.completed ?? 0),
    errored: Number(statsRow?.errored ?? 0),
    inFlight: Number(statsRow?.in_flight ?? 0),
    completionRate: Number(statsRow?.completion_rate ?? 0),
    averagePipelineMs: statsRow?.average_pipeline_ms == null ? null : Number(statsRow.average_pipeline_ms),
    statusBreakdown: statusRows.results.map((row) => ({ status: row.status, count: Number(row.count) })),
    sceneUsage: sceneRows.results.map((row) => ({
      sceneId: row.scene_id,
      sceneName: row.scene_name || row.scene_id,
      count: Number(row.count),
    })),
    volume: volumeRows.results.map((row) => ({ bucket: row.bucket, count: Number(row.count) })),
    volumeGranularity,
  };
}
