import { env } from 'cloudflare:workers';
import { ADMIN_IMAGE_KINDS, loadAdminSessionImageKey, type AdminImageKind } from '../../../../../../db/admin';

export const prerender = false;

const SAFE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function isAdminImageKind(value: string | undefined): value is AdminImageKind {
  return value !== undefined && ADMIN_IMAGE_KINDS.includes(value as AdminImageKind);
}

function safeFilenamePart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128) || 'session';
}

function isOwnedSessionImageKey(sessionId: string, kind: AdminImageKind, key: string) {
  return key === `sessions/${sessionId}/${kind}.jpg`;
}

function notFound() {
  return new Response('Not found', { status: 404 });
}

export async function GET({ params, url }: { params: Record<string, string | undefined>; url: URL }) {
  const sessionId = params.sessionId;
  const kind = params.kind;
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId) || !isAdminImageKind(kind)) return notFound();

  try {
    const imageKey = await loadAdminSessionImageKey(env.DB, sessionId, kind);
    if (!imageKey || !isOwnedSessionImageKey(sessionId, kind, imageKey)) return notFound();

    const object = await env.SELFIES.get(imageKey);
    const contentType = object?.httpMetadata?.contentType;
    if (!object || !contentType || !SAFE_IMAGE_TYPES.has(contentType)) return notFound();

    let body = object.body;
    let responseContentType = contentType;
    if (url.searchParams.get('variant') === 'thumbnail') {
      const thumbnail = await env.IMAGES.input(object.body)
        .transform({ width: 320, height: 213, fit: 'cover' })
        .output({ format: 'image/jpeg' })
        .then((result) => result.response());
      if (!thumbnail.ok || !thumbnail.body) return notFound();
      body = thumbnail.body;
      responseContentType = 'image/jpeg';
    }

    const filename = `${kind}-${safeFilenamePart(sessionId)}.jpg`;
    const headers = new Headers({
      'Cache-Control': 'private, no-store',
      'Content-Type': responseContentType,
      'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
    });

    return new Response(body, { headers });
  } catch {
    return notFound();
  }
}
