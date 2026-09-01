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
vi.mock('../src/db/sessions', () => ({ loadSession: vi.fn(), transitionSession: vi.fn() }));
vi.mock('../src/lib/moderation', () => ({ moderateImage: vi.fn() }));
vi.mock('../src/lib/postcard', () => ({ buildPostcard: vi.fn() }));
vi.mock('../src/lib/replicate', () => ({ generateCaricature: vi.fn() }));

import { CaricatureWorkflow } from '../src/worker';
import { loadSession, transitionSession } from '../src/db/sessions';
import { moderateImage } from '../src/lib/moderation';
import { buildPostcard } from '../src/lib/postcard';
import { generateCaricature } from '../src/lib/replicate';

const sessionId = '00000000-0000-4000-8000-000000000001';
const workflowInstanceId = 'instance-1';
const selfieSha256 = '1a493b22d4b17319c1fae01707e77e4c93e3836b84e766722cc61189ee89e224';
const workflowPrefix = `sessions/${sessionId}/${workflowInstanceId}`;
const selfieKey = `${workflowPrefix}/selfie.jpg`;
const caricatureKey = `${workflowPrefix}/caricature.jpg`;
const postcardKey = `${workflowPrefix}/postcard.jpg`;
const legacySelfieKey = `sessions/${sessionId}/selfie.jpg`;
const legacySelfieSha256 = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
const payload = {
  sessionId,
  workflowInstanceId,
  eventId: 1,
  sceneId: 'brooklyn-bridge',
  sceneName: 'Brooklyn Bridge',
  sceneDescription: 'Stone arches and Manhattan behind the guest.',
  scenePrompt: 'Stored event scene prompt.',
  eventPromptPreamble: 'Use a bold editorial ink style.',
  eventConstraints: 'Use the event palette and avoid logos.',
  selfieKey,
  selfieSha256,
  watermarkKey: 'events/1/watermarks/brand.png',
  watermarkWidth: 620,
};
const sessionRecord = {
  id: sessionId,
  event_id: payload.eventId,
  status: 'uploading' as const,
  scene_id: payload.sceneId,
  scene_name: payload.sceneName,
  selfie_key: selfieKey,
  selfie_sha256: selfieSha256,
  caricature_key: null,
  postcard_key: null,
  workflow_instance_id: workflowInstanceId,
  error_code: null,
  error_msg: null,
  created_at: 1,
  completed_at: null,
  pipeline_ms: null,
  updated_at: 1,
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
    httpMetadata: { contentType: 'image/jpeg' },
    customMetadata: {
      sessionId,
      eventId: String(payload.eventId),
      workflowInstanceId,
      assetKind: 'selfie',
      selfieSha256,
    },
  };
  const caricature = {
    body: new ReadableStream(),
    httpMetadata: { contentType: 'image/jpeg' },
    customMetadata: {
      sessionId,
      eventId: String(payload.eventId),
      workflowInstanceId,
      assetKind: 'caricature',
      sceneId: payload.sceneId,
    },
  };
  return {
    env: {
      SELFIES: {
        head: vi.fn().mockResolvedValue(selfie),
        get: vi.fn().mockImplementation(async (key: string) => key === selfieKey ? selfie : caricature),
        delete: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
      },
      DB: {},
      AI: {},
      REPLICATE_API_TOKEN: 'test-token',
    },
    selfie,
    caricature,
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
    vi.mocked(loadSession).mockResolvedValue(sessionRecord);
    vi.mocked(transitionSession).mockResolvedValue(undefined as never);
    vi.mocked(buildPostcard).mockResolvedValue({ ok: true, status: 200, body: new Uint8Array([4, 5, 6]) } as never);
    vi.mocked(generateCaricature).mockResolvedValue(new Uint8Array([7, 8, 9]));
  });

  it('rejects unsafe images, deletes the selfie, and never generates', async () => {
    vi.mocked(moderateImage).mockResolvedValue({ safe: false, reasons: ['sexual content'], raw: '', elapsedMs: 10 });
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    const result = await workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never);

    expect(result).toEqual({ sessionId, postcardKey: null });
    expect(env.SELFIES.delete).toHaveBeenCalledWith(selfieKey);
    expect(generateCaricature).not.toHaveBeenCalled();
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'errored', {
      error_code: 'photo_rejected',
    }, workflowInstanceId);
  });

  it('fails safely when the uploaded selfie is missing', async () => {
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    const { env } = createEnvironment();
    env.SELFIES.get.mockResolvedValue(null);
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never)).rejects.toThrow('Uploaded selfie was not found.');

    expect(generateCaricature).not.toHaveBeenCalled();
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'errored', {
      error_code: 'moderation_unavailable',
    }, workflowInstanceId);
  });

  it('fails safely after all moderation attempts are exhausted', async () => {
    const diagnostic = 'moderation-sentinel-4f763c';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(moderateImage).mockRejectedValue(new Error(diagnostic));
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never)).rejects.toThrow(diagnostic);

    expect(moderateImage).toHaveBeenCalledTimes(2);
    expect(generateCaricature).not.toHaveBeenCalled();
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'errored', {
      error_code: 'moderation_unavailable',
    }, workflowInstanceId);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(diagnostic);
    expect(JSON.stringify(vi.mocked(transitionSession).mock.calls)).not.toContain(diagnostic);
  });

  it('does not mark moderation errored when the final attempt succeeds', async () => {
    vi.mocked(moderateImage)
      .mockRejectedValueOnce(new Error('Moderation attempt 1 failed.'))
      .mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never);

    expect(moderateImage).toHaveBeenCalledTimes(2);
    expect(transitionSession).not.toHaveBeenCalledWith(expect.anything(), sessionId, 'errored', expect.anything());
  });

  it('continues to generation only after a safe verdict', async () => {
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    const { env, caricature } = createEnvironment();
    const workflow = createWorkflow(env);

    await workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never);

    expect(generateCaricature).toHaveBeenCalledTimes(1);
    expect(generateCaricature).toHaveBeenCalledWith(
      'test-token',
      expect.any(Uint8Array),
      'Use a bold editorial ink style. Stored event scene prompt. Stone arches and Manhattan behind the guest. Use the event palette and avoid logos. Keep the person recognizable, expressive, and centered. No text.',
    );
    expect(buildPostcard).toHaveBeenCalledWith(env, caricature, payload.watermarkKey, payload.watermarkWidth);
    expect(env.SELFIES.put).toHaveBeenNthCalledWith(
      1,
      caricatureKey,
      new Uint8Array([7, 8, 9]),
      {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: {
          sessionId,
          eventId: String(payload.eventId),
          workflowInstanceId,
          assetKind: 'caricature',
          sceneId: payload.sceneId,
        },
      },
    );
    expect(env.SELFIES.put).toHaveBeenNthCalledWith(
      2,
      postcardKey,
      new Uint8Array([4, 5, 6]),
      {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: {
          sessionId,
          eventId: String(payload.eventId),
          workflowInstanceId,
          assetKind: 'postcard',
          sceneId: payload.sceneId,
        },
      },
    );
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'generating', expect.anything(), workflowInstanceId);
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'compositing', {
      scene_name: payload.sceneName,
      caricature_key: caricatureKey,
    }, workflowInstanceId);
    expect(transitionSession).toHaveBeenCalledWith(expect.anything(), sessionId, 'completed', expect.objectContaining({
      postcard_key: postcardKey,
      pipeline_ms: expect.any(Number),
    }), workflowInstanceId);
  });

  it('marks the session errored after postcard composition exhausts its configured attempts', async () => {
    const diagnostic = 'composition-sentinel-d64e91';
    const postcardError = new Error(diagnostic);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    vi.mocked(buildPostcard).mockRejectedValue(postcardError);
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never)).rejects.toBe(postcardError);

    expect(buildPostcard).toHaveBeenCalledTimes(2);
    expect(transitionSession).toHaveBeenLastCalledWith(expect.anything(), sessionId, 'errored', {
      error_code: 'composition_failed',
    }, workflowInstanceId);
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

    await workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never);

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

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never)).rejects.toBe(generationError);

    expect(generateCaricature).toHaveBeenCalledTimes(1);
    expect(transitionSession).toHaveBeenLastCalledWith(expect.anything(), sessionId, 'errored', {
      error_code: 'generation_failed',
    }, workflowInstanceId);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(diagnostic);
    expect(JSON.stringify(vi.mocked(transitionSession).mock.calls)).not.toContain(diagnostic);
  });

  it('exits before workflow steps when the session belongs to a newer workflow', async () => {
    vi.mocked(loadSession).mockResolvedValue({
      ...sessionRecord,
      workflow_instance_id: 'replacement-instance',
    });
    const { env } = createEnvironment();
    const step = createStep();
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, step as never)).resolves.toEqual({
      sessionId,
      postcardKey: null,
    });

    expect(step.calls).toEqual([]);
    expect(moderateImage).not.toHaveBeenCalled();
    expect(generateCaricature).not.toHaveBeenCalled();
    expect(buildPostcard).not.toHaveBeenCalled();
    expect(env.SELFIES.get).not.toHaveBeenCalled();
    expect(env.SELFIES.put).not.toHaveBeenCalled();
    expect(env.SELFIES.delete).not.toHaveBeenCalled();
    expect(transitionSession).not.toHaveBeenCalled();
  });

  it('stops before generation when ownership changes after moderation', async () => {
    let ownsSession = true;
    vi.mocked(loadSession).mockImplementation(async () => ({
      ...sessionRecord,
      workflow_instance_id: ownsSession ? workflowInstanceId : 'replacement-instance',
    }));
    vi.mocked(moderateImage).mockImplementation(async () => {
      ownsSession = false;
      return { safe: true, reasons: [], raw: '', elapsedMs: 10 };
    });
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never)).resolves.toEqual({
      sessionId,
      postcardKey: null,
    });

    expect(moderateImage).toHaveBeenCalledTimes(1);
    expect(generateCaricature).not.toHaveBeenCalled();
    expect(buildPostcard).not.toHaveBeenCalled();
    expect(env.SELFIES.put).not.toHaveBeenCalled();
  });

  it('does not delete a replacement selfie when ownership changes after rejection', async () => {
    let ownsSession = true;
    vi.mocked(loadSession).mockImplementation(async () => ({
      ...sessionRecord,
      workflow_instance_id: ownsSession ? workflowInstanceId : 'replacement-instance',
    }));
    vi.mocked(moderateImage).mockImplementation(async () => {
      ownsSession = false;
      return { safe: false, reasons: ['sexual content'], raw: '', elapsedMs: 10 };
    });
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never)).resolves.toEqual({
      sessionId,
      postcardKey: null,
    });

    expect(env.SELFIES.delete).not.toHaveBeenCalled();
    expect(transitionSession).not.toHaveBeenCalledWith(expect.anything(), sessionId, 'errored', expect.anything(), workflowInstanceId);
  });

  it('does not send a selfie with mismatched metadata to moderation', async () => {
    const { env, selfie } = createEnvironment();
    selfie.customMetadata.workflowInstanceId = 'replacement-instance';
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never)).resolves.toEqual({
      sessionId,
      postcardKey: null,
    });

    expect(moderateImage).not.toHaveBeenCalled();
    expect(generateCaricature).not.toHaveBeenCalled();
    expect(env.SELFIES.put).not.toHaveBeenCalled();
  });

  it('does not send a replaced selfie to generation', async () => {
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    const { env, selfie } = createEnvironment();
    env.SELFIES.get
      .mockResolvedValueOnce(selfie)
      .mockResolvedValueOnce({
        ...selfie,
        customMetadata: { ...selfie.customMetadata, workflowInstanceId: 'replacement-instance' },
      });
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never)).resolves.toEqual({
      sessionId,
      postcardKey: null,
    });

    expect(moderateImage).toHaveBeenCalledTimes(1);
    expect(generateCaricature).not.toHaveBeenCalled();
    expect(env.SELFIES.put).not.toHaveBeenCalled();
  });

  it('does not store generated output after losing ownership', async () => {
    let ownsSession = true;
    vi.mocked(loadSession).mockImplementation(async () => ({
      ...sessionRecord,
      workflow_instance_id: ownsSession ? workflowInstanceId : 'replacement-instance',
    }));
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    vi.mocked(generateCaricature).mockImplementation(async () => {
      ownsSession = false;
      return new Uint8Array([7, 8, 9]);
    });
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never)).resolves.toEqual({
      sessionId,
      postcardKey: null,
    });

    expect(generateCaricature).toHaveBeenCalledTimes(1);
    expect(env.SELFIES.put).not.toHaveBeenCalled();
    expect(buildPostcard).not.toHaveBeenCalled();
  });

  it.each([
    ['missing metadata', {}],
    ['mismatched workflow metadata', {
      sessionId,
      eventId: String(payload.eventId),
      workflowInstanceId: 'replacement-instance',
      assetKind: 'caricature',
    }],
  ])('rejects generated caricature ownership with %s before composition', async (_label, customMetadata) => {
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    const { env, caricature } = createEnvironment();
    caricature.customMetadata = customMetadata as typeof caricature.customMetadata;
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never)).resolves.toEqual({
      sessionId,
      postcardKey: null,
    });

    expect(buildPostcard).not.toHaveBeenCalled();
    expect(env.SELFIES.put).not.toHaveBeenCalledWith(postcardKey, expect.anything(), expect.anything());
  });

  it('recovers a legacy in-flight selfie by hashing its bytes when metadata is absent', async () => {
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    vi.mocked(loadSession).mockResolvedValue({
      ...sessionRecord,
      selfie_key: legacySelfieKey,
      selfie_sha256: legacySelfieSha256,
    });
    const { env, selfie, caricature } = createEnvironment();
    const legacySelfie = { ...selfie, customMetadata: {} };
    env.SELFIES.get.mockImplementation(async (key: string) => key === legacySelfieKey ? legacySelfie : caricature);
    const workflow = createWorkflow(env);

    await workflow.run({
      instanceId: workflowInstanceId,
      payload: { ...payload, selfieKey: legacySelfieKey, selfieSha256: undefined },
    } as never, createStep() as never);

    expect(moderateImage).toHaveBeenCalledTimes(1);
    expect(generateCaricature).toHaveBeenCalledTimes(1);
  });

  it('rejects a legacy in-flight selfie when its bytes do not match the persisted hash', async () => {
    vi.mocked(loadSession).mockResolvedValue({
      ...sessionRecord,
      selfie_key: legacySelfieKey,
      selfie_sha256: 'mismatched-sha256',
    });
    const { env, selfie, caricature } = createEnvironment();
    const legacySelfie = { ...selfie, customMetadata: {} };
    env.SELFIES.get.mockImplementation(async (key: string) => key === legacySelfieKey ? legacySelfie : caricature);
    const workflow = createWorkflow(env);

    await expect(workflow.run({
      instanceId: workflowInstanceId,
      payload: { ...payload, selfieKey: legacySelfieKey, selfieSha256: undefined },
    } as never, createStep() as never)).resolves.toEqual({ sessionId, postcardKey: null });

    expect(moderateImage).not.toHaveBeenCalled();
    expect(generateCaricature).not.toHaveBeenCalled();
  });

  it('rejects conflicting ownership metadata on a legacy in-flight selfie', async () => {
    vi.mocked(loadSession).mockResolvedValue({
      ...sessionRecord,
      selfie_key: legacySelfieKey,
      selfie_sha256: legacySelfieSha256,
    });
    const { env, selfie, caricature } = createEnvironment();
    const legacySelfie = {
      ...selfie,
      customMetadata: { sessionId: 'replacement-session' },
    };
    env.SELFIES.get.mockImplementation(async (key: string) => key === legacySelfieKey ? legacySelfie : caricature);
    const workflow = createWorkflow(env);

    await expect(workflow.run({
      instanceId: workflowInstanceId,
      payload: { ...payload, selfieKey: legacySelfieKey, selfieSha256: undefined },
    } as never, createStep() as never)).resolves.toEqual({ sessionId, postcardKey: null });

    expect(moderateImage).not.toHaveBeenCalled();
  });

  it('never reads assets from a replacement workflow after an entry-check interleaving', async () => {
    const replacementWorkflowInstanceId = 'instance-2';
    const replacementSelfieKey = `sessions/${sessionId}/${replacementWorkflowInstanceId}/selfie.jpg`;
    vi.mocked(loadSession)
      .mockResolvedValueOnce(sessionRecord)
      .mockResolvedValue({
        ...sessionRecord,
        selfie_key: replacementSelfieKey,
        workflow_instance_id: replacementWorkflowInstanceId,
      });
    const { env } = createEnvironment();
    const workflow = createWorkflow(env);

    await expect(workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never)).resolves.toEqual({
      sessionId,
      postcardKey: null,
    });

    expect(env.SELFIES.get).not.toHaveBeenCalledWith(replacementSelfieKey);
    expect(env.SELFIES.put).not.toHaveBeenCalled();
    expect(env.SELFIES.delete).not.toHaveBeenCalled();
  });

  it('cannot delete a replacement workflow selfie after a final-check interleaving', async () => {
    let currentSession = sessionRecord;
    const replacementWorkflowInstanceId = 'instance-2';
    const replacementSelfieKey = `sessions/${sessionId}/${replacementWorkflowInstanceId}/selfie.jpg`;
    vi.mocked(loadSession).mockImplementation(async () => currentSession);
    vi.mocked(moderateImage).mockResolvedValue({ safe: false, reasons: ['unsafe'], raw: '', elapsedMs: 10 });
    const { env, selfie, caricature } = createEnvironment();
    let selfieReads = 0;
    env.SELFIES.get.mockImplementation(async (key: string) => {
      if (key !== selfieKey) return caricature;
      selfieReads += 1;
      if (selfieReads === 2) {
        currentSession = {
          ...sessionRecord,
          selfie_key: replacementSelfieKey,
          workflow_instance_id: replacementWorkflowInstanceId,
        };
      }
      return selfie;
    });
    const workflow = createWorkflow(env);

    await workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never);

    expect(env.SELFIES.delete).toHaveBeenCalledWith(selfieKey);
    expect(env.SELFIES.delete).not.toHaveBeenCalledWith(replacementSelfieKey);
  });

  it('cannot overwrite replacement workflow outputs after a write interleaving', async () => {
    let currentSession = sessionRecord;
    const replacementWorkflowInstanceId = 'instance-2';
    const replacementCaricatureKey = `sessions/${sessionId}/${replacementWorkflowInstanceId}/caricature.jpg`;
    vi.mocked(loadSession).mockImplementation(async () => currentSession);
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, reasons: [], raw: '', elapsedMs: 10 });
    const { env } = createEnvironment();
    env.SELFIES.put.mockImplementation(async (key: string) => {
      if (key === caricatureKey) {
        currentSession = {
          ...sessionRecord,
          workflow_instance_id: replacementWorkflowInstanceId,
        };
      }
      return {} as R2Object;
    });
    const workflow = createWorkflow(env);

    await workflow.run({ instanceId: workflowInstanceId, payload } as never, createStep() as never);

    expect(env.SELFIES.put).toHaveBeenCalledWith(caricatureKey, expect.anything(), expect.anything());
    expect(env.SELFIES.put).not.toHaveBeenCalledWith(replacementCaricatureKey, expect.anything(), expect.anything());
  });
});
