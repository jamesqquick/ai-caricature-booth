export const EVENT_STATUSES = ['draft', 'active', 'archived'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type CreateEventInput = {
  name: string;
  slug: string;
  status: EventStatus;
};

export type EventField = keyof CreateEventInput;

export class EventValidationError extends Error {
  name = 'EventValidationError';

  constructor(public readonly fields: Partial<Record<EventField, string>>) {
    super('Event details are invalid.');
  }
}

export class EventSlugConflictError extends Error {
  name = 'EventSlugConflictError';

  constructor(public readonly slug: string) {
    super(`An event with slug "${slug}" already exists.`);
  }
}

export function validateCreateEvent(input: Partial<Record<EventField, unknown>>): CreateEventInput {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const slug = typeof input.slug === 'string' ? input.slug.trim() : '';
  const status = typeof input.status === 'string' ? input.status.trim() : 'draft';
  const fields: Partial<Record<EventField, string>> = {};

  if (!name) fields.name = 'Enter an event name.';
  else if (name.length > 120) fields.name = 'Event names must be 120 characters or fewer.';

  if (!slug) fields.slug = 'Enter a URL slug.';
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    fields.slug = 'Use lowercase letters, numbers, and single hyphens only.';
  }

  if (!EVENT_STATUSES.includes(status as EventStatus)) fields.status = 'Choose draft, active, or archived.';
  if (Object.keys(fields).length > 0) throw new EventValidationError(fields);

  return {
    name,
    slug,
    status: status as EventStatus,
  };
}
