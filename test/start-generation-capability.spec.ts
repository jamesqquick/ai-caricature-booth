import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyPrintCapability } from '../src/lib/print-capability';

const sessionId = '00000000-0000-4000-8000-000000000001';
const event = {
  id: 7,
  slug: 'demo-event',
  scene_style_preamble: null,
  scene_constraints: null,
  watermark_image_key: null,
  watermark_w: null,
};
const scene = { id: 'bridge', name: 'Bridge', description: '', prompt: '' };
const session = {
  id: sessionId,
  event_id: 7,
  scene_id: 'bridge',
  scene_name: 'Bridge',
  selfie_key: `sessions/${sessionId}/selfie.jpg`,
  selfie_sha256: null,
  status: 'completed',
};
const fakeEnv = vi.hoisted(() => ({
  DB: {},
  SELFIES: { head: vi.fn() },
  CARICATURE_WORKFLOW: {},
  PRINT_CAPABILITY_SECRET: 'test-print-capability-secret',
}));
const loadSession = vi.hoisted(() => vi.fn());
const loadActiveEventById = vi.hoisted(() => vi.fn());
const loadActiveEventBySlug = vi.hoisted(() => vi.fn());
const loadEventScene = vi.hoisted(() => vi.fn());
const createPendingSession = vi.hoisted(() => vi.fn());

vi.mock('astro:actions', () => ({
  ActionError: class ActionError extends Error {},
  defineAction: (definition: unknown) => definition,
}));
vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));
vi.mock('../src/db/events', () => ({ loadActiveEventById, loadActiveEventBySlug }));
vi.mock('../src/db/scenes', () => ({ loadEventScene }));
vi.mock('../src/db/sessions', () => ({ createPendingSession, loadSession, transitionSession: vi.fn() }));

import { server } from '../src/actions';

const jpeg = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xda, 0x00, 0x02,
  0xff, 0xd9,
]);

describe('startGeneration print capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadEventScene.mockResolvedValue(scene);
    fakeEnv.SELFIES.head.mockResolvedValue({});
  });

  it.each(['fresh', 'replay'] as const)('returns a valid printToken on the %s path', async (path) => {
    if (path === 'fresh') {
      loadSession.mockResolvedValueOnce(null).mockResolvedValueOnce(session);
      loadActiveEventBySlug.mockResolvedValue(event);
      createPendingSession.mockResolvedValue({ created: true, session });
    } else {
      loadSession.mockResolvedValueOnce(session).mockResolvedValueOnce(session);
      loadActiveEventById.mockResolvedValue(event);
    }

    const handler = (server.startGeneration as unknown as { handler(input: unknown): Promise<{ printToken: string; sessionId: string }> }).handler;
    const result = await handler({
      eventSlug: event.slug,
      sceneId: scene.id,
      idempotencyKey: sessionId,
      selfie: new File([jpeg], 'selfie.jpg', { type: 'image/jpeg' }),
    });

    expect(result.sessionId).toBe(sessionId);
    await expect(verifyPrintCapability(fakeEnv.PRINT_CAPABILITY_SECRET, result.printToken, { sessionId, eventId: event.id }))
      .resolves.toMatchObject({ sessionId, eventId: event.id });
  });
});
