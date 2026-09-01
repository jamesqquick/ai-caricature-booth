import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeEnv = vi.hoisted(() => ({
  DB: {},
  SELFIES: { get: vi.fn() },
  IMAGES: { input: vi.fn() },
}));
const loadAdminSessionImageKey = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/admin', async () => {
  const actual = await vi.importActual<typeof import('../src/db/admin')>('../src/db/admin');
  return { ...actual, loadAdminSessionImageKey };
});

import { GET } from '../src/pages/api/admin/sessions/[sessionId]/images/[kind]';

const sessionId = 'session-with-safe-id';

function requestUrl(query = '') {
  return new URL(`https://booth.test/api/admin/sessions/${encodeURIComponent(sessionId)}/images/caricature${query}`);
}

function imageObject(contentType = 'image/webp') {
  return {
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }),
    httpMetadata: { contentType },
  };
}

describe('admin session image proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['selfie', 'sessions/session-1/selfie.jpg'],
    ['caricature', 'sessions/session-1/workflow-1/caricature.jpg'],
    ['postcard', 'sessions/session-1/workflow-1/postcard.jpg'],
  ])('resolves the %s key server-side and streams the object', async (kind, key) => {
    loadAdminSessionImageKey.mockResolvedValue(key);
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject());

    const response = await GET({ params: { sessionId: 'session-1', kind }, url: new URL(`https://booth.test/${kind}`) });

    expect(response.status).toBe(200);
    expect(loadAdminSessionImageKey).toHaveBeenCalledWith(fakeEnv.DB, 'session-1', kind);
    expect(fakeEnv.SELFIES.get).toHaveBeenCalledWith(key);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it('returns a sanitized attachment filename for downloads', async () => {
    loadAdminSessionImageKey.mockResolvedValue('sessions/session-with-safe-id/postcard.jpg');
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject('image/jpeg'));

    const response = await GET({ params: { sessionId, kind: 'postcard' }, url: requestUrl('?download=1') });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="postcard-session-with-safe-id.jpg"');
  });

  it('resizes thumbnail variants while keeping the source proxy protected', async () => {
    loadAdminSessionImageKey.mockResolvedValue('sessions/session-1/postcard.jpg');
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject('image/jpeg'));
    const responseBody = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([4, 5, 6])); controller.close(); } });
    const outputResponse = new Response(responseBody, { status: 200 });
    const output = { response: vi.fn(() => outputResponse) };
    const transformed = { output: vi.fn().mockResolvedValue(output) };
    const input = { transform: vi.fn(() => transformed) };
    fakeEnv.IMAGES.input.mockReturnValue(input);

    const response = await GET({ params: { sessionId: 'session-1', kind: 'postcard' }, url: requestUrl('?variant=thumbnail') });

    expect(response.status).toBe(200);
    expect(fakeEnv.IMAGES.input).toHaveBeenCalledWith(expect.any(ReadableStream));
    expect(input.transform).toHaveBeenCalledWith({ width: 320, height: 213, fit: 'cover' });
    expect(transformed.output).toHaveBeenCalledWith({ format: 'image/jpeg' });
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([4, 5, 6]).buffer);
  });

  it.each([
    ['invalid kind', { sessionId: 'session-1', kind: 'original' }],
    ['unknown session', { sessionId: 'missing-session', kind: 'selfie' }],
    ['absent image', { sessionId: 'session-1', kind: 'postcard' }],
  ])('returns 404 for %s', async (_label, params) => {
    loadAdminSessionImageKey.mockResolvedValue(null);

    const response = await GET({ params, url: new URL('https://booth.test/image') });

    expect(response.status).toBe(404);
    expect(fakeEnv.SELFIES.get).not.toHaveBeenCalled();
  });

  it('returns 404 when the stored R2 object is missing', async () => {
    loadAdminSessionImageKey.mockResolvedValue('sessions/session-1/selfie.jpg');
    fakeEnv.SELFIES.get.mockResolvedValue(null);

    const response = await GET({ params: { sessionId: 'session-1', kind: 'selfie' }, url: new URL('https://booth.test/image') });

    expect(response.status).toBe(404);
  });

  it.each([
    ['cross-owned key', 'sessions/other-session/selfie.jpg'],
    ['wrong kind key', 'sessions/session-1/postcard.jpg'],
    ['nested wrong kind key', 'sessions/session-1/workflow-1/postcard.jpg'],
    ['nested path traversal', 'sessions/session-1/workflow-1/../selfie.jpg'],
    ['corrupted key', 'private/session-1/selfie.jpg'],
  ])('returns 404 without reading R2 for a %s', async (_label, key) => {
    loadAdminSessionImageKey.mockResolvedValue(key);

    const response = await GET({ params: { sessionId: 'session-1', kind: 'selfie' }, url: new URL('https://booth.test/image') });

    expect(response.status).toBe(404);
    expect(fakeEnv.SELFIES.get).not.toHaveBeenCalled();
  });

  it('returns 404 for an object with a non-image content type', async () => {
    loadAdminSessionImageKey.mockResolvedValue('sessions/session-1/selfie.jpg');
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject('text/html'));

    const response = await GET({ params: { sessionId: 'session-1', kind: 'selfie' }, url: new URL('https://booth.test/image') });

    expect(response.status).toBe(404);
  });

  it('ignores a caller-supplied key and only fetches the database-resolved key', async () => {
    loadAdminSessionImageKey.mockResolvedValue('sessions/session-1/selfie.jpg');
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject());

    await GET({
      params: { sessionId: 'session-1', kind: 'selfie', key: 'sessions/other-session/postcard.jpg' },
      url: new URL('https://booth.test/image?key=sessions/other-session/postcard.jpg'),
    });

    expect(fakeEnv.SELFIES.get).toHaveBeenCalledWith('sessions/session-1/selfie.jpg');
    expect(fakeEnv.SELFIES.get).not.toHaveBeenCalledWith('sessions/other-session/postcard.jpg');
  });
});
