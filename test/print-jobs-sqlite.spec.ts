import { readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { acknowledgePrintJob, claimPrintJobs, createAttendeePrintJob, loadAdminPrintJobs, PrintJobConflictError, queueAdminPrintJob, reconcilePrintJobs, releasePrintJob, retryAdminPrintJob } from '../src/db/print-jobs';

const migrationUrls = [
  '0001_events.sql',
  '0002_sessions.sql',
  '0003_session_fingerprints.sql',
  '0004_remove_event_timezone.sql',
  '0005_session_pipeline_duration.sql',
  '0006_event_scenes.sql',
  '0007_simplify_event_scenes.sql',
  '0008_print_jobs.sql',
  '0009_literal_event_copy.sql',
  '0010_print_job_claim_tokens.sql',
  '0011_print_job_terminal_claim_tokens.sql',
  '0012_print_job_claim_owners.sql',
  '0013_print_job_request_keys.sql',
].map((name) => new URL(`../drizzle/migrations/${name}`, import.meta.url));

function asD1(sqlite: DatabaseSync) {
  const allResults: Record<string, unknown>[][] = [];
  const database = {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      let values: SQLInputValue[] = [];
      const prepared = {
        bind(...bindings: unknown[]) {
          values = bindings as SQLInputValue[];
          return prepared;
        },
        async all<T>() {
          const results = statement.all(...values) as T[];
          allResults.push(results as Record<string, unknown>[]);
          return { results };
        },
        async first<T>() {
          return statement.get(...values) as T | undefined ?? null;
        },
      };
      return prepared;
    },
  } as unknown as D1Database;
  return { database, allResults };
}

async function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migrationUrl of migrationUrls) sqlite.exec(await readFile(migrationUrl, 'utf8'));
  return { sqlite, ...asD1(sqlite) };
}

const sessionId = '00000000-0000-4000-8000-000000000001';
const attendeeRequestKey = '20000000-0000-4000-8000-000000000001';
const retryRequestKey = '30000000-0000-4000-8000-000000000001';

function insertCompletedSession(sqlite: DatabaseSync) {
  sqlite.prepare(`
    INSERT INTO sessions (id, event_id, status, scene_id, scene_name, selfie_key, postcard_key)
    VALUES (?, 1, 'completed', 'brooklyn-bridge', 'Brooklyn Bridge', 'selfie.jpg', 'postcard.jpg')
  `).run(sessionId);
}

describe('print job SQLite integration', () => {
  it('returns the exact completed admin job when a lost success is retried with the same request key', async () => {
    const { sqlite, database } = await createDatabase();
    try {
      insertCompletedSession(sqlite);
      const requestKey = '10000000-0000-4000-8000-000000000001';
      const queued = await queueAdminPrintJob(database, sessionId, requestKey);
      const [claimed] = await claimPrintJobs(database, 'nyc-tech-week-2026', 'a'.repeat(64), 1);
      await acknowledgePrintJob(database, queued.id, { status: 'printed', claimToken: claimed.claimToken });

      const repeated = await queueAdminPrintJob(database, sessionId, requestKey);

      expect(repeated).toMatchObject({ id: queued.id, status: 'printed' });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM print_jobs').get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('deduplicates concurrent attendee creation through the production insert SQL', async () => {
    const { sqlite, database } = await createDatabase();
    try {
      insertCompletedSession(sqlite);

      const jobs = await Promise.all([
        createAttendeePrintJob(database, 1, sessionId, attendeeRequestKey),
        createAttendeePrintJob(database, 1, sessionId, attendeeRequestKey),
      ]);

      expect(jobs[0].id).toBe(jobs[1].id);
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM print_jobs').get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('loads only one session print history newest first without private columns', async () => {
    const { sqlite, database } = await createDatabase();
    try {
      insertCompletedSession(sqlite);
      const secondSessionId = '00000000-0000-4000-8000-000000000002';
      sqlite.prepare(`
        INSERT INTO sessions (id, event_id, status, scene_id, scene_name, selfie_key, postcard_key)
        VALUES (?, 1, 'completed', 'subway', 'Subway', 'selfie-2.jpg', 'postcard-2.jpg')
      `).run(secondSessionId);
      const insert = sqlite.prepare(`
        INSERT INTO print_jobs (id, session_id, event_id, postcard_key, postcard_url, scene_name, created_at, claim_token, claim_owner)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
      `);
      insert.run('1'.repeat(32), sessionId, 'private-one', '/one', 'One', 10, 'a'.repeat(32), 'b'.repeat(64));
      insert.run('2'.repeat(32), sessionId, 'private-two', '/two', 'Two', 20, null, null);
      insert.run('3'.repeat(32), secondSessionId, 'private-three', '/three', 'Three', 30, null, null);

      const jobs = await loadAdminPrintJobs(database, sessionId);

      expect(jobs.map((job) => job.id)).toEqual(['2'.repeat(32), '1'.repeat(32)]);
      expect(jobs.every((job) => job.sessionId === sessionId)).toBe(true);
      expect(JSON.stringify(jobs)).not.toMatch(/private-|claim/);
    } finally {
      sqlite.close();
    }
  });

  it('fills disjoint claims and sorts domain results despite unordered SQLite RETURNING rows', async () => {
    const { sqlite, database, allResults } = await createDatabase();
    try {
      insertCompletedSession(sqlite);
      const insert = sqlite.prepare(`
        INSERT INTO print_jobs (id, session_id, event_id, postcard_key, postcard_url, scene_name, created_at)
        VALUES (?, ?, 1, 'postcard.jpg', ?, ?, ?)
      `);
      insert.run('00000000000000000000000000000004', sessionId, '/four', 'Four', 40);
      insert.run('00000000000000000000000000000003', sessionId, '/three', 'Three', 30);
      insert.run('00000000000000000000000000000002', sessionId, '/two', 'Two', 20);
      insert.run('00000000000000000000000000000001', sessionId, '/one', 'One', 10);

      const first = await claimPrintJobs(database, 'nyc-tech-week-2026', 'a'.repeat(64), 2);
      const second = await claimPrintJobs(database, 'nyc-tech-week-2026', 'b'.repeat(64), 2);

      expect(allResults.map((rows) => rows.map((row) => row.created_at))).toEqual([[20, 10], [40, 30]]);
      expect(first.map((job) => job.createdAt)).toEqual([10, 20]);
      expect(second.map((job) => job.createdAt)).toEqual([30, 40]);
      expect(first).toHaveLength(2);
      expect(second).toHaveLength(2);
      expect(first.some((job) => second.some((other) => other.id === job.id))).toBe(false);
      expect(first.every((job) => /^[0-9a-f]{32}$/.test(job.claimToken))).toBe(true);
      expect(new Set(first.map((job) => job.claimToken)).size).toBe(2);
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM print_jobs WHERE claim_owner IS NOT NULL").get()).toEqual({ count: 4 });
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM print_jobs WHERE status = 'pending'").get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('rejects admin retry for an active printing job', async () => {
    const { sqlite, database } = await createDatabase();
    try {
      insertCompletedSession(sqlite);
      const pending = await createAttendeePrintJob(database, 1, sessionId, attendeeRequestKey);
      const [firstClaim] = await claimPrintJobs(database, 'nyc-tech-week-2026', 'a'.repeat(64), 1);
      await expect(retryAdminPrintJob(database, sessionId, pending.id, retryRequestKey)).rejects.toBeInstanceOf(PrintJobConflictError);

      const printing = sqlite.prepare('SELECT status, claim_token FROM print_jobs WHERE id = ?').get(pending.id);
      expect(printing).toEqual({ status: 'printing', claim_token: firstClaim.claimToken });
    } finally {
      sqlite.close();
    }
  });

  it('retries failed jobs back to pending', async () => {
    const { sqlite, database } = await createDatabase();
    try {
      insertCompletedSession(sqlite);
      const pending = await createAttendeePrintJob(database, 1, sessionId, attendeeRequestKey);
      const [claim] = await claimPrintJobs(database, 'nyc-tech-week-2026', 'a'.repeat(64), 1);
      await acknowledgePrintJob(database, pending.id, { status: 'failed', error: 'paper jam', claimToken: claim.claimToken });

      await expect(retryAdminPrintJob(database, sessionId, pending.id, retryRequestKey)).resolves.toMatchObject({ status: 'pending' });
      expect(sqlite.prepare('SELECT status, claim_token, claim_owner, error_msg FROM print_jobs WHERE id = ?').get(pending.id))
        .toEqual({ status: 'pending', claim_token: null, claim_owner: null, error_msg: null });
    } finally {
      sqlite.close();
    }
  });

  it('accepts a repeated terminal acknowledgement after a successful response is lost', async () => {
    const { sqlite, database } = await createDatabase();
    try {
      insertCompletedSession(sqlite);
      const pending = await createAttendeePrintJob(database, 1, sessionId, attendeeRequestKey);
      const [claim] = await claimPrintJobs(database, 'nyc-tech-week-2026', 'a'.repeat(64), 1);

      const first = await acknowledgePrintJob(database, pending.id, { status: 'printed', claimToken: claim.claimToken });
      const repeated = await acknowledgePrintJob(database, pending.id, { status: 'printed', claimToken: claim.claimToken });

      expect(repeated).toEqual(first);
      expect(sqlite.prepare('SELECT status, claim_token, claim_owner, terminal_claim_token FROM print_jobs WHERE id = ?').get(pending.id))
        .toEqual({ status: 'printed', claim_token: null, claim_owner: null, terminal_claim_token: claim.claimToken });
    } finally {
      sqlite.close();
    }
  });

  it('releases the matching active claim and rejects stale release tokens', async () => {
    const { sqlite, database } = await createDatabase();
    try {
      insertCompletedSession(sqlite);
      const pending = await createAttendeePrintJob(database, 1, sessionId, attendeeRequestKey);
      const [firstClaim] = await claimPrintJobs(database, 'nyc-tech-week-2026', 'a'.repeat(64), 1);
      await releasePrintJob(database, pending.id, firstClaim.claimToken);
      expect(sqlite.prepare('SELECT status, claim_token, claim_owner FROM print_jobs WHERE id = ?').get(pending.id))
        .toEqual({ status: 'pending', claim_token: null, claim_owner: null });

      const [secondClaim] = await claimPrintJobs(database, 'nyc-tech-week-2026', 'a'.repeat(64), 1);
      await expect(releasePrintJob(database, pending.id, firstClaim.claimToken)).rejects.toBeInstanceOf(PrintJobConflictError);
      expect(sqlite.prepare('SELECT status, claim_token FROM print_jobs WHERE id = ?').get(pending.id))
        .toEqual({ status: 'printing', claim_token: secondClaim.claimToken });
    } finally {
      sqlite.close();
    }
  });

  it('releases only unknown active claims owned by the reconciling agent', async () => {
    const { sqlite, database } = await createDatabase();
    try {
      insertCompletedSession(sqlite);
      const insert = sqlite.prepare(`
        INSERT INTO print_jobs (id, session_id, event_id, postcard_key, postcard_url, scene_name, created_at)
        VALUES (?, ?, 1, 'postcard.jpg', ?, ?, ?)
      `);
      insert.run('1'.repeat(32), sessionId, '/one', 'One', 10);
      insert.run('2'.repeat(32), sessionId, '/two', 'Two', 20);
      insert.run('3'.repeat(32), sessionId, '/three', 'Three', 30);
      const owner = 'a'.repeat(64);
      const otherOwner = 'b'.repeat(64);
      const owned = await claimPrintJobs(database, 'nyc-tech-week-2026', owner, 2);
      const [other] = await claimPrintJobs(database, 'nyc-tech-week-2026', otherOwner, 1);

      const result = await reconcilePrintJobs(database, owner, [{ id: owned[1]!.id, claimToken: owned[1]!.claimToken }]);

      expect(result).toEqual({ released: 1 });
      expect(sqlite.prepare('SELECT status, claim_token, claim_owner FROM print_jobs WHERE id = ?').get(owned[0]!.id))
        .toEqual({ status: 'pending', claim_token: null, claim_owner: null });
      expect(sqlite.prepare('SELECT status, claim_token, claim_owner FROM print_jobs WHERE id = ?').get(owned[1]!.id))
        .toEqual({ status: 'printing', claim_token: owned[1]!.claimToken, claim_owner: owner });
      expect(sqlite.prepare('SELECT status, claim_token, claim_owner FROM print_jobs WHERE id = ?').get(other.id))
        .toEqual({ status: 'printing', claim_token: other.claimToken, claim_owner: otherOwner });
    } finally {
      sqlite.close();
    }
  });

  it('adds claim tracking columns without constraining imported statuses', async () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      for (const migrationUrl of migrationUrls.slice(0, -1)) sqlite.exec(await readFile(migrationUrl, 'utf8'));
      insertCompletedSession(sqlite);
      sqlite.prepare(`
        INSERT INTO print_jobs (id, session_id, event_id, postcard_key, postcard_url, scene_name, status)
        VALUES ('legacy', ?, 1, 'postcard.jpg', '/legacy', 'Legacy', 'imported')
      `).run(sessionId);

      sqlite.exec(await readFile(migrationUrls.at(-1)!, 'utf8'));

      expect(sqlite.prepare("SELECT status, claim_token, terminal_claim_token, claim_owner FROM print_jobs WHERE id = 'legacy'").get())
        .toEqual({ status: 'imported', claim_token: null, terminal_claim_token: null, claim_owner: null });
      expect(sqlite.prepare("SELECT name FROM pragma_index_list('print_jobs') WHERE name = 'print_jobs_session_status_idx'").get())
        .toEqual({ name: 'print_jobs_session_status_idx' });
      expect(sqlite.prepare("SELECT name FROM pragma_index_list('print_jobs') WHERE name = 'print_jobs_claim_owner_status_idx'").get())
        .toEqual({ name: 'print_jobs_claim_owner_status_idx' });
    } finally {
      sqlite.close();
    }
  });
});
