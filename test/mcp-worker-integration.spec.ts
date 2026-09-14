import { timingSafeEqual } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('jose', () => ({ createRemoteJWKSet: vi.fn(), jwtVerify: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ WorkflowEntrypoint: class {} }));
vi.mock('@astrojs/cloudflare/handler', () => ({ handle: vi.fn() }));
vi.mock('../src/db/sessions', () => ({ transitionSession: vi.fn() }));
vi.mock('../src/lib/moderation', () => ({ moderateImage: vi.fn() }));
vi.mock('../src/lib/postcard', () => ({ buildPostcard: vi.fn() }));
vi.mock('../src/lib/replicate', () => ({ generateCaricature: vi.fn() }));

import worker from '../src/worker';

describe('MCP Worker integration', () => {
  beforeAll(() => {
    Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
      configurable: true,
      value: (left: ArrayBuffer, right: ArrayBuffer) => (
        timingSafeEqual(new Uint8Array(left), new Uint8Array(right))
      ),
    });
  });

  afterAll(() => {
    Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual');
  });

  it('authenticates and initializes through the real MCP handler', async () => {
    const response = await worker.fetch(
      new Request('https://booth.test/mcp', {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer machine-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'worker-test-client', version: '1.0.0' },
          },
        }),
      }),
      {
        MCP_AUTH_TOKEN: 'machine-token',
        DB: {} as D1Database,
      } as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    const data = body.split('\n').find(line => line.startsWith('data: '));
    expect(data).toBeDefined();
    expect(JSON.parse(data!.slice(6))).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { serverInfo: { name: 'ai-caricature-booth-events', version: '1.0.0' } },
    });
  });
});
