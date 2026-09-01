import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeEnv = vi.hoisted(() => ({ DB: {} }));
const createAttendeePrintJob = vi.hoisted(() => vi.fn());
const loadAttendeePrintJob = vi.hoisted(() => vi.fn());
const loadAdminPrintJobs = vi.hoisted(() => vi.fn());
const claimPrintJobs = vi.hoisted(() => vi.fn());
const reconcilePrintJobs = vi.hoisted(() => vi.fn());
const acknowledgePrintJob = vi.hoisted(() => vi.fn());
const releasePrintJob = vi.hoisted(() => vi.fn());
const queueAdminPrintJob = vi.hoisted(() => vi.fn());
const retryAdminPrintJob = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/print-jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/db/print-jobs')>(),
  createAttendeePrintJob,
  loadAttendeePrintJob,
  loadAdminPrintJobs,
  claimPrintJobs,
  reconcilePrintJobs,
  acknowledgePrintJob,
  releasePrintJob,
  queueAdminPrintJob,
  retryAdminPrintJob,
}));

import { POST as createJob } from '../src/pages/api/events/[eventId]/sessions/[sessionId]/print-jobs';
import { GET as getJob } from '../src/pages/api/events/[eventId]/sessions/[sessionId]/print-jobs/[jobId]';
import { POST as claimJobs } from '../src/pages/api/print-agent/jobs/claim';
import { POST as reconcileJobs } from '../src/pages/api/print-agent/jobs/reconcile';
import { POST as acknowledgeJob } from '../src/pages/api/print-agent/jobs/[jobId]/ack';
import { POST as releaseJob } from '../src/pages/api/print-agent/jobs/[jobId]/release';
import { GET as getAdminJobs, POST as mutateAdminJob } from '../src/pages/api/admin/sessions/[sessionId]/print-jobs';
import { PrintJobConflictError, PrintJobNotFoundError } from '../src/db/print-jobs';

const sessionId = '00000000-0000-4000-8000-000000000001';
const jobId = '0123456789abcdef0123456789abcdef';
const claimToken = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const agentId = 'b'.repeat(64);
const publicJob = { id: jobId, status: 'pending', printedAt: null };
const idempotencyKey = '10000000-0000-4000-8000-000000000001';

function attendeeRequest(headers: HeadersInit = {}) {
  return new Request('https://booth.test/api/events/7/sessions/x/print-jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ idempotencyKey }),
  });
}

function adminRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request('https://booth.test/api/admin/sessions/x/print-jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('print job APIs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates event identifiers and never calls the database for invalid input', async () => {
    const response = await createJob({ params: { eventId: '7x', sessionId: 'not-a-uuid' }, request: attendeeRequest() });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid eventId.', field: 'eventId' });
    expect(createAttendeePrintJob).not.toHaveBeenCalled();
  });

  it('rejects invalid session and job identifiers', async () => {
    const invalidSession = await createJob({ params: { eventId: '7', sessionId: 'not-a-uuid' }, request: attendeeRequest() });
    const invalidJob = await getJob({ params: { eventId: '7', sessionId, jobId: 'not-a-job-id' } });

    expect(invalidSession.status).toBe(400);
    expect(await invalidSession.json()).toEqual({ error: 'Invalid sessionId.', field: 'sessionId' });
    expect(invalidJob.status).toBe(400);
    expect(await invalidJob.json()).toEqual({ error: 'Invalid jobId.', field: 'jobId' });
    expect(createAttendeePrintJob).not.toHaveBeenCalled();
    expect(loadAttendeePrintJob).not.toHaveBeenCalled();
  });

  it('creates an attendee job scoped to its event and session', async () => {
    createAttendeePrintJob.mockResolvedValue(publicJob);

    const response = await createJob({ params: { eventId: '7', sessionId }, request: attendeeRequest() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: publicJob });
    expect(createAttendeePrintJob).toHaveBeenCalledWith(fakeEnv.DB, 7, sessionId, idempotencyKey);
  });

  it('blocks cross-origin browser posts while allowing same-origin and headerless clients', async () => {
    createAttendeePrintJob.mockResolvedValue(publicJob);
    const params = { eventId: '7', sessionId };

    const wrongOrigin = await createJob({ params, request: attendeeRequest({ Origin: 'https://evil.test' }) });
    const crossSite = await createJob({ params, request: attendeeRequest({ 'Sec-Fetch-Site': 'cross-site' }) });
    const sameOrigin = await createJob({ params, request: attendeeRequest({ Origin: 'https://booth.test', 'Sec-Fetch-Site': 'same-origin' }) });
    const headerless = await createJob({ params, request: attendeeRequest() });

    expect(wrongOrigin.status).toBe(403);
    expect(crossSite.status).toBe(403);
    expect(sameOrigin.status).toBe(200);
    expect(headerless.status).toBe(200);
    expect(createAttendeePrintJob).toHaveBeenCalledTimes(2);
  });

  it('requires JSON and blocks cross-origin admin browser posts at the route', async () => {
    queueAdminPrintJob.mockResolvedValue(publicJob);
    const params = { sessionId };
    const body = { action: 'queue', idempotencyKey };

    const wrongType = await mutateAdminJob({
      params,
      request: new Request('https://booth.test/api/admin/sessions/x/print-jobs', { method: 'POST', body: JSON.stringify(body) }),
    });
    const wrongOrigin = await mutateAdminJob({ params, request: adminRequest(body, { Origin: 'https://evil.test' }) });
    const crossSite = await mutateAdminJob({ params, request: adminRequest(body, { 'Sec-Fetch-Site': 'cross-site' }) });
    const sameOrigin = await mutateAdminJob({ params, request: adminRequest(body, { Origin: 'https://booth.test', 'Sec-Fetch-Site': 'same-origin' }) });
    const headerless = await mutateAdminJob({ params, request: adminRequest(body) });

    expect(wrongType.status).toBe(400);
    expect(await wrongType.json()).toEqual({ error: 'Content-Type must be application/json.', field: 'action' });
    expect(wrongOrigin.status).toBe(403);
    expect(crossSite.status).toBe(403);
    expect(sameOrigin.status).toBe(200);
    expect(headerless.status).toBe(200);
    expect(queueAdminPrintJob).toHaveBeenCalledTimes(2);
  });

  it('loads status only for the event/session/job tuple', async () => {
    loadAttendeePrintJob.mockResolvedValue({ ...publicJob, status: 'printed', printedAt: 200 });

    const response = await getJob({ params: { eventId: '7', sessionId, jobId } });

    expect(await response.json()).toEqual({ job: { status: 'printed', printedAt: 200 } });
    expect(loadAttendeePrintJob).toHaveBeenCalledWith(fakeEnv.DB, 7, sessionId, jobId);
  });

  it('accepts claim limits within the inclusive range', async () => {
    claimPrintJobs.mockResolvedValue([{ ...publicJob, claimToken }]);
    const response = await claimJobs({ request: new Request('https://booth.test/api/print-agent/jobs/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventSlug: 'demo-event', agentId, limit: 20 }),
    }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobs: [{ ...publicJob, claimToken }] });
    expect(claimPrintJobs).toHaveBeenCalledWith(fakeEnv.DB, 'demo-event', agentId, 20);
  });

  it.each([0, -1, 1.5, 21, '2'])('rejects invalid claim limit %j', async (limit) => {
    const response = await claimJobs({ request: new Request('https://booth.test/api/print-agent/jobs/claim', {
      method: 'POST', body: JSON.stringify({ eventSlug: 'demo-event', agentId, limit }),
    }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'limit must be an integer between 1 and 20.', field: 'limit' });
    expect(claimPrintJobs).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'not-an-agent-id'])('rejects invalid claim agent ID %j', async (value) => {
    const response = await claimJobs({ request: new Request('https://booth.test/api/print-agent/jobs/claim', {
      method: 'POST', body: JSON.stringify({ eventSlug: 'demo-event', agentId: value, limit: 1 }),
    }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid agentId.', field: 'agentId' });
    expect(claimPrintJobs).not.toHaveBeenCalled();
  });

  it('reconciles exact locally durable claims without returning claim identities', async () => {
    reconcilePrintJobs.mockResolvedValue({ released: 2 });
    const knownClaims = [{ id: jobId, claimToken }];
    const response = await reconcileJobs({ request: new Request('https://booth.test/api/print-agent/jobs/reconcile', {
      method: 'POST', body: JSON.stringify({ agentId, knownClaims }),
    }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ released: 2 });
    expect(reconcilePrintJobs).toHaveBeenCalledWith(fakeEnv.DB, agentId, knownClaims);
  });

  it('rejects malformed reconciliation claims before querying the database', async () => {
    const response = await reconcileJobs({ request: new Request('https://booth.test/api/print-agent/jobs/reconcile', {
      method: 'POST', body: JSON.stringify({ agentId, knownClaims: [{ id: jobId, claimToken: 'secret' }] }),
    }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid claimToken.', field: 'claimToken' });
    expect(reconcilePrintJobs).not.toHaveBeenCalled();
  });

  it('bounds reconciliation input before querying the database', async () => {
    const response = await reconcileJobs({ request: new Request('https://booth.test/api/print-agent/jobs/reconcile', {
      method: 'POST', body: JSON.stringify({ agentId, knownClaims: Array.from({ length: 101 }, () => ({ id: jobId, claimToken })) }),
    }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'knownClaims must be an array with at most 100 entries.', field: 'knownClaims' });
    expect(reconcilePrintJobs).not.toHaveBeenCalled();
  });

  it('returns a typed 400 for malformed JSON', async () => {
    const response = await claimJobs({ request: new Request('https://booth.test/api/print-agent/jobs/claim', {
      method: 'POST', body: '{',
    }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Request body must be valid JSON.', field: 'eventSlug' });
    expect(claimPrintJobs).not.toHaveBeenCalled();
  });

  it.each([
    ['claim', () => claimJobs({ request: new Request('https://booth.test/api/print-agent/jobs/claim', { method: 'POST', body: '[]' }) }), 'eventSlug'],
    ['ack', () => acknowledgeJob({ params: { jobId }, request: new Request('https://booth.test/api/print-agent/jobs/x/ack', { method: 'POST', body: '[]' }) }), 'status'],
    ['admin', () => mutateAdminJob({ params: { sessionId }, request: adminRequest([]) }), 'action'],
  ] as const)('reports endpoint-specific fields for non-object %s bodies', async (_name, request, field) => {
    const response = await request();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Request body must be a JSON object.', field });
  });

  it('requires a bounded failure message and supports printed acknowledgements', async () => {
    const invalid = await acknowledgeJob({
      params: { jobId },
      request: new Request('https://booth.test/api/print-agent/jobs/x/ack', {
        method: 'POST', body: JSON.stringify({ status: 'failed', error: '   ', claimToken }),
      }),
    });
    expect(invalid.status).toBe(400);
    expect(acknowledgePrintJob).not.toHaveBeenCalled();

    acknowledgePrintJob.mockResolvedValue({ ...publicJob, status: 'printed', printedAt: 200 });
    const valid = await acknowledgeJob({
      params: { jobId },
      request: new Request('https://booth.test/api/print-agent/jobs/x/ack', {
        method: 'POST', body: JSON.stringify({ status: 'printed', claimToken }),
      }),
    });
    expect(valid.status).toBe(200);
    expect(acknowledgePrintJob).toHaveBeenCalledWith(fakeEnv.DB, jobId, { status: 'printed', claimToken });
  });

  it('requires a valid claim token for acknowledgements', async () => {
    for (const value of [undefined, '', 'not-a-token']) {
      const response = await acknowledgeJob({
        params: { jobId },
        request: new Request('https://booth.test/api/print-agent/jobs/x/ack', {
          method: 'POST', body: JSON.stringify({ status: 'printed', claimToken: value }),
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid claimToken.', field: 'claimToken' });
    }
    expect(acknowledgePrintJob).not.toHaveBeenCalled();
  });

  it('releases a matching claimed job through the authenticated agent contract', async () => {
    releasePrintJob.mockResolvedValue({ ...publicJob, status: 'pending' });
    const response = await releaseJob({
      params: { jobId },
      request: new Request('https://booth.test/api/print-agent/jobs/x/release', {
        method: 'POST', body: JSON.stringify({ claimToken }),
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: { ...publicJob, status: 'pending' } });
    expect(releasePrintJob).toHaveBeenCalledWith(fakeEnv.DB, jobId, claimToken);
  });

  it('rejects missing or malformed release claim tokens', async () => {
    for (const value of [undefined, '', 'not-a-token']) {
      const response = await releaseJob({
        params: { jobId },
        request: new Request('https://booth.test/api/print-agent/jobs/x/release', {
          method: 'POST', body: JSON.stringify({ claimToken: value }),
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid claimToken.', field: 'claimToken' });
    }
    expect(releasePrintJob).not.toHaveBeenCalled();
  });

  it('accepts a 500-character failure message and rejects 501 characters', async () => {
    acknowledgePrintJob.mockResolvedValue({ ...publicJob, status: 'failed', error: 'x'.repeat(500) });
    const request = (error: string) => acknowledgeJob({
      params: { jobId },
      request: new Request('https://booth.test/api/print-agent/jobs/x/ack', {
        method: 'POST', body: JSON.stringify({ status: 'failed', error, claimToken }),
      }),
    });

    expect((await request('x'.repeat(500))).status).toBe(200);
    expect(acknowledgePrintJob).toHaveBeenCalledWith(fakeEnv.DB, jobId, { status: 'failed', error: 'x'.repeat(500), claimToken });
    expect((await request('x'.repeat(501))).status).toBe(400);
  });

  it('maps missing and invalid transitions without exposing database failures', async () => {
    acknowledgePrintJob.mockRejectedValueOnce(new PrintJobNotFoundError()).mockRejectedValueOnce(new PrintJobConflictError('Job is not printing.'));
    const request = () => new Request('https://booth.test/api/print-agent/jobs/x/ack', {
      method: 'POST', body: JSON.stringify({ status: 'printed', claimToken }),
    });

    expect((await acknowledgeJob({ params: { jobId }, request: request() })).status).toBe(404);
    const conflict = await acknowledgeJob({ params: { jobId }, request: request() });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'Job is not printing.' });
  });

  it('supports admin queue and retry actions', async () => {
    queueAdminPrintJob.mockResolvedValue(publicJob);
    retryAdminPrintJob.mockResolvedValue(publicJob);

    const queueResponse = await mutateAdminJob({
      params: { sessionId },
      request: adminRequest({ action: 'queue', idempotencyKey }),
    });
    const retryResponse = await mutateAdminJob({
      params: { sessionId },
      request: adminRequest({ action: 'retry', jobId, idempotencyKey }),
    });

    expect(queueResponse.status).toBe(200);
    expect(retryResponse.status).toBe(200);
    expect(queueAdminPrintJob).toHaveBeenCalledWith(fakeEnv.DB, sessionId, idempotencyKey);
    expect(retryAdminPrintJob).toHaveBeenCalledWith(fakeEnv.DB, sessionId, jobId, idempotencyKey);
  });

  it('returns safe admin print history for the requested session', async () => {
    const adminJob = {
      ...publicJob,
      sessionId,
      eventId: 7,
      sceneName: 'Brooklyn Bridge',
      postcardUrl: `/api/events/7/sessions/${sessionId}/postcard`,
      createdAt: 100,
      error: null,
    };
    loadAdminPrintJobs.mockResolvedValue([adminJob]);

    const response = await getAdminJobs({ params: { sessionId } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobs: [adminJob] });
    expect(loadAdminPrintJobs).toHaveBeenCalledWith(fakeEnv.DB, sessionId);
  });

  it('maps invalid admin history input and database failures', async () => {
    const invalid = await getAdminJobs({ params: { sessionId: 'not-a-uuid' } });
    expect(invalid.status).toBe(400);
    expect(loadAdminPrintJobs).not.toHaveBeenCalled();

    loadAdminPrintJobs.mockRejectedValue(new Error('database unavailable'));
    const failed = await getAdminJobs({ params: { sessionId } });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Couldn't process the print job request." });
  });

  it('returns typed admin queue and retry conflicts', async () => {
    queueAdminPrintJob.mockRejectedValue(new PrintJobConflictError('This session already has an active print job.'));
    retryAdminPrintJob.mockRejectedValue(new PrintJobConflictError('Only failed or stuck printing jobs can be retried.'));
    const request = (body: object) => mutateAdminJob({
      params: { sessionId },
      request: adminRequest(body),
    });

    expect((await request({ action: 'queue', idempotencyKey })).status).toBe(409);
    expect((await request({ action: 'retry', jobId, idempotencyKey })).status).toBe(409);
  });
});
