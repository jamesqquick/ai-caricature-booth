import { handle } from '@astrojs/cloudflare/handler';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { claimSessionGeneration, loadSession, transitionSession, type SessionRecord } from './db/sessions';
import { buildPostcard } from './lib/postcard';
import { moderateImage } from './lib/moderation';
import { generateCaricature } from './lib/replicate';
import { adminForbiddenResponse, isAdminApiPath, isAdminPath, isAllowedAdminMutation, withVerifiedAdminIdentity } from './lib/admin-access';
import type { GenerationFailureCode } from './lib/generation-errors';
import { composeGenerationPrompt } from './lib/generation-prompt';
import { hasExactSessionAssetOwnership, readOwnedSelfieBytes, workflowSessionAssetKey } from './lib/selfie-ownership';

export type CaricaturePayload = {
  sessionId: string;
  workflowInstanceId: string;
  eventId: number;
  sceneId: string;
  sceneName: string;
  sceneDescription?: string;
  scenePrompt: string;
  eventPromptPreamble?: string | null;
  eventConstraints?: string | null;
  selfieKey: string;
  selfieSha256?: string;
  watermarkKey: string | null;
  watermarkWidth: number | null;
};

export class CaricatureWorkflow extends WorkflowEntrypoint<Env, CaricaturePayload> {
  async run(event: WorkflowEvent<CaricaturePayload>, step: WorkflowStep) {
    const workflowStartedAt = Date.now();
    const {
      sessionId,
      workflowInstanceId,
      eventId,
      sceneId,
      sceneName,
      sceneDescription,
      scenePrompt,
      eventPromptPreamble,
      eventConstraints,
      selfieKey,
      selfieSha256,
      watermarkKey,
      watermarkWidth,
    } = event.payload;
    const stopped = { sessionId, postcardKey: null };
    const ownsSession = () => ownsActiveWorkflowSession(this.env.DB, sessionId, event.instanceId);
    const session = await loadSession(this.env.DB, sessionId);
    const ownedSelfieSha256 = selfieSha256 ?? session?.selfie_sha256;
    if (
      workflowInstanceId !== event.instanceId
      || session?.workflow_instance_id !== event.instanceId
      || session.event_id !== eventId
      || session.selfie_key !== selfieKey
      || !ownedSelfieSha256
      || session.selfie_sha256 !== ownedSelfieSha256
    ) return stopped;
    const selfieOwnership = {
      sessionId,
      eventId,
      workflowInstanceId: event.instanceId,
      selfieSha256: ownedSelfieSha256,
    };
    const markErrored = async (errorCode: GenerationFailureCode) => {
      await transitionSession(this.env.DB, sessionId, 'errored', { error_code: errorCode }, event.instanceId);
    };
    const moderatingSession = await step.do<SessionRecord | undefined>('mark-moderating', { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } }, async () => {
      return transitionSession(this.env.DB, sessionId, 'moderating', {}, event.instanceId);
    });
    if (!isOwnedSessionAtStatus(moderatingSession, event.instanceId, 'moderating')) return stopped;

    let moderationOutcome: 'safe' | 'unsafe' | 'stale';
    const moderationStartedAt = Date.now();
    try {
      moderationOutcome = await step.do<'safe' | 'unsafe' | 'stale'>('moderate-selfie', { retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' }, timeout: '1 minute' }, async () => {
        const startedAt = Date.now();
        if (!(await ownsSession())) return 'stale';
        const selfie = await this.env.SELFIES.get(selfieKey);
        if (!selfie) throw new Error('Uploaded selfie was not found.');
        const selfieBytes = await readOwnedSelfieBytes(selfie, selfieKey, selfieOwnership);
        if (!selfieBytes) return 'stale';
        const verdict = await moderateImage(this.env.AI, selfieBytes);
        if (!verdict.safe) {
          if (!(await ownsSession())) return 'stale';
          const currentSelfie = await this.env.SELFIES.get(selfieKey);
          if (!currentSelfie || !await readOwnedSelfieBytes(currentSelfie, selfieKey, selfieOwnership)) return 'stale';
          await deleteRejectedSelfie(this.env.SELFIES, selfieKey);
          await markErrored('photo_rejected');
          console.info(JSON.stringify({ message: 'photo moderation completed', sessionId, elapsedMs: Date.now() - startedAt, outcome: 'unsafe' }));
          return 'unsafe';
        }
        console.info(JSON.stringify({ message: 'photo moderation completed', sessionId, elapsedMs: Date.now() - startedAt, outcome: 'safe' }));
        return 'safe';
      });
    } catch (error) {
      console.error(JSON.stringify({ message: 'photo moderation failed', sessionId, elapsedMs: Date.now() - moderationStartedAt, outcome: 'service-error', ...errorDiagnostic(error) }));
      await markErrored('moderation_unavailable');
      throw error;
    }

    if (moderationOutcome !== 'safe' || !(await ownsSession())) return stopped;

    let caricatureKey: string | null;
    try {
      caricatureKey = await step.do<string | null>('generate-caricature', { retries: { limit: 1, delay: '1 second' }, timeout: '3 minutes' }, async () => {
        const generationClaim = await claimSessionGeneration(this.env.DB, sessionId, event.instanceId);
        if (!generationClaim.claimed) {
          if (isOwnedSessionAtStatus(generationClaim.session, event.instanceId, 'generating')) await markErrored('generation_failed');
          return null;
        }
        if (!(await ownsSession())) return null;
        const selfie = await this.env.SELFIES.get(selfieKey);
        if (!selfie) throw new Error('Approved selfie was not found.');
        const selfieBytes = await readOwnedSelfieBytes(selfie, selfieKey, selfieOwnership);
        if (!selfieBytes) return null;
        if (!(await ownsSession())) return null;
        const prompt = composeGenerationPrompt({
          preamble: eventPromptPreamble,
          scenePrompt,
          sceneDescription,
          constraints: eventConstraints,
        });
        const bytes = await generateCaricature(this.env.REPLICATE_API_TOKEN, selfieBytes, prompt);
        if (!(await ownsSession())) return null;
        const key = workflowSessionAssetKey(sessionId, event.instanceId, 'caricature');
        await this.env.SELFIES.put(key, bytes, {
          httpMetadata: { contentType: 'image/jpeg' },
          customMetadata: { sessionId, eventId: String(eventId), workflowInstanceId: event.instanceId, assetKind: 'caricature', sceneId },
        });
        const compositingSession = await transitionSession(this.env.DB, sessionId, 'compositing', { scene_name: sceneName, caricature_key: key }, event.instanceId);
        if (
          !isOwnedSessionAtStatus(compositingSession, event.instanceId, 'compositing')
          || compositingSession?.caricature_key !== key
        ) return null;
        return key;
      });
    } catch (error) {
      console.error(JSON.stringify({ message: 'caricature generation failed', sessionId, ...errorDiagnostic(error) }));
      await markErrored('generation_failed');
      throw error;
    }
    if (!caricatureKey || !(await ownsSession())) return stopped;

    let postcardKey: string | null;
    try {
      postcardKey = await step.do<string | null>('compose-postcard', { retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' } }, async (ctx) => {
        const startedAt = Date.now();
        if (!(await ownsSession())) return null;
        const caricature = await this.env.SELFIES.get(caricatureKey);
        if (!caricature) throw new Error('Generated caricature was not found.');
        if (!hasExactSessionAssetOwnership(caricature, {
          sessionId,
          eventId,
          workflowInstanceId: event.instanceId,
          assetKind: 'caricature',
        })) {
          await markErrored('unknown_failure');
          return null;
        }
        console.info(JSON.stringify({ message: 'postcard composition started', sessionId, attempt: ctx.attempt, caricatureBytes: caricature.size, hasWatermark: Boolean(watermarkKey) }));
        const postcard = await buildPostcard(this.env, caricature, watermarkKey, watermarkWidth);
        if (!postcard.ok || !postcard.body) throw new Error(`Postcard composition failed: HTTP ${postcard.status}`);
        if (!(await ownsSession())) return null;
        console.info(JSON.stringify({ message: 'postcard composition completed', sessionId, attempt: ctx.attempt, status: postcard.status, elapsedMs: Date.now() - startedAt }));
        const key = workflowSessionAssetKey(sessionId, event.instanceId, 'postcard');
        await this.env.SELFIES.put(key, postcard.body, {
          httpMetadata: { contentType: 'image/jpeg' },
          customMetadata: { sessionId, eventId: String(eventId), workflowInstanceId: event.instanceId, assetKind: 'postcard', sceneId },
        });
        console.info(JSON.stringify({ message: 'postcard stored', sessionId, attempt: ctx.attempt, elapsedMs: Date.now() - startedAt }));
        return key;
      });
    } catch (error) {
      console.error(JSON.stringify({ message: 'postcard composition failed', sessionId, ...errorDiagnostic(error) }));
      await markErrored('composition_failed');
      throw error;
    }
    if (!postcardKey || !(await ownsSession())) return stopped;

    const completedSession = await step.do<SessionRecord | undefined>('mark-completed', { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } }, async () => {
      return transitionSession(this.env.DB, sessionId, 'completed', {
        postcard_key: postcardKey,
        pipeline_ms: Math.max(0, Date.now() - workflowStartedAt),
      }, event.instanceId);
    });
    if (
      !isOwnedSessionAtStatus(completedSession, event.instanceId, 'completed')
      || completedSession?.postcard_key !== postcardKey
    ) return stopped;
    return { sessionId, postcardKey };
  }
}

async function ownsActiveWorkflowSession(database: D1Database, sessionId: string, workflowInstanceId: string) {
  const session = await loadSession(database, sessionId);
  return session?.workflow_instance_id === workflowInstanceId
    && session.status !== 'completed'
    && session.status !== 'errored';
}

function isOwnedSessionAtStatus(session: SessionRecord | undefined, workflowInstanceId: string, status: SessionRecord['status']) {
  return session?.workflow_instance_id === workflowInstanceId && session.status === status;
}

function errorDiagnostic(error: unknown) {
  return error instanceof Error
    ? { errorName: error.name, errorMessage: error.message }
    : { errorType: typeof error };
}

async function deleteRejectedSelfie(bucket: R2Bucket, key: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await bucket.delete(key);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not delete rejected selfie.');
}

const astro = { fetch: handle } satisfies ExportedHandler<Env>;

export default {
  async fetch(request: Request, env, context) {
    const pathname = new URL(request.url).pathname;
    if (!isAdminPath(pathname)) return astro.fetch(request, env, context);

    const verifiedRequest = await withVerifiedAdminIdentity(request, context.access, env, import.meta.env.DEV);
    if (!verifiedRequest) return adminForbiddenResponse(pathname);
    if (isAdminApiPath(pathname) && !isAllowedAdminMutation(verifiedRequest)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    return astro.fetch(verifiedRequest, env, context);
  },
} satisfies ExportedHandler<Env>;
