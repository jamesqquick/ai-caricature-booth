import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { loadActiveEventScene, loadActiveScenesByEvent, loadEventScene } from '../src/db/scenes';
import { createPendingSession } from '../src/db/sessions';

const migrationUrl = new URL('../drizzle/migrations/0006_event_scenes.sql', import.meta.url);

function createSceneDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE events (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE);
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
    sqlite.exec(await readFile(migrationUrl, 'utf8'));

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
  });
});

describe('event scene queries', () => {
  it('loads only active scenes for one event in configured order', async () => {
    const { sqlite, database } = createSceneDatabase();
    sqlite.exec(await readFile(migrationUrl, 'utf8'));
    sqlite.exec(`
      UPDATE event_scenes SET active = 0 WHERE event_id = 1 AND id = 'hot-dog-stand';
      UPDATE event_scenes SET sort_order = 0 WHERE event_id = 1 AND id = 'broadway';
      UPDATE event_scenes SET name = 'Other Event Broadway' WHERE event_id = 2 AND id = 'broadway';
    `);

    const scenes = await loadActiveScenesByEvent(database, 1);

    expect(scenes).toHaveLength(5);
    expect(scenes[0]).toMatchObject({ id: 'broadway', name: 'Broadway' });
    expect(scenes.map((scene) => scene.id)).not.toContain('hot-dog-stand');
    expect(scenes.map((scene) => scene.name)).not.toContain('Other Event Broadway');
  });

  it('enforces event ownership and active state for new requests without breaking recovery', async () => {
    const { sqlite, database } = createSceneDatabase();
    sqlite.exec(await readFile(migrationUrl, 'utf8'));
    sqlite.exec(`
      INSERT INTO event_scenes (
        event_id, id, name, description, emoji, accent, backdrop, prompt, sort_order, active
      ) VALUES
        (1, 'first-only', 'First only', 'First event scene', '1', 'accent', 'backdrop', 'First prompt', 7, 1),
        (2, 'second-only', 'Second only', 'Second event scene', '2', 'accent', 'backdrop', 'Second prompt', 7, 1);
      UPDATE event_scenes SET active = 0 WHERE event_id = 1 AND id = 'first-only';
    `);

    await expect(loadActiveEventScene(database, 1, 'second-only')).resolves.toBeNull();
    await expect(loadActiveEventScene(database, 1, 'first-only')).resolves.toBeNull();
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
    expect(route).toContain('loadActiveScenesByEvent(env.DB, event.id)');
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

    expect(actions.match(/loadActiveEventScene\(env\.DB, event\.id, (?:existing\.scene_id|sceneId)\)/g)).toHaveLength(2);
    expect(actions).toContain('sceneName: scene.name');
    expect(actions).toContain('scenePrompt: scene.prompt');
    expect(worker).toContain('${scenePrompt} Keep the person recognizable, expressive, and centered. No text.');
    expect(worker).not.toMatch(/data\/scenes/);
    expect(sceneData).not.toMatch(/export const (scenes|DEFAULT_SCENE_SEEDS)/);
  });
});
