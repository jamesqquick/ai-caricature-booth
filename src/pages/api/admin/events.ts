import { env } from 'cloudflare:workers';
import { createEvent } from '../../../db/events';
import { ADMIN_EMAIL_HEADER } from '../../../lib/admin-access';
import { EventSlugConflictError, EventValidationError, validateCreateEvent } from '../../../lib/event-validation';

export const prerender = false;

async function readInput(request: Request) {
  if (request.headers.get('content-type')?.includes('application/json')) {
    return await request.json() as Record<string, unknown>;
  }

  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function POST({ request }: { request: Request }) {
  const createdBy = request.headers.get(ADMIN_EMAIL_HEADER)?.trim();
  if (!createdBy) return Response.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const input = validateCreateEvent(await readInput(request));
    const event = await createEvent(env.DB, input, createdBy);
    if (!event) return Response.json({ error: 'Event could not be created.' }, { status: 500 });
    return Response.redirect(new URL(`/admin/events/${encodeURIComponent(event.slug)}`, request.url), 303);
  } catch (error) {
    if (error instanceof EventValidationError) {
      return Response.json({ error: error.message, fields: error.fields }, { status: 400 });
    }
    if (error instanceof EventSlugConflictError) {
      return Response.json({ error: error.message, field: 'slug' }, { status: 409 });
    }
    console.error('Admin event creation failed', error);
    return Response.json({ error: 'Event could not be created.' }, { status: 500 });
  }
}
