import { describe, expect, it, vi } from 'vitest';
import {
  acknowledgePrintJob,
  claimPrintJobs,
  createAttendeePrintJob,
  loadAttendeePrintJob,
  PrintJobConflictError,
  PrintJobNotFoundError,
  queueAdminPrintJob,
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
  it('atomically creates an attendee job only for an owned completed session and returns no private key', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, row);
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    const job = await createAttendeePrintJob(database, 7, row.session_id);

    expect(statements).toHaveLength(1);
    expect(statements[0].query).toMatch(/INSERT INTO print_jobs[\s\S]*SELECT[\s\S]*FROM sessions s[\s\S]*s\.event_id = \?[\s\S]*s\.status = 'completed'[\s\S]*s\.postcard_key IS NOT NULL[\s\S]*NOT EXISTS/);
    expect(statements[0].query).toContain("pj.status IN ('pending', 'printing', 'printed')");
    expect(statements[0].query).toContain('RETURNING');
    expect(statements[0].values).toContain(row.postcard_url);
    expect(job).not.toHaveProperty('postcardKey');
    expect(job).toEqual({ id: row.id, status: 'pending', printedAt: null });
  });

  it('returns the existing active attendee job when the atomic insert loses the race', async () => {
    let call = 0;
    const database = {
      prepare() {
        call += 1;
        return statement('', call === 1 ? null : { ...row, status: 'printing' });
      },
    } as unknown as D1Database;

    await expect(createAttendeePrintJob(database, 7, row.session_id)).resolves.toEqual({
      id: row.id,
      status: 'printing',
      printedAt: null,
    });
  });

  it('reasserts session ownership and postcard eligibility before returning a deduplicated job', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, statements.length === 0 ? null : row);
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    await createAttendeePrintJob(database, 7, row.session_id);

    expect(statements[1].query).toContain('INNER JOIN sessions s ON s.id = pj.session_id');
    expect(statements[1].query).toContain('s.event_id = ?');
    expect(statements[1].query).toContain("s.status = 'completed'");
    expect(statements[1].query).toContain('s.postcard_key IS NOT NULL');
    expect(statements[1].query).toContain("s.postcard_key <> ''");
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

  it('does not return a job for an incomplete or postcard-less session', async () => {
    const database = {
      prepare() {
        return statement('', null);
      },
    } as unknown as D1Database;

    await expect(createAttendeePrintJob(database, 7, row.session_id)).rejects.toBeInstanceOf(PrintJobNotFoundError);
  });

  it('queues reprints while preserving printed and failed history', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, row);
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    await queueAdminPrintJob(database, row.session_id);

    expect(statements[0].query).toContain("pj.status IN ('pending', 'printing')");
    expect(statements[0].query).not.toContain("'printed')");
  });

  it('selects and transitions event-scoped pending jobs in one update statement', async () => {
    const claimed = [row, { ...row, id: 'fedcba9876543210fedcba9876543210', created_at: 101 }];
    const prepared: Array<ReturnType<typeof statement>> = [];
    const database = {
      prepare(query: string) {
        const value = statement(query, { results: claimed });
        prepared.push(value);
        return value;
      },
    } as unknown as D1Database;

    const jobs = await claimPrintJobs(database, 'demo-event', 2);

    expect(prepared).toHaveLength(1);
    expect(prepared[0].query).toMatch(/UPDATE print_jobs[\s\S]*WHERE id IN \([\s\S]*SELECT pj\.id[\s\S]*INNER JOIN events e ON e\.id = pj\.event_id[\s\S]*pj\.status = 'pending'[\s\S]*e\.slug = \?[\s\S]*ORDER BY pj\.created_at ASC, pj\.id ASC[\s\S]*LIMIT \?[\s\S]*\)[\s\S]*AND status = 'pending'[\s\S]*RETURNING/);
    expect(prepared[0].values).toEqual(['demo-event', 2]);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ id: claimed[0].id, eventSlug: 'demo-event', sceneName: 'Brooklyn Bridge' });
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

    const job = await acknowledgePrintJob(database, row.id, { status: 'printed' });

    expect(statements[0].query).toContain("WHERE id = ? AND status = 'printing'");
    expect(statements[0].query).toContain('printed_at = unixepoch()');
    expect(statements[0].query).toContain('error_msg = NULL');
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

    const job = await acknowledgePrintJob(database, row.id, { status: 'failed', error: 'Paper jam' });

    expect(statements[0].query).toContain("SET status = 'failed', printed_at = NULL, error_msg = ?");
    expect(statements[0].values).toEqual(['Paper jam', row.id]);
    expect(job).toMatchObject({ status: 'failed', printedAt: null, error: 'Paper jam' });
    expect(job).not.toHaveProperty('postcardKey');
  });

  it('retries only failed or explicitly selected printing jobs for the requested session', async () => {
    const statements: ReturnType<typeof statement>[] = [];
    const database = {
      prepare(query: string) {
        const prepared = statement(query, row);
        statements.push(prepared);
        return prepared;
      },
    } as unknown as D1Database;

    await retryAdminPrintJob(database, row.session_id, row.id);

    expect(statements[0].query).toContain('session_id = ?');
    expect(statements[0].query).toContain("status IN ('failed', 'printing')");
    expect(statements[0].query).toContain("active.status IN ('pending', 'printing')");
    expect(statements[0].query).toContain('active.id <> print_jobs.id');
    expect(statements[0].query).toContain("status = 'pending'");
    expect(statements[0].query).toContain('printed_at = NULL');
    expect(statements[0].query).toContain('error_msg = NULL');
  });

  it('reports an admin queue conflict when an active job blocks insertion', async () => {
    let call = 0;
    const database = {
      prepare() {
        call += 1;
        return statement('', call === 1 ? null : { id: row.id });
      },
    } as unknown as D1Database;

    await expect(queueAdminPrintJob(database, row.session_id)).rejects.toMatchObject({
      name: 'PrintJobConflictError',
      message: 'This session already has an active print job.',
    });
  });

  it('reports an admin retry conflict for an ineligible existing job', async () => {
    let call = 0;
    const database = {
      prepare() {
        call += 1;
        return statement('', call === 1 ? null : { id: row.id });
      },
    } as unknown as D1Database;

    await expect(retryAdminPrintJob(database, row.session_id, row.id)).rejects.toBeInstanceOf(PrintJobConflictError);
  });
});
