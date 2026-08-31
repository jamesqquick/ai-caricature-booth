import { env } from 'cloudflare:workers';
import { loadEventBySlug } from '../../../../../db/events';
import { createEventScene, loadAdminScenesByEvent, SceneConflictError } from '../../../../../db/scenes';
import { ADMIN_EMAIL_HEADER } from '../../../../../lib/admin-access';
import { SceneValidationError, validateScene } from '../../../../../lib/event-validation';

export const prerender = false;

type RouteContext = { request: Request; params: { slug?: string } };

function forbidden(request: Request) {
  return request.headers.get(ADMIN_EMAIL_HEADER)?.trim()
    ? null
    : Response.json({ error: 'Forbidden' }, { status: 403 });
}

async function requireEvent(slug: string) {
  return loadEventBySlug(env.DB, slug);
}

function errorResponse(error: unknown) {
  if (error instanceof SceneValidationError) {
    return Response.json({ error: error.message, fields: error.fields }, { status: 400 });
  }
  if (error instanceof SceneConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  console.error('Admin scene request failed', error);
  return Response.json({ error: "Couldn't save the scene." }, { status: 500 });
}

export async function GET({ request, params }: RouteContext) {
  const denied = forbidden(request);
  if (denied) return denied;
  const event = await requireEvent(params.slug ?? '');
  if (!event) return Response.json({ error: 'Event not found.' }, { status: 404 });
  return Response.json({ scenes: await loadAdminScenesByEvent(env.DB, event.id) });
}

export async function POST({ request, params }: RouteContext) {
  const denied = forbidden(request);
  if (denied) return denied;

  try {
    const event = await requireEvent(params.slug ?? '');
    if (!event) return Response.json({ error: 'Event not found.' }, { status: 404 });
    const input = validateScene(await request.json<Record<string, unknown>>().catch(() => ({})));
    const scene = await createEventScene(env.DB, event.id, input);
    return Response.json({ scene }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
