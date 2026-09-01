import { describe, expect, it } from 'vitest';
import { claimPrintJobs, createAttendeePrintJob, loadAttendeePrintJob, PrintJobNotFoundError } from '../src/db/print-jobs';

type SessionState = {
  id: string;
  eventId: number;
  status: string;
  postcardKey: string | null;
  sceneName: string;
};

type JobState = {
  id: string;
  session_id: string;
  event_id: number;
  postcard_key: string;
  postcard_url: string;
  scene_name: string;
  status: 'pending' | 'printing' | 'printed' | 'failed';
  created_at: number;
  printed_at: number | null;
  error_msg: string | null;
};

class StatefulStatement {
  values: unknown[] = [];

  constructor(private readonly database: StatefulD1, readonly query: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return this.database.first(this) as T | null;
  }

  async all<T>() {
    return { results: this.database.all(this) as T[], success: true, meta: {} };
  }
}

class StatefulD1 {
  readonly sessions = new Map<string, SessionState>();
  readonly eventSlugs = new Map<number, string>();
  readonly jobs: JobState[] = [];
  private nextId = 1;

  prepare(query: string) {
    return new StatefulStatement(this, query);
  }

  first(statement: StatefulStatement) {
    const normalized = statement.query.replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('INSERT INTO print_jobs')) return this.insert(statement);
    if (normalized.includes('FROM print_jobs pj') && normalized.includes('INNER JOIN sessions s')) {
      const [sessionId, eventId] = statement.values as [string, number];
      const session = this.sessions.get(sessionId);
      if (!session || session.eventId !== eventId || session.status !== 'completed' || !session.postcardKey) return null;
      return this.jobs
        .filter((job) => job.session_id === sessionId && job.event_id === eventId && ['pending', 'printing', 'printed'].includes(job.status))
        .sort((left, right) => right.created_at - left.created_at || right.id.localeCompare(left.id))[0] ?? null;
    }
    if (normalized.includes('WHERE id = ? AND session_id = ? AND event_id = ?')) {
      const [jobId, sessionId, eventId] = statement.values as [string, string, number];
      return this.jobs.find((job) => job.id === jobId && job.session_id === sessionId && job.event_id === eventId) ?? null;
    }
    return null;
  }

  all(statement: StatefulStatement) {
    const normalized = statement.query.replace(/\s+/g, ' ').trim();
    if (!normalized.startsWith('UPDATE print_jobs') || !normalized.includes('INNER JOIN events e')) return [];
    const [eventSlug, limit] = statement.values as [string, number];
    const claimed = this.jobs
      .filter((job) => job.status === 'pending' && this.eventSlugs.get(job.event_id) === eventSlug)
      .sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id))
      .slice(0, limit);
    for (const job of claimed) {
      job.status = 'printing';
      job.printed_at = null;
      job.error_msg = null;
    }
    return claimed.map((job) => ({ ...job }));
  }

  private insert(statement: StatefulStatement) {
    const [postcardUrl, sessionId, eventId] = statement.values as [string, string, number];
    const session = this.sessions.get(sessionId);
    if (!session || session.eventId !== eventId || session.status !== 'completed' || !session.postcardKey) return null;
    const blocked = this.jobs.some((job) => (
      job.session_id === sessionId
      && job.event_id === eventId
      && ['pending', 'printing', 'printed'].includes(job.status)
    ));
    if (blocked) return null;
    const job: JobState = {
      id: String(this.nextId++).padStart(32, '0'),
      session_id: sessionId,
      event_id: eventId,
      postcard_key: session.postcardKey,
      postcard_url: postcardUrl,
      scene_name: session.sceneName,
      status: 'pending',
      created_at: this.nextId,
      printed_at: null,
      error_msg: null,
    };
    this.jobs.push(job);
    return job;
  }
}

const sessionId = '00000000-0000-4000-8000-000000000001';

function databaseWithCompletedSession() {
  const database = new StatefulD1();
  database.eventSlugs.set(7, 'demo-event');
  database.eventSlugs.set(8, 'other-event');
  database.sessions.set(sessionId, {
    id: sessionId,
    eventId: 7,
    status: 'completed',
    postcardKey: `sessions/${sessionId}/postcard.jpg`,
    sceneName: 'Brooklyn Bridge',
  });
  return database;
}

describe('print job conditional behavior', () => {
  it('deduplicates competing attendee creation calls', async () => {
    const database = databaseWithCompletedSession();

    const [first, second] = await Promise.all([
      createAttendeePrintJob(database as unknown as D1Database, 7, sessionId),
      createAttendeePrintJob(database as unknown as D1Database, 7, sessionId),
    ]);

    expect(database.jobs).toHaveLength(1);
    expect(first.id).toBe(second.id);
    expect(JSON.stringify([first, second])).not.toContain('postcard.jpg');
  });

  it.each([
    ['incomplete', 'generating', `sessions/${sessionId}/postcard.jpg`],
    ['postcard-less', 'completed', null],
    ['wrong event', 'completed', `sessions/${sessionId}/postcard.jpg`],
  ])('does not create for an %s session', async (_name, status, postcardKey) => {
    const database = databaseWithCompletedSession();
    const session = database.sessions.get(sessionId)!;
    session.status = status;
    session.postcardKey = postcardKey;
    const eventId = _name === 'wrong event' ? 8 : 7;

    await expect(createAttendeePrintJob(database as unknown as D1Database, eventId, sessionId))
      .rejects.toBeInstanceOf(PrintJobNotFoundError);
    expect(database.jobs).toHaveLength(0);
  });

  it('fills competing claims with disjoint, oldest, event-scoped jobs', async () => {
    const database = databaseWithCompletedSession();
    database.jobs.push(
      { id: '00000000000000000000000000000002', session_id: sessionId, event_id: 7, postcard_key: 'private-2', postcard_url: '/two', scene_name: 'Two', status: 'pending', created_at: 20, printed_at: null, error_msg: null },
      { id: '00000000000000000000000000000001', session_id: sessionId, event_id: 7, postcard_key: 'private-1', postcard_url: '/one', scene_name: 'One', status: 'pending', created_at: 10, printed_at: null, error_msg: null },
      { id: '00000000000000000000000000000003', session_id: sessionId, event_id: 8, postcard_key: 'private-3', postcard_url: '/three', scene_name: 'Three', status: 'pending', created_at: 5, printed_at: null, error_msg: null },
      { id: '00000000000000000000000000000004', session_id: sessionId, event_id: 7, postcard_key: 'private-4', postcard_url: '/four', scene_name: 'Four', status: 'pending', created_at: 30, printed_at: null, error_msg: null },
      { id: '00000000000000000000000000000005', session_id: sessionId, event_id: 7, postcard_key: 'private-5', postcard_url: '/five', scene_name: 'Five', status: 'pending', created_at: 40, printed_at: null, error_msg: null },
    );

    const claims = await Promise.all([
      claimPrintJobs(database as unknown as D1Database, 'demo-event', 2),
      claimPrintJobs(database as unknown as D1Database, 'demo-event', 2),
    ]);
    const claimed = claims.flat();

    expect(claims.map((claim) => claim.length)).toEqual([2, 2]);
    expect(claims[0].some((job) => claims[1].some((other) => other.id === job.id))).toBe(false);
    expect(new Set(claimed.map((job) => job.id))).toEqual(new Set([
      '00000000000000000000000000000001',
      '00000000000000000000000000000002',
      '00000000000000000000000000000004',
      '00000000000000000000000000000005',
    ]));
    expect(database.jobs.find((job) => job.event_id === 8)?.status).toBe('pending');
    expect(JSON.stringify(claimed)).not.toMatch(/postcard_key|private-/);
  });

  it('isolates attendee status by the complete event, session, and job tuple', async () => {
    const database = databaseWithCompletedSession();
    const created = await createAttendeePrintJob(database as unknown as D1Database, 7, sessionId);

    await expect(loadAttendeePrintJob(database as unknown as D1Database, 8, sessionId, created.id))
      .rejects.toBeInstanceOf(PrintJobNotFoundError);
    await expect(loadAttendeePrintJob(database as unknown as D1Database, 7, '00000000-0000-4000-8000-000000000002', created.id))
      .rejects.toBeInstanceOf(PrintJobNotFoundError);
    await expect(loadAttendeePrintJob(database as unknown as D1Database, 7, sessionId, 'ffffffffffffffffffffffffffffffff'))
      .rejects.toBeInstanceOf(PrintJobNotFoundError);
  });
});
