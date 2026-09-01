import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    const request = new Request('https://booth.test/api/print-agent/jobs/claim', {
      headers: { authorization: 'Bearer machine-token' },
    });

    expect((await authenticatePrintAgent(request, undefined))?.status).toBe(500);
    expect((await authenticatePrintAgent(request, 'expected-token'))?.status).toBe(401);
    expect(await authenticatePrintAgent(request, 'machine-token')).toBeNull();
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
