import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeEnv = vi.hoisted(() => ({ DB: {} }));
const createAttendeePrintJob = vi.hoisted(() => vi.fn());
const loadAttendeePrintJob = vi.hoisted(() => vi.fn());
const claimPrintJobs = vi.hoisted(() => vi.fn());
const acknowledgePrintJob = vi.hoisted(() => vi.fn());
const queueAdminPrintJob = vi.hoisted(() => vi.fn());
const retryAdminPrintJob = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/print-jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/db/print-jobs')>(),
  createAttendeePrintJob,
  loadAttendeePrintJob,
  claimPrintJobs,
  acknowledgePrintJob,
  queueAdminPrintJob,
  retryAdminPrintJob,
}));

import { POST as createJob } from '../src/pages/api/events/[eventId]/sessions/[sessionId]/print-jobs';
import { GET as getJob } from '../src/pages/api/events/[eventId]/sessions/[sessionId]/print-jobs/[jobId]';
import { POST as claimJobs } from '../src/pages/api/print-agent/jobs/claim';
import { POST as acknowledgeJob } from '../src/pages/api/print-agent/jobs/[jobId]/ack';
import { POST as mutateAdminJob } from '../src/pages/api/admin/sessions/[sessionId]/print-jobs';
import { PrintJobConflictError, PrintJobNotFoundError } from '../src/db/print-jobs';

const sessionId = '00000000-0000-4000-8000-000000000001';
const jobId = '0123456789abcdef0123456789abcdef';
const publicJob = { id: jobId, status: 'pending', printedAt: null };

describe('print job APIs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates attendee identifiers and never calls the database for invalid input', async () => {
    const response = await createJob({ params: { eventId: '7x', sessionId: 'not-a-uuid' } });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid eventId.', field: 'eventId' });
    expect(createAttendeePrintJob).not.toHaveBeenCalled();
  });

  it('creates an attendee job scoped to its event and session', async () => {
    createAttendeePrintJob.mockResolvedValue(publicJob);

    const response = await createJob({ params: { eventId: '7', sessionId } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: publicJob });
    expect(createAttendeePrintJob).toHaveBeenCalledWith(fakeEnv.DB, 7, sessionId);
  });

  it('loads status only for the event/session/job tuple', async () => {
    loadAttendeePrintJob.mockResolvedValue({ ...publicJob, status: 'printed', printedAt: 200 });

    const response = await getJob({ params: { eventId: '7', sessionId, jobId } });

    expect(await response.json()).toEqual({ job: { status: 'printed', printedAt: 200 } });
    expect(loadAttendeePrintJob).toHaveBeenCalledWith(fakeEnv.DB, 7, sessionId, jobId);
  });

  it('validates and clamps claim input', async () => {
    claimPrintJobs.mockResolvedValue([]);
    const response = await claimJobs({ request: new Request('https://booth.test/api/print-agent/jobs/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventSlug: 'demo-event', limit: 999 }),
    }) });

    expect(response.status).toBe(200);
    expect(claimPrintJobs).toHaveBeenCalledWith(fakeEnv.DB, 'demo-event', 20);
  });

  it('returns a typed 400 for malformed JSON', async () => {
    const response = await claimJobs({ request: new Request('https://booth.test/api/print-agent/jobs/claim', {
      method: 'POST', body: '{',
    }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Request body must be valid JSON.', field: 'eventSlug' });
    expect(claimPrintJobs).not.toHaveBeenCalled();
  });

  it('requires a bounded failure message and supports printed acknowledgements', async () => {
    const invalid = await acknowledgeJob({
      params: { jobId },
      request: new Request('https://booth.test/api/print-agent/jobs/x/ack', {
        method: 'POST', body: JSON.stringify({ status: 'failed', error: '   ' }),
      }),
    });
    expect(invalid.status).toBe(400);
    expect(acknowledgePrintJob).not.toHaveBeenCalled();

    acknowledgePrintJob.mockResolvedValue({ ...publicJob, status: 'printed', printedAt: 200 });
    const valid = await acknowledgeJob({
      params: { jobId },
      request: new Request('https://booth.test/api/print-agent/jobs/x/ack', {
        method: 'POST', body: JSON.stringify({ status: 'printed' }),
      }),
    });
    expect(valid.status).toBe(200);
    expect(acknowledgePrintJob).toHaveBeenCalledWith(fakeEnv.DB, jobId, { status: 'printed' });
  });

  it('maps missing and invalid transitions without exposing database failures', async () => {
    acknowledgePrintJob.mockRejectedValueOnce(new PrintJobNotFoundError()).mockRejectedValueOnce(new PrintJobConflictError('Job is not printing.'));
    const request = () => new Request('https://booth.test/api/print-agent/jobs/x/ack', {
      method: 'POST', body: JSON.stringify({ status: 'printed' }),
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
      request: new Request('https://booth.test/api/admin/sessions/x/print-jobs', { method: 'POST', body: JSON.stringify({ action: 'queue' }) }),
    });
    const retryResponse = await mutateAdminJob({
      params: { sessionId },
      request: new Request('https://booth.test/api/admin/sessions/x/print-jobs', { method: 'POST', body: JSON.stringify({ action: 'retry', jobId }) }),
    });

    expect(queueResponse.status).toBe(200);
    expect(retryResponse.status).toBe(200);
    expect(queueAdminPrintJob).toHaveBeenCalledWith(fakeEnv.DB, sessionId);
    expect(retryAdminPrintJob).toHaveBeenCalledWith(fakeEnv.DB, sessionId, jobId);
  });
});
