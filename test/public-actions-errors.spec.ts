import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeEnv = vi.hoisted(() => ({
  DB: {},
  SELFIES: {
    head: vi.fn(),
    put: vi.fn(),
  },
  CARICATURE_WORKFLOW: {
    create: vi.fn(),
    get: vi.fn(),
  },
}));
const loadActiveEventById = vi.hoisted(() => vi.fn());
const loadActiveEventBySlug = vi.hoisted(() => vi.fn());
const loadEventScene = vi.hoisted(() => vi.fn());
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
vi.mock('../src/db/events', () => ({ loadActiveEventById, loadActiveEventBySlug }));
vi.mock('../src/db/scenes', () => ({ loadEventScene }));
vi.mock('../src/db/sessions', () => ({ createPendingSession, loadSession, transitionSession }));

import { server } from '../src/actions';

const sessionId = '00000000-0000-4000-8000-000000000001';
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
    loadActiveEventById.mockResolvedValue(event);
    loadActiveEventBySlug.mockResolvedValue(event);
    loadEventScene.mockResolvedValue(scene);
    createPendingSession.mockResolvedValue({ session, created: false });
    loadSession.mockResolvedValue(session);
    transitionSession.mockResolvedValue(session);
    fakeEnv.SELFIES.head.mockResolvedValue({
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {
        sessionId,
        eventId: String(event.id),
        assetKind: 'selfie',
        selfieSha256,
      },
    });
    fakeEnv.SELFIES.put.mockResolvedValue(undefined);
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
        assetKind: 'selfie',
        selfieSha256,
      },
    });
  });

  it('contains workflow diagnostics from startGeneration', async () => {
    const diagnostic = 'workflow-sentinel-028ced';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const workflowError = new Error(diagnostic);
    loadSession.mockResolvedValue({ ...session, status: 'moderating' });
    fakeEnv.CARICATURE_WORKFLOW.create.mockRejectedValue(workflowError);
    fakeEnv.CARICATURE_WORKFLOW.get.mockRejectedValue(workflowError);

    const error = await caughtError(() => startGeneration(startInput()));

    expectContained(error, diagnostic);
    expect(JSON.stringify(errorLog.mock.calls)).toContain(diagnostic);
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
