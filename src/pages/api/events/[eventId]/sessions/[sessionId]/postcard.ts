import { env } from 'cloudflare:workers';
import { loadSession } from '../../../../../../db/sessions';
import { hasOwnedPostcard, isOwnedSessionAssetKey, legacySessionAssetKey } from '../../../../../../lib/selfie-ownership';

export const prerender = false;

const EVENT_ID_PATTERN = /^[1-9]\d{0,18}$/;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError']);
const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

function notFound() {
  return new Response('Not found', { status: 404, headers: RESPONSE_HEADERS });
}

function unavailable() {
  return new Response('Postcard temporarily unavailable', { status: 503, headers: RESPONSE_HEADERS });
}

export async function GET({ params, url }: { params: Record<string, string | undefined>; url: URL }) {
  const eventId = params.eventId;
  const sessionId = params.sessionId;
  if (!eventId || !EVENT_ID_PATTERN.test(eventId) || !sessionId || !SESSION_ID_PATTERN.test(sessionId)) return notFound();

  try {
    const session = await loadSession(env.DB, sessionId);
    if (
      !session
      || session.id !== sessionId
      || String(session.event_id) !== eventId
      || session.status !== 'completed'
      || !session.postcard_key
      || !isOwnedSessionAssetKey(sessionId, 'postcard', session.postcard_key)
      || (!session.workflow_instance_id && session.postcard_key !== legacySessionAssetKey(sessionId, 'postcard'))
    ) return notFound();

    const postcardKey = session.postcard_key;
    const object = await env.SELFIES.get(postcardKey);
    if (!object || !hasOwnedPostcard(object, postcardKey, {
      sessionId,
      eventId: session.event_id,
      workflowInstanceId: session.workflow_instance_id,
    })) return notFound();

    const download = url.searchParams.get('download') === '1';
    const headers = new Headers({
      ...RESPONSE_HEADERS,
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="caricature-postcard.jpg"`,
    });
    return new Response(object.body, { headers });
  } catch (error) {
    console.error(JSON.stringify({
      message: 'public postcard request failed',
      eventId,
      sessionId,
      ...errorDiagnostic(error),
    }));
    return unavailable();
  }
}

function errorDiagnostic(error: unknown) {
  return error instanceof Error
    ? { errorName: SAFE_ERROR_NAMES.has(error.name) ? error.name : 'Error' }
    : { errorType: typeof error };
}
