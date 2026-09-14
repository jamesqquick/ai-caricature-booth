import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventSlugConflictError } from '../src/lib/event-validation';
import {
  CompleteEventCompensationError,
  CompleteEventReadError,
  createCompleteEvent,
  getCompleteEvent,
  listEvents,
} from '../src/lib/event-service';
import {
  CompleteEventValidationError,
  type CreateCompleteEventInput,
  validateCompleteEvent,
} from '../src/lib/event-validation';
import { MAX_WATERMARK_BYTES } from '../src/lib/event-watermark';

const PNG_CONTENT_TYPE = 'image/png';

function png(width = 800, height = 300) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function sizedPng(size: number) {
  const bytes = new Uint8Array(size);
  bytes.set(png());
  return bytes;
}

function completeInput(overrides: Partial<CreateCompleteEventInput> = {}): CreateCompleteEventInput {
  return {
    name: '  Launch Booth  ',
    slug: 'launch-booth',
    status: 'active',
    accentColor: '#ABC123',
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
    watermark: { bytes: png(), width: 640 },
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
      accent_color TEXT NOT NULL DEFAULT '#f6821f',
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

type StoredObject = {
  bytes: Uint8Array;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  size?: number;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

class MemoryBucket {
  readonly objects = new Map<string, StoredObject>();
  readonly puts: string[] = [];
  readonly gets: string[] = [];
  readonly deletes: string[] = [];
  putError: Error | null = null;
  deleteError: Error | null = null;
  onOperation?: (operation: string) => void;

  async put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ) {
    this.puts.push(key);
    if (this.putError) throw this.putError;
    this.objects.set(key, {
      bytes: value.slice(),
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    });
    this.onOperation?.(`put:${key}`);
  }

  async get(key: string) {
    this.gets.push(key);
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      key,
      size: object.size ?? object.bytes.byteLength,
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
      async arrayBuffer() {
        if (object.arrayBuffer) return object.arrayBuffer();
        return object.bytes.slice().buffer;
      },
    };
  }

  async delete(key: string) {
    this.deletes.push(key);
    if (this.deleteError) throw this.deleteError;
    this.objects.delete(key);
    this.onOperation?.(`delete:${key}`);
  }
}

function context(database: D1Database, bucket: MemoryBucket, createdBy = 'creator@example.com') {
  return { database, bucket: bucket as unknown as R2Bucket, createdBy };
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
      watermark: undefined,
    }))).toEqual({
      name: 'Launch Booth',
      slug: 'launch-booth',
      status: 'draft',
      accentColor: '#abc123',
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
    ['malformed PNG', completeInput({ watermark: { bytes: new Uint8Array(33), width: 640 } }), { 'watermark.bytes': expect.any(String) }],
    ['oversized PNG', completeInput({ watermark: { bytes: sizedPng(MAX_WATERMARK_BYTES + 1), width: 640 } }), { 'watermark.bytes': expect.any(String) }],
    ['invalid watermark width', completeInput({ watermark: { bytes: png(), width: 100 } }), { 'watermark.width': expect.any(String) }],
  ])('rejects %s before side effects', async (_label, input, expectedFields) => {
    const { database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();

    await expect(createCompleteEvent(context(database, bucket), input)).rejects.toMatchObject({
      name: 'CompleteEventValidationError',
      fields: expectedFields,
    });
    expect(rawEventCount(sqlite)).toBe(0);
    expect(bucket.puts).toEqual([]);
  });

  it('defaults an omitted status to draft', () => {
    const input: Partial<CreateCompleteEventInput> = completeInput({ scenes: [], watermark: undefined });
    delete input.status;

    expect(validateCompleteEvent(input).status).toBe('draft');
  });

  it('accepts a structurally valid PNG at the exact watermark byte limit', () => {
    const bytes = sizedPng(MAX_WATERMARK_BYTES);

    const validated = validateCompleteEvent(completeInput({
      status: 'draft',
      scenes: [],
      watermark: { bytes, width: 640 },
    }));
    expect(validated.watermark?.bytes).toBe(bytes);
    expect(validated.watermark?.width).toBe(640);
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
        accentColor: expect.any(String),
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
      watermark: undefined,
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
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    const { database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();

    const event = await createCompleteEvent(context(database, bucket), completeInput());
    const rawEvent = sqlite.prepare('SELECT * FROM events WHERE id = ?').get(event.id);
    const rawScenes = sqlite.prepare('SELECT * FROM event_scenes WHERE event_id = ? ORDER BY sort_order').all(event.id);

    expect(rawEvent).toMatchObject({
      id: 1,
      slug: 'launch-booth',
      name: 'Launch Booth',
      status: 'active',
      accent_color: '#abc123',
      watermark_image_key: 'events/1/watermarks/00000000-0000-4000-8000-000000000001.png',
      tagline: 'Make a launch-day postcard.',
      kiosk_idle_subhead: 'Welcome to Launch Day',
      scene_picker_heading: 'Pick a launch scene',
      scene_style_preamble: 'Draw this as ink art.',
      scene_constraints: 'Keep the badge visible.',
      created_by: 'creator@example.com',
      watermark_w: 640,
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
      accentColor: '#abc123',
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
      watermark: { contentType: PNG_CONTENT_TYPE, width: 640 },
    });
    expect(event).not.toHaveProperty('createdBy');
    expect(event).not.toHaveProperty('created_by');
    expect(event).not.toHaveProperty('watermarkImageKey');
    expect(event).not.toHaveProperty('watermark_image_key');
    expect(JSON.stringify(event)).not.toMatch(/created_by|watermark_image_key|watermarkImageKey|creator@example\.com/);
  });

  it('creates a complete event without a watermark or any R2 access', async () => {
    const { database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();

    const event = await createCompleteEvent(context(database, bucket), completeInput({ watermark: undefined }));

    expect(event.watermark).toBeNull();
    expect(bucket.puts).toEqual([]);
    expect(bucket.gets).toEqual([]);
    expect(bucket.deletes).toEqual([]);
    expect(sqlite.prepare(`
      SELECT watermark_image_key, watermark_w FROM events WHERE id = ?
    `).get(event.id)).toEqual({ watermark_image_key: null, watermark_w: null });
    expect(sqlite.prepare(`
      SELECT id, sort_order FROM event_scenes WHERE event_id = ? ORDER BY sort_order
    `).all(event.id)).toEqual([
      { id: 'second-scene', sort_order: 0 },
      { id: 'first-scene', sort_order: 1 },
    ]);
  });

  it('returns the committed DTO without database readback and persists the same createdAt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_123_456);
    const { controls, database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();
    controls.failPreparesAfterBatch = new Error('DB reads unavailable after commit');

    const event = await createCompleteEvent(context(database, bucket), completeInput());

    expect(event).toMatchObject({
      id: 1,
      slug: 'launch-booth',
      createdAt: 1_800_000_123,
      watermark: { contentType: PNG_CONTENT_TYPE, width: 640 },
    });
    expect(sqlite.prepare('SELECT created_at FROM events WHERE id = 1').get()).toEqual({
      created_at: event.createdAt,
    });
    expect(bucket.gets).toEqual([]);
  });

  it('rejects a blank creator before any D1 or R2 access', async () => {
    const prepare = vi.fn();
    const batch = vi.fn();
    const database = { prepare, batch } as unknown as D1Database;
    const bucket = new MemoryBucket();

    await expect(createCompleteEvent(context(database, bucket, '   '), completeInput())).rejects.toMatchObject({
      name: 'CompleteEventValidationError',
      fields: { 'context.createdBy': expect.any(String) },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(bucket.puts).toEqual([]);
    expect(bucket.gets).toEqual([]);
    expect(bucket.deletes).toEqual([]);
  });

  it('lists safe summaries newest-first and filters by validated status', async () => {
    const { database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();
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
    await expect(listEvents(database, 'live' as never)).rejects.toMatchObject({
      name: 'CompleteEventValidationError',
      fields: { status: expect.any(String) },
    });
    expect(bucket.gets).toEqual([]);
  });

  it('reads watermark bytes only when explicitly requested', async () => {
    const { database } = createDatabase();
    const bucket = new MemoryBucket();
    const created = await createCompleteEvent(context(database, bucket), completeInput());
    bucket.gets.length = 0;

    const defaultRead = await getCompleteEvent(database, bucket as unknown as R2Bucket, created.slug);
    expect(defaultRead?.watermark).toEqual({ contentType: PNG_CONTENT_TYPE, width: 640 });
    expect(bucket.gets).toEqual([]);

    const withBytes = await getCompleteEvent(database, bucket as unknown as R2Bucket, created.slug, {
      includeWatermarkData: true,
    });
    expect(withBytes?.watermark).toEqual({
      bytes: png(),
      contentType: PNG_CONTENT_TYPE,
      width: 640,
    });
    expect(bucket.gets).toHaveLength(1);
  });

  it('returns null for an unknown slug without reading R2', async () => {
    const { database } = createDatabase();
    const bucket = new MemoryBucket();

    await expect(getCompleteEvent(database, bucket as unknown as R2Bucket, 'missing', {
      includeWatermarkData: true,
    })).resolves.toBeNull();
    expect(bucket.gets).toEqual([]);
  });

  it.each([
    ['missing', 'events/1/watermarks/missing.png', undefined, undefined, 'missing-watermark'],
    ['cross-event', 'events/2/watermarks/other.png', undefined, undefined, 'unsafe-watermark'],
    ['wrong content type', 'events/1/watermarks/wrong.png', 'image/jpeg', png(), 'unsafe-watermark'],
    ['malformed PNG', 'events/1/watermarks/malformed.png', PNG_CONTENT_TYPE, new Uint8Array(33), 'invalid-watermark'],
  ])('throws a typed read error for a %s watermark object', async (_label, key, contentType, bytes, reason) => {
    const { database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();
    sqlite.prepare(`
      INSERT INTO events (id, slug, name, status, watermark_image_key, watermark_w)
      VALUES (1, 'unsafe-watermark', 'Unsafe Watermark', 'draft', ?, 640)
    `).run(key);
    if (contentType && bytes) {
      bucket.objects.set(key, { bytes, httpMetadata: { contentType } });
    }

    try {
      await getCompleteEvent(database, bucket as unknown as R2Bucket, 'unsafe-watermark', {
        includeWatermarkData: true,
      });
      expect.fail('Expected the watermark read to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(CompleteEventReadError);
      expect(error).toMatchObject({
        name: 'CompleteEventReadError',
        slug: 'unsafe-watermark',
        reason,
      });
    }
  });

  it('rejects an oversized stored watermark before reading its bytes', async () => {
    const { database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();
    const key = 'events/1/watermarks/oversized.png';
    const arrayBuffer = vi.fn(async () => png().slice().buffer);
    sqlite.prepare(`
      INSERT INTO events (id, slug, name, status, watermark_image_key, watermark_w)
      VALUES (1, 'oversized-watermark', 'Oversized Watermark', 'draft', ?, 640)
    `).run(key);
    bucket.objects.set(key, {
      bytes: png(),
      size: MAX_WATERMARK_BYTES + 1,
      httpMetadata: { contentType: PNG_CONTENT_TYPE },
      arrayBuffer,
    });

    await expect(getCompleteEvent(database, bucket as unknown as R2Bucket, 'oversized-watermark', {
      includeWatermarkData: true,
    })).rejects.toMatchObject({
      name: 'CompleteEventReadError',
      reason: 'oversized-watermark',
      slug: 'oversized-watermark',
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('does not write D1 when the watermark upload fails', async () => {
    const { database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();
    bucket.putError = new Error('R2 unavailable');

    await expect(createCompleteEvent(context(database, bucket), completeInput())).rejects.toThrow('R2 unavailable');
    expect(rawEventCount(sqlite)).toBe(0);
  });

  it('rolls back the event and scenes and deletes the staged watermark when a scene insert fails', async () => {
    const { database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();
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

    await expect(createCompleteEvent(context(database, bucket), input)).rejects.toThrow('forced scene failure');
    expect(rawEventCount(sqlite)).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM event_scenes').get()).toEqual({ count: 0 });
    expect(bucket.puts).toHaveLength(1);
    expect(bucket.deletes).toEqual(bucket.puts);
    expect(bucket.objects.size).toBe(0);
  });

  it('reports operation and cleanup context when staged watermark deletion is exhausted', async () => {
    const { database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();
    const cleanupError = new Error('R2 delete unavailable');
    bucket.deleteError = cleanupError;
    sqlite.exec(`
      CREATE TRIGGER reject_scene BEFORE INSERT ON event_scenes
      WHEN NEW.prompt = 'force-scene-failure'
      BEGIN
        SELECT RAISE(ABORT, 'forced scene failure');
      END;
    `);
    const input = completeInput({
      scenes: [{ id: 'failure', name: 'Failure', description: 'Failure', prompt: 'force-scene-failure' }],
    });

    try {
      await createCompleteEvent(context(database, bucket), input);
      expect.fail('Expected event creation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(CompleteEventCompensationError);
      expect(error).toMatchObject({
        eventId: 1,
        watermarkKey: bucket.puts[0],
        operationError: expect.objectContaining({ message: 'forced scene failure' }),
        cleanupError,
      });
    }
    expect(rawEventCount(sqlite)).toBe(0);
    expect(bucket.deletes).toHaveLength(3);
    expect(bucket.objects.size).toBe(1);
  });

  it('cleans the staged watermark and reports an explicit duplicate slug', async () => {
    const { database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();
    sqlite.exec("INSERT INTO events (id, slug, name) VALUES (1, 'launch-booth', 'Existing')");

    await expect(createCompleteEvent(context(database, bucket), completeInput())).rejects.toBeInstanceOf(EventSlugConflictError);
    expect(rawEventCount(sqlite)).toBe(1);
    expect(bucket.puts).toHaveLength(1);
    expect(bucket.deletes).toEqual(bucket.puts);
    expect(bucket.objects.size).toBe(0);
  });

  it('reallocates an event ID after a race and cleans the first event-scoped staged key', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
    const { controls, database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();
    const operations: string[] = [];
    let allocationCount = 0;
    let batchCount = 0;
    controls.onPrepare = (query) => {
      if (query.includes('MAX(id)')) {
        allocationCount += 1;
        operations.push(`allocate:${allocationCount}`);
      }
    };
    bucket.onOperation = (operation) => operations.push(operation);
    controls.beforeBatch = (databaseHandle) => {
      batchCount += 1;
      if (batchCount === 1) {
        databaseHandle.exec("INSERT INTO events (id, slug, name) VALUES (1, 'racing-event', 'Racing Event')");
      }
    };

    const event = await createCompleteEvent(context(database, bucket), completeInput());

    expect(event.id).toBe(2);
    expect(batchCount).toBe(2);
    expect(bucket.puts).toEqual([
      'events/1/watermarks/00000000-0000-4000-8000-000000000001.png',
      'events/2/watermarks/00000000-0000-4000-8000-000000000002.png',
    ]);
    expect(bucket.deletes).toEqual([bucket.puts[0]]);
    expect(bucket.objects.has(bucket.puts[0])).toBe(false);
    expect(bucket.objects.has(bucket.puts[1])).toBe(true);
    expect(sqlite.prepare("SELECT id FROM events WHERE slug = 'launch-booth'").get()).toEqual({ id: 2 });
    expect(operations).toEqual([
      'allocate:1',
      `put:${bucket.puts[0]}`,
      `delete:${bucket.puts[0]}`,
      'allocate:2',
      `put:${bucket.puts[1]}`,
    ]);
  });

  it('stops after three event ID allocation races and cleans every staged key', async () => {
    const { controls, database, sqlite } = createDatabase();
    const bucket = new MemoryBucket();
    let batchCount = 0;
    controls.beforeBatch = (databaseHandle) => {
      batchCount += 1;
      databaseHandle.prepare('INSERT INTO events (id, slug, name) VALUES (?, ?, ?)')
        .run(batchCount, `racing-event-${batchCount}`, `Racing Event ${batchCount}`);
    };

    await expect(createCompleteEvent(context(database, bucket), completeInput())).rejects.toMatchObject({
      name: 'EventIdConflictError',
      eventId: 3,
    });
    expect(batchCount).toBe(3);
    expect(bucket.puts).toHaveLength(3);
    expect(bucket.deletes).toEqual(bucket.puts);
    expect(bucket.objects.size).toBe(0);
    expect(rawEventCount(sqlite)).toBe(3);
  });
});
