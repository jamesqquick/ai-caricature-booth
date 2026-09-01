import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  sceneName: 'Brooklyn Bridge',
  sceneDescription: 'Stone arches and Manhattan behind the guest.',
  scenePrompt: 'Stored event scene prompt.',
  eventPromptPreamble: 'Use a bold editorial ink style.',
  eventConstraints: 'Use the event palette and avoid logos.',
  selfieKey,
  watermarkKey: 'events/1/watermarks/brand.png',
  watermarkWidth: 620,
};

function createStep() {
  const calls: string[] = [];
  const step = {
    calls,
    async do<T>(name: string, configOrCallback: unknown, callback?: (ctx: { attempt: number; config: { retries?: { limit: number } } }) => Promise<T>) {
      const config = typeof configOrCallback === 'function' ? {} : configOrCallback as { retries?: { limit?: number } };
      const run = typeof configOrCallback === 'function' ? configOrCallback as (ctx: { attempt: number; config: { retries?: { limit: number } } }) => Promise<T> : callback!;
      const attempts = Math.max(1, config.retries?.limit ?? 1);
      calls.push(name);
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return await run({ attempt, config: { retries: config.retries?.limit === undefined ? undefined : { limit: config.retries.limit } } });
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
      error_code: 'photo_rejected',
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
      error_code: 'moderation_unavailable',
    });
  });

  it('fails safely after all moderation attempts are exhausted', async () => {
    const diagnostic = 'moderation-sentinel-4f763c';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(moderateImage).mockRejectedValue(new Error(diagnostic));
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: 'instance-1', payload } as never, createStep() as never)).rejects.toThrow(diagnostic);

    expect(moderateImage).toHaveBeenCalledTimes(2);
    expect(generateCaricature).not.toHaveBeenCalled();
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'errored', {
      error_code: 'moderation_unavailable',
    });
    expect(JSON.stringify(errorLog.mock.calls)).toContain(diagnostic);
    expect(JSON.stringify(vi.mocked(transitionSession).mock.calls)).not.toContain(diagnostic);
  });

  it('does not mark moderation errored when the final attempt succeeds', async () => {
    vi.mocked(moderateImage)
      .mockRejectedValueOnce(new Error('Moderation attempt 1 failed.'))
      .mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await workflow.run({ instanceId: 'instance-1', payload } as never, createStep() as never);

    expect(moderateImage).toHaveBeenCalledTimes(2);
    expect(transitionSession).not.toHaveBeenCalledWith(expect.anything(), sessionId, 'errored', expect.anything());
  });

  it('continues to generation only after a safe verdict', async () => {
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    const { env, selfie } = createEnvironment();
    const workflow = createWorkflow(env);

    await workflow.run({ instanceId: 'instance-1', payload } as never, createStep() as never);

    expect(generateCaricature).toHaveBeenCalledTimes(1);
    expect(generateCaricature).toHaveBeenCalledWith(
      'test-token',
      expect.any(Uint8Array),
      'Use a bold editorial ink style. Stored event scene prompt. Stone arches and Manhattan behind the guest. Use the event palette and avoid logos. Keep the person recognizable, expressive, and centered. No text.',
    );
    expect(buildPostcard).toHaveBeenCalledWith(env, selfie, payload.watermarkKey, payload.watermarkWidth);
    expect(env.SELFIES.put).toHaveBeenCalled();
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'generating', expect.anything());
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'completed', expect.objectContaining({
      pipeline_ms: expect.any(Number),
    }));
  });

  it('marks the session errored after postcard composition exhausts its configured attempts', async () => {
    const diagnostic = 'composition-sentinel-d64e91';
    const postcardError = new Error(diagnostic);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    vi.mocked(buildPostcard).mockRejectedValue(postcardError);
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: 'instance-1', payload } as never, createStep() as never)).rejects.toBe(postcardError);

    expect(buildPostcard).toHaveBeenCalledTimes(2);
    expect(transitionSession).toHaveBeenLastCalledWith(expect.anything(), sessionId, 'errored', {
      error_code: 'composition_failed',
    });
    expect(JSON.stringify(errorLog.mock.calls)).toContain(diagnostic);
    expect(JSON.stringify(vi.mocked(transitionSession).mock.calls)).not.toContain(diagnostic);
  });

  it('does not mark composition errored when the final attempt succeeds', async () => {
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    vi.mocked(buildPostcard)
      .mockRejectedValueOnce(new Error('Composition attempt 1 failed.'))
      .mockResolvedValue({ ok: true, status: 200, body: new Uint8Array([4, 5, 6]) } as never);
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await workflow.run({ instanceId: 'instance-1', payload } as never, createStep() as never);

    expect(buildPostcard).toHaveBeenCalledTimes(2);
    expect(transitionSession).not.toHaveBeenCalledWith(expect.anything(), sessionId, 'errored', expect.anything());
  });

  it('logs image-generation diagnostics but persists only the stable failure code', async () => {
    const diagnostic = 'generation-sentinel-e8ca25';
    const generationError = new Error(diagnostic);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    vi.mocked(generateCaricature).mockRejectedValue(generationError);
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: 'instance-1', payload } as never, createStep() as never)).rejects.toBe(generationError);

    expect(generateCaricature).toHaveBeenCalledTimes(1);
    expect(transitionSession).toHaveBeenLastCalledWith(expect.anything(), sessionId, 'errored', {
      error_code: 'generation_failed',
    });
    expect(JSON.stringify(errorLog.mock.calls)).toContain(diagnostic);
    expect(JSON.stringify(vi.mocked(transitionSession).mock.calls)).not.toContain(diagnostic);
  });
});
