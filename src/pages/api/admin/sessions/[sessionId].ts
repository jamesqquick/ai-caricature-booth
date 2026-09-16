import { env } from 'cloudflare:workers';
import { deleteSessionWithAssets, SessionDeletionConflictError } from '../../../../db/sessions';
import { ADMIN_EMAIL_HEADER } from '../../../../lib/admin-access';
import { isOwnedSessionAssetKey, type SessionAssetKind } from '../../../../lib/selfie-ownership';

export const prerender = false;

type RouteContext = { request: Request; params: { sessionId?: string } };

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

async function deleteSessionObjects(
  sessionId: string,
  assets: Array<[SessionAssetKind, string | null]>,
) {
  const keys = [...new Set(assets
    .filter((asset): asset is [SessionAssetKind, string] => Boolean(asset[1]))
    .filter(([kind, key]) => isOwnedSessionAssetKey(sessionId, kind, key))
    .map(([, key]) => key))];
  if (keys.length === 0) return;

  try {
    await env.SELFIES.delete(keys);
  } catch (error) {
    console.error('Deleted session R2 cleanup failed', error);
  }
}

export async function DELETE({ request, params }: RouteContext) {
  const sessionId = params.sessionId ?? '';
  if (!request.headers.get(ADMIN_EMAIL_HEADER)?.trim()) return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!SESSION_ID_PATTERN.test(sessionId)) return Response.json({ error: 'Invalid session ID.' }, { status: 400 });

  try {
    const result = await deleteSessionWithAssets(env.DB, sessionId);
    if (!result.session) return Response.json({ error: 'Session not found.' }, { status: 404 });
    if (!result.deleted) {
      return Response.json({ error: 'Session changed in another request. Refresh and try again.' }, { status: 409 });
    }

    await deleteSessionObjects(sessionId, [
      ['selfie', result.session.selfie_key],
      ['caricature', result.session.caricature_key],
      ['postcard', result.session.postcard_key],
    ]);
    return Response.json({ deleted: true, redirectTo: '/admin' });
  } catch (error) {
    if (error instanceof SessionDeletionConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error('Admin session deletion failed', error);
    return Response.json({ error: "Couldn't delete the session." }, { status: 500 });
  }
}
