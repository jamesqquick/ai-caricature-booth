import { readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { acknowledgePrintJob, claimPrintJobs, createAttendeePrintJob, PrintJobConflictError, retryAdminPrintJob } from '../src/db/print-jobs';

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

function insertCompletedSession(sqlite: DatabaseSync) {
  sqlite.prepare(`
    INSERT INTO sessions (id, event_id, status, scene_id, scene_name, selfie_key, postcard_key)
    VALUES (?, 1, 'completed', 'brooklyn-bridge', 'Brooklyn Bridge', 'selfie.jpg', 'postcard.jpg')
  `).run(sessionId);
}

describe('print job SQLite integration', () => {
  it('deduplicates concurrent attendee creation through the production insert SQL', async () => {
    const { sqlite, database } = await createDatabase();
    try {
      insertCompletedSession(sqlite);

      const jobs = await Promise.all([
        createAttendeePrintJob(database, 1, sessionId),
        createAttendeePrintJob(database, 1, sessionId),
      ]);

      expect(jobs[0].id).toBe(jobs[1].id);
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM print_jobs').get()).toEqual({ count: 1 });
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

      const first = await claimPrintJobs(database, 'nyc-tech-week-2026', 2);
      const second = await claimPrintJobs(database, 'nyc-tech-week-2026', 2);

      expect(allResults.map((rows) => rows.map((row) => row.created_at))).toEqual([[20, 10], [40, 30]]);
      expect(first.map((job) => job.createdAt)).toEqual([10, 20]);
      expect(second.map((job) => job.createdAt)).toEqual([30, 40]);
      expect(first).toHaveLength(2);
      expect(second).toHaveLength(2);
      expect(first.some((job) => second.some((other) => other.id === job.id))).toBe(false);
      expect(first.every((job) => /^[0-9a-f]{32}$/.test(job.claimToken))).toBe(true);
      expect(new Set(first.map((job) => job.claimToken)).size).toBe(2);
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM print_jobs WHERE status = 'pending'").get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('rejects a stale acknowledgement after an admin retry and reclaim', async () => {
    const { sqlite, database } = await createDatabase();
    try {
      insertCompletedSession(sqlite);
      const pending = await createAttendeePrintJob(database, 1, sessionId);
      const [firstClaim] = await claimPrintJobs(database, 'nyc-tech-week-2026', 1);
      await retryAdminPrintJob(database, sessionId, pending.id);
      const [secondClaim] = await claimPrintJobs(database, 'nyc-tech-week-2026', 1);

      expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);
      await expect(acknowledgePrintJob(database, pending.id, {
        status: 'printed',
        claimToken: firstClaim.claimToken,
      })).rejects.toBeInstanceOf(PrintJobConflictError);

      const printing = sqlite.prepare('SELECT status, claim_token FROM print_jobs WHERE id = ?').get(pending.id);
      expect(printing).toEqual({ status: 'printing', claim_token: secondClaim.claimToken });

      await acknowledgePrintJob(database, pending.id, { status: 'printed', claimToken: secondClaim.claimToken });
      expect(sqlite.prepare('SELECT status, claim_token FROM print_jobs WHERE id = ?').get(pending.id))
        .toEqual({ status: 'printed', claim_token: null });
    } finally {
      sqlite.close();
    }
  });

  it('adds the claim token column and session/status index without constraining imported statuses', async () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      for (const migrationUrl of migrationUrls.slice(0, -1)) sqlite.exec(await readFile(migrationUrl, 'utf8'));
      insertCompletedSession(sqlite);
      sqlite.prepare(`
        INSERT INTO print_jobs (id, session_id, event_id, postcard_key, postcard_url, scene_name, status)
        VALUES ('legacy', ?, 1, 'postcard.jpg', '/legacy', 'Legacy', 'imported')
      `).run(sessionId);

      sqlite.exec(await readFile(migrationUrls.at(-1)!, 'utf8'));

      expect(sqlite.prepare("SELECT status, claim_token FROM print_jobs WHERE id = 'legacy'").get())
        .toEqual({ status: 'imported', claim_token: null });
      expect(sqlite.prepare("SELECT name FROM pragma_index_list('print_jobs') WHERE name = 'print_jobs_session_status_idx'").get())
        .toEqual({ name: 'print_jobs_session_status_idx' });
    } finally {
      sqlite.close();
    }
  });
});
