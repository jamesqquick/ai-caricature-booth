import { env } from 'cloudflare:workers';
import { loadEventBySlug } from '../../../../../../db/events';
import { deleteEventScene, SceneConflictError, SceneDeletionConflictError, updateEventScene } from '../../../../../../db/scenes';
import { ADMIN_EMAIL_HEADER } from '../../../../../../lib/admin-access';
import { SceneValidationError, validateScene } from '../../../../../../lib/event-validation';

export const prerender = false;

type RouteContext = { request: Request; params: { slug?: string; sceneId?: string } };

function forbidden(request: Request) {
  return request.headers.get(ADMIN_EMAIL_HEADER)?.trim()
    ? null
    : Response.json({ error: 'Forbidden' }, { status: 403 });
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof SceneValidationError) {
    return Response.json({ error: error.message, fields: error.fields }, { status: 400 });
  }
  if (error instanceof SceneConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof SceneDeletionConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  console.error('Admin scene request failed', error);
  return Response.json({ error: fallback }, { status: 500 });
}

async function eventForRoute(slug: string) {
  return loadEventBySlug(env.DB, slug);
}

export async function PUT({ request, params }: RouteContext) {
  const denied = forbidden(request);
  if (denied) return denied;

  try {
    const event = await eventForRoute(params.slug ?? '');
    if (!event) return Response.json({ error: 'Event not found.' }, { status: 404 });
    const sceneId = params.sceneId ?? '';
    const input = validateScene({
      ...await request.json<Record<string, unknown>>().catch(() => ({})),
      id: sceneId,
    });
    const scene = await updateEventScene(env.DB, event.id, sceneId, input);
    if (!scene) return Response.json({ error: 'Scene not found.' }, { status: 404 });
    return Response.json({ scene });
  } catch (error) {
    return errorResponse(error, "Couldn't save the scene.");
  }
}

export async function DELETE({ request, params }: RouteContext) {
  const denied = forbidden(request);
  if (denied) return denied;

  try {
    const event = await eventForRoute(params.slug ?? '');
    if (!event) return Response.json({ error: 'Event not found.' }, { status: 404 });
    const sceneId = params.sceneId ?? '';
    const deleted = await deleteEventScene(env.DB, event.id, sceneId);
    if (!deleted) return Response.json({ error: 'Scene not found.' }, { status: 404 });
    return Response.json({ deleted: true, sceneId });
  } catch (error) {
    return errorResponse(error, "Couldn't delete the scene.");
  }
}
