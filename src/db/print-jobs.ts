export const PRINT_JOB_STATUSES = ['pending', 'printing', 'printed', 'failed'] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

export type PublicPrintJob = {
  id: string;
  status: PrintJobStatus;
  printedAt: number | null;
};

export type AdminPrintJob = PublicPrintJob & {
  sessionId: string;
  eventId: number;
  sceneName: string;
  postcardUrl: string;
  createdAt: number;
  error: string | null;
};

export type AgentPrintJob = Pick<AdminPrintJob, 'id' | 'sessionId' | 'eventId' | 'sceneName' | 'postcardUrl' | 'createdAt'> & {
  eventSlug: string;
  claimToken: string;
};

export type PrintJobField = 'eventId' | 'sessionId' | 'jobId' | 'eventSlug' | 'limit' | 'status' | 'error' | 'claimToken' | 'action';

export class PrintJobValidationError extends Error {
  name = 'PrintJobValidationError';

  constructor(public readonly field: PrintJobField, message: string) {
    super(message);
  }
}

export class PrintJobNotFoundError extends Error {
  name = 'PrintJobNotFoundError';

  constructor(message = 'Print job not found.') {
    super(message);
  }
}

export class PrintJobConflictError extends Error {
  name = 'PrintJobConflictError';
}

type PrintJobRow = {
  id: string;
  session_id: string;
  event_id: number;
  postcard_url: string;
  scene_name: string;
  status: PrintJobStatus;
  created_at: number;
  printed_at: number | null;
  error_msg: string | null;
};

type AgentPrintJobRow = PrintJobRow & { claim_token: string };

type Acknowledgement =
  | { status: 'printed'; claimToken: string }
  | { status: 'failed'; error: string; claimToken: string };

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_ID_PATTERN = /^[0-9a-f]{32}$/i;
const EVENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ERROR_LENGTH = 500;

export function parseEventId(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) throw new PrintJobValidationError('eventId', 'Invalid eventId.');
  const eventId = Number(value);
  if (!Number.isSafeInteger(eventId) || eventId < 1) throw new PrintJobValidationError('eventId', 'Invalid eventId.');
  return eventId;
}

export function parseSessionId(value: string | undefined) {
  if (!value || !SESSION_ID_PATTERN.test(value)) throw new PrintJobValidationError('sessionId', 'Invalid sessionId.');
  return value;
}

export function parseJobId(value: string | undefined) {
  if (!value || !JOB_ID_PATTERN.test(value)) throw new PrintJobValidationError('jobId', 'Invalid jobId.');
  return value.toLowerCase();
}

export function parseClaimInput(input: unknown) {
  const body = asObject(input, 'eventSlug');
  const eventSlug = typeof body.eventSlug === 'string' ? body.eventSlug.trim() : '';
  if (!EVENT_SLUG_PATTERN.test(eventSlug) || eventSlug.length > 120) {
    throw new PrintJobValidationError('eventSlug', 'Invalid eventSlug.');
  }
  const requestedLimit = body.limit;
  if (typeof requestedLimit !== 'number' || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 20) {
    throw new PrintJobValidationError('limit', 'limit must be an integer between 1 and 20.');
  }
  return { eventSlug, limit: requestedLimit };
}

export function parseAcknowledgement(input: unknown): Acknowledgement {
  const body = asObject(input, 'status');
  const claimToken = parseClaimToken(body.claimToken);
  if (body.status === 'printed') return { status: 'printed', claimToken };
  if (body.status !== 'failed') throw new PrintJobValidationError('status', 'status must be printed or failed.');
  const error = typeof body.error === 'string' ? body.error.trim() : '';
  if (!error || error.length > MAX_ERROR_LENGTH) {
    throw new PrintJobValidationError('error', `error must be between 1 and ${MAX_ERROR_LENGTH} characters.`);
  }
  return { status: 'failed', error, claimToken };
}

export function parseRelease(input: unknown) {
  const body = asObject(input, 'claimToken');
  return { claimToken: parseClaimToken(body.claimToken) };
}

function parseClaimToken(value: unknown) {
  const claimToken = typeof value === 'string' ? value.toLowerCase() : '';
  if (!JOB_ID_PATTERN.test(claimToken)) throw new PrintJobValidationError('claimToken', 'Invalid claimToken.');
  return claimToken;
}

export function parseAdminMutation(input: unknown) {
  const body = asObject(input, 'action');
  if (body.action === 'queue') return { action: 'queue' } as const;
  if (body.action === 'retry') return { action: 'retry', jobId: parseJobId(typeof body.jobId === 'string' ? body.jobId : undefined) } as const;
  throw new PrintJobValidationError('action', 'action must be queue or retry.');
}

function asObject(input: unknown, field: PrintJobField): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PrintJobValidationError(field, 'Request body must be a JSON object.');
  }
  return input as Record<string, unknown>;
}

function publicJob(row: PrintJobRow): PublicPrintJob {
  return { id: row.id, status: row.status, printedAt: row.printed_at };
}

function adminJob(row: PrintJobRow): AdminPrintJob {
  return {
    ...publicJob(row),
    sessionId: row.session_id,
    eventId: row.event_id,
    sceneName: row.scene_name,
    postcardUrl: row.postcard_url,
    createdAt: row.created_at,
    error: row.error_msg,
  };
}

function postcardUrl(eventId: number, sessionId: string) {
  return `/api/events/${eventId}/sessions/${sessionId}/postcard`;
}

export async function createAttendeePrintJob(database: D1Database, eventId: number, sessionId: string): Promise<PublicPrintJob> {
  const url = postcardUrl(eventId, sessionId);
  const inserted = await database.prepare(`
    INSERT INTO print_jobs (session_id, event_id, postcard_key, postcard_url, scene_name)
    SELECT s.id, s.event_id, s.postcard_key, ?, COALESCE(NULLIF(s.scene_name, ''), s.scene_id)
    FROM sessions s
    WHERE s.id = ?
      AND s.event_id = ?
      AND s.status = 'completed'
      AND s.postcard_key IS NOT NULL
      AND s.postcard_key <> ''
      AND NOT EXISTS (
        SELECT 1 FROM print_jobs pj
        WHERE pj.session_id = s.id
          AND pj.event_id = s.event_id
          AND pj.status IN ('pending', 'printing', 'printed')
      )
    RETURNING id, session_id, event_id, postcard_url, scene_name, status, created_at, printed_at, error_msg
  `).bind(url, sessionId, eventId).first<PrintJobRow>();
  if (inserted) return publicJob(inserted);

  const existing = await database.prepare(`
    SELECT pj.id, pj.session_id, pj.event_id, pj.postcard_url, pj.scene_name,
           pj.status, pj.created_at, pj.printed_at, pj.error_msg
    FROM print_jobs pj
    INNER JOIN sessions s ON s.id = pj.session_id
    WHERE pj.session_id = ?
      AND s.event_id = ?
      AND pj.event_id = s.event_id
      AND s.status = 'completed'
      AND s.postcard_key IS NOT NULL
      AND s.postcard_key <> ''
      AND pj.status IN ('pending', 'printing', 'printed')
    ORDER BY pj.created_at DESC, pj.id DESC
    LIMIT 1
  `).bind(sessionId, eventId).first<PrintJobRow>();
  if (existing) return publicJob(existing);
  throw new PrintJobNotFoundError('Completed session not found.');
}

export async function loadAttendeePrintJob(database: D1Database, eventId: number, sessionId: string, jobId: string): Promise<PublicPrintJob> {
  const row = await database.prepare(`
    SELECT id, session_id, event_id, postcard_url, scene_name, status, created_at, printed_at, error_msg
    FROM print_jobs
    WHERE id = ? AND session_id = ? AND event_id = ?
    LIMIT 1
  `).bind(jobId, sessionId, eventId).first<PrintJobRow>();
  if (!row) throw new PrintJobNotFoundError();
  return publicJob(row);
}

export async function claimPrintJobs(database: D1Database, eventSlug: string, limit: number): Promise<AgentPrintJob[]> {
  const claimed = await database.prepare(`
    UPDATE print_jobs
    SET status = 'printing', printed_at = NULL, error_msg = NULL,
        claim_token = lower(hex(randomblob(16)))
    WHERE id IN (
        SELECT pj.id
        FROM print_jobs pj
        INNER JOIN events e ON e.id = pj.event_id
        WHERE pj.status = 'pending' AND e.slug = ?
        ORDER BY pj.created_at ASC, pj.id ASC
        LIMIT ?
      )
      AND status = 'pending'
    RETURNING id, session_id, event_id, postcard_url, scene_name, status, created_at, printed_at, error_msg, claim_token
  `).bind(eventSlug, limit).all<AgentPrintJobRow>();

  return claimed.results.map((job) => ({
    id: job.id,
    sessionId: job.session_id,
    eventId: job.event_id,
    eventSlug,
    sceneName: job.scene_name,
    postcardUrl: job.postcard_url,
    createdAt: job.created_at,
    claimToken: job.claim_token,
  })).sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

export async function acknowledgePrintJob(database: D1Database, jobId: string, acknowledgement: Acknowledgement): Promise<AdminPrintJob> {
  const row = acknowledgement.status === 'printed'
    ? await database.prepare(`
        UPDATE print_jobs
        SET status = 'printed', printed_at = unixepoch(), error_msg = NULL,
            claim_token = NULL, terminal_claim_token = claim_token
        WHERE id = ? AND status = 'printing' AND claim_token = ?
        RETURNING id, session_id, event_id, postcard_url, scene_name, status, created_at, printed_at, error_msg
      `).bind(jobId, acknowledgement.claimToken).first<PrintJobRow>()
    : await database.prepare(`
        UPDATE print_jobs
        SET status = 'failed', printed_at = NULL, error_msg = ?,
            claim_token = NULL, terminal_claim_token = claim_token
        WHERE id = ? AND status = 'printing' AND claim_token = ?
        RETURNING id, session_id, event_id, postcard_url, scene_name, status, created_at, printed_at, error_msg
      `).bind(acknowledgement.error, jobId, acknowledgement.claimToken).first<PrintJobRow>();
  if (row) return adminJob(row);
  const terminal = await database.prepare(`
    SELECT id, session_id, event_id, postcard_url, scene_name, status, created_at, printed_at, error_msg
    FROM print_jobs
    WHERE id = ? AND status = ? AND terminal_claim_token = ?
    LIMIT 1
  `).bind(jobId, acknowledgement.status, acknowledgement.claimToken).first<PrintJobRow>();
  if (terminal) return adminJob(terminal);
  return await throwMissingOrConflict(database, jobId, 'Print job is not printing.');
}

export async function releasePrintJob(database: D1Database, jobId: string, claimToken: string): Promise<AdminPrintJob> {
  const row = await database.prepare(`
    UPDATE print_jobs
    SET status = 'pending', claim_token = NULL
    WHERE id = ? AND status = 'printing' AND claim_token = ?
    RETURNING id, session_id, event_id, postcard_url, scene_name, status, created_at, printed_at, error_msg
  `).bind(jobId, claimToken).first<PrintJobRow>();
  if (row) return adminJob(row);
  return await throwMissingOrConflict(database, jobId, 'Print job claim is no longer active.');
}

export async function queueAdminPrintJob(database: D1Database, sessionId: string): Promise<AdminPrintJob> {
  const row = await database.prepare(`
    INSERT INTO print_jobs (session_id, event_id, postcard_key, postcard_url, scene_name)
    SELECT s.id, s.event_id, s.postcard_key,
           '/api/events/' || s.event_id || '/sessions/' || s.id || '/postcard',
           COALESCE(NULLIF(s.scene_name, ''), s.scene_id)
    FROM sessions s
    WHERE s.id = ?
      AND s.status = 'completed'
      AND s.postcard_key IS NOT NULL
      AND s.postcard_key <> ''
      AND NOT EXISTS (
        SELECT 1 FROM print_jobs pj
        WHERE pj.session_id = s.id AND pj.status IN ('pending', 'printing')
      )
    RETURNING id, session_id, event_id, postcard_url, scene_name, status, created_at, printed_at, error_msg
  `).bind(sessionId).first<PrintJobRow>();
  if (row) return adminJob(row);

  const active = await database.prepare(`
    SELECT id FROM print_jobs WHERE session_id = ? AND status IN ('pending', 'printing') LIMIT 1
  `).bind(sessionId).first<{ id: string }>();
  if (active) throw new PrintJobConflictError('This session already has an active print job.');
  throw new PrintJobNotFoundError('Completed session not found.');
}

export async function retryAdminPrintJob(database: D1Database, sessionId: string, jobId: string): Promise<AdminPrintJob> {
  const row = await database.prepare(`
    UPDATE print_jobs
    SET status = 'pending', printed_at = NULL, error_msg = NULL, claim_token = NULL
    WHERE id = ?
      AND session_id = ?
      AND status IN ('failed', 'printing')
      AND NOT EXISTS (
        SELECT 1 FROM print_jobs active
        WHERE active.session_id = print_jobs.session_id
          AND active.id <> print_jobs.id
          AND active.status IN ('pending', 'printing')
      )
    RETURNING id, session_id, event_id, postcard_url, scene_name, status, created_at, printed_at, error_msg
  `).bind(jobId, sessionId).first<PrintJobRow>();
  if (row) return adminJob(row);
  return await throwMissingOrConflict(database, jobId, 'Only failed or stuck printing jobs can be retried.', sessionId);
}

async function throwMissingOrConflict(database: D1Database, jobId: string, message: string, sessionId?: string): Promise<never> {
  const row = await database.prepare(`
    SELECT id FROM print_jobs WHERE id = ?${sessionId ? ' AND session_id = ?' : ''} LIMIT 1
  `).bind(...(sessionId ? [jobId, sessionId] : [jobId])).first<{ id: string }>();
  if (!row) throw new PrintJobNotFoundError();
  throw new PrintJobConflictError(message);
}
