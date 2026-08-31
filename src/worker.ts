import { handle } from '@astrojs/cloudflare/handler';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { transitionSession } from './db/sessions';
import { buildPostcard } from './lib/postcard';
import { moderateImage } from './lib/moderation';
import { generateCaricature } from './lib/replicate';
import { adminForbiddenResponse, isAdminApiPath, isAdminPath, isAllowedAdminMutation, withVerifiedAdminIdentity } from './lib/admin-access';
import { composeGenerationPrompt } from './lib/generation-prompt';

export type CaricaturePayload = {
  sessionId: string;
  eventId: number;
  sceneId: string;
  sceneName: string;
  sceneDescription?: string;
  scenePrompt: string;
  eventPromptPreamble?: string | null;
  eventConstraints?: string | null;
  selfieKey: string;
  watermarkKey: string | null;
  watermarkWidth: number | null;
};

export class CaricatureWorkflow extends WorkflowEntrypoint<Env, CaricaturePayload> {
  async run(event: WorkflowEvent<CaricaturePayload>, step: WorkflowStep) {
    const workflowStartedAt = Date.now();
    const {
      sessionId,
      eventId,
      sceneId,
      sceneName,
      sceneDescription,
      scenePrompt,
      eventPromptPreamble,
      eventConstraints,
      selfieKey,
      watermarkKey,
      watermarkWidth,
    } = event.payload;
    const markErrored = async (error: unknown) => {
      await transitionSession(this.env.DB, sessionId, 'errored', { error_msg: error instanceof Error ? error.message : String(error) });
    };
    await step.do('mark-moderating', { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } }, async () => {
      await transitionSession(this.env.DB, sessionId, 'moderating', { workflow_instance_id: event.instanceId });
      return true;
    });

    const moderationPassed = await step.do<boolean>('moderate-selfie', { retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' }, timeout: '1 minute' }, async (ctx) => {
      const startedAt = Date.now();
      try {
        const selfie = await this.env.SELFIES.get(selfieKey);
        if (!selfie) throw new Error('Uploaded selfie was not found.');
        const verdict = await moderateImage(this.env.AI, new Uint8Array(await selfie.arrayBuffer()));
        if (!verdict.safe) {
          await deleteRejectedSelfie(this.env.SELFIES, selfieKey);
          await transitionSession(this.env.DB, sessionId, 'errored', { error_msg: "We couldn't use this photo after the safety check. Try a different photo." });
          console.info(JSON.stringify({ message: 'photo moderation completed', sessionId, elapsedMs: Date.now() - startedAt, outcome: 'unsafe' }));
          return false;
        }
        console.info(JSON.stringify({ message: 'photo moderation completed', sessionId, elapsedMs: Date.now() - startedAt, outcome: 'safe' }));
        return true;
      } catch (error) {
        if (ctx.attempt >= 2) {
          await transitionSession(this.env.DB, sessionId, 'errored', { error_msg: "We couldn't check your photo. Please try again." });
          console.error(JSON.stringify({ message: 'photo moderation failed', sessionId, elapsedMs: Date.now() - startedAt, outcome: 'service-error' }));
        }
        throw error;
      }
    });

    if (!moderationPassed) return { sessionId, postcardKey: null };

    await step.do('mark-generating', { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } }, async () => {
      await transitionSession(this.env.DB, sessionId, 'generating', { workflow_instance_id: event.instanceId });
      return true;
    });

    const caricatureKey = await step.do<string>('generate-caricature', { retries: { limit: 0, delay: '1 second' }, timeout: '3 minutes' }, async () => {
      try {
        const selfie = await this.env.SELFIES.get(selfieKey);
        if (!selfie) throw new Error('Approved selfie was not found.');
        const prompt = composeGenerationPrompt({
          preamble: eventPromptPreamble,
          scenePrompt,
          sceneDescription,
          constraints: eventConstraints,
        });
        const bytes = await generateCaricature(this.env.REPLICATE_API_TOKEN, new Uint8Array(await selfie.arrayBuffer()), prompt);
        const key = `sessions/${sessionId}/caricature.jpg`;
        await this.env.SELFIES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { eventId: String(eventId), sceneId } });
        await transitionSession(this.env.DB, sessionId, 'compositing', { scene_name: sceneName, caricature_key: key });
        return key;
      } catch (error) {
        console.error(JSON.stringify({ message: 'caricature generation failed', sessionId, error: error instanceof Error ? error.message : String(error) }));
        await markErrored("We couldn't create your caricature. Please try again.");
        throw error;
      }
    });

    const postcardKey = await step.do('compose-postcard', { retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' } }, async (ctx) => {
      const startedAt = Date.now();
      try {
        const caricature = await this.env.SELFIES.get(caricatureKey);
        if (!caricature) throw new Error('Generated caricature was not found.');
        console.info(JSON.stringify({ message: 'postcard composition started', sessionId, attempt: ctx.attempt, caricatureBytes: caricature.size, hasWatermark: Boolean(watermarkKey) }));
        const postcard = await buildPostcard(this.env, caricature, watermarkKey, watermarkWidth);
        if (!postcard.ok || !postcard.body) throw new Error(`Postcard composition failed: HTTP ${postcard.status}`);
        console.info(JSON.stringify({ message: 'postcard composition completed', sessionId, attempt: ctx.attempt, status: postcard.status, elapsedMs: Date.now() - startedAt }));
        const key = `sessions/${sessionId}/postcard.jpg`;
        await this.env.SELFIES.put(key, postcard.body, { httpMetadata: { contentType: 'image/jpeg' } });
        console.info(JSON.stringify({ message: 'postcard stored', sessionId, attempt: ctx.attempt, elapsedMs: Date.now() - startedAt }));
        return key;
      } catch (error) {
        if (ctx.attempt >= (ctx.config.retries?.limit ?? 1)) {
          console.error(JSON.stringify({ message: 'postcard composition failed', sessionId, error: error instanceof Error ? error.message : String(error) }));
          await markErrored("We couldn't finish your postcard. Please try again.");
        }
        throw error;
      }
    });

    await step.do('mark-completed', { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } }, async () => {
      await transitionSession(this.env.DB, sessionId, 'completed', {
        postcard_key: postcardKey,
        pipeline_ms: Math.max(0, Date.now() - workflowStartedAt),
      });
      return true;
    });
    return { sessionId, postcardKey };
  }
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
