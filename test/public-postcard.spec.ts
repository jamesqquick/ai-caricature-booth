import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeEnv = vi.hoisted(() => ({
  DB: {},
  SELFIES: { get: vi.fn() },
}));
const loadSession = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/sessions', () => ({ loadSession }));

import { GET } from '../src/pages/api/events/[eventId]/sessions/[sessionId]/postcard';

const eventId = '7';
const sessionId = '00000000-0000-4000-8000-000000000001';
const postcardKey = `sessions/${sessionId}/postcard.jpg`;
const session = {
  id: sessionId,
  event_id: Number(eventId),
  status: 'completed',
  scene_id: 'brooklyn-bridge',
  scene_name: 'Brooklyn Bridge',
  selfie_key: `sessions/${sessionId}/selfie.jpg`,
  selfie_sha256: 'sha256',
  caricature_key: `sessions/${sessionId}/caricature.jpg`,
  postcard_key: postcardKey,
  workflow_instance_id: 'workflow-1',
  error_code: null,
  error_msg: null,
  created_at: 1,
  completed_at: 2,
  pipeline_ms: 1,
  updated_at: 2,
};

function requestUrl(query = '') {
  return new URL(`https://booth.test/api/events/${eventId}/sessions/${sessionId}/postcard${query}`);
}

function imageObject(key = postcardKey, contentType = 'image/jpeg') {
  return {
    key,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
        controller.close();
      },
    }),
    httpMetadata: { contentType },
  };
}

function get(params: Record<string, string | undefined> = { eventId, sessionId }, query = '') {
  return GET({ params, url: requestUrl(query) });
}

function expectSecurityHeaders(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
}

describe('public postcard endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadSession.mockResolvedValue(session);
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams the canonical JPEG without disclosing its object key', async () => {
    const response = await get(undefined, '?download=1');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="caricature-postcard.jpg"');
    expectSecurityHeaders(response);
    expect(fakeEnv.SELFIES.get).toHaveBeenCalledWith(postcardKey);
    expect(JSON.stringify([...response.headers])).not.toContain(postcardKey);
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer);
  });

  it.each([
    ['missing parameters', { eventId: undefined, sessionId: undefined }, session, imageObject()],
    ['invalid event ID', { eventId: '7-sentinel', sessionId }, session, imageObject()],
    ['invalid session ID', { eventId, sessionId: 'bad/session' }, session, imageObject()],
    ['missing session', { eventId, sessionId }, null, imageObject()],
    ['different session', { eventId, sessionId }, { ...session, id: '00000000-0000-4000-8000-000000000002' }, imageObject()],
    ['different event', { eventId, sessionId }, { ...session, event_id: 8 }, imageObject()],
    ['incomplete session', { eventId, sessionId }, { ...session, status: 'generating' }, imageObject()],
    ['noncanonical stored key', { eventId, sessionId }, { ...session, postcard_key: 'sessions/other/postcard.jpg' }, imageObject()],
    ['missing object', { eventId, sessionId }, session, null],
    ['mismatched object', { eventId, sessionId }, session, imageObject('sessions/other/postcard.jpg')],
    ['non-JPEG object', { eventId, sessionId }, session, imageObject(postcardKey, 'text/html')],
  ])('returns the same protected 404 for a %s', async (_label, params, sessionResult, objectResult) => {
    loadSession.mockResolvedValue(sessionResult);
    fakeEnv.SELFIES.get.mockResolvedValue(objectResult);

    const response = await get(params);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
    expectSecurityHeaders(response);
    expect(JSON.stringify([...response.headers])).not.toContain('sessions/');
  });

  it('does not read R2 when the session record is unauthorized', async () => {
    loadSession.mockResolvedValue({ ...session, event_id: 8 });

    const response = await get();

    expect(response.status).toBe(404);
    expect(fakeEnv.SELFIES.get).not.toHaveBeenCalled();
  });

  it('contains D1 diagnostics and returns a fixed protected 503', async () => {
    const diagnostic = 'd1-postcard-sentinel-b049ce';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadSession.mockRejectedValue(new Error(diagnostic));

    const response = await get();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('Postcard temporarily unavailable');
    expect(body).not.toContain(diagnostic);
    expectSecurityHeaders(response);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(diagnostic);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(eventId);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(sessionId);
  });

  it('contains R2 diagnostics and returns a fixed protected 503', async () => {
    const diagnostic = 'r2-postcard-sentinel-7cd32a';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeEnv.SELFIES.get.mockRejectedValue(new Error(diagnostic));

    const response = await get();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('Postcard temporarily unavailable');
    expect(body).not.toContain(diagnostic);
    expectSecurityHeaders(response);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(diagnostic);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(postcardKey);
  });
});
