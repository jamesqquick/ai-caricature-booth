import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, updateEvent } from '../src/db/events';
import { composeGenerationPrompt, GENERATION_SAFETY_INSTRUCTION } from '../src/lib/generation-prompt';
import { SceneValidationError, validateEventPrompts, validateEventUpdate, validateScene } from '../src/lib/event-validation';

const fakeEnv = vi.hoisted(() => ({ DB: {} as D1Database }));
vi.mock('cloudflare:workers', () => ({ env: fakeEnv }));

import { GET as listScenes, POST as createScene } from '../src/pages/api/admin/events/[slug]/scenes';
import { PUT as updateScene } from '../src/pages/api/admin/events/[slug]/scenes/[sceneId]';
import { POST as updateAdminEvent } from '../src/pages/api/admin/events/[slug]';

const adminHeaders = { 'Content-Type': 'application/json', 'x-booth-admin-email': 'admin@example.com' };

function asD1(sqlite: DatabaseSync) {
  const database = {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      let values: SQLInputValue[] = [];
      const prepared = {
        bind(...bindings: unknown[]) {
          values = bindings as SQLInputValue[];
          return prepared;
        },
        async all<T>() {
          return { results: statement.all(...values) as T[] };
        },
        async first<T>() {
          return statement.get(...values) as T | undefined ?? null;
        },
        async run() {
          const result = statement.run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
      return prepared;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return database as unknown as D1Database;
}

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      accent_color TEXT NOT NULL DEFAULT '#ff0000',
      watermark_image_key TEXT,
      watermark_image_key_left TEXT,
      tagline TEXT NOT NULL DEFAULT 'Tagline',
      kiosk_idle_subhead TEXT NOT NULL DEFAULT 'Subhead',
      scene_picker_heading TEXT NOT NULL DEFAULT 'Pick a scene',
      scene_style_preamble TEXT,
      scene_constraints TEXT,
      created_at INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      watermark_w INTEGER,
      watermark_left_w INTEGER
    );
    CREATE TABLE event_scenes (
      event_id INTEGER NOT NULL REFERENCES events(id),
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      prompt TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (event_id, id)
    );
    INSERT INTO events (id, slug, name, status) VALUES
      (1, 'active-event', 'Active Event', 'active'),
      (2, 'draft-event', 'Draft Event', 'draft');
    INSERT INTO event_scenes VALUES
      (1, 'first', 'First', 'First description', 'First prompt', 1),
      (1, 'second', 'Second', 'Second description', 'Second prompt', 2),
      (2, 'other', 'Other', 'Other description', 'Other prompt', 1);
  `);
  fakeEnv.DB = asD1(sqlite);
  return sqlite;
}

function jsonRequest(path: string, method: string, body: object, authenticated = true) {
  return new Request(`https://booth.test${path}`, {
    method,
    headers: authenticated ? adminHeaders : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validScene = {
  id: 'new-scene',
  name: 'New Scene',
  description: 'A new scene description.',
  prompt: 'Draw the new scene.',
};

beforeEach(() => {
  createDatabase();
});

describe('scene validation and prompt composition', () => {
  it('accepts the simplified scene contract and rejects invalid fields', () => {
    expect(validateScene(validScene)).toEqual(validScene);
    expect(() => validateScene({ ...validScene, id: 'Invalid ID' }))
      .toThrow(SceneValidationError);
    try {
      validateScene({ ...validScene, name: '', prompt: 'x'.repeat(2_001) });
    } catch (error) {
      expect(error).toMatchObject({ fields: { name: expect.any(String), prompt: expect.any(String) } });
    }
  });

  it('bounds optional event prompt fields and normalizes empty values to null', () => {
    expect(validateEventUpdate({
      name: 'Event', slug: 'event', status: 'draft', scene_style_preamble: ' ', scene_constraints: '  No logos. ',
    })).toMatchObject({ scene_style_preamble: null, scene_constraints: 'No logos.' });
    expect(() => validateEventUpdate({
      name: 'Event', slug: 'event', status: 'draft', scene_style_preamble: 'x'.repeat(2_001),
    })).toThrow();
    expect(validateEventPrompts({ scene_style_preamble: ' ', scene_constraints: '  No logos. ' }))
      .toEqual({ scene_style_preamble: null, scene_constraints: 'No logos.' });
  });

  it('composes event, scene, constraint, and safety instructions in order', () => {
    expect(composeGenerationPrompt({
      preamble: 'Editorial ink style.',
      scenePrompt: 'Place the guest on a rooftop.',
      sceneDescription: 'Sunset skyline behind them.',
      constraints: 'Use warm colors.',
    })).toBe([
      'Editorial ink style.',
      'Place the guest on a rooftop.',
      'Sunset skyline behind them.',
      'Use warm colors.',
      GENERATION_SAFETY_INSTRUCTION,
    ].join(' '));
  });
});

describe('admin scene endpoints', () => {
  it('requires trusted admin identity for collection and item operations', async () => {
    const list = await listScenes({ request: new Request('https://booth.test/api/admin/events/active-event/scenes'), params: { slug: 'active-event' } });
    const update = await updateScene({
      request: jsonRequest('/api/admin/events/active-event/scenes/first', 'PUT', validScene, false),
      params: { slug: 'active-event', sceneId: 'first' },
    });
    expect(list.status).toBe(403);
    expect(update.status).toBe(403);
  });

  it('adds at the end and returns 409 for a duplicate event-scoped ID', async () => {
    const request = jsonRequest('/api/admin/events/active-event/scenes', 'POST', validScene);
    const response = await createScene({ request, params: { slug: 'active-event' } });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ scene: { id: 'new-scene', sort_order: 3 } });

    const duplicate = await createScene({
      request: jsonRequest('/api/admin/events/active-event/scenes', 'POST', validScene),
      params: { slug: 'active-event' },
    });
    expect(duplicate.status).toBe(409);
  });

  it('keeps reads and writes scoped to the event resolved from the slug', async () => {
    const list = await listScenes({ request: new Request('https://booth.test', { headers: adminHeaders }), params: { slug: 'active-event' } });
    expect((await list.json() as { scenes: Array<{ id: string }> }).scenes.map((scene) => scene.id)).toEqual(['first', 'second']);

    const response = await updateScene({
      request: jsonRequest('/api/admin/events/active-event/scenes/other', 'PUT', { ...validScene, id: 'ignored' }),
      params: { slug: 'active-event', sceneId: 'other' },
    });
    expect(response.status).toBe(404);
  });

  it('edits a scene while keeping its route-scoped ID and creation order', async () => {
    const edit = await updateScene({
      request: jsonRequest('/api/admin/events/active-event/scenes/second', 'PUT', { ...validScene, id: 'renamed', name: 'Edited' }),
      params: { slug: 'active-event', sceneId: 'second' },
    });
    expect(await edit.json()).toMatchObject({ scene: { id: 'second', name: 'Edited', sort_order: 2 } });
    const list = await listScenes({ request: new Request('https://booth.test', { headers: adminHeaders }), params: { slug: 'active-event' } });
    expect((await list.json() as { scenes: Array<{ id: string; sort_order: number }> }).scenes)
      .toMatchObject([{ id: 'first', sort_order: 1 }, { id: 'second', sort_order: 2 }]);
  });

  it('returns field-level 400 errors for invalid scene data', async () => {
    const invalid = await createScene({
      request: jsonRequest('/api/admin/events/active-event/scenes', 'POST', { ...validScene, description: '' }),
      params: { slug: 'active-event' },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ fields: { description: expect.any(String) } });
  });
});

describe('event activation and editor wiring', () => {
  it('rejects creating an active event because a new event has no scenes', async () => {
    await expect(createEvent(fakeEnv.DB, {
      name: 'New Event', slug: 'new-event', status: 'active',
    }, 'admin@example.com')).rejects.toMatchObject({ name: 'EventActivationError' });
  });

  it('rejects activation when an event has no scenes', async () => {
    const sqlite = createDatabase();
    sqlite.exec('DELETE FROM event_scenes WHERE event_id = 2');
    await expect(updateEvent(fakeEnv.DB, 2, { name: 'Draft Event', slug: 'draft-event', status: 'active' }))
      .rejects.toMatchObject({ name: 'EventActivationError' });
  });

  it('updates prompts without rewriting event details', async () => {
    const sqlite = createDatabase();
    const response = await updateAdminEvent({
      request: jsonRequest('/api/admin/events/draft-event', 'POST', {
        section: 'prompts',
        scene_style_preamble: 'Editorial ink.',
        scene_constraints: 'No logos.',
      }),
      params: { slug: 'draft-event' },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { event: Record<string, unknown> };
    expect(body.event).toEqual({ scene_style_preamble: 'Editorial ink.', scene_constraints: 'No logos.' });
    expect(body.event).not.toHaveProperty('watermark_image_key');
    expect(body.event).not.toHaveProperty('watermark_image_key_left');
    expect(body.event).not.toHaveProperty('created_by');
    expect(sqlite.prepare(`
      SELECT slug, name, status, scene_style_preamble, scene_constraints
      FROM events WHERE id = 2
    `).get()).toEqual({
      slug: 'draft-event',
      name: 'Draft Event',
      status: 'draft',
      scene_style_preamble: 'Editorial ink.',
      scene_constraints: 'No logos.',
    });
  });

  it('compiles with URL-addressable settings tabs and no scene availability or reorder controls', async () => {
    const source = await readFile(new URL('../src/pages/admin/events/[slug].astro', import.meta.url), 'utf8');
    await expect(transform(source, { filename: 'src/pages/admin/events/[slug].astro' })).resolves.toBeTruthy();
    expect(source).toContain("{ id: 'prompts', label: 'Prompts' }");
    expect(source).toContain('data-tab-panel="prompts"');
    expect(source).toContain('id="scenes-heading">Scenes</h2>');
    expect(source).not.toContain('data-move=');
    expect(source).not.toContain('Available to attendees');
    expect(source).not.toContain('cannot be changed later');
    expect(source).not.toContain('window.location.reload()');
    expect(source).toContain("import { toast } from 'sonner'");
    expect(source).toContain('data-event-form="details"');
    expect(source).toContain('data-event-form="prompts"');
    expect(source).toContain("querySelectorAll<Element>('input, button, textarea, select')");
    expect(source).toContain("field.setAttribute('aria-errormessage', output.id)");
    expect(source).toContain("querySelector<HTMLElement>('[aria-invalid=\"true\"]')?.focus()");
  });

  it('switches tabs without navigation and keeps browser history in sync', async () => {
    const source = await readFile(new URL('../src/pages/admin/events/[slug].astro', import.meta.url), 'utf8');

    expect(source).toContain("link.addEventListener('click'");
    expect(source).toContain('event.preventDefault();');
    expect(source).toContain("history.pushState({}, '', `${url.pathname}${url.search}`)");
    expect(source).toContain("window.addEventListener('popstate'");
    expect(source).toContain('tabPanels.forEach((panel) => panel.hidden = panel.dataset.tabPanel !== tabId)');
    expect(source).toContain('updateHistory && currentTab !== tabId');
    expect(source).toContain("document.querySelector<HTMLElement>('[data-event-page-header] h1')");
    expect(source).toContain("previewContainer?.style.setProperty('--preview-accent', result.event.accent_color)");
  });

  it('renders add scene before a vertical single-open scene accordion list', async () => {
    const source = await readFile(new URL('../src/pages/admin/events/[slug].astro', import.meta.url), 'utf8');
    const addSceneIndex = source.indexOf('id="add-scene-form"');
    const sceneListIndex = source.indexOf('id="scene-list"');

    expect(addSceneIndex).toBeGreaterThan(-1);
    expect(addSceneIndex).toBeLessThan(sceneListIndex);
    expect(source).toContain('data-scene-accordion open={index === 0}');
    expect(source).toContain('name="scene-editor" data-scene-accordion');
    expect(source).toContain("accordion.addEventListener('toggle'");
    expect(source).toContain('if (other !== accordion) other.open = false;');
    expect(source).not.toContain('lg:grid-cols-2');
    expect(source).toContain('id="scene-empty"');
    expect(source).toContain("document.querySelector<HTMLElement>('#scene-empty')?.remove()");
    expect(source).toContain('summary?.focus()');
    expect(source).toContain('Scene added: ${result.scene.name}.');
  });

  it('captures add and edit payloads before mutateScene disables form controls', async () => {
    const source = await readFile(new URL('../src/pages/admin/events/[slug].astro', import.meta.url), 'utf8');
    const editStart = source.indexOf("sceneForm.addEventListener('submit'");
    const editEnd = source.indexOf('document.querySelectorAll<HTMLFormElement>', editStart);
    const editHandler = source.slice(editStart, editEnd);
    const addStart = source.indexOf("addSceneForm?.addEventListener('submit'");
    const addHandler = source.slice(addStart);

    expect(editHandler.indexOf('const sceneData = scenePayload(sceneForm);')).toBeLessThan(editHandler.indexOf("submitMutation(sceneForm, 'Saving...'"));
    expect(editHandler).toContain('body: JSON.stringify(sceneData)');

    expect(addHandler.indexOf('const sceneData = scenePayload(addSceneForm);')).toBeLessThan(addHandler.indexOf("submitMutation(addSceneForm, 'Adding...'"));
    expect(addHandler).toContain('body: JSON.stringify(sceneData)');
  });
});
