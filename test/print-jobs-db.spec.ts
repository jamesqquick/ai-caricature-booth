import { describe, expect, it, vi } from 'vitest';
import {
  acknowledgePrintJob,
  claimPrintJobs,
  createAttendeePrintJob,
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

  it('claims only rows won by conditional pending updates in one D1 batch', async () => {
    const candidates = [row, { ...row, id: 'fedcba9876543210fedcba9876543210', created_at: 101 }];
    const prepared: Array<ReturnType<typeof statement>> = [];
    const database = {
      prepare(query: string) {
        const result = query.includes('FROM print_jobs pj') ? { results: candidates } : { results: [] };
        const value = statement(query, result);
        prepared.push(value);
        return value;
      },
      batch: vi.fn().mockResolvedValue([
        { results: [{ id: candidates[0].id }] },
        { results: [] },
      ]),
    } as unknown as D1Database;

    const jobs = await claimPrintJobs(database, 'demo-event', 2);

    expect(database.batch).toHaveBeenCalledOnce();
    expect(prepared.slice(1).every((item) => item.query.includes("WHERE id = ? AND status = 'pending'"))).toBe(true);
    expect(prepared.slice(1).every((item) => item.query.includes('RETURNING id'))).toBe(true);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: candidates[0].id, eventSlug: 'demo-event', sceneName: 'Brooklyn Bridge' });
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

    await acknowledgePrintJob(database, row.id, { status: 'printed' });

    expect(statements[0].query).toContain("WHERE id = ? AND status = 'printing'");
    expect(statements[0].query).toContain('printed_at = unixepoch()');
    expect(statements[0].query).toContain('error_msg = NULL');
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
});
