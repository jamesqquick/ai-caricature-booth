import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { loadEventScene, loadScenesByEvent } from '../src/db/scenes';
import { createPendingSession } from '../src/db/sessions';

const migrationUrl = new URL('../drizzle/migrations/0006_event_scenes.sql', import.meta.url);
const simplifyMigrationUrl = new URL('../drizzle/migrations/0007_simplify_event_scenes.sql', import.meta.url);
const literalCopyMigrationUrl = new URL('../drizzle/migrations/0009_literal_event_copy.sql', import.meta.url);

async function migrateScenes(sqlite: DatabaseSync) {
  sqlite.exec(await readFile(migrationUrl, 'utf8'));
  sqlite.exec(await readFile(simplifyMigrationUrl, 'utf8'));
}

function createSceneDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
     CREATE TABLE events (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, tagline TEXT NOT NULL DEFAULT '');
     INSERT INTO events (id, slug) VALUES (1, 'first-event'), (2, 'second-event');
  `);

  return { sqlite, database: asD1(sqlite) };
}

function asD1(sqlite: DatabaseSync) {
  return {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      let values: SQLInputValue[] = [];
      const prepared = {
        bind(...bindings: unknown[]) {
          values = bindings as SQLInputValue[];
          return prepared;
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async first() {
          return statement.get(...values) ?? null;
        },
        async run() {
          const result = statement.run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
      return prepared;
    },
  } as unknown as D1Database;
}

describe('event scene migration', () => {
  it('seeds all six scenes for every event that already exists', async () => {
    const { sqlite } = createSceneDatabase();
    await migrateScenes(sqlite);

    const counts = sqlite.prepare(`
      SELECT event_id, COUNT(*) AS scene_count
      FROM event_scenes
      GROUP BY event_id
      ORDER BY event_id
    `).all();
    const names = sqlite.prepare(`
      SELECT name
      FROM event_scenes
      WHERE event_id = 1
      ORDER BY sort_order, id
    `).all().map((row) => row.name);

    expect(counts).toEqual([
      { event_id: 1, scene_count: 6 },
      { event_id: 2, scene_count: 6 },
    ]);
    expect(names).toEqual([
      'Hot Dog Stand',
      'Subway Platform',
      'Central Park',
      'Broadway',
      'Times Square',
      'Brooklyn Bridge',
    ]);
    expect(sqlite.prepare(`
      SELECT prompt FROM event_scenes WHERE event_id = 1 AND id = 'hot-dog-stand'
    `).get()).toEqual({
      prompt: 'Create a bold editorial ink caricature in the Hot Dog Stand setting.',
    });
  });

  it('preserves customized prompts while normalizing untouched seed prompts', async () => {
    const { sqlite } = createSceneDatabase();
    sqlite.exec(await readFile(migrationUrl, 'utf8'));
    const customPrompt = 'Keep the red car visible, then draw a red car.';
    sqlite.prepare(`
      UPDATE event_scenes SET description = ?, prompt = ?
      WHERE event_id = 1 AND id = 'hot-dog-stand'
    `).run('red car', customPrompt);

    sqlite.exec(await readFile(simplifyMigrationUrl, 'utf8'));

    expect(sqlite.prepare(`
      SELECT prompt FROM event_scenes WHERE event_id = 1 AND id = 'hot-dog-stand'
    `).get()).toEqual({ prompt: customPrompt });
    expect(sqlite.prepare(`
      SELECT prompt FROM event_scenes WHERE event_id = 1 AND id = 'subway'
    `).get()).toEqual({
      prompt: 'Create a bold editorial ink caricature in the Subway Platform setting.',
    });
  });

  it('updates only the seeded event copy', async () => {
    const { sqlite } = createSceneDatabase();
    sqlite.exec(await readFile(migrationUrl, 'utf8'));
    sqlite.exec(`
      UPDATE events SET slug = 'custom-one', tagline = 'Take a selfie, pick an iconic NYC scene, and walk away with a printed postcard.' WHERE id = 1;
      UPDATE events SET slug = 'custom-two', tagline = 'Turn your conference selfie into a one-of-a-kind caricature postcard.' WHERE id = 2;
      INSERT INTO events (id, slug, tagline) VALUES
        (3, 'nyc-tech-week-2026', 'Take a selfie, pick an iconic NYC scene, and walk away with a printed postcard.'),
        (4, 'cloudflare-connect-2026', 'Turn your conference selfie into a one-of-a-kind caricature postcard.'),
        (5, 'custom-event', 'Turn your conference selfie into a one-of-a-kind caricature postcard.');
      INSERT INTO event_scenes (event_id, id, name, description, emoji, accent, backdrop, prompt, sort_order, active)
      VALUES
        (3, 'hot-dog-stand', 'Hot Dog Stand', 'A curbside classic with mustard-yellow swagger.', '', '', '', '', 1, 1),
        (5, 'hot-dog-stand', 'Hot Dog Stand', 'A curbside classic with mustard-yellow swagger.', '', '', '', '', 1, 1);
    `);
    sqlite.exec(await readFile(literalCopyMigrationUrl, 'utf8'));

    expect(sqlite.prepare('SELECT id, tagline FROM events ORDER BY id').all()).toEqual([
      { id: 1, tagline: 'Take a selfie, pick an iconic NYC scene, and walk away with a printed postcard.' },
      { id: 2, tagline: 'Turn your conference selfie into a one-of-a-kind caricature postcard.' },
      { id: 3, tagline: 'Take a selfie, choose a scene, and download your caricature postcard.' },
      { id: 4, tagline: 'Turn your conference selfie into a downloadable caricature postcard.' },
      { id: 5, tagline: 'Turn your conference selfie into a one-of-a-kind caricature postcard.' },
    ]);
    expect(sqlite.prepare("SELECT event_id, description FROM event_scenes WHERE id = 'hot-dog-stand' AND event_id IN (1, 3, 5) ORDER BY event_id").all()).toEqual([
      { event_id: 1, description: 'A curbside classic with mustard-yellow swagger.' },
      { event_id: 3, description: 'A New York hot dog cart with a yellow umbrella and condiment bottles.' },
      { event_id: 5, description: 'A curbside classic with mustard-yellow swagger.' },
    ]);
  });
});

describe('event scene queries', () => {
  it('loads every scene for one event in creation order', async () => {
    const { sqlite, database } = createSceneDatabase();
    await migrateScenes(sqlite);
    sqlite.exec(`
      UPDATE event_scenes SET sort_order = 0 WHERE event_id = 1 AND id = 'broadway';
      UPDATE event_scenes SET name = 'Other Event Broadway' WHERE event_id = 2 AND id = 'broadway';
    `);

    const scenes = await loadScenesByEvent(database, 1);

    expect(scenes).toHaveLength(6);
    expect(scenes[0]).toMatchObject({ id: 'broadway', name: 'Broadway' });
    expect(scenes.map((scene) => scene.id)).toContain('hot-dog-stand');
    expect(scenes.map((scene) => scene.name)).not.toContain('Other Event Broadway');
  });

  it('enforces event ownership for scene requests', async () => {
    const { sqlite, database } = createSceneDatabase();
    await migrateScenes(sqlite);
    sqlite.exec(`
      INSERT INTO event_scenes (
        event_id, id, name, description, prompt, sort_order
      ) VALUES
        (1, 'first-only', 'First only', 'First event scene', 'First prompt', 7),
        (2, 'second-only', 'Second only', 'Second event scene', 'Second prompt', 7);
    `);

    await expect(loadEventScene(database, 1, 'second-only')).resolves.toBeNull();
    await expect(loadEventScene(database, 1, 'first-only')).resolves.toMatchObject({
      id: 'first-only',
      prompt: 'First prompt',
    });
    await expect(loadEventScene(database, 2, 'first-only')).resolves.toBeNull();
  });
});

describe('event scene runtime wiring', () => {
  it('snapshots the selected scene name when creating a session', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        event_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        scene_name TEXT,
        selfie_key TEXT NOT NULL,
        selfie_sha256 TEXT NOT NULL,
        caricature_key TEXT,
        postcard_key TEXT,
        workflow_instance_id TEXT,
        error_code TEXT,
        error_msg TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER,
        pipeline_ms INTEGER,
        updated_at INTEGER NOT NULL
      );
    `);

    const result = await createPendingSession(asD1(sqlite), {
      id: 'session-1',
      event_id: 1,
      scene_id: 'event-scene',
      scene_name: 'Event Scene',
      selfie_key: 'sessions/session-1/selfie.jpg',
      selfie_sha256: 'sha256',
    });

    expect(result.created).toBe(true);
    expect(result.session).toMatchObject({ scene_id: 'event-scene', scene_name: 'Event Scene' });
  });

  it('loads route scenes from D1 and passes them into Photobooth', async () => {
    const route = await readFile(new URL('../src/pages/e/[slug].astro', import.meta.url), 'utf8');

    await expect(transform(route, { filename: 'src/pages/e/[slug].astro' })).resolves.toBeTruthy();
    expect(route).toContain('loadScenesByEvent(env.DB, event.id)');
    expect(route).toContain('scenes={scenes}');
  });

  it('uses the first nonempty event scene set for landing-page previews', async () => {
    const route = await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8');

    await expect(transform(route, { filename: 'src/pages/index.astro' })).resolves.toBeTruthy();
    expect(route).toContain('sceneSets.find((eventScenes) => eventScenes.length > 0)');
    expect(route).toContain('scenes.slice(0, 3)');
    expect(route).toContain('scenes.slice(0, 4)');
  });

  it('initializes Photobooth from the first provided scene and has no static scene import', async () => {
    const photobooth = await readFile(new URL('../src/components/Photobooth.tsx', import.meta.url), 'utf8');

    expect(photobooth).toContain('scenes[0]?.id ?? null');
    expect(photobooth).toContain('scenes={scenes}');
    expect(photobooth).not.toMatch(/import\s+\{\s*scenes\s*\}/);
  });

  it('uses event-scoped validation and snapshots stored scene data for the worker', async () => {
    const [actions, worker, sceneData] = await Promise.all([
      readFile(new URL('../src/actions/index.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/worker.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/data/scenes.ts', import.meta.url), 'utf8'),
    ]);
    const workflowCreate = actions.slice(actions.indexOf('env.CARICATURE_WORKFLOW.create({'));
    const workflowParams = workflowCreate.slice(0, workflowCreate.indexOf('    });'));

    expect(actions.match(/loadEventScene\(env\.DB, event\.id, (?:existing\.scene_id|sceneId)\)/g)).toHaveLength(2);
    expect(workflowParams).toContain('sceneName: scene.name');
    expect(workflowParams).toContain('sceneDescription: scene.description');
    expect(workflowParams).toContain('scenePrompt: scene.prompt');
    expect(workflowParams).toContain('eventPromptPreamble: event.scene_style_preamble');
    expect(workflowParams).toContain('eventConstraints: event.scene_constraints');
    expect(worker).toContain('composeGenerationPrompt({');
    expect(worker).not.toMatch(/data\/scenes/);
    expect(sceneData).not.toMatch(/export const (scenes|DEFAULT_SCENE_SEEDS)/);
  });
});
