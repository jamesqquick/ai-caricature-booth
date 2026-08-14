import { handle } from '@astrojs/cloudflare/handler';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { transitionSession } from './db/sessions';
import { buildPostcard } from './lib/postcard';
import { generateCaricature } from './lib/replicate';
import { scenes } from './data/scenes';

export type CaricaturePayload = {
  sessionId: string;
  eventId: number;
  sceneId: string;
  selfieKey: string;
  watermarkKey: string | null;
};

export class CaricatureWorkflow extends WorkflowEntrypoint<Env, CaricaturePayload> {
  async run(event: WorkflowEvent<CaricaturePayload>, step: WorkflowStep) {
    const { sessionId, eventId, sceneId, selfieKey, watermarkKey } = event.payload;
    const markErrored = async (error: unknown) => {
      await transitionSession(this.env.DB, sessionId, 'errored', { error_msg: error instanceof Error ? error.message : String(error) });
    };
    await step.do('mark-generating', { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } }, async () => {
      await transitionSession(this.env.DB, sessionId, 'generating', { workflow_instance_id: event.instanceId });
      return true;
    });

    const caricatureKey = await step.do<string>('generate-caricature', { retries: { limit: 0, delay: '1 second' }, timeout: '3 minutes' }, async () => {
      try {
        const selfie = await this.env.SELFIES.get(selfieKey);
        if (!selfie) throw new Error('Approved selfie was not found.');
        const scene = scenes.find((candidate) => candidate.id === sceneId);
        if (!scene) throw new Error('Generation scene was not found.');
        const bytes = await generateCaricature(this.env.REPLICATE_API_TOKEN, new Uint8Array(await selfie.arrayBuffer()), `Create a bold editorial ink caricature in the ${scene.name} setting. ${scene.description} Keep the person recognizable, expressive, and centered. No text.`);
        const key = `sessions/${sessionId}/caricature.jpg`;
        await this.env.SELFIES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { eventId: String(eventId), sceneId } });
        await transitionSession(this.env.DB, sessionId, 'compositing', { caricature_key: key });
        return key;
      } catch (error) {
        console.error(JSON.stringify({ message: 'caricature generation failed', sessionId, error: error instanceof Error ? error.message : String(error) }));
        await markErrored('We could not create your caricature. Please try again.');
        throw error;
      }
    });

    const postcardKey = await step.do('compose-postcard', { retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' } }, async (ctx) => {
      const startedAt = Date.now();
      try {
        const caricature = await this.env.SELFIES.get(caricatureKey);
        if (!caricature) throw new Error('Generated caricature was not found.');
        console.info(JSON.stringify({ message: 'postcard composition started', sessionId, attempt: ctx.attempt, caricatureBytes: caricature.size, hasWatermark: Boolean(watermarkKey) }));
        const postcard = await buildPostcard(this.env, caricature, watermarkKey);
        if (!postcard.ok || !postcard.body) throw new Error(`Postcard composition failed: HTTP ${postcard.status}`);
        console.info(JSON.stringify({ message: 'postcard composition completed', sessionId, attempt: ctx.attempt, status: postcard.status, elapsedMs: Date.now() - startedAt }));
        const key = `sessions/${sessionId}/postcard.jpg`;
        await this.env.SELFIES.put(key, postcard.body, { httpMetadata: { contentType: 'image/jpeg' } });
        console.info(JSON.stringify({ message: 'postcard stored', sessionId, attempt: ctx.attempt, elapsedMs: Date.now() - startedAt }));
        return key;
      } catch (error) {
        if (ctx.attempt >= 3) {
          console.error(JSON.stringify({ message: 'postcard composition failed', sessionId, error: error instanceof Error ? error.message : String(error) }));
          await markErrored('We could not finish your postcard. Please try again.');
        }
        throw error;
      }
    });

    await step.do('mark-completed', { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } }, async () => {
      await transitionSession(this.env.DB, sessionId, 'completed', { postcard_key: postcardKey });
      return true;
    });
    return { sessionId, postcardKey };
  }
}

const astro = { fetch: handle } satisfies ExportedHandler<Env>;

export default {
  fetch(request, env, context) {
    return astro.fetch(request, env, context);
  },
} satisfies ExportedHandler<Env>;
