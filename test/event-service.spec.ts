import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventSlugConflictError } from '../src/lib/event-validation';
import {
  createCompleteEvent,
  getCompleteEvent,
  listEvents,
} from '../src/lib/event-service';
import {
  CompleteEventValidationError,
  type CreateCompleteEventInput,
  validateCompleteEvent,
} from '../src/lib/event-validation';

const PNG_CONTENT_TYPE = 'image/png';

function completeInput(overrides: Partial<CreateCompleteEventInput> = {}): CreateCompleteEventInput {
  return {
    name: '  Launch Booth  ',
    slug: 'launch-booth',
    status: 'active',
    tagline: '  Make a launch-day postcard.  ',
    kioskIdleSubhead: '  Welcome to Launch Day  ',
    scenePickerHeading: '  Pick a launch scene  ',
    sceneStylePreamble: '  Draw this as ink art.  ',
    sceneConstraints: '  Keep the badge visible.  ',
    scenes: [
      {
        id: 'second-scene',
        name: '  Second Scene  ',
        description: '  Created first despite its ID.  ',
        prompt: '  Draw scene two.  ',
      },
      {
        id: 'first-scene',
        name: 'First Scene',
        description: 'Created second despite its ID.',
        prompt: 'Draw scene one.',
      },
    ],
    ...overrides,
  };
}

type BatchHook = (sqlite: DatabaseSync) => void;

class TestPreparedStatement {
  private values: SQLInputValue[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]) {
    this.values = values as SQLInputValue[];
    return this;
  }

  async all<T>() {
    return { results: this.statement.all(...this.values) as T[] };
  }

  async first<T>() {
    return (this.statement.get(...this.values) as T | undefined) ?? null;
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const result = this.statement.run(...this.values);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      watermark_image_key TEXT,
      watermark_image_key_left TEXT,
      tagline TEXT NOT NULL DEFAULT 'Take a selfie, pick a scene, walk away with a printed postcard.',
      kiosk_idle_subhead TEXT NOT NULL DEFAULT 'Cloudflare Kiosk',
      scene_picker_heading TEXT NOT NULL DEFAULT 'Pick your scene',
      scene_style_preamble TEXT,
      scene_constraints TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by TEXT,
      watermark_w INTEGER,
      watermark_x INTEGER NOT NULL DEFAULT 50,
      watermark_y INTEGER NOT NULL DEFAULT 50,
      watermark_left_w INTEGER,
      watermark_left_x INTEGER NOT NULL DEFAULT 50,
      watermark_left_y INTEGER NOT NULL DEFAULT 50
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
    CREATE INDEX event_scenes_order_idx ON event_scenes(event_id, sort_order, id);
  `);

  const controls: {
    beforeBatch?: BatchHook;
    failPreparesAfterBatch?: Error;
    onPrepare?: (query: string) => void;
  } = {};
  let batchCommitted = false;
  const database = {
    prepare(query: string) {
      if (batchCommitted && controls.failPreparesAfterBatch) throw controls.failPreparesAfterBatch;
      controls.onPrepare?.(query);
      return new TestPreparedStatement(sqlite.prepare(query));
    },
    async batch(statements: TestPreparedStatement[]) {
      controls.beforeBatch?.(sqlite);
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.runSync());
        sqlite.exec('COMMIT');
        batchCommitted = true;
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;

  return { controls, database, sqlite };
}

function context(database: D1Database, createdBy = 'creator@example.com') {
  return { database, createdBy };
}

function rawEventCount(sqlite: DatabaseSync) {
  return Number((sqlite.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number }).count);
}

describe('complete event validation', () => {
  it('normalizes all fields, including blank prompt fields', () => {
    expect(validateCompleteEvent(completeInput({
      status: 'draft',
      scenes: [],
      sceneStylePreamble: '   ',
      sceneConstraints: '',
    }))).toEqual({
      name: 'Launch Booth',
      slug: 'launch-booth',
      status: 'draft',
      tagline: 'Make a launch-day postcard.',
      kioskIdleSubhead: 'Welcome to Launch Day',
      scenePickerHeading: 'Pick a launch scene',
      sceneStylePreamble: null,
      sceneConstraints: null,
      scenes: [],
    });
  });

  it.each([
    ['active event without scenes', completeInput({ scenes: [] }), { scenes: expect.any(String) }],
    ['more than 50 scenes', completeInput({ scenes: Array.from({ length: 51 }, (_, index) => ({
      id: `scene-${index}`,
      name: `Scene ${index}`,
      description: `Description ${index}`,
      prompt: `Prompt ${index}`,
    })) }), { scenes: expect.any(String) }],
    ['duplicate scene IDs', completeInput({ scenes: [
      { id: 'same-scene', name: 'First', description: 'First', prompt: 'First' },
      { id: 'same-scene', name: 'Second', description: 'Second', prompt: 'Second' },
    ] }), { 'scenes[1].id': expect.any(String) }],
    ['nested scene error', completeInput({ scenes: [
      { id: 'valid', name: 'Valid', description: 'Valid', prompt: 'Valid' },
      { id: 'invalid', name: 'Invalid', description: 'Invalid', prompt: '' },
    ] }), { 'scenes[1].prompt': expect.any(String) }],
    ['null status', completeInput({ status: null as never }), { status: expect.any(String) }],
    ['numeric status', completeInput({ status: 1 as never }), { status: expect.any(String) }],
    ['object status', completeInput({ status: {} as never }), { status: expect.any(String) }],
    ['non-string scene style preamble', completeInput({ sceneStylePreamble: 1 as never }), { sceneStylePreamble: expect.any(String) }],
    ['non-string scene constraints', completeInput({ sceneConstraints: {} as never }), { sceneConstraints: expect.any(String) }],
  ])('rejects %s before side effects', async (_label, input, expectedFields) => {
    const { database, sqlite } = createDatabase();

    await expect(createCompleteEvent(context(database), input)).rejects.toMatchObject({
      name: 'CompleteEventValidationError',
      fields: expectedFields,
    });
    expect(rawEventCount(sqlite)).toBe(0);
  });

  it('defaults an omitted status to draft', () => {
    const input: Partial<CreateCompleteEventInput> = completeInput({ scenes: [] });
    delete input.status;

    expect(validateCompleteEvent(input).status).toBe('draft');
  });

  it('collects missing branding and scene errors with camelCase paths', () => {
    expect(() => validateCompleteEvent({
      name: '',
      slug: 'Not Valid',
      status: 'active',
      scenes: [{ id: '', name: '', description: '', prompt: '' }],
    })).toThrow(CompleteEventValidationError);

    try {
      validateCompleteEvent({
        name: '',
        slug: 'Not Valid',
        status: 'active',
        scenes: [{ id: '', name: '', description: '', prompt: '' }],
      });
    } catch (error) {
      expect(error).toMatchObject({ fields: {
        name: expect.any(String),
        slug: expect.any(String),
        tagline: expect.any(String),
        kioskIdleSubhead: expect.any(String),
        scenePickerHeading: expect.any(String),
        'scenes[0].id': expect.any(String),
        'scenes[0].prompt': expect.any(String),
      } });
    }
  });

  it('uses independently normalized status for active scene requirements when core validation also fails', () => {
    const input = completeInput({
      name: '',
      status: ' active ' as 'active',
      scenes: [],
    });

    expect(() => validateCompleteEvent(input)).toThrow(CompleteEventValidationError);
    try {
      validateCompleteEvent(input);
    } catch (error) {
      expect(error).toMatchObject({ fields: {
        name: expect.any(String),
        scenes: expect.any(String),
      } });
    }
  });
});

describe('complete event service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('atomically persists every field and scene in array order, then returns only safe camelCase data', async () => {
    const { database, sqlite } = createDatabase();

    const event = await createCompleteEvent(context(database), completeInput());
    const rawEvent = sqlite.prepare('SELECT * FROM events WHERE id = ?').get(event.id);
    const rawScenes = sqlite.prepare('SELECT * FROM event_scenes WHERE event_id = ? ORDER BY sort_order').all(event.id);

    expect(rawEvent).toMatchObject({
      id: 1,
      slug: 'launch-booth',
      name: 'Launch Booth',
      status: 'active',
      watermark_image_key: null,
      tagline: 'Make a launch-day postcard.',
      kiosk_idle_subhead: 'Welcome to Launch Day',
      scene_picker_heading: 'Pick a launch scene',
      scene_style_preamble: 'Draw this as ink art.',
      scene_constraints: 'Keep the badge visible.',
      created_by: 'creator@example.com',
      watermark_w: null,
    });
    expect(rawEvent).toMatchObject({ created_at: event.createdAt });
    expect(rawScenes).toEqual([
      {
        event_id: 1,
        id: 'second-scene',
        name: 'Second Scene',
        description: 'Created first despite its ID.',
        prompt: 'Draw scene two.',
        sort_order: 0,
      },
      {
        event_id: 1,
        id: 'first-scene',
        name: 'First Scene',
        description: 'Created second despite its ID.',
        prompt: 'Draw scene one.',
        sort_order: 1,
      },
    ]);
    expect(event).toEqual({
      id: 1,
      slug: 'launch-booth',
      name: 'Launch Booth',
      status: 'active',
      tagline: 'Make a launch-day postcard.',
      kioskIdleSubhead: 'Welcome to Launch Day',
      scenePickerHeading: 'Pick a launch scene',
      sceneStylePreamble: 'Draw this as ink art.',
      sceneConstraints: 'Keep the badge visible.',
      createdAt: expect.any(Number),
      scenes: [
        {
          id: 'second-scene',
          name: 'Second Scene',
          description: 'Created first despite its ID.',
          prompt: 'Draw scene two.',
        },
        {
          id: 'first-scene',
          name: 'First Scene',
          description: 'Created second despite its ID.',
          prompt: 'Draw scene one.',
        },
      ],
      watermark: null,
    });
    expect(event).not.toHaveProperty('createdBy');
    expect(event).not.toHaveProperty('created_by');
    expect(event).not.toHaveProperty('watermarkImageKey');
    expect(event).not.toHaveProperty('watermark_image_key');
    expect(JSON.stringify(event)).not.toMatch(/created_by|watermark_image_key|watermarkImageKey|creator@example\.com/);
  });

  it('returns the committed DTO without database readback and persists the same createdAt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_123_456);
    const { controls, database, sqlite } = createDatabase();
    controls.failPreparesAfterBatch = new Error('DB reads unavailable after commit');

    const event = await createCompleteEvent(context(database), completeInput());

    expect(event).toMatchObject({
      id: 1,
      slug: 'launch-booth',
      createdAt: 1_800_000_123,
      watermark: null,
    });
    expect(sqlite.prepare('SELECT created_at FROM events WHERE id = 1').get()).toEqual({
      created_at: event.createdAt,
    });
  });

  it('rejects a blank creator before any D1 access', async () => {
    const prepare = vi.fn();
    const batch = vi.fn();
    const database = { prepare, batch } as unknown as D1Database;

    await expect(createCompleteEvent(context(database, '   '), completeInput())).rejects.toMatchObject({
      name: 'CompleteEventValidationError',
      fields: { 'context.createdBy': expect.any(String) },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it('lists safe summaries newest-first and filters by validated status', async () => {
    const { database, sqlite } = createDatabase();
    sqlite.exec(`
      INSERT INTO events (id, slug, name, status, created_at, created_by) VALUES
        (1, 'old-draft', 'Old Draft', 'draft', 100, 'private-one'),
        (2, 'new-active', 'New Active', 'active', 300, 'private-two'),
        (3, 'new-draft', 'New Draft', 'draft', 300, 'private-three');
    `);

    await expect(listEvents(database)).resolves.toEqual([
      { id: 3, slug: 'new-draft', name: 'New Draft', status: 'draft', createdAt: 300 },
      { id: 2, slug: 'new-active', name: 'New Active', status: 'active', createdAt: 300 },
      { id: 1, slug: 'old-draft', name: 'Old Draft', status: 'draft', createdAt: 100 },
    ]);
    await expect(listEvents(database, 'draft')).resolves.toEqual([
      { id: 3, slug: 'new-draft', name: 'New Draft', status: 'draft', createdAt: 300 },
      { id: 1, slug: 'old-draft', name: 'Old Draft', status: 'draft', createdAt: 100 },
    ]);
    await expect(listEvents(database, undefined, {
      limit: 1,
      cursor: { createdAt: 300, id: 3 },
    })).resolves.toEqual([
      { id: 2, slug: 'new-active', name: 'New Active', status: 'active', createdAt: 300 },
    ]);
    await expect(listEvents(database, 'live' as never)).rejects.toMatchObject({
      name: 'CompleteEventValidationError',
      fields: { status: expect.any(String) },
    });
  });

  it('returns stored watermark metadata without reading binary assets', async () => {
    const { database, sqlite } = createDatabase();
    sqlite.exec(`
      INSERT INTO events (id, slug, name, status, watermark_image_key, watermark_w)
      VALUES (1, 'branded-event', 'Branded Event', 'active', 'events/1/watermarks/logo.png', 640)
    `);

    const event = await getCompleteEvent(database, 'branded-event');

    expect(event?.watermark).toEqual({ contentType: PNG_CONTENT_TYPE, width: 640 });
  });

  it('omits watermark metadata for a key owned by another event', async () => {
    const { database, sqlite } = createDatabase();
    sqlite.exec(`
      INSERT INTO events (id, slug, name, status, watermark_image_key, watermark_w)
      VALUES (1, 'unsafe-watermark', 'Unsafe Watermark', 'draft', 'events/2/watermarks/logo.png', 640)
    `);

    const event = await getCompleteEvent(database, 'unsafe-watermark');

    expect(event?.watermark).toBeNull();
  });

  it('returns null for an unknown slug', async () => {
    const { database } = createDatabase();

    await expect(getCompleteEvent(database, 'missing')).resolves.toBeNull();
  });

  it('rolls back the event and scenes when a scene insert fails', async () => {
    const { database, sqlite } = createDatabase();
    sqlite.exec(`
      CREATE TRIGGER reject_scene BEFORE INSERT ON event_scenes
      WHEN NEW.prompt = 'force-scene-failure'
      BEGIN
        SELECT RAISE(ABORT, 'forced scene failure');
      END;
    `);
    const input = completeInput({
      scenes: [
        { id: 'valid', name: 'Valid', description: 'Valid', prompt: 'Valid' },
        { id: 'failure', name: 'Failure', description: 'Failure', prompt: 'force-scene-failure' },
      ],
    });

    await expect(createCompleteEvent(context(database), input)).rejects.toThrow('forced scene failure');
    expect(rawEventCount(sqlite)).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM event_scenes').get()).toEqual({ count: 0 });
  });

  it('reports an explicit duplicate slug', async () => {
    const { database, sqlite } = createDatabase();
    sqlite.exec("INSERT INTO events (id, slug, name) VALUES (1, 'launch-booth', 'Existing')");

    await expect(createCompleteEvent(context(database), completeInput())).rejects.toBeInstanceOf(EventSlugConflictError);
    expect(rawEventCount(sqlite)).toBe(1);
  });

  it('reallocates an event ID after a race', async () => {
    const { controls, database, sqlite } = createDatabase();
    let allocationCount = 0;
    let batchCount = 0;
    controls.onPrepare = (query) => {
      if (query.includes('MAX(id)')) {
        allocationCount += 1;
      }
    };
    controls.beforeBatch = (databaseHandle) => {
      batchCount += 1;
      if (batchCount === 1) {
        databaseHandle.exec("INSERT INTO events (id, slug, name) VALUES (1, 'racing-event', 'Racing Event')");
      }
    };

    const event = await createCompleteEvent(context(database), completeInput());

    expect(event.id).toBe(2);
    expect(batchCount).toBe(2);
    expect(allocationCount).toBe(2);
    expect(sqlite.prepare("SELECT id FROM events WHERE slug = 'launch-booth'").get()).toEqual({ id: 2 });
  });

  it('stops after three event ID allocation races', async () => {
    const { controls, database, sqlite } = createDatabase();
    let batchCount = 0;
    controls.beforeBatch = (databaseHandle) => {
      batchCount += 1;
      databaseHandle.prepare('INSERT INTO events (id, slug, name) VALUES (?, ?, ?)')
        .run(batchCount, `racing-event-${batchCount}`, `Racing Event ${batchCount}`);
    };

    await expect(createCompleteEvent(context(database), completeInput())).rejects.toMatchObject({
      name: 'EventIdConflictError',
      eventId: 3,
    });
    expect(batchCount).toBe(3);
    expect(rawEventCount(sqlite)).toBe(3);
  });
});
