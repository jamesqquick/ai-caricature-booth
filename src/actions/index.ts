import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { env } from 'cloudflare:workers';
import { loadActiveEventById, loadActiveEventBySlug, type EventRecord } from '../db/events';
import { loadEventScene } from '../db/scenes';
import { createPendingSession, loadSession, transitionSession } from '../db/sessions';
import { toGenerationFailureCode } from '../lib/generation-errors';
import { assertJpeg, MAX_SELFIE_BYTES } from '../lib/image-validation';
import type { Scene } from '../data/scenes';

const startInput = z.object({
  eventSlug: z.string().min(1).max(120),
  sceneId: z.string().min(1).max(80),
  idempotencyKey: z.uuid(),
  selfie: z.instanceof(File),
});
const publicStartInput = z.object({
  eventSlug: z.unknown().optional(),
  sceneId: z.unknown().optional(),
  idempotencyKey: z.unknown().optional(),
  selfie: z.unknown().optional(),
});
const getInput = z.object({ sessionId: z.uuid() });

export const server = {
  startGeneration: defineAction({
    accept: 'form',
    input: publicStartInput,
    handler: async (input) => {
      let sessionId: string | undefined;
      try {
        const parsed = startInput.safeParse(input);
        if (!parsed.success) throw new ActionError({ code: 'BAD_REQUEST', message: 'Invalid photo request. Start over.' });
        const { eventSlug, sceneId, idempotencyKey, selfie } = parsed.data;
        sessionId = idempotencyKey;
        if (selfie.size === 0 || selfie.size > MAX_SELFIE_BYTES) {
          throw new ActionError({ code: 'BAD_REQUEST', message: 'Photo must be a JPEG smaller than 6 MB.' });
        }
        const bytes = new Uint8Array(await selfie.arrayBuffer());
        try {
          assertJpeg(bytes);
        } catch (error) {
          const message = error instanceof Error && error.message === 'Photo dimensions are not supported.'
            ? 'Photo dimensions are not supported.'
            : 'Only valid JPEG photos are supported.';
          throw new ActionError({ code: 'BAD_REQUEST', message });
        }
        const selfieSha256 = await hashBytes(bytes);
        const existing = await loadSession(env.DB, idempotencyKey);
        if (existing) {
          const event = await loadActiveEventById(env.DB, existing.event_id);
          if (!event || event.slug !== eventSlug || existing.scene_id !== sceneId) {
            throw new ActionError({ code: 'BAD_REQUEST', message: 'This photo session does not match the selected booth. Start over.' });
          }
          const scene = await loadEventScene(env.DB, event.id, existing.scene_id);
          if (!scene) throw new ActionError({ code: 'BAD_REQUEST', message: 'That scene is not available for this booth.' });
          if (existing.selfie_sha256 && existing.selfie_sha256 !== selfieSha256) {
            throw new ActionError({ code: 'BAD_REQUEST', message: 'This photo session already uses another image. Start over.' });
          }
          if (existing.status === 'pending' || existing.status === 'uploading') {
            await ensureSelfieUploaded(existing.id, existing.selfie_key, bytes);
          }
          const current = await loadSession(env.DB, existing.id);
          if (current) await ensureWorkflow(current, scene, event);
          return { sessionId: existing.id, status: current?.status ?? existing.status };
        }

        const event = await loadActiveEventBySlug(env.DB, eventSlug);
        if (!event) throw new ActionError({ code: 'NOT_FOUND', message: 'This booth is not available.' });
        const scene = await loadEventScene(env.DB, event.id, sceneId);
        if (!scene) throw new ActionError({ code: 'BAD_REQUEST', message: 'That scene is not available for this booth.' });

        const selfieKey = `sessions/${idempotencyKey}/selfie.jpg`;
        const claim = await createPendingSession(env.DB, { id: idempotencyKey, event_id: event.id, scene_id: scene.id, scene_name: scene.name, selfie_key: selfieKey, selfie_sha256: selfieSha256 });
        if (!claim.session) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't start your postcard. Please try again." });
        if (!claim.created) {
          if (claim.session.event_id !== event.id || claim.session.scene_id !== scene.id || claim.session.selfie_sha256 !== selfieSha256) {
            throw new ActionError({ code: 'BAD_REQUEST', message: 'This photo session does not match the selected booth. Start over.' });
          }
          if (claim.session.status === 'pending' || claim.session.status === 'uploading') {
            await ensureSelfieUploaded(claim.session.id, claim.session.selfie_key, bytes);
          }
          const current = await loadSession(env.DB, claim.session.id);
          if (current) await ensureWorkflow(current, scene, event);
          return { sessionId: claim.session.id, status: current?.status ?? claim.session.status };
        }

        await ensureSelfieUploaded(idempotencyKey, selfieKey, bytes);
        const current = await loadSession(env.DB, idempotencyKey);
        if (current) await ensureWorkflow(current, scene, event);
        return { sessionId: idempotencyKey, status: current?.status ?? claim.session.status };
      } catch (error) {
        throwPublicActionError('startGeneration', sessionId, error, "Couldn't start your postcard. Please try again.");
      }
    },
  }),

  getGeneration: defineAction({
    input: z.unknown(),
    handler: async (input) => {
      let sessionId: string | undefined;
      try {
        const parsed = getInput.safeParse(input);
        if (!parsed.success) throw new ActionError({ code: 'BAD_REQUEST', message: 'Invalid postcard session. Start over.' });
        sessionId = parsed.data.sessionId;
        const session = await loadSession(env.DB, sessionId);
        if (!session) throw new ActionError({ code: 'NOT_FOUND', message: 'This postcard session was not found. Start over.' });
        if (!['completed', 'errored'].includes(session.status)) {
          const event = await loadActiveEventById(env.DB, session.event_id);
          const scene = event ? await loadEventScene(env.DB, event.id, session.scene_id) : null;
          if (event && scene) await ensureWorkflow(session, scene, event);
        }
        const result = {
          status: session.status,
          failureCode: session.status === 'errored' ? toGenerationFailureCode(session.error_code, session.error_msg) : null,
          postcardUrl: session.status === 'completed' ? `/api/events/${session.event_id}/sessions/${session.id}/postcard` : null,
        };
        return result as typeof result & { error?: never };
      } catch (error) {
        throwPublicActionError('getGeneration', sessionId, error, "Couldn't check your postcard. Please try again.");
      }
    },
  }),
};

async function ensureWorkflow(
  session: NonNullable<Awaited<ReturnType<typeof loadSession>>>,
  scene: Scene,
  event: EventRecord,
) {
  if (session.status === 'pending' || session.status === 'completed' || session.status === 'errored') return;
  if (!(await env.SELFIES.head(session.selfie_key))) return;
  try {
    await env.CARICATURE_WORKFLOW.create({
      id: session.id,
      params: {
        sessionId: session.id,
        eventId: session.event_id,
        sceneId: scene.id,
        sceneName: scene.name,
        sceneDescription: scene.description,
        scenePrompt: scene.prompt,
        eventPromptPreamble: event.scene_style_preamble,
        eventConstraints: event.scene_constraints,
        selfieKey: session.selfie_key,
        watermarkKey: event.watermark_image_key,
        watermarkWidth: event.watermark_w,
      },
    });
    return;
  } catch (createError) {
    try {
      const instance = await env.CARICATURE_WORKFLOW.get(session.id);
      const { status } = await instance.status();
      if (['queued', 'running', 'waiting', 'waitingForPause', 'complete'].includes(status)) return;
      if (status === 'errored' || status === 'terminated') {
        await instance.restart();
        return;
      }
      if (status === 'paused') {
        await instance.resume();
        return;
      }
      throw createError;
    } catch (recoveryError) {
      console.error(JSON.stringify({ message: 'workflow start failed', sessionId: session.id, ...errorDiagnostic(recoveryError) }));
      throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't start your postcard. Please try again." });
    }
  }
}

async function ensureSelfieUploaded(sessionId: string, selfieKey: string, bytes: Uint8Array) {
  if (await env.SELFIES.head(selfieKey)) return;
  await transitionSession(env.DB, sessionId, 'uploading');
  await env.SELFIES.put(selfieKey, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
}

async function hashBytes(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function throwPublicActionError(action: 'startGeneration' | 'getGeneration', sessionId: string | undefined, error: unknown, message: string): never {
  if (error instanceof ActionError) throw error;
  console.error(JSON.stringify({
    message: 'public action failed',
    action,
    ...(sessionId ? { sessionId } : {}),
    ...errorDiagnostic(error),
  }));
  throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message });
}

function errorDiagnostic(error: unknown) {
  return error instanceof Error
    ? { errorName: error.name, errorMessage: error.message }
    : { errorType: typeof error };
}
