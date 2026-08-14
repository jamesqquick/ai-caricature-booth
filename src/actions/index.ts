import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { env } from 'cloudflare:workers';
import { loadActiveEventById, loadActiveEventBySlug } from '../db/events';
import { createPendingSession, loadSession } from '../db/sessions';
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
        await ensureWorkflow(existing, event.watermark_image_key);
        return { sessionId: existing.id, status: existing.status };
      }

      const event = await loadActiveEventBySlug(env.DB, eventSlug);
      if (!event) throw new ActionError({ code: 'NOT_FOUND', message: 'This booth is not available.' });
      const scene = scenes.find((candidate) => candidate.id === sceneId);
      if (!scene) throw new ActionError({ code: 'BAD_REQUEST', message: 'That scene is not available.' });

      const selfieKey = `sessions/${idempotencyKey}/selfie.jpg`;
      const claim = await createPendingSession(env.DB, { id: idempotencyKey, event_id: event.id, scene_id: scene.id, selfie_key: selfieKey, selfie_sha256: selfieSha256 });
      if (!claim.session) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not create a generation session.' });
      if (!claim.created) return { sessionId: claim.session.id, status: claim.session.status };

      try {
        await env.SELFIES.put(selfieKey, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
      } catch {
        await env.DB.prepare("UPDATE sessions SET status = 'errored', error_msg = ?, updated_at = unixepoch() WHERE id = ? AND status = 'pending'").bind('We could not upload your photo.', idempotencyKey).run();
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not upload your photo.' });
      }

      try {
        await env.CARICATURE_WORKFLOW.create({
          id: idempotencyKey,
          params: { sessionId: idempotencyKey, eventId: event.id, sceneId: scene.id, selfieKey, watermarkKey: event.watermark_image_key },
        });
      } catch (error) {
        console.error(JSON.stringify({ message: 'workflow start failed', sessionId: idempotencyKey, error: error instanceof Error ? error.message : String(error) }));
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not start generation.' });
      }

      return { sessionId: idempotencyKey, status: claim.session.status };
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
  if (session.status === 'completed' || session.status === 'errored') return;
  try {
    await env.CARICATURE_WORKFLOW.create({
      id: session.id,
      params: { sessionId: session.id, eventId: session.event_id, sceneId: session.scene_id, selfieKey: session.selfie_key, watermarkKey },
    });
  } catch (error) {
    console.warn(JSON.stringify({ message: 'workflow may already exist', sessionId: session.id, error: error instanceof Error ? error.message : String(error) }));
  }
}

async function hashBytes(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
