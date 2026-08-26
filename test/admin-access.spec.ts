import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
}));
vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
}));
vi.mock('@astrojs/cloudflare/handler', () => ({ handle: vi.fn() }));
vi.mock('../src/db/sessions', () => ({ transitionSession: vi.fn() }));
vi.mock('../src/lib/moderation', () => ({ moderateImage: vi.fn() }));
vi.mock('../src/lib/postcard', () => ({ buildPostcard: vi.fn() }));
vi.mock('../src/lib/replicate', () => ({ generateCaricature: vi.fn() }));

import { handle } from '@astrojs/cloudflare/handler';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import worker from '../src/worker';
import { ADMIN_EMAIL_HEADER, isAdminPath, withVerifiedAdminIdentity } from '../src/lib/admin-access';

function contextWithIdentity(email?: string) {
  return {
    access: {
      getIdentity: vi.fn().mockResolvedValue(email === undefined ? undefined : { email }),
    },
  } as unknown as ExecutionContext;
}

describe('admin Access boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(handle).mockResolvedValue(new Response('Astro response'));
    vi.mocked(createRemoteJWKSet).mockReturnValue(vi.fn() as never);
  });

  it.each([
    '/admin',
    '/admin/',
    '/admin/events',
    '/api/admin',
    '/api/admin/',
    '/api/admin/sessions',
  ])('protects %s', (pathname) => {
    expect(isAdminPath(pathname)).toBe(true);
  });

  it.each(['/', '/administrator', '/api', '/api/administrator', '/events/admin'])('does not protect %s', (pathname) => {
    expect(isAdminPath(pathname)).toBe(false);
  });

  it('returns JSON 403 for a protected API request without Access context', async () => {
    const response = await worker.fetch(
      new Request('https://booth.example.com/api/admin/sessions'),
      {} as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('returns HTML 403 for a protected browser request without a verified email', async () => {
    const response = await worker.fetch(
      new Request('https://booth.example.com/admin'),
      {} as Env,
      contextWithIdentity('   '),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toContain('<h1>Forbidden</h1>');
    expect(handle).not.toHaveBeenCalled();
  });

  it('overwrites a caller-supplied email with the verified Access identity', async () => {
    const request = new Request('https://booth.example.com/admin/events', {
      headers: { [ADMIN_EMAIL_HEADER]: 'attacker@example.com' },
    });

    const response = await worker.fetch(request, {} as Env, contextWithIdentity(' admin@example.com '));

    expect(response.status).toBe(200);
    const forwardedRequest = vi.mocked(handle).mock.calls[0]?.[0] as Request;
    expect(forwardedRequest.headers.get(ADMIN_EMAIL_HEADER)).toBe('admin@example.com');
  });

  it('validates the Access JWT when Static Assets omits Access context', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { email: ' jwt-admin@example.com ' },
      protectedHeader: { alg: 'RS256' },
    });
    const request = new Request('https://booth.example.com/admin', {
      headers: {
        'cf-access-jwt-assertion': 'signed-token',
        [ADMIN_EMAIL_HEADER]: 'attacker@example.com',
      },
    });
    const config = {
      ACCESS_AUD: 'access-audience',
      ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
    };

    const verifiedRequest = await withVerifiedAdminIdentity(request, undefined, config);

    expect(createRemoteJWKSet).toHaveBeenCalledWith(new URL('https://team.cloudflareaccess.com/cdn-cgi/access/certs'));
    expect(jwtVerify).toHaveBeenCalledWith('signed-token', expect.any(Function), {
      issuer: 'https://team.cloudflareaccess.com',
      audience: 'access-audience',
    });
    expect(verifiedRequest?.headers.get(ADMIN_EMAIL_HEADER)).toBe('jwt-admin@example.com');
  });

  it('fails closed when the Access JWT is invalid', async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new Error('Invalid signature'));
    const request = new Request('https://booth.example.com/admin', {
      headers: { 'cf-access-jwt-assertion': 'invalid-token' },
    });
    const config = {
      ACCESS_AUD: 'access-audience',
      ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
    };

    const verifiedRequest = await withVerifiedAdminIdentity(request, undefined, config);

    expect(verifiedRequest).toBeNull();
  });

  it('allows an explicit development identity only on loopback URLs', async () => {
    const localRequest = await withVerifiedAdminIdentity(
      new Request('http://localhost:4321/admin'),
      undefined,
      {},
      true,
    );
    const externalRequest = await withVerifiedAdminIdentity(
      new Request('https://booth.example.com/admin'),
      undefined,
      {},
      true,
    );

    expect(localRequest?.headers.get(ADMIN_EMAIL_HEADER)).toBe('local-admin@localhost');
    expect(externalRequest).toBeNull();
  });

  it('fails closed when Access identity lookup throws', async () => {
    const context = {
      access: { getIdentity: vi.fn().mockRejectedValue(new Error('Access unavailable')) },
    } as unknown as ExecutionContext;

    const response = await worker.fetch(new Request('https://booth.example.com/admin'), {} as Env, context);

    expect(response.status).toBe(403);
    expect(handle).not.toHaveBeenCalled();
  });

  it('allows an unprotected request to reach Astro unchanged', async () => {
    const request = new Request('https://booth.example.com/');
    const context = {} as ExecutionContext;

    const response = await worker.fetch(request, {} as Env, context);

    expect(response.status).toBe(200);
    expect(handle).toHaveBeenCalledWith(request, {}, context);
  });
});
