import { timingSafeEqual } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('jose', () => ({ createRemoteJWKSet: vi.fn(), jwtVerify: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ WorkflowEntrypoint: class {} }));
vi.mock('@astrojs/cloudflare/handler', () => ({ handle: vi.fn() }));
vi.mock('../src/db/sessions', () => ({ transitionSession: vi.fn() }));
vi.mock('../src/lib/moderation', () => ({ moderateImage: vi.fn() }));
vi.mock('../src/lib/postcard', () => ({ buildPostcard: vi.fn() }));
vi.mock('../src/lib/replicate', () => ({ generateCaricature: vi.fn() }));
vi.mock('../src/lib/event-mcp', () => ({ handleEventMcpRequest: vi.fn() }));

import { handle } from '@astrojs/cloudflare/handler';
import worker from '../src/worker';
import { authenticateMcpRequest, isMcpPath } from '../src/lib/mcp-auth';
import { handleEventMcpRequest } from '../src/lib/event-mcp';

describe('MCP authentication', () => {
  const platformTimingSafeEqual = vi.fn((left: ArrayBuffer, right: ArrayBuffer) => (
    timingSafeEqual(new Uint8Array(left), new Uint8Array(right))
  ));

  beforeAll(() => {
    Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
      configurable: true,
      value: platformTimingSafeEqual,
    });
  });

  afterAll(() => {
    Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(handle).mockResolvedValue(new Response('Astro response'));
    vi.mocked(handleEventMcpRequest).mockResolvedValue(new Response('MCP response'));
  });

  it('matches only the exact MCP endpoint', () => {
    expect(isMcpPath('/mcp')).toBe(true);
    expect(isMcpPath('/mcp/')).toBe(false);
    expect(isMcpPath('/mcps')).toBe(false);
  });

  it('distinguishes missing configuration from invalid credentials', async () => {
    const request = new Request('https://booth.test/mcp', {
      headers: { authorization: 'Bearer machine-token' },
    });

    expect((await authenticateMcpRequest(request, undefined))?.status).toBe(500);
    const invalid = await authenticateMcpRequest(request, 'expected-token');
    expect(invalid?.status).toBe(401);
    expect(invalid?.headers.get('www-authenticate')).toBe('Bearer');
    expect(await authenticateMcpRequest(request, 'machine-token')).toBeNull();
    expect(platformTimingSafeEqual).toHaveBeenCalledTimes(2);
  });

  it('accepts case-insensitive bearer authentication schemes', async () => {
    const request = new Request('https://booth.test/mcp', {
      headers: { authorization: 'bearer machine-token' },
    });

    expect(await authenticateMcpRequest(request, 'machine-token')).toBeNull();
  });

  it('routes authenticated requests to MCP before Astro and admin handling', async () => {
    const request = new Request('https://booth.test/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer machine-token' },
    });
    const env = { MCP_AUTH_TOKEN: 'machine-token' } as Env;
    const context = {} as ExecutionContext;

    const response = await worker.fetch(request, env, context);

    expect(await response.text()).toBe('MCP response');
    expect(handleEventMcpRequest).toHaveBeenCalledWith(request, env, context);
    expect(handle).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated MCP requests before invoking a handler', async () => {
    const response = await worker.fetch(
      new Request('https://booth.test/mcp', { method: 'POST' }),
      { MCP_AUTH_TOKEN: 'machine-token' } as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(401);
    expect(handleEventMcpRequest).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });
});
