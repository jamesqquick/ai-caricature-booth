export const EVENT_STATUSES = ['draft', 'active', 'archived'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type CreateEventInput = {
  name: string;
  slug: string;
  status: EventStatus;
};

export type DuplicateEventInput = {
  name: string;
};

export type EventBrandingInput = {
  tagline: string;
  kiosk_idle_subhead: string;
  scene_picker_heading: string;
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

export type CreateCompleteEventInput = {
  name: string;
  slug: string;
  status: EventStatus;
  tagline: string;
  kioskIdleSubhead: string;
  scenePickerHeading: string;
  sceneStylePreamble: string | null;
  sceneConstraints: string | null;
  scenes: SceneInput[];
};

export class CompleteEventValidationError extends Error {
  name = 'CompleteEventValidationError';

  constructor(public readonly fields: Record<string, string>) {
    super('Complete event configuration is invalid.');
  }
}

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

export function validateDuplicateEvent(input: Record<string, unknown>): DuplicateEventInput {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const fields: Partial<Record<EventField, string>> = {};

  if (!name) fields.name = 'Enter an event name.';
  else if (name.length > 120) fields.name = 'Event names must be 120 characters or fewer.';
  if (Object.keys(fields).length > 0) throw new EventValidationError(fields);

  return { name };
}

export function eventSlugFromName(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'event-copy';
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

export function validateCompleteEvent(input: unknown): CreateCompleteEventInput {
  const value = isRecord(input) ? input : {};
  const normalizedStatus = value.status === undefined
    ? 'draft'
    : typeof value.status === 'string' ? value.status.trim() : '';
  const fields: Record<string, string> = {};
  let core: CreateEventInput | undefined;
  let details: EventUpdateInput | undefined;

  try {
    core = validateCreateEvent({ ...value, status: normalizedStatus });
  } catch (error) {
    if (!(error instanceof EventValidationError)) throw error;
    for (const [field, message] of Object.entries(error.fields)) {
      if (message) fields[field] = message;
    }
  }

  const requiredBranding = {
    tagline: value.tagline,
    kiosk_idle_subhead: value.kioskIdleSubhead,
    scene_picker_heading: value.scenePickerHeading,
  };
  for (const [field, fieldValue] of Object.entries(requiredBranding)) {
    if (fieldValue === undefined) fields[toCompleteField(field)] = 'This field is required.';
  }
  for (const field of ['sceneStylePreamble', 'sceneConstraints'] as const) {
    const fieldValue = value[field];
    if (fieldValue !== undefined && fieldValue !== null && typeof fieldValue !== 'string') {
      fields[field] = 'Use text or null.';
    }
  }

  try {
    details = validateEventUpdate({
      name: 'Event',
      slug: 'event',
      status: 'draft',
      ...requiredBranding,
      scene_style_preamble: value.sceneStylePreamble ?? '',
      scene_constraints: value.sceneConstraints ?? '',
    });
  } catch (error) {
    if (!(error instanceof EventValidationError)) throw error;
    for (const [field, message] of Object.entries(error.fields)) {
      if (message) fields[toCompleteField(field)] = message;
    }
  }

  const scenes: SceneInput[] = [];
  const seenSceneIds = new Set<string>();
  if (!Array.isArray(value.scenes)) {
    fields.scenes = 'Scenes must be an array.';
  } else {
    if (value.scenes.length > 50) fields.scenes = 'Use 50 scenes or fewer.';
    if (normalizedStatus === 'active' && value.scenes.length === 0) {
      fields.scenes = 'Active events require at least one scene.';
    }

    value.scenes.forEach((scene, index) => {
      const sceneValue = isRecord(scene) ? scene : {};
      const sceneId = typeof sceneValue.id === 'string' ? sceneValue.id.trim() : '';
      if (sceneId && seenSceneIds.has(sceneId)) {
        fields[`scenes[${index}].id`] = `Scene ID "${sceneId}" is duplicated.`;
      } else if (sceneId) {
        seenSceneIds.add(sceneId);
      }

      try {
        scenes.push(validateScene(sceneValue));
      } catch (error) {
        if (!(error instanceof SceneValidationError)) throw error;
        for (const [field, message] of Object.entries(error.fields)) {
          if (message) fields[`scenes[${index}].${field}`] = message;
        }
      }
    });
  }

  if (Object.keys(fields).length > 0 || !core || !details) {
    throw new CompleteEventValidationError(fields);
  }

  return {
    ...core,
    tagline: details.tagline!,
    kioskIdleSubhead: details.kiosk_idle_subhead!,
    scenePickerHeading: details.scene_picker_heading!,
    sceneStylePreamble: details.scene_style_preamble ?? null,
    sceneConstraints: details.scene_constraints ?? null,
    scenes,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCompleteField(field: string) {
  const fields: Record<string, string> = {
    kiosk_idle_subhead: 'kioskIdleSubhead',
    scene_constraints: 'sceneConstraints',
    scene_picker_heading: 'scenePickerHeading',
    scene_style_preamble: 'sceneStylePreamble',
  };
  return fields[field] ?? field;
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
