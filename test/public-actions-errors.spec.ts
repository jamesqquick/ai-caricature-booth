import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeEnv = vi.hoisted(() => ({
  DB: {},
  SELFIES: {
    head: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
  },
  CARICATURE_WORKFLOW: {
    create: vi.fn(),
    get: vi.fn(),
  },
}));
const loadActiveEventById = vi.hoisted(() => vi.fn());
const loadActiveEventBySlug = vi.hoisted(() => vi.fn());
const loadEventById = vi.hoisted(() => vi.fn());
const loadEventScene = vi.hoisted(() => vi.fn());
const claimWorkflowInstanceId = vi.hoisted(() => vi.fn());
const createPendingSession = vi.hoisted(() => vi.fn());
const loadSession = vi.hoisted(() => vi.fn());
const transitionSession = vi.hoisted(() => vi.fn());

vi.mock('astro:actions', () => ({
  ActionError: class ActionError extends Error {
    code: string;

    constructor({ code, message }: { code: string; message: string }) {
      super(message);
      this.name = 'ActionError';
      this.code = code;
    }
  },
  defineAction: (definition: unknown) => definition,
}));
vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/events', () => ({ loadActiveEventById, loadActiveEventBySlug, loadEventById }));
vi.mock('../src/db/scenes', () => ({ loadEventScene }));
vi.mock('../src/db/sessions', () => ({ claimWorkflowInstanceId, createPendingSession, loadSession, transitionSession }));

import { server } from '../src/actions';

const sessionId = '00000000-0000-4000-8000-000000000001';
const workflowInstanceId = '10000000-0000-4000-8000-000000000002';
const selfieSha256 = '1a493b22d4b17319c1fae01707e77e4c93e3836b84e766722cc61189ee89e224';
const event = {
  id: 7,
  slug: 'launch-night',
  scene_style_preamble: null,
  scene_constraints: null,
  watermark_image_key: null,
  watermark_w: null,
};
const scene = {
  id: 'brooklyn-bridge',
  name: 'Brooklyn Bridge',
  description: 'A bridge scene.',
  prompt: 'Draw the guest at the bridge.',
};
const session = {
  id: sessionId,
  event_id: event.id,
  status: 'uploading',
  scene_id: scene.id,
  scene_name: scene.name,
  selfie_key: `sessions/${sessionId}/selfie.jpg`,
  selfie_sha256: selfieSha256,
  caricature_key: null,
  postcard_key: null,
  workflow_instance_id: null,
  error_code: null,
  error_msg: null,
  created_at: 1,
  completed_at: null,
  pipeline_ms: null,
  updated_at: 1,
};
const validJpeg = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xda, 0x00, 0x02,
  0xff, 0xd9,
]);

type TestAction = { handler: (input: Record<string, unknown>) => Promise<unknown> };
type TestSession = NonNullable<Awaited<ReturnType<typeof loadSession>>>;

const startGeneration = (server.startGeneration as unknown as TestAction).handler;
const getGeneration = (server.getGeneration as unknown as TestAction).handler;

function startInput(file = new File([validJpeg], 'selfie.jpg', { type: 'image/jpeg' })) {
  return {
    eventSlug: event.slug,
    sceneId: scene.id,
    idempotencyKey: sessionId,
    selfie: file,
  };
}

async function caughtError(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error('Expected action to fail.');
}

function expectContained(error: Error & { code?: string }, diagnostic: string) {
  expect(error).toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
    message: expect.not.stringContaining(diagnostic),
  });
  expect(JSON.stringify(error)).not.toContain(diagnostic);
}

describe('public action error boundaries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    let currentSession: Record<string, unknown> = session;
    loadActiveEventById.mockResolvedValue(event);
    loadActiveEventBySlug.mockResolvedValue(event);
    loadEventById.mockResolvedValue(event);
    loadEventScene.mockResolvedValue(scene);
    createPendingSession.mockResolvedValue({ session, created: false });
    loadSession.mockImplementation(async () => currentSession);
    claimWorkflowInstanceId.mockImplementation(async () => {
      currentSession = { ...currentSession, workflow_instance_id: sessionId };
      return currentSession;
    });
    transitionSession.mockImplementation(async (_database, _sessionId, status, _fields, expectedWorkflowInstanceId) => {
      currentSession = { ...currentSession, status, workflow_instance_id: expectedWorkflowInstanceId };
      return currentSession;
    });
    fakeEnv.SELFIES.head.mockResolvedValue({
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {
        sessionId,
        eventId: String(event.id),
        workflowInstanceId: sessionId,
        assetKind: 'selfie',
        selfieSha256,
      },
    });
    fakeEnv.SELFIES.put.mockResolvedValue(undefined);
    fakeEnv.SELFIES.get.mockResolvedValue(null);
    fakeEnv.CARICATURE_WORKFLOW.create.mockResolvedValue(undefined);
  });

  it('contains D1 diagnostics from getGeneration', async () => {
    const diagnostic = 'd1-sentinel-a3b17f';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadSession.mockRejectedValue(new Error(diagnostic));

    const error = await caughtError(() => getGeneration({ sessionId }));

    expectContained(error, diagnostic);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(diagnostic);
  });

  it('contains R2 diagnostics from startGeneration', async () => {
    const diagnostic = 'r2-sentinel-f917b2';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeEnv.SELFIES.head.mockRejectedValue(new Error(diagnostic));

    const error = await caughtError(() => startGeneration(startInput()));

    expectContained(error, diagnostic);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(diagnostic);
  });

  it('overwrites stale selfie metadata when a deleted session UUID is reused', async () => {
    fakeEnv.SELFIES.head.mockResolvedValue({
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {
        sessionId,
        eventId: '999',
        assetKind: 'selfie',
        selfieSha256: 'stale-selfie-sha256',
      },
    });

    await startGeneration(startInput());

    expect(fakeEnv.SELFIES.put).toHaveBeenCalledWith(session.selfie_key, validJpeg, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {
        sessionId,
        eventId: String(event.id),
        workflowInstanceId: sessionId,
        assetKind: 'selfie',
        selfieSha256,
      },
    });
  });

  it('persists a legacy workflow identity before starting its workflow', async () => {
    await startGeneration(startInput());

    expect(claimWorkflowInstanceId).toHaveBeenCalledWith(fakeEnv.DB, sessionId, sessionId);
    expect(fakeEnv.CARICATURE_WORKFLOW.create).toHaveBeenCalledWith(expect.objectContaining({
      id: sessionId,
      params: expect.objectContaining({ workflowInstanceId: sessionId, selfieSha256 }),
    }));
    expect(fakeEnv.SELFIES.get).not.toHaveBeenCalled();
  });

  it('does not adopt a workflow identity claimed by another request', async () => {
    claimWorkflowInstanceId.mockResolvedValue({ ...session, workflow_instance_id: 'replacement-instance' });

    await expect(caughtError(() => startGeneration(startInput()))).resolves.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: "Couldn't start your postcard. Please try again.",
    });

    expect(fakeEnv.SELFIES.put).not.toHaveBeenCalled();
    expect(fakeEnv.CARICATURE_WORKFLOW.create).not.toHaveBeenCalled();
  });

  it('creates new sessions and selfies under a workflow-scoped key', async () => {
    const scopedSelfieKey = `sessions/${sessionId}/${workflowInstanceId}/selfie.jpg`;
    const scopedSession = {
      ...session,
      status: 'uploading',
      selfie_key: scopedSelfieKey,
      workflow_instance_id: workflowInstanceId,
    };
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(workflowInstanceId);
    loadSession.mockResolvedValueOnce(null).mockResolvedValue(scopedSession);
    createPendingSession.mockResolvedValue({ session: { ...scopedSession, status: 'pending' }, created: true });
    transitionSession.mockResolvedValue(scopedSession);
    fakeEnv.SELFIES.head
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: {
          sessionId,
          eventId: String(event.id),
          workflowInstanceId,
          assetKind: 'selfie',
          selfieSha256,
        },
      });

    await startGeneration(startInput());

    expect(createPendingSession).toHaveBeenCalledWith(fakeEnv.DB, expect.objectContaining({
      id: sessionId,
      selfie_key: scopedSelfieKey,
      workflow_instance_id: workflowInstanceId,
    }));
    expect(fakeEnv.SELFIES.put).toHaveBeenCalledWith(scopedSelfieKey, validJpeg, expect.anything());
    expect(fakeEnv.SELFIES.put).not.toHaveBeenCalledWith(`sessions/${sessionId}/selfie.jpg`, expect.anything(), expect.anything());
  });

  it('uses a fresh workflow identity when a session UUID is recreated', async () => {
    const oldInstance = {
      status: vi.fn().mockResolvedValue({ status: 'errored' }),
      restart: vi.fn(),
      resume: vi.fn(),
    };
    const recreatedSession = {
      ...session,
      selfie_key: `sessions/${sessionId}/${workflowInstanceId}/selfie.jpg`,
      workflow_instance_id: workflowInstanceId,
    };
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(workflowInstanceId);
    loadSession.mockResolvedValueOnce(null).mockResolvedValue(recreatedSession);
    createPendingSession.mockResolvedValue({ session: recreatedSession, created: true });
    fakeEnv.SELFIES.head
      .mockResolvedValueOnce({
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: {
          sessionId,
          eventId: String(event.id),
          workflowInstanceId: sessionId,
          assetKind: 'selfie',
          selfieSha256,
        },
      })
      .mockResolvedValue({
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: {
          sessionId,
          eventId: String(event.id),
          workflowInstanceId,
          assetKind: 'selfie',
          selfieSha256,
        },
      });
    fakeEnv.CARICATURE_WORKFLOW.create.mockImplementation(async ({ id }: { id: string }) => {
      if (id === sessionId) throw new Error('Retained workflow instance');
    });
    fakeEnv.CARICATURE_WORKFLOW.get.mockResolvedValue(oldInstance);

    await expect(startGeneration(startInput())).resolves.toEqual({ sessionId, status: 'uploading' });

    expect(createPendingSession).toHaveBeenCalledWith(fakeEnv.DB, expect.objectContaining({
      id: sessionId,
      workflow_instance_id: workflowInstanceId,
    }));
    expect(fakeEnv.CARICATURE_WORKFLOW.create).toHaveBeenCalledWith(expect.objectContaining({ id: workflowInstanceId }));
    expect(fakeEnv.CARICATURE_WORKFLOW.create).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ workflowInstanceId, selfieSha256 }),
    }));
    expect(fakeEnv.CARICATURE_WORKFLOW.get).not.toHaveBeenCalled();
    expect(oldInstance.restart).not.toHaveBeenCalled();
    expect(oldInstance.resume).not.toHaveBeenCalled();
  });

  it('rejects a row recreated between a new selfie upload and session reload', async () => {
    const oldPrompt = 'old-prompt-sentinel';
    const oldWatermark = 'events/7/watermarks/old-watermark.png';
    const scopedSelfieKey = `sessions/${sessionId}/${workflowInstanceId}/selfie.jpg`;
    const claimedSession = {
      ...session,
      status: 'uploading',
      selfie_key: scopedSelfieKey,
      workflow_instance_id: workflowInstanceId,
    };
    const replacementSession = {
      ...claimedSession,
      event_id: 8,
      scene_id: 'replacement-scene',
      selfie_key: `sessions/${sessionId}/replacement/selfie.jpg`,
      selfie_sha256: 'replacement-hash',
      workflow_instance_id: 'replacement',
    };
    const oldInstance = {
      status: vi.fn(),
      restart: vi.fn(),
      resume: vi.fn(),
    };
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(workflowInstanceId);
    loadSession.mockResolvedValueOnce(null).mockResolvedValue(replacementSession);
    createPendingSession.mockResolvedValue({ session: { ...claimedSession, status: 'pending' }, created: true });
    transitionSession.mockResolvedValue(claimedSession);
    loadEventScene.mockResolvedValue({ ...scene, prompt: oldPrompt });
    loadActiveEventBySlug.mockResolvedValue({ ...event, watermark_image_key: oldWatermark });
    fakeEnv.SELFIES.head.mockResolvedValue(null);
    fakeEnv.CARICATURE_WORKFLOW.get.mockResolvedValue(oldInstance);

    await expect(caughtError(() => startGeneration(startInput()))).resolves.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: "Couldn't start your postcard. Please try again.",
    });

    expect(fakeEnv.SELFIES.put).toHaveBeenCalledWith(scopedSelfieKey, validJpeg, expect.anything());
    expect(fakeEnv.CARICATURE_WORKFLOW.create).not.toHaveBeenCalled();
    expect(fakeEnv.CARICATURE_WORKFLOW.get).not.toHaveBeenCalled();
    expect(oldInstance.restart).not.toHaveBeenCalled();
    expect(oldInstance.resume).not.toHaveBeenCalled();
    expect(JSON.stringify(fakeEnv.CARICATURE_WORKFLOW.create.mock.calls)).not.toContain(oldPrompt);
    expect(JSON.stringify(fakeEnv.CARICATURE_WORKFLOW.create.mock.calls)).not.toContain(oldWatermark);
  });

  it('revalidates the claim inside ensureWorkflow before creating or recovering an instance', async () => {
    const ownedSession = { ...session, status: 'moderating', workflow_instance_id: sessionId };
    const replacementSession = {
      ...ownedSession,
      scene_id: 'replacement-scene',
      workflow_instance_id: 'replacement-instance',
    };
    const instance = {
      status: vi.fn(),
      restart: vi.fn(),
      resume: vi.fn(),
    };
    loadSession
      .mockResolvedValueOnce(ownedSession)
      .mockResolvedValueOnce(ownedSession)
      .mockResolvedValue(replacementSession);
    fakeEnv.CARICATURE_WORKFLOW.get.mockResolvedValue(instance);

    await expect(caughtError(() => startGeneration(startInput()))).resolves.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: "Couldn't start your postcard. Please try again.",
    });

    expect(fakeEnv.CARICATURE_WORKFLOW.create).not.toHaveBeenCalled();
    expect(fakeEnv.CARICATURE_WORKFLOW.get).not.toHaveBeenCalled();
    expect(instance.restart).not.toHaveBeenCalled();
    expect(instance.resume).not.toHaveBeenCalled();
  });

  it.each([
    ['get', 3, 'errored'],
    ['restart', 4, 'errored'],
    ['resume', 4, 'paused'],
  ])('revalidates the claim immediately before workflow %s', async (operation, validReads, workflowStatus) => {
    const ownedSession = { ...session, status: 'generating', workflow_instance_id: sessionId };
    const replacementSession = { ...ownedSession, workflow_instance_id: 'replacement-instance' };
    const instance = {
      status: vi.fn().mockResolvedValue({ status: workflowStatus }),
      restart: vi.fn(),
      resume: vi.fn(),
    };
    for (let index = 0; index < validReads; index += 1) {
      loadSession.mockResolvedValueOnce(ownedSession);
    }
    loadSession.mockResolvedValue(replacementSession);
    fakeEnv.CARICATURE_WORKFLOW.create.mockRejectedValue(new Error('Instance already exists.'));
    fakeEnv.CARICATURE_WORKFLOW.get.mockResolvedValue(instance);

    await expect(caughtError(() => startGeneration(startInput()))).resolves.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: "Couldn't start your postcard. Please try again.",
    });

    expect(fakeEnv.CARICATURE_WORKFLOW.create).toHaveBeenCalledTimes(1);
    expect(fakeEnv.CARICATURE_WORKFLOW.get).toHaveBeenCalledTimes(operation === 'get' ? 0 : 1);
    expect(instance.restart).not.toHaveBeenCalled();
    expect(instance.resume).not.toHaveBeenCalled();
  });

  it.each([
    ['moderating', 'create'],
    ['compositing', 'resume'],
  ])('recovers a metadata-less legacy selfie in %s after its bytes match D1', async (status, recovery) => {
    const legacySession = { ...session, status, workflow_instance_id: sessionId };
    const instance = {
      status: vi.fn().mockResolvedValue({ status: recovery === 'restart' ? 'errored' : 'paused' }),
      restart: vi.fn(),
      resume: vi.fn(),
    };
    loadSession.mockResolvedValue(legacySession);
    fakeEnv.SELFIES.head.mockResolvedValue({ httpMetadata: { contentType: 'image/jpeg' }, customMetadata: {} });
    fakeEnv.SELFIES.get.mockResolvedValue({
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {},
      arrayBuffer: vi.fn().mockResolvedValue(validJpeg.slice().buffer),
    });
    if (recovery !== 'create') {
      fakeEnv.CARICATURE_WORKFLOW.create.mockRejectedValue(new Error('Instance already exists.'));
      fakeEnv.CARICATURE_WORKFLOW.get.mockResolvedValue(instance);
    }

    await expect(startGeneration(startInput())).resolves.toEqual({ sessionId, status });

    expect(fakeEnv.SELFIES.get).toHaveBeenCalledWith(session.selfie_key);
    expect(fakeEnv.CARICATURE_WORKFLOW.create).toHaveBeenCalledWith(expect.objectContaining({ id: sessionId }));
    if (recovery === 'restart') expect(instance.restart).toHaveBeenCalledTimes(1);
    if (recovery === 'resume') expect(instance.resume).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a completed workflow leaves its session nonterminal', async () => {
    let currentSession: TestSession = { ...session, status: 'compositing', workflow_instance_id: sessionId };
    const instance = {
      status: vi.fn().mockResolvedValue({ status: 'complete' }),
      restart: vi.fn(),
      resume: vi.fn(),
    };
    loadSession.mockImplementation(async () => currentSession);
    transitionSession.mockImplementation(async (_database, _sessionId, status, fields, expectedWorkflowInstanceId) => {
      if (currentSession.workflow_instance_id === expectedWorkflowInstanceId) currentSession = { ...currentSession, ...fields, status };
      return currentSession;
    });
    fakeEnv.CARICATURE_WORKFLOW.create.mockRejectedValue(new Error('Instance already exists.'));
    fakeEnv.CARICATURE_WORKFLOW.get.mockResolvedValue(instance);

    await expect(getGeneration({ sessionId })).resolves.toEqual({
      status: 'errored',
      failureCode: 'unknown_failure',
      postcardUrl: null,
    });

    expect(transitionSession).toHaveBeenCalledWith(fakeEnv.DB, sessionId, 'errored', {
      error_code: 'unknown_failure',
      error_msg: null,
    }, sessionId);
    expect(instance.restart).not.toHaveBeenCalled();
    expect(instance.resume).not.toHaveBeenCalled();
  });

  it('reconciles a completed workflow after its event is archived', async () => {
    let currentSession: TestSession = { ...session, status: 'compositing', workflow_instance_id: sessionId };
    const archivedEvent = { ...event, status: 'archived' };
    const instance = {
      status: vi.fn().mockResolvedValue({ status: 'complete' }),
      restart: vi.fn(),
      resume: vi.fn(),
    };
    loadActiveEventById.mockResolvedValue(null);
    loadEventById.mockResolvedValue(archivedEvent);
    loadSession.mockImplementation(async () => currentSession);
    transitionSession.mockImplementation(async (_database, _sessionId, status, fields, expectedWorkflowInstanceId) => {
      if (currentSession.workflow_instance_id === expectedWorkflowInstanceId) currentSession = { ...currentSession, ...fields, status };
      return currentSession;
    });
    fakeEnv.CARICATURE_WORKFLOW.create.mockRejectedValue(new Error('Instance already exists.'));
    fakeEnv.CARICATURE_WORKFLOW.get.mockResolvedValue(instance);

    await expect(getGeneration({ sessionId })).resolves.toEqual({
      status: 'errored',
      failureCode: 'unknown_failure',
      postcardUrl: null,
    });

    expect(loadEventById).toHaveBeenCalledWith(fakeEnv.DB, event.id);
    expect(loadActiveEventById).not.toHaveBeenCalled();
  });

  it.each([
    ['restart', 'errored'],
    ['resume', 'paused'],
  ])('does not %s a workflow after its session becomes terminal', async (_operation, workflowStatus) => {
    let currentSession: TestSession = { ...session, status: 'generating', workflow_instance_id: sessionId };
    const instance = {
      status: vi.fn().mockImplementation(async () => {
        currentSession = { ...currentSession, status: 'errored', error_code: 'unknown_failure' };
        return { status: workflowStatus };
      }),
      restart: vi.fn(),
      resume: vi.fn(),
    };
    loadSession.mockImplementation(async () => currentSession);
    fakeEnv.CARICATURE_WORKFLOW.create.mockRejectedValue(new Error('Instance already exists.'));
    fakeEnv.CARICATURE_WORKFLOW.get.mockResolvedValue(instance);

    await expect(getGeneration({ sessionId })).resolves.toEqual({
      status: 'errored',
      failureCode: 'unknown_failure',
      postcardUrl: null,
    });

    expect(instance.restart).not.toHaveBeenCalled();
    expect(instance.resume).not.toHaveBeenCalled();
  });

  it.each([
    ['generating', 'generation_failed'],
    ['compositing', 'composition_failed'],
  ] as const)('fails a %s session closed instead of restarting paid work', async (status, failureCode) => {
    let currentSession: TestSession = { ...session, status, workflow_instance_id: sessionId };
    const instance = {
      status: vi.fn().mockResolvedValue({ status: 'errored' }),
      restart: vi.fn(),
      resume: vi.fn(),
    };
    loadSession.mockImplementation(async () => currentSession);
    transitionSession.mockImplementation(async (_database, _sessionId, nextStatus, fields, expectedWorkflowInstanceId) => {
      if (currentSession.workflow_instance_id === expectedWorkflowInstanceId) currentSession = { ...currentSession, ...fields, status: nextStatus };
      return currentSession;
    });
    fakeEnv.CARICATURE_WORKFLOW.create.mockRejectedValue(new Error('Instance already exists.'));
    fakeEnv.CARICATURE_WORKFLOW.get.mockResolvedValue(instance);

    await expect(getGeneration({ sessionId })).resolves.toEqual({
      status: 'errored',
      failureCode,
      postcardUrl: null,
    });

    expect(transitionSession).toHaveBeenCalledWith(fakeEnv.DB, sessionId, 'errored', {
      error_code: failureCode,
      error_msg: null,
    }, sessionId);
    expect(instance.restart).not.toHaveBeenCalled();
  });

  it('fails a legacy recovery closed when object bytes do not match D1', async () => {
    let currentSession = { ...session, status: 'moderating', workflow_instance_id: sessionId };
    loadSession.mockImplementation(async () => currentSession);
    transitionSession.mockImplementation(async (_database, _sessionId, status, fields, expectedWorkflowInstanceId) => {
      if (currentSession.workflow_instance_id === expectedWorkflowInstanceId) currentSession = { ...currentSession, ...fields, status };
      return currentSession;
    });
    fakeEnv.SELFIES.head.mockResolvedValue({ httpMetadata: { contentType: 'image/jpeg' }, customMetadata: {} });
    fakeEnv.SELFIES.get.mockResolvedValue({
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {},
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    });

    await expect(startGeneration(startInput())).resolves.toEqual({ sessionId, status: 'errored' });

    expect(transitionSession).toHaveBeenCalledWith(fakeEnv.DB, sessionId, 'errored', {
      error_code: 'unknown_failure',
      error_msg: null,
    }, sessionId);
    expect(fakeEnv.CARICATURE_WORKFLOW.create).not.toHaveBeenCalled();
    expect(fakeEnv.CARICATURE_WORKFLOW.get).not.toHaveBeenCalled();
  });

  it('fails a legacy recovery closed for conflicting metadata without reading its bytes', async () => {
    let currentSession = { ...session, status: 'moderating', workflow_instance_id: sessionId };
    const arrayBuffer = vi.fn();
    const conflictingObject = {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { workflowInstanceId: 'replacement-instance' },
      arrayBuffer,
    };
    loadSession.mockImplementation(async () => currentSession);
    transitionSession.mockImplementation(async (_database, _sessionId, status, fields, expectedWorkflowInstanceId) => {
      if (currentSession.workflow_instance_id === expectedWorkflowInstanceId) currentSession = { ...currentSession, ...fields, status };
      return currentSession;
    });
    fakeEnv.SELFIES.head.mockResolvedValue(conflictingObject);
    fakeEnv.SELFIES.get.mockResolvedValue(conflictingObject);

    await expect(startGeneration(startInput())).resolves.toEqual({ sessionId, status: 'errored' });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(transitionSession).toHaveBeenCalledWith(fakeEnv.DB, sessionId, 'errored', {
      error_code: 'unknown_failure',
      error_msg: null,
    }, sessionId);
    expect(fakeEnv.CARICATURE_WORKFLOW.create).not.toHaveBeenCalled();
    expect(fakeEnv.CARICATURE_WORKFLOW.get).not.toHaveBeenCalled();
  });

  it('returns a fresh terminal failure when the claimed selfie is missing', async () => {
    let currentSession = { ...session, status: 'generating', workflow_instance_id: sessionId };
    loadSession.mockImplementation(async () => currentSession);
    transitionSession.mockImplementation(async (_database, _sessionId, status, fields, expectedWorkflowInstanceId) => {
      if (currentSession.workflow_instance_id === expectedWorkflowInstanceId) currentSession = { ...currentSession, ...fields, status };
      return currentSession;
    });
    fakeEnv.SELFIES.head.mockResolvedValue(null);
    fakeEnv.SELFIES.get.mockResolvedValue(null);

    await expect(getGeneration({ sessionId })).resolves.toEqual({
      status: 'errored',
      failureCode: 'unknown_failure',
      postcardUrl: null,
    });
    expect(transitionSession).toHaveBeenCalledWith(fakeEnv.DB, sessionId, 'errored', {
      error_code: 'unknown_failure',
      error_msg: null,
    }, sessionId);
    expect(fakeEnv.CARICATURE_WORKFLOW.create).not.toHaveBeenCalled();
  });

  it('cannot fail a row recreated before the ownership transition', async () => {
    const originalSession = { ...session, status: 'moderating', workflow_instance_id: sessionId };
    const replacementSession = { ...originalSession, workflow_instance_id: 'replacement-instance' };
    let currentSession = originalSession;
    loadSession.mockImplementation(async () => currentSession);
    transitionSession.mockImplementation(async (_database, _sessionId, _status, _fields, expectedWorkflowInstanceId) => {
      currentSession = replacementSession;
      if (currentSession.workflow_instance_id === expectedWorkflowInstanceId) throw new Error('stale transition applied');
      return currentSession;
    });
    fakeEnv.SELFIES.head.mockResolvedValue(null);
    fakeEnv.SELFIES.get.mockResolvedValue(null);

    await expect(caughtError(() => getGeneration({ sessionId }))).resolves.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: "Couldn't start your postcard. Please try again.",
    });

    expect(transitionSession).toHaveBeenCalledWith(fakeEnv.DB, sessionId, 'errored', {
      error_code: 'unknown_failure',
      error_msg: null,
    }, sessionId);
    expect(currentSession).toEqual(replacementSession);
    expect(fakeEnv.CARICATURE_WORKFLOW.create).not.toHaveBeenCalled();
  });

  it('does not recover a workflow after a stale selfie replacement upload fails', async () => {
    const uploadError = new Error('R2 replacement failed');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const currentSession = { ...session, workflow_instance_id: workflowInstanceId };
    loadSession.mockResolvedValue(currentSession);
    fakeEnv.SELFIES.head.mockResolvedValue({
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {
        sessionId,
        eventId: String(event.id),
        workflowInstanceId: 'retained-workflow-instance',
        assetKind: 'selfie',
        selfieSha256,
      },
    });
    fakeEnv.SELFIES.put.mockRejectedValue(uploadError);

    await expect(caughtError(() => startGeneration(startInput()))).resolves.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: "Couldn't start your postcard. Please try again.",
    });
    await expect(getGeneration({ sessionId })).resolves.toMatchObject({ status: 'uploading' });

    expect(fakeEnv.CARICATURE_WORKFLOW.create).not.toHaveBeenCalled();
    expect(fakeEnv.CARICATURE_WORKFLOW.get).not.toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).toContain(uploadError.message);
  });

  it('does not overwrite a selfie after the session changes workflow ownership', async () => {
    const currentSession = { ...session, workflow_instance_id: workflowInstanceId };
    loadSession.mockResolvedValue(currentSession);
    fakeEnv.SELFIES.head.mockResolvedValue({
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {
        sessionId,
        eventId: String(event.id),
        workflowInstanceId: 'retained-workflow-instance',
        assetKind: 'selfie',
        selfieSha256,
      },
    });
    transitionSession.mockResolvedValue({ ...currentSession, workflow_instance_id: 'replacement-instance' });

    await expect(caughtError(() => startGeneration(startInput()))).resolves.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: "Couldn't start your postcard. Please try again.",
    });

    expect(transitionSession).toHaveBeenCalledWith(fakeEnv.DB, sessionId, 'uploading', {}, workflowInstanceId);
    expect(fakeEnv.SELFIES.put).not.toHaveBeenCalled();
    expect(fakeEnv.CARICATURE_WORKFLOW.create).not.toHaveBeenCalled();
  });

  it('contains workflow diagnostics from startGeneration', async () => {
    const diagnostic = 'workflow-sentinel-028ced';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const workflowError = new Error(diagnostic);
    loadSession.mockResolvedValue({ ...session, status: 'moderating', workflow_instance_id: sessionId });
    fakeEnv.CARICATURE_WORKFLOW.create.mockRejectedValue(workflowError);
    fakeEnv.CARICATURE_WORKFLOW.get.mockRejectedValue(workflowError);

    const error = await caughtError(() => startGeneration(startInput()));

    expectContained(error, diagnostic);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(diagnostic);
    expect(fakeEnv.CARICATURE_WORKFLOW.create).toHaveBeenCalledWith(expect.objectContaining({ id: sessionId }));
    expect(fakeEnv.CARICATURE_WORKFLOW.get).toHaveBeenCalledWith(sessionId);
  });

  it('preserves expected fixed ActionError values without logging them', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const error = await caughtError(() => startGeneration(startInput(new File([], 'empty.jpg', { type: 'image/jpeg' }))));

    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Photo must be a JPEG smaller than 6 MB.',
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('replaces invalid public input details with a fixed ActionError', async () => {
    const diagnostic = 'zod-sentinel-b3a8c1';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const error = await caughtError(() => getGeneration({ sessionId: diagnostic }));

    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Invalid postcard session. Start over.',
    });
    expect(error.message).not.toContain(diagnostic);
    expect(JSON.stringify(error)).not.toContain(diagnostic);
    expect(errorLog).not.toHaveBeenCalled();
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('maps legacy errored rows to failureCode without returning raw errors', async () => {
    loadSession.mockResolvedValue({
      ...session,
      status: 'errored',
      error_msg: "We couldn't finish your postcard. Please try again.",
    });

    const result = await getGeneration({ sessionId });

    expect(result).toEqual({
      status: 'errored',
      failureCode: 'composition_failed',
      postcardUrl: null,
    });
    expect(JSON.stringify(result)).not.toContain('error_msg');
    expect(JSON.stringify(result)).not.toContain("We couldn't finish your postcard");
  });

  it('returns no failure code before an errored terminal state', async () => {
    loadSession.mockResolvedValue({ ...session, status: 'completed', error_code: 'generation_failed' });

    await expect(getGeneration({ sessionId })).resolves.toEqual({
      status: 'completed',
      failureCode: null,
      postcardUrl: `/api/events/${event.id}/sessions/${sessionId}/postcard`,
    });
  });
});
