import { env } from 'cloudflare:workers';
import { loadSession } from '../../../../../../db/sessions';

export const prerender = false;

export async function GET({ params, url }: { params: Record<string, string | undefined>; url: URL }) {
  const sessionId = params.sessionId;
  if (!sessionId || params.eventId === undefined) return new Response('Not found', { status: 404 });
  const session = await loadSession(env.DB, sessionId);
  if (!session || String(session.event_id) !== params.eventId || session.status !== 'completed' || !session.postcard_key) {
    return new Response('Not found', { status: 404 });
  }
  const object = await env.SELFIES.get(session.postcard_key);
  if (!object) return new Response('Not found', { status: 404 });
  const download = url.searchParams.get('download') === '1';
  const headers = new Headers({
    'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg',
    'Cache-Control': 'private, no-store',
  });
  headers.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="caricature-postcard.jpg"`);
  return new Response(object.body, { headers });
}
