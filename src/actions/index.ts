import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { env } from 'cloudflare:workers';
import { loadActiveEventById, loadActiveEventBySlug } from '../db/events';
import { createPendingSession, loadSession, transitionSession } from '../db/sessions';
import { assertJpeg, MAX_SELFIE_BYTES } from '../lib/image-validation';
import { scenes } from '../data/scenes';

const startInput = z.object({
  eventSlug: z.string().min(1).max(120),
  sceneId: z.string().min(1).max(80),
  idempotencyKey: z.uuid(),
  selfie: z.instanceof(File),
});

export const server = {
  startGeneration: defineAction({
    accept: 'form',
    input: startInput,
    handler: async ({ eventSlug, sceneId, idempotencyKey, selfie }) => {
      if (selfie.size === 0 || selfie.size > MAX_SELFIE_BYTES) {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'Photo must be a JPEG smaller than 6 MB.' });
      }
      const bytes = new Uint8Array(await selfie.arrayBuffer());
      try {
        assertJpeg(bytes);
      } catch (error) {
        throw new ActionError({ code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Invalid photo.' });
      }
      const selfieSha256 = await hashBytes(bytes);
      const existing = await loadSession(env.DB, idempotencyKey);
      if (existing) {
        const event = await loadActiveEventById(env.DB, existing.event_id);
        if (!event || event.slug !== eventSlug || existing.scene_id !== sceneId) {
          throw new ActionError({ code: 'BAD_REQUEST', message: 'That generation session does not match this booth.' });
        }
        if (existing.selfie_sha256 && existing.selfie_sha256 !== selfieSha256) {
          throw new ActionError({ code: 'BAD_REQUEST', message: 'That generation session already has a different photo.' });
        }
        if (existing.status === 'pending' || existing.status === 'uploading') {
          await ensureSelfieUploaded(existing.id, existing.selfie_key, bytes);
        }
        const current = await loadSession(env.DB, existing.id);
        if (current) await ensureWorkflow(current, event.watermark_image_key);
        return { sessionId: existing.id, status: current?.status ?? existing.status };
      }

      const event = await loadActiveEventBySlug(env.DB, eventSlug);
      if (!event) throw new ActionError({ code: 'NOT_FOUND', message: 'This booth is not available.' });
      const scene = scenes.find((candidate) => candidate.id === sceneId);
      if (!scene) throw new ActionError({ code: 'BAD_REQUEST', message: 'That scene is not available.' });

      const selfieKey = `sessions/${idempotencyKey}/selfie.jpg`;
      const claim = await createPendingSession(env.DB, { id: idempotencyKey, event_id: event.id, scene_id: scene.id, selfie_key: selfieKey, selfie_sha256: selfieSha256 });
      if (!claim.session) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not create a generation session.' });
      if (!claim.created) {
        if (claim.session.status === 'pending' || claim.session.status === 'uploading') {
          await ensureSelfieUploaded(claim.session.id, claim.session.selfie_key, bytes);
        }
        const current = await loadSession(env.DB, claim.session.id);
        if (current) await ensureWorkflow(current, event.watermark_image_key);
        return { sessionId: claim.session.id, status: current?.status ?? claim.session.status };
      }

      await ensureSelfieUploaded(idempotencyKey, selfieKey, bytes);
      const current = await loadSession(env.DB, idempotencyKey);
      if (current) await ensureWorkflow(current, event.watermark_image_key);
      return { sessionId: idempotencyKey, status: current?.status ?? claim.session.status };
    },
  }),

  getGeneration: defineAction({
    input: z.object({ sessionId: z.uuid() }),
    handler: async ({ sessionId }) => {
      const session = await loadSession(env.DB, sessionId);
      if (!session) throw new ActionError({ code: 'NOT_FOUND', message: 'Generation session not found.' });
      if (!['completed', 'errored'].includes(session.status)) {
        const event = await loadActiveEventById(env.DB, session.event_id);
        if (event) await ensureWorkflow(session, event.watermark_image_key);
      }
      return {
        status: session.status,
        error: session.error_msg,
        postcardUrl: session.status === 'completed' ? `/api/events/${session.event_id}/sessions/${session.id}/postcard` : null,
      };
    },
  }),
};

async function ensureWorkflow(session: NonNullable<Awaited<ReturnType<typeof loadSession>>>, watermarkKey: string | null) {
  if (session.status === 'pending' || session.status === 'completed' || session.status === 'errored') return;
  if (!(await env.SELFIES.head(session.selfie_key))) return;
  try {
    await env.CARICATURE_WORKFLOW.create({
      id: session.id,
      params: { sessionId: session.id, eventId: session.event_id, sceneId: session.scene_id, selfieKey: session.selfie_key, watermarkKey },
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
      console.error(JSON.stringify({ message: 'workflow start failed', sessionId: session.id, error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError) }));
      throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not start generation.' });
    }
  }
}

async function ensureSelfieUploaded(sessionId: string, selfieKey: string, bytes: Uint8Array) {
  if (await env.SELFIES.head(selfieKey)) return;
  await transitionSession(env.DB, sessionId, 'uploading');
  try {
    await env.SELFIES.put(selfieKey, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  } catch {
    throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not upload your photo.' });
  }
}

async function hashBytes(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
