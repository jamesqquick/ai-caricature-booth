export const EVENT_STATUSES = ['draft', 'active', 'archived'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type CreateEventInput = {
  name: string;
  slug: string;
  status: EventStatus;
};

export type EventBrandingInput = {
  tagline: string;
  kiosk_idle_subhead: string;
  scene_picker_heading: string;
  accent_color: string;
};

export type EventPromptInput = {
  scene_style_preamble: string | null;
  scene_constraints: string | null;
};

export type EventUpdateInput = CreateEventInput & Partial<EventBrandingInput & EventPromptInput>;
export type EventField = keyof EventUpdateInput;

export type SceneInput = {
  id: string;
  name: string;
  description: string;
  prompt: string;
};

export type SceneField = keyof SceneInput;

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

export class SceneValidationError extends Error {
  name = 'SceneValidationError';

  constructor(public readonly fields: Partial<Record<SceneField, string>>) {
    super('Scene configuration is invalid.');
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

export function validateEventUpdate(input: Partial<Record<EventField, unknown>>): EventUpdateInput {
  const core = validateCreateEvent(input);
  const fields: Partial<Record<EventField, string>> = {};
  const branding: Partial<EventBrandingInput> = {};
  const copyFields: Array<keyof Pick<EventBrandingInput, 'tagline' | 'kiosk_idle_subhead' | 'scene_picker_heading'>> = [
    'tagline',
    'kiosk_idle_subhead',
    'scene_picker_heading',
  ];
  const copyLimits = {
    tagline: 180,
    kiosk_idle_subhead: 120,
    scene_picker_heading: 100,
  } as const;

  for (const field of copyFields) {
    if (input[field] === undefined) continue;
    const value = typeof input[field] === 'string' ? input[field].trim() : '';
    if (!value) fields[field] = 'This field is required.';
    else if (value.length > copyLimits[field]) fields[field] = `Use ${copyLimits[field]} characters or fewer.`;
    else branding[field] = value;
  }

  if (input.accent_color !== undefined) {
    const accentColor = typeof input.accent_color === 'string' ? input.accent_color.trim().toLowerCase() : '';
    if (!/^#[0-9a-f]{6}$/.test(accentColor)) fields.accent_color = 'Use a six-digit hexadecimal color.';
    else branding.accent_color = accentColor;
  }

  const prompts: Partial<EventPromptInput> = {};
  for (const field of ['scene_style_preamble', 'scene_constraints'] as const) {
    if (input[field] === undefined) continue;
    const value = typeof input[field] === 'string' ? input[field].trim() : '';
    if (value.length > 2_000) fields[field] = 'Use 2000 characters or fewer.';
    else prompts[field] = value || null;
  }

  if (Object.keys(fields).length > 0) throw new EventValidationError(fields);
  return { ...core, ...branding, ...prompts };
}

export function validateEventPrompts(input: Partial<Record<EventField, unknown>>): EventPromptInput {
  const fields: Partial<Record<EventField, string>> = {};
  const prompts = {} as EventPromptInput;

  for (const field of ['scene_style_preamble', 'scene_constraints'] as const) {
    const value = typeof input[field] === 'string' ? input[field].trim() : '';
    if (value.length > 2_000) fields[field] = 'Use 2000 characters or fewer.';
    else prompts[field] = value || null;
  }

  if (Object.keys(fields).length > 0) throw new EventValidationError(fields);
  return prompts;
}

export function validateScene(input: Partial<Record<SceneField, unknown>>, requireId = true): SceneInput {
  const values = {
    id: typeof input.id === 'string' ? input.id.trim() : '',
    name: typeof input.name === 'string' ? input.name.trim() : '',
    description: typeof input.description === 'string' ? input.description.trim() : '',
    prompt: typeof input.prompt === 'string' ? input.prompt.trim() : '',
  };
  const fields: Partial<Record<SceneField, string>> = {};

  if (requireId && !values.id) fields.id = 'Enter a scene ID.';
  else if (values.id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.id)) {
    fields.id = 'Use lowercase letters, numbers, and single hyphens only.';
  } else if (values.id.length > 80) fields.id = 'Use 80 characters or fewer.';

  validateRequiredLength(fields, 'name', values.name, 120);
  validateRequiredLength(fields, 'description', values.description, 300);
  validateRequiredLength(fields, 'prompt', values.prompt, 2_000);

  if (Object.keys(fields).length > 0) throw new SceneValidationError(fields);
  return values;
}

function validateRequiredLength(
  fields: Partial<Record<SceneField, string>>,
  field: 'name' | 'description' | 'prompt',
  value: string,
  limit: number,
) {
  if (!value) fields[field] = 'This field is required.';
  else if (value.length > limit) fields[field] = `Use ${limit} characters or fewer.`;
}
