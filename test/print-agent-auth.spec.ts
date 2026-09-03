import { timingSafeEqual } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('jose', () => ({ createRemoteJWKSet: vi.fn(), jwtVerify: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ WorkflowEntrypoint: class {} }));
vi.mock('@astrojs/cloudflare/handler', () => ({ handle: vi.fn() }));
vi.mock('../src/db/sessions', () => ({ transitionSession: vi.fn() }));
vi.mock('../src/lib/moderation', () => ({ moderateImage: vi.fn() }));
vi.mock('../src/lib/postcard', () => ({ buildPostcard: vi.fn() }));
vi.mock('../src/lib/replicate', () => ({ generateCaricature: vi.fn() }));

import { handle } from '@astrojs/cloudflare/handler';
import worker from '../src/worker';
import { authenticatePrintAgent, isPrintAgentPath } from '../src/lib/print-agent-auth';

describe('print agent authentication', () => {
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
  });

  it('matches only the dedicated API boundary', () => {
    expect(isPrintAgentPath('/api/print-agent')).toBe(true);
    expect(isPrintAgentPath('/api/print-agent/jobs/claim')).toBe(true);
    expect(isPrintAgentPath('/api/print-agents')).toBe(false);
  });

  it('distinguishes missing configuration from invalid credentials', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest');
    const request = new Request('https://booth.test/api/print-agent/jobs/claim', {
      headers: { authorization: 'Bearer machine-token' },
    });

    expect((await authenticatePrintAgent(request, undefined))?.status).toBe(500);
    expect((await authenticatePrintAgent(request, 'expected-token'))?.status).toBe(401);
    expect(await authenticatePrintAgent(request, 'machine-token')).toBeNull();
    expect(platformTimingSafeEqual).toHaveBeenCalledTimes(2);
    expect(platformTimingSafeEqual).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.any(ArrayBuffer));
    expect((platformTimingSafeEqual.mock.calls[0]?.[0] as ArrayBuffer).byteLength).toBe(32);
    expect((platformTimingSafeEqual.mock.calls[0]?.[1] as ArrayBuffer).byteLength).toBe(32);
    expect(digest).toHaveBeenCalledTimes(4);
    expect(digest.mock.calls.every(([algorithm]) => algorithm === 'SHA-256')).toBe(true);
    digest.mockRestore();
  });

  it('authenticates print-agent routes before Astro without Access or origin checks', async () => {
    const env = { PRINT_AGENT_TOKEN: 'machine-token' } as Env;
    const context = {} as ExecutionContext;
    const crossOriginRequest = new Request('https://booth.test/api/print-agent/jobs/claim', {
      method: 'POST',
      headers: { authorization: 'Bearer machine-token', origin: 'https://agent-machine.test' },
    });

    const response = await worker.fetch(crossOriginRequest, env, context);

    expect(response.status).toBe(200);
    expect(handle).toHaveBeenCalledWith(crossOriginRequest, env, context);
  });

  it('rejects unauthenticated agent calls before Astro', async () => {
    const response = await worker.fetch(
      new Request('https://booth.test/api/print-agent/jobs/claim', { method: 'POST' }),
      { PRINT_AGENT_TOKEN: 'machine-token' } as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });
});
