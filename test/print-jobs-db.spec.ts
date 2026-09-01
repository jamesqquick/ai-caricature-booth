import { describe, expect, it, vi } from 'vitest';
import {
  acknowledgePrintJob,
  claimPrintJobs,
  createAttendeePrintJob,
  loadAdminPrintJobs,
  loadAttendeePrintJob,
  PrintJobConflictError,
  PrintJobNotFoundError,
  queueAdminPrintJob,
  releasePrintJob,
  parseAdminMutation,
  retryAdminPrintJob,
} from '../src/db/print-jobs';

const row = {
  id: '0123456789abcdef0123456789abcdef',
  session_id: '00000000-0000-4000-8000-000000000001',
  event_id: 7,
  event_slug: 'demo-event',
  postcard_url: '/api/events/7/sessions/00000000-0000-4000-8000-000000000001/postcard',
  scene_name: 'Brooklyn Bridge',
  status: 'pending',
  created_at: 100,
  printed_at: null,
  error_msg: null,
  claim_token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

function statement(query: string, result: unknown) {
  return {
    query,
    values: [] as unknown[],
    bind(...values: unknown[]) {
      this.values = values;
      return this;
    },
    first: vi.fn().mockResolvedValue(result),
    all: vi.fn().mockResolvedValue(result),
  };
}

describe('print job data layer', () => {
  const requestKey = '10000000-0000-4000-8000-000000000001';

  it('atomically creates an attendee job only for an owned completed session and returns no private key', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, statements.length === 0 ? null : row);
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    const job = await createAttendeePrintJob(database, 7, row.session_id, requestKey);

    expect(statements).toHaveLength(2);
    expect(statements[1].query).toMatch(/INSERT INTO print_jobs[\s\S]*SELECT[\s\S]*FROM sessions s[\s\S]*s\.event_id = \?[\s\S]*s\.status = 'completed'[\s\S]*s\.postcard_key IS NOT NULL[\s\S]*NOT EXISTS/);
    expect(statements[1].query).toContain("pj.status IN ('pending', 'printing', 'printed')");
    expect(statements[1].query).toContain('RETURNING');
    expect(statements[1].values).toContain(row.postcard_url);
    expect(job).not.toHaveProperty('postcardKey');
    expect(job).toEqual({ id: row.id, status: 'pending', printedAt: null });
  });

  it('returns the existing active attendee job when the atomic insert loses the race', async () => {
    let call = 0;
    const database = {
      prepare() {
        call += 1;
        return statement('', call < 3 ? null : { ...row, status: 'printing' });
      },
    } as unknown as D1Database;

    await expect(createAttendeePrintJob(database, 7, row.session_id, requestKey)).resolves.toEqual({
      id: row.id,
      status: 'printing',
      printedAt: null,
    });
  });

  it('reasserts session ownership and postcard eligibility before returning a deduplicated job', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, statements.length < 2 ? null : row);
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    await createAttendeePrintJob(database, 7, row.session_id, requestKey);

    expect(statements[2].query).toContain('INNER JOIN sessions s ON s.id = pj.session_id');
    expect(statements[2].query).toContain('s.event_id = ?');
    expect(statements[2].query).toContain("s.status = 'completed'");
    expect(statements[2].query).toContain('s.postcard_key IS NOT NULL');
    expect(statements[2].query).toContain("s.postcard_key <> ''");
  });

  it('scopes attendee status reads to the event, session, and job without exposing raw keys', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, row);
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    const job = await loadAttendeePrintJob(database, 7, row.session_id, row.id);

    expect(statements[0].query).toContain('id = ? AND session_id = ? AND event_id = ?');
    expect(statements[0].values).toEqual([row.id, row.session_id, 7]);
    expect(JSON.stringify(job)).not.toMatch(/postcard_key|postcardKey|sessions\//);
  });

  it('lists session-scoped admin jobs newest first without private fields', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const older = { ...row, id: '00000000000000000000000000000001', created_at: 90 };
    const newer = { ...row, id: 'ffffffffffffffffffffffffffffffff', created_at: 110 };
    const database = {
      prepare(query: string) {
        const prepared = statement(query, { results: [newer, older] });
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    const jobs = await loadAdminPrintJobs(database, row.session_id);

    expect(statements[0].query).toContain('WHERE session_id = ?');
    expect(statements[0].query).toContain('ORDER BY created_at DESC, id DESC');
    expect(statements[0].query).not.toMatch(/claim_token|claim_owner|terminal_claim_token|postcard_key/);
    expect(statements[0].values).toEqual([row.session_id]);
    expect(jobs.map((job) => job.id)).toEqual([newer.id, older.id]);
    expect(jobs[0]).toEqual({
      id: newer.id,
      status: 'pending',
      printedAt: null,
      sessionId: row.session_id,
      eventId: 7,
      sceneName: 'Brooklyn Bridge',
      postcardUrl: row.postcard_url,
      createdAt: 110,
      error: null,
    });
    expect(JSON.stringify(jobs)).not.toMatch(/claim|postcard_key|must-not-leak/);
  });

  it('does not return a job for an incomplete or postcard-less session', async () => {
    const database = {
      prepare() {
        return statement('', null);
      },
    } as unknown as D1Database;

    await expect(createAttendeePrintJob(database, 7, row.session_id, requestKey)).rejects.toBeInstanceOf(PrintJobNotFoundError);
  });

  it('queues reprints while preserving printed and failed history', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, statements.length === 0 ? null : row);
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    const job = await queueAdminPrintJob(database, row.session_id, requestKey);

    expect(statements[0].query).toContain('request_key = ?');
    expect(statements[1].query).toContain('request_key');
    expect(statements[1].query).toContain("pj.status IN ('pending', 'printing')");
    expect(statements[1].query).not.toContain("'printed')");
    expect(job).not.toHaveProperty('claimToken');
  });

  it('requires UUID idempotency keys for admin mutations', () => {
    expect(parseAdminMutation({ action: 'queue', idempotencyKey: '10000000-0000-4000-8000-000000000001' })).toEqual({
      action: 'queue',
      idempotencyKey: '10000000-0000-4000-8000-000000000001',
    });
    expect(() => parseAdminMutation({ action: 'queue', idempotencyKey: 'not-a-uuid' })).toThrow(/idempotencyKey/);
  });

  it('selects and transitions event-scoped pending jobs in one update statement', async () => {
    const newer = { ...row, id: 'fedcba9876543210fedcba9876543210', created_at: 101 };
    const sameTime = { ...row, id: 'abcdef0123456789abcdef0123456789' };
    const claimed = [newer, sameTime, row];
    const prepared: Array<ReturnType<typeof statement>> = [];
    const database = {
      prepare(query: string) {
        const value = statement(query, { results: claimed });
        prepared.push(value);
        return value;
      },
    } as unknown as D1Database;

    const agentId = 'a'.repeat(64);
    const jobs = await claimPrintJobs(database, 'demo-event', agentId, 3);

    expect(prepared).toHaveLength(1);
    expect(prepared[0].query).toMatch(/UPDATE print_jobs[\s\S]*WHERE id IN \([\s\S]*SELECT pj\.id[\s\S]*INNER JOIN events e ON e\.id = pj\.event_id[\s\S]*pj\.status = 'pending'[\s\S]*e\.slug = \?[\s\S]*ORDER BY pj\.created_at ASC, pj\.id ASC[\s\S]*LIMIT \?[\s\S]*\)[\s\S]*AND status = 'pending'[\s\S]*RETURNING/);
    expect(prepared[0].values).toEqual([agentId, 'demo-event', 3]);
    expect(jobs).toHaveLength(3);
    expect(jobs.map((job) => job.id)).toEqual([row.id, sameTime.id, newer.id]);
    expect(jobs[0]).toMatchObject({ eventSlug: 'demo-event', sceneName: 'Brooklyn Bridge', claimToken: row.claim_token });
    expect(prepared[0].query).toContain("claim_token = lower(hex(randomblob(16)))");
    expect(prepared[0].query).toContain('claim_owner = ?');
  });

  it('only acknowledges printing jobs and applies terminal fields safely', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, { ...row, status: 'printed', printed_at: 200 });
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    const job = await acknowledgePrintJob(database, row.id, { status: 'printed', claimToken: row.claim_token });

    expect(statements[0].query).toContain("WHERE id = ? AND status = 'printing' AND claim_token = ?");
    expect(statements[0].query).toContain('printed_at = unixepoch()');
    expect(statements[0].query).toContain('error_msg = NULL');
    expect(statements[0].query).toContain('claim_token = NULL');
    expect(statements[0].values).toEqual([row.id, row.claim_token]);
    expect(job).toMatchObject({ status: 'printed', printedAt: 200, error: null });
    expect(job).not.toHaveProperty('postcardKey');
  });

  it('records failed acknowledgement errors and clears printed timestamps', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, { ...row, status: 'failed', error_msg: 'Paper jam' });
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    const job = await acknowledgePrintJob(database, row.id, { status: 'failed', error: 'Paper jam', claimToken: row.claim_token });

    expect(statements[0].query).toContain("SET status = 'failed', printed_at = NULL, error_msg = ?");
    expect(statements[0].query).toContain('claim_token = NULL, claim_owner = NULL, terminal_claim_token = claim_token');
    expect(statements[0].values).toEqual(['Paper jam', row.id, row.claim_token]);
    expect(job).toMatchObject({ status: 'failed', printedAt: null, error: 'Paper jam' });
    expect(job).not.toHaveProperty('postcardKey');
  });

  it('returns an already-applied terminal acknowledgement for the same token without another mutation', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    let call = 0;
    const terminal = { ...row, status: 'printed', printed_at: 200, claim_token: null, terminal_claim_token: row.claim_token };
    const database = {
      prepare(query: string) {
        call += 1;
        const prepared = statement(query, call === 1 ? null : terminal);
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    await expect(acknowledgePrintJob(database, row.id, { status: 'printed', claimToken: row.claim_token }))
      .resolves.toMatchObject({ id: row.id, status: 'printed', printedAt: 200 });
    expect(statements).toHaveLength(2);
    expect(statements[1].query).toContain('status = ? AND terminal_claim_token = ?');
    expect(statements[1].values).toEqual([row.id, 'printed', row.claim_token]);
  });

  it('releases only the matching active claim back to pending', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, { ...row, status: 'pending', claim_token: null });
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    await expect(releasePrintJob(database, row.id, row.claim_token)).resolves.toMatchObject({ status: 'pending' });
    expect(statements[0].query).toContain("SET status = 'pending', claim_token = NULL");
    expect(statements[0].query).toContain("WHERE id = ? AND status = 'printing' AND claim_token = ?");
    expect(statements[0].values).toEqual([row.id, row.claim_token]);
  });

  it('retries only failed jobs for the requested session', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, statements.length === 0 ? null : row);
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    const job = await retryAdminPrintJob(database, row.session_id, row.id, requestKey);

    expect(statements[1].query).toContain('session_id = ?');
    expect(statements[1].query).toContain("status = 'failed'");
    expect(statements[1].query).not.toContain("status IN ('failed', 'printing')");
    expect(statements[1].query).toContain("active.status IN ('pending', 'printing')");
    expect(statements[1].query).toContain('active.id <> print_jobs.id');
    expect(statements[1].query).toContain("status = 'pending'");
    expect(statements[1].query).toContain('printed_at = NULL');
    expect(statements[1].query).toContain('error_msg = NULL');
    expect(statements[1].query).toContain('claim_token = NULL');
    expect(job).not.toHaveProperty('claimToken');
  });

  it('reports an admin queue conflict when an active job blocks insertion', async () => {
    let call = 0;
    const database = {
      prepare() {
        call += 1;
        return statement('', call === 4 ? { id: row.id } : null);
      },
    } as unknown as D1Database;

    await expect(queueAdminPrintJob(database, row.session_id, '10000000-0000-4000-8000-000000000001')).rejects.toMatchObject({
      name: 'PrintJobConflictError',
      message: 'This session already has an active print job.',
    });
  });

  it('reports an admin retry conflict for an ineligible existing job', async () => {
    let call = 0;
    const database = {
      prepare() {
        call += 1;
        return statement('', call === 4 ? { id: row.id } : null);
      },
    } as unknown as D1Database;

    await expect(retryAdminPrintJob(database, row.session_id, row.id, requestKey)).rejects.toBeInstanceOf(PrintJobConflictError);
  });
});
