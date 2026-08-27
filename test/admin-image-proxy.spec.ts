import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeEnv = vi.hoisted(() => ({
  DB: {},
  SELFIES: { get: vi.fn() },
}));
const loadAdminSessionImageKey = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/admin', async () => {
  const actual = await vi.importActual<typeof import('../src/db/admin')>('../src/db/admin');
  return { ...actual, loadAdminSessionImageKey };
});

import { GET } from '../src/pages/api/admin/sessions/[sessionId]/images/[kind]';

const sessionId = 'session/with unsafe spaces';

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
    ['caricature', 'sessions/session-1/caricature.jpg'],
    ['postcard', 'sessions/session-1/postcard.jpg'],
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
    loadAdminSessionImageKey.mockResolvedValue('sessions/session-1/postcard.jpg');
    fakeEnv.SELFIES.get.mockResolvedValue(imageObject('image/jpeg'));

    const response = await GET({ params: { sessionId, kind: 'postcard' }, url: requestUrl('?download=1') });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="postcard-session-with-unsafe-spaces.jpg"');
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
