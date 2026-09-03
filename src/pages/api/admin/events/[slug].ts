import { env } from 'cloudflare:workers';
import { deleteEventWithSessions, EventActivationError, EventDeletionConflictError, loadEventBySlug, updateEvent, updateEventPrompts } from '../../../../db/events';
import { ADMIN_EMAIL_HEADER } from '../../../../lib/admin-access';
import type { EventFeedbackCode } from '../../../../lib/admin-event-feedback';
import { EventSlugConflictError, EventValidationError, validateEventPrompts, validateEventUpdate } from '../../../../lib/event-validation';

export const prerender = false;

type RouteContext = { request: Request; params: { slug?: string } };

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

function redirectWithError(request: Request, slug: string, code: EventFeedbackCode) {
  const url = new URL(`/admin/events/${encodeURIComponent(slug)}`, request.url);
  url.searchParams.set('error', code);
  return Response.redirect(url, 303);
}

function eventDetailsDto(event: Record<string, unknown>) {
  return {
    name: event.name,
    slug: event.slug,
    status: event.status,
    accent_color: event.accent_color,
    tagline: event.tagline,
    kiosk_idle_subhead: event.kiosk_idle_subhead,
    scene_picker_heading: event.scene_picker_heading,
  };
}

export async function POST({ request, params }: RouteContext) {
  const json = isJsonRequest(request);
  const currentSlug = params.slug ?? '';
  if (!request.headers.get(ADMIN_EMAIL_HEADER)?.trim()) return Response.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const event = await loadEventBySlug(env.DB, currentSlug);
    if (!event) return Response.json({ error: 'Event not found.' }, { status: 404 });

    const rawInput = await readInput(request);
    if (rawInput.section === 'prompts') {
      const updated = await updateEventPrompts(env.DB, event.id, validateEventPrompts(rawInput));
      return Response.json({ event: {
        scene_style_preamble: updated.scene_style_preamble,
        scene_constraints: updated.scene_constraints,
      } });
    }

    const input = validateEventUpdate(rawInput);
    const updated = await updateEvent(env.DB, event.id, input);
    if (json) return Response.json({ event: eventDetailsDto({ ...event, ...updated }) });

    const url = new URL(`/admin/events/${encodeURIComponent(updated.slug)}`, request.url);
    url.searchParams.set('saved', '1');
    return Response.redirect(url, 303);
  } catch (error) {
    if (error instanceof EventValidationError) {
      if (!json) return redirectWithError(request, currentSlug, 'validation');
      return Response.json({ error: error.message, fields: error.fields }, { status: 400 });
    }
    if (error instanceof EventSlugConflictError) {
      if (!json) return redirectWithError(request, currentSlug, 'slug-conflict');
      return Response.json({ error: error.message, field: 'slug' }, { status: 409 });
    }
    if (error instanceof EventActivationError) {
      if (!json) return redirectWithError(request, currentSlug, 'activation');
      return Response.json({ error: error.message, fields: { status: error.message } }, { status: 400 });
    }
    console.error('Admin event update failed', error);
    if (!json) return redirectWithError(request, currentSlug, 'save-failed');
    return Response.json({ error: "Couldn't save the event." }, { status: 500 });
  }
}

function ownedEventObjects(event: { id: number; watermark_image_key: string | null; watermark_image_key_left: string | null }, sessions: { id: string; objectKeys: string[] }[]) {
  const keys = [event.watermark_image_key, event.watermark_image_key_left]
    .filter((key): key is string => Boolean(key?.startsWith(`events/${event.id}/watermarks/`)));
  for (const session of sessions) {
    keys.push(...session.objectKeys.filter((key) => key.startsWith(`sessions/${session.id}/`)));
  }
  return [...new Set(keys)];
}

async function deleteEventObjects(keys: string[]) {
  for (let index = 0; index < keys.length; index += 1000) {
    try {
      await env.SELFIES.delete(keys.slice(index, index + 1000));
    } catch (error) {
      console.error('Deleted event R2 cleanup failed', error);
    }
  }
}

export async function DELETE({ request, params }: RouteContext) {
  const slug = params.slug ?? '';
  if (!request.headers.get(ADMIN_EMAIL_HEADER)?.trim()) return Response.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const event = await loadEventBySlug(env.DB, slug);
    if (!event) return Response.json({ error: 'Event not found.' }, { status: 404 });

    const result = await deleteEventWithSessions(env.DB, event.id);
    if (!result.deleted) return Response.json({ error: 'Event changed in another request. Refresh and try again.' }, { status: 409 });
    await deleteEventObjects(ownedEventObjects(event, result.sessions));
    return Response.json({ deleted: true, redirectTo: '/admin/events' });
  } catch (error) {
    if (error instanceof EventDeletionConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error('Admin event deletion failed', error);
     return Response.json({ error: "Couldn't delete the event." }, { status: 500 });
  }
}
