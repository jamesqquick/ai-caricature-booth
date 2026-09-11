import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { duplicateEventConfiguration } from '../src/db/events';
import { EventValidationError, eventSlugFromName, validateDuplicateEvent } from '../src/lib/event-validation';

const sourceEvent = {
  id: 7,
  slug: 'demo-event',
  name: 'Demo Event',
  status: 'active',
  accent_color: '#ff0000',
  watermark_image_key: null,
  watermark_image_key_left: null,
  tagline: 'Tagline',
  kiosk_idle_subhead: 'Subhead',
  scene_picker_heading: 'Pick a scene',
  scene_style_preamble: 'Style',
  scene_constraints: 'Constraints',
  created_at: 1,
  created_by: 'source@example.com',
  watermark_w: null,
  watermark_left_w: null,
};

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
        async run() {
          const result = statement.run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
      return prepared;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

describe('duplicateEventConfiguration', () => {
  it('normalizes the editable name and derives its URL slug', () => {
    expect(validateDuplicateEvent({ name: '  Démo Event (Copy)  ' })).toEqual({ name: 'Démo Event (Copy)' });
    expect(eventSlugFromName('Démo Event (Copy)')).toBe('demo-event-copy');
    expect(eventSlugFromName('🔥')).toBe('event-copy');
    expect(() => validateDuplicateEvent({ name: '' })).toThrow(EventValidationError);
  });

  it('retries conflicting slugs and copies configuration and scenes as a draft', async () => {
    const calls: { query: string; values: unknown[] }[] = [];
    let eventInsert = 0;
    const database = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ query, values });
            return {
              async run() {
                if (query.includes('INSERT INTO events')) {
                  eventInsert += 1;
                  if (eventInsert === 1) throw new Error('UNIQUE constraint failed: events.slug');
                  return { meta: { changes: 1, last_row_id: 12 } };
                }
                return { meta: { changes: 3 } };
              },
            };
          },
        };
      },
      async batch(statements: Array<{ run(): Promise<unknown> }>) {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      },
    } as unknown as D1Database;

    await expect(duplicateEventConfiguration(
      database,
      sourceEvent,
      'Demo Event (Copy)',
      'admin@example.com',
    )).resolves.toEqual({ id: 12, name: 'Demo Event (Copy)', slug: 'demo-event-copy-2', status: 'draft' });

    const inserts = calls.filter(({ query }) => query.includes('INSERT INTO events'));
    expect(inserts.map(({ values }) => values[0])).toEqual(['demo-event-copy', 'demo-event-copy-2']);
    expect(inserts[1].query).toContain("'draft'");
    expect(inserts[1].query).toContain('accent_color');
    expect(inserts[1].query).toContain('scene_style_preamble');
    expect(inserts[1].values).toEqual(expect.arrayContaining(['Demo Event (Copy)', 'admin@example.com', 7]));

    const sceneCopy = calls.filter(({ query }) => query.includes('INSERT INTO event_scenes')).at(-1);
    expect(sceneCopy?.query).toContain('JOIN events AS duplicate ON duplicate.slug = ?');
    expect(sceneCopy?.values).toEqual(['demo-event-copy-2', 7]);
  });

  it('executes against SQLite and excludes source sessions and watermark references', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        accent_color TEXT NOT NULL,
        watermark_image_key TEXT,
        watermark_image_key_left TEXT,
        tagline TEXT NOT NULL,
        kiosk_idle_subhead TEXT NOT NULL,
        scene_picker_heading TEXT NOT NULL,
        scene_style_preamble TEXT,
        scene_constraints TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        created_by TEXT,
        watermark_w INTEGER,
        watermark_left_w INTEGER
      );
      CREATE TABLE event_scenes (
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        prompt TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (event_id, id)
      );
      CREATE TABLE sessions (id TEXT PRIMARY KEY, event_id INTEGER NOT NULL);
      INSERT INTO events VALUES (
        7, 'demo-event', 'Demo Event', 'active', '#ff0000',
        'events/7/watermarks/right.png', NULL, 'Tagline', 'Subhead', 'Pick a scene',
        'Style', 'Constraints', 1, 'source@example.com', 540, NULL
      );
      INSERT INTO event_scenes VALUES (7, 'scene-1', 'Scene', 'Description', 'Prompt', 1);
      INSERT INTO sessions VALUES ('session-1', 7);
    `);

    try {
      const duplicate = await duplicateEventConfiguration(
        asD1(sqlite),
        { ...sourceEvent, watermark_image_key: 'events/7/watermarks/right.png', watermark_w: 540 },
        'Demo Event (Copy)',
        'admin@example.com',
      );
      const event = sqlite.prepare('SELECT * FROM events WHERE id = ?').get(duplicate.id) as Record<string, unknown>;
      const scenes = sqlite.prepare('SELECT * FROM event_scenes WHERE event_id = ?').all(duplicate.id);
      const sessions = sqlite.prepare('SELECT * FROM sessions WHERE event_id = ?').all(duplicate.id);

      expect(event).toMatchObject({
        slug: 'demo-event-copy',
        name: 'Demo Event (Copy)',
        status: 'draft',
        accent_color: '#ff0000',
        scene_style_preamble: 'Style',
        scene_constraints: 'Constraints',
        created_by: 'admin@example.com',
        watermark_image_key: null,
        watermark_w: null,
      });
      expect(scenes).toEqual([expect.objectContaining({ event_id: duplicate.id, id: 'scene-1', sort_order: 1 })]);
      expect(sessions).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
