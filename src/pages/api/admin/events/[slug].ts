import { env } from 'cloudflare:workers';
import { loadEventBySlug, updateEvent } from '../../../../db/events';
import { ADMIN_EMAIL_HEADER } from '../../../../lib/admin-access';
import { EventSlugConflictError, EventValidationError, validateEventUpdate } from '../../../../lib/event-validation';

export const prerender = false;

async function readInput(request: Request) {
  if (request.headers.get('content-type')?.includes('application/json')) {
    return await request.json() as Record<string, unknown>;
  }

  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

function isJsonRequest(request: Request) {
  return request.headers.get('content-type')?.includes('application/json') ?? false;
}

function redirectWithError(request: Request, slug: string, message: string) {
  const url = new URL(`/admin/events/${encodeURIComponent(slug)}`, request.url);
  url.searchParams.set('error', message);
  return Response.redirect(url, 303);
}

export async function POST({ request, params }: { request: Request; params: { slug?: string } }) {
  const json = isJsonRequest(request);
  const currentSlug = params.slug ?? '';
  if (!request.headers.get(ADMIN_EMAIL_HEADER)?.trim()) return Response.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const event = await loadEventBySlug(env.DB, currentSlug);
    if (!event) return Response.json({ error: 'Event not found.' }, { status: 404 });

    const input = validateEventUpdate(await readInput(request));
    const updated = await updateEvent(env.DB, event.id, input);
    if (json) return Response.json({ event: updated });

    const url = new URL(`/admin/events/${encodeURIComponent(updated.slug)}`, request.url);
    url.searchParams.set('saved', '1');
    return Response.redirect(url, 303);
  } catch (error) {
    if (error instanceof EventValidationError) {
      if (!json) return redirectWithError(request, currentSlug, error.message);
      return Response.json({ error: error.message, fields: error.fields }, { status: 400 });
    }
    if (error instanceof EventSlugConflictError) {
      if (!json) return redirectWithError(request, currentSlug, error.message);
      return Response.json({ error: error.message, field: 'slug' }, { status: 409 });
    }
    console.error('Admin event update failed', error);
    if (!json) return redirectWithError(request, currentSlug, 'Event could not be saved.');
    return Response.json({ error: 'Event could not be saved.' }, { status: 500 });
  }
}
