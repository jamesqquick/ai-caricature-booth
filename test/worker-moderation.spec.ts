import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {
    env: unknown;

    constructor(_ctx: unknown, env: unknown) {
      this.env = env;
    }
  },
}));
vi.mock('@astrojs/cloudflare/handler', () => ({ handle: vi.fn() }));
vi.mock('../src/db/sessions', () => ({ transitionSession: vi.fn() }));
vi.mock('../src/lib/moderation', () => ({ moderateImage: vi.fn() }));
vi.mock('../src/lib/postcard', () => ({ buildPostcard: vi.fn() }));
vi.mock('../src/lib/replicate', () => ({ generateCaricature: vi.fn() }));

import { CaricatureWorkflow } from '../src/worker';
import { transitionSession } from '../src/db/sessions';
import { moderateImage } from '../src/lib/moderation';
import { buildPostcard } from '../src/lib/postcard';
import { generateCaricature } from '../src/lib/replicate';

const sessionId = '00000000-0000-4000-8000-000000000001';
const selfieKey = `sessions/${sessionId}/selfie.jpg`;
const payload = {
  sessionId,
  eventId: 1,
  sceneId: 'brooklyn-bridge',
  selfieKey,
  watermarkKey: null,
};

function createStep() {
  const calls: string[] = [];
  const step = {
    calls,
    async do<T>(name: string, configOrCallback: unknown, callback?: (ctx: { attempt: number }) => Promise<T>) {
      const config = typeof configOrCallback === 'function' ? {} : configOrCallback as { retries?: { limit?: number } };
      const run = typeof configOrCallback === 'function' ? configOrCallback as (ctx: { attempt: number }) => Promise<T> : callback!;
      const attempts = Math.max(1, config.retries?.limit ?? 1);
      calls.push(name);
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return await run({ attempt });
        } catch (error) {
          if (attempt === attempts) throw error;
        }
      }
      throw new Error(`Step did not run: ${name}`);
    },
  };
  return step;
}

function createEnvironment() {
  const selfie = {
    arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
  };
  return {
    env: {
      SELFIES: {
        get: vi.fn().mockResolvedValue(selfie),
        delete: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
      },
      DB: {},
      AI: {},
      REPLICATE_API_TOKEN: 'test-token',
    },
    selfie,
  };
}

function createWorkflow(env: unknown) {
  return new CaricatureWorkflow({} as ExecutionContext, env as Env);
}

describe('CaricatureWorkflow moderation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transitionSession).mockResolvedValue(undefined as never);
    vi.mocked(buildPostcard).mockResolvedValue({ ok: true, status: 200, body: new Uint8Array([4, 5, 6]) } as never);
    vi.mocked(generateCaricature).mockResolvedValue(new Uint8Array([7, 8, 9]));
  });

  it('rejects unsafe images, deletes the selfie, and never generates', async () => {
    vi.mocked(moderateImage).mockResolvedValue({ safe: false, reasons: ['sexual content'], raw: '', elapsedMs: 10 });
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    const result = await workflow.run({ instanceId: 'instance-1', payload } as never, createStep() as never);

    expect(result).toEqual({ sessionId, postcardKey: null });
    expect(env.SELFIES.delete).toHaveBeenCalledWith(selfieKey);
    expect(generateCaricature).not.toHaveBeenCalled();
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'errored', {
      error_msg: "Your photo didn't pass our content check. Please try again with a different selfie.",
    });
  });

  it('fails safely when the uploaded selfie is missing', async () => {
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    const { env } = createEnvironment();
    env.SELFIES.get.mockResolvedValue(null);
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: 'instance-1', payload } as never, createStep() as never)).rejects.toThrow('Uploaded selfie was not found.');

    expect(generateCaricature).not.toHaveBeenCalled();
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'errored', {
      error_msg: 'We could not check your photo. Please try again.',
    });
  });

  it('fails safely after all moderation attempts are exhausted', async () => {
    vi.mocked(moderateImage).mockRejectedValue(new Error('Workers AI unavailable'));
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: 'instance-1', payload } as never, createStep() as never)).rejects.toThrow('Workers AI unavailable');

    expect(moderateImage).toHaveBeenCalledTimes(2);
    expect(generateCaricature).not.toHaveBeenCalled();
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'errored', {
      error_msg: 'We could not check your photo. Please try again.',
    });
  });

  it('continues to generation only after a safe verdict', async () => {
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await workflow.run({ instanceId: 'instance-1', payload } as never, createStep() as never);

    expect(generateCaricature).toHaveBeenCalledTimes(1);
    expect(buildPostcard).toHaveBeenCalledTimes(1);
    expect(env.SELFIES.put).toHaveBeenCalled();
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'generating', expect.anything());
  });
});
