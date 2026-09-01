import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { env } from 'cloudflare:workers';
import { loadActiveEventById, loadActiveEventBySlug, type EventRecord } from '../db/events';
import { loadEventScene } from '../db/scenes';
import { claimWorkflowInstanceId, createPendingSession, loadSession, transitionSession, type SessionRecord } from '../db/sessions';
import { toGenerationFailureCode } from '../lib/generation-errors';
import { assertJpeg, MAX_SELFIE_BYTES } from '../lib/image-validation';
import {
  hasExactSelfieOwnership,
  legacySessionAssetKey,
  readOwnedSelfieBytes,
  workflowSessionAssetKey,
} from '../lib/selfie-ownership';
import type { Scene } from '../data/scenes';

const START_GENERATION_ERROR = "Couldn't start your postcard. Please try again.";

type GenerationClaim = Pick<
  SessionRecord,
  'id' | 'event_id' | 'scene_id' | 'selfie_key' | 'selfie_sha256' | 'workflow_instance_id'
>;

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
          const ownedSession = ['completed', 'errored'].includes(existing.status)
            ? existing
            : await ensureWorkflowIdentity(existing);
          if (!ownedSession) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: START_GENERATION_ERROR });
          if (ownedSession.status === 'pending' || ownedSession.status === 'uploading') {
            if (!ownedSession.workflow_instance_id) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: START_GENERATION_ERROR });
            await ensureSelfieUploaded(ownedSession.id, ownedSession.event_id, ownedSession.workflow_instance_id, ownedSession.selfie_key, selfieSha256, bytes);
          }
          const current = await loadClaimedSession(generationClaim(ownedSession));
          await ensureWorkflow(current, scene, event);
          return { sessionId: existing.id, status: current.status };
        }

        const event = await loadActiveEventBySlug(env.DB, eventSlug);
        if (!event) throw new ActionError({ code: 'NOT_FOUND', message: 'This booth is not available.' });
        const scene = await loadEventScene(env.DB, event.id, sceneId);
        if (!scene) throw new ActionError({ code: 'BAD_REQUEST', message: 'That scene is not available for this booth.' });

        const workflowInstanceId = crypto.randomUUID();
        const selfieKey = workflowSessionAssetKey(idempotencyKey, workflowInstanceId, 'selfie');
        const claim = await createPendingSession(env.DB, {
          id: idempotencyKey,
          event_id: event.id,
          scene_id: scene.id,
          scene_name: scene.name,
          selfie_key: selfieKey,
          selfie_sha256: selfieSha256,
          workflow_instance_id: workflowInstanceId,
        });
        if (!claim.session) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: START_GENERATION_ERROR });
        if (!claim.created) {
          if (claim.session.event_id !== event.id || claim.session.scene_id !== scene.id || claim.session.selfie_sha256 !== selfieSha256) {
            throw new ActionError({ code: 'BAD_REQUEST', message: 'This photo session does not match the selected booth. Start over.' });
          }
          const ownedSession = ['completed', 'errored'].includes(claim.session.status)
            ? claim.session
            : await ensureWorkflowIdentity(claim.session);
          if (!ownedSession) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: START_GENERATION_ERROR });
          if (ownedSession.status === 'pending' || ownedSession.status === 'uploading') {
            if (!ownedSession.workflow_instance_id) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: START_GENERATION_ERROR });
            await ensureSelfieUploaded(ownedSession.id, ownedSession.event_id, ownedSession.workflow_instance_id, ownedSession.selfie_key, selfieSha256, bytes);
          }
          const current = await loadClaimedSession(generationClaim(ownedSession));
          await ensureWorkflow(current, scene, event);
          return { sessionId: claim.session.id, status: current.status };
        }

        await ensureSelfieUploaded(idempotencyKey, event.id, workflowInstanceId, selfieKey, selfieSha256, bytes);
        const current = await loadClaimedSession({
          id: idempotencyKey,
          event_id: event.id,
          scene_id: scene.id,
          selfie_key: selfieKey,
          selfie_sha256: selfieSha256,
          workflow_instance_id: workflowInstanceId,
        });
        await ensureWorkflow(current, scene, event);
        return { sessionId: idempotencyKey, status: current.status };
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
        return result;
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
  const ownedSession = await ensureWorkflowIdentity(session);
  const workflowInstanceId = ownedSession?.workflow_instance_id;
  if (!ownedSession || !workflowInstanceId) {
    throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: START_GENERATION_ERROR });
  }
  const claim = generationClaim(ownedSession);
  const ownership = {
    sessionId: ownedSession.id,
    eventId: ownedSession.event_id,
    workflowInstanceId,
    selfieSha256: ownedSession.selfie_sha256,
  };
  const selfie = await env.SELFIES.head(ownedSession.selfie_key);
  if (!hasExactSelfieOwnership(selfie, ownership)) {
    if (ownedSession.selfie_key !== legacySessionAssetKey(ownedSession.id, 'selfie')) return;
    const legacyObject = await env.SELFIES.get(ownedSession.selfie_key);
    const legacySelfie = legacyObject
      ? await readOwnedSelfieBytes(legacyObject, ownedSession.selfie_key, ownership)
      : null;
    if (!legacySelfie) return;
  }
  let current = await loadClaimedSession(claim);
  if (current.status === 'pending' || current.status === 'completed' || current.status === 'errored') return;
  try {
    await env.CARICATURE_WORKFLOW.create({
      id: workflowInstanceId,
      params: {
        sessionId: current.id,
        workflowInstanceId,
        eventId: current.event_id,
        sceneId: scene.id,
        sceneName: scene.name,
        sceneDescription: scene.description,
        scenePrompt: scene.prompt,
        eventPromptPreamble: event.scene_style_preamble,
        eventConstraints: event.scene_constraints,
        selfieKey: current.selfie_key,
        selfieSha256: current.selfie_sha256,
        watermarkKey: event.watermark_image_key,
        watermarkWidth: event.watermark_w,
      },
    });
    return;
  } catch (createError) {
    try {
      current = await loadClaimedSession(claim);
      if (current.status === 'pending' || current.status === 'completed' || current.status === 'errored') return;
      const instance = await env.CARICATURE_WORKFLOW.get(workflowInstanceId);
      const { status } = await instance.status();
      if (['queued', 'running', 'waiting', 'waitingForPause', 'complete'].includes(status)) return;
      if (status === 'errored' || status === 'terminated') {
        await loadClaimedSession(claim);
        await instance.restart();
        return;
      }
      if (status === 'paused') {
        await loadClaimedSession(claim);
        await instance.resume();
        return;
      }
      throw createError;
    } catch (recoveryError) {
      if (recoveryError instanceof ActionError) throw recoveryError;
      console.error(JSON.stringify({ message: 'workflow start failed', sessionId: ownedSession.id, ...errorDiagnostic(recoveryError) }));
      throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: START_GENERATION_ERROR });
    }
  }
}

async function ensureWorkflowIdentity(session: SessionRecord): Promise<(SessionRecord & { workflow_instance_id: string }) | null> {
  if (session.workflow_instance_id) return { ...session, workflow_instance_id: session.workflow_instance_id };
  const claimed = await claimWorkflowInstanceId(env.DB, session.id, session.id);
  return claimed?.workflow_instance_id === session.id ? { ...claimed, workflow_instance_id: claimed.workflow_instance_id } : null;
}

function generationClaim(session: SessionRecord): GenerationClaim {
  return {
    id: session.id,
    event_id: session.event_id,
    scene_id: session.scene_id,
    selfie_key: session.selfie_key,
    selfie_sha256: session.selfie_sha256,
    workflow_instance_id: session.workflow_instance_id,
  };
}

async function loadClaimedSession(claim: GenerationClaim) {
  const session = await loadSession(env.DB, claim.id);
  if (!session
    || session.id !== claim.id
    || session.event_id !== claim.event_id
    || session.scene_id !== claim.scene_id
    || session.selfie_key !== claim.selfie_key
    || session.selfie_sha256 !== claim.selfie_sha256
    || session.workflow_instance_id !== claim.workflow_instance_id) {
    throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: START_GENERATION_ERROR });
  }
  return session;
}

async function ensureSelfieUploaded(sessionId: string, eventId: number, workflowInstanceId: string, selfieKey: string, selfieSha256: string, bytes: Uint8Array) {
  const existing = await env.SELFIES.head(selfieKey);
  if (hasExactSelfieOwnership(existing, { sessionId, eventId, workflowInstanceId, selfieSha256 })) return;
  const uploadingSession = await transitionSession(env.DB, sessionId, 'uploading', {}, workflowInstanceId);
  if (uploadingSession?.workflow_instance_id !== workflowInstanceId || uploadingSession.status !== 'uploading') {
    throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: START_GENERATION_ERROR });
  }
  await env.SELFIES.put(selfieKey, bytes, {
    httpMetadata: { contentType: 'image/jpeg' },
    customMetadata: {
      sessionId,
      eventId: String(eventId),
      workflowInstanceId,
      assetKind: 'selfie',
      selfieSha256,
    },
  });
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
