import { env } from 'cloudflare:workers';
import { ADMIN_IMAGE_KINDS, loadAdminSessionImageKey, type AdminImageKind } from '../../../../../../db/admin';

export const prerender = false;

function isAdminImageKind(value: string | undefined): value is AdminImageKind {
  return value !== undefined && ADMIN_IMAGE_KINDS.includes(value as AdminImageKind);
}

function safeFilenamePart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128) || 'session';
}

export async function GET({ params, url }: { params: Record<string, string | undefined>; url: URL }) {
  const sessionId = params.sessionId;
  const kind = params.kind;
  if (!sessionId || !isAdminImageKind(kind)) return new Response('Not found', { status: 404 });

  const imageKey = await loadAdminSessionImageKey(env.DB, sessionId, kind);
  if (!imageKey) return new Response('Not found', { status: 404 });

  const object = await env.SELFIES.get(imageKey);
  if (!object) return new Response('Not found', { status: 404 });

  const filename = `${kind}-${safeFilenamePart(sessionId)}.jpg`;
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
  });

  return new Response(object.body, { headers });
}
