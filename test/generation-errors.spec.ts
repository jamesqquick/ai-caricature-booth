import { readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { loadSession, transitionSession } from '../src/db/sessions';
import {
  GENERATION_FAILURE_CODES,
  generationFailureContent,
  isGenerationFailureCode,
  toGenerationFailureCode,
} from '../src/lib/generation-errors';

const migrationUrl = new URL('../drizzle/migrations/0010_session_error_codes.sql', import.meta.url);

const knownLegacyFailures = [
  ["We couldn't use this photo after the safety check. Try a different photo.", 'photo_rejected'],
  ["We couldn't check your photo. Please try again.", 'moderation_unavailable'],
  ["We couldn't create your caricature. Please try again.", 'generation_failed'],
  ["We couldn't finish your postcard. Please try again.", 'composition_failed'],
] as const;

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

describe('generation failure contract', () => {
  it('accepts exactly the closed set of persisted failure codes', () => {
    expect(GENERATION_FAILURE_CODES).toEqual([
      'photo_rejected',
      'moderation_unavailable',
      'generation_failed',
      'composition_failed',
      'unknown_failure',
    ]);

    for (const code of GENERATION_FAILURE_CODES) {
      expect(isGenerationFailureCode(code)).toBe(true);
      expect(toGenerationFailureCode(code, knownLegacyFailures[0][0])).toBe(code);
    }

    expect(isGenerationFailureCode('other_failure')).toBe(false);
    expect(isGenerationFailureCode(null)).toBe(false);
    expect(isGenerationFailureCode(1)).toBe(false);
  });

  it.each(knownLegacyFailures)('maps legacy attendee copy %s to %s', (legacyMessage, expected) => {
    expect(toGenerationFailureCode(null, legacyMessage)).toBe(expected);
    expect(toGenerationFailureCode('invalid', legacyMessage)).toBe(expected);
  });

  it.each([null, '', 'database connection exposed internal details', 'toString', 'constructor'])('fails closed for unknown legacy values', (legacyMessage) => {
    expect(toGenerationFailureCode(null, legacyMessage)).toBe('unknown_failure');
  });

  it('defines fixed attendee copy and retry semantics for every code', () => {
    expect(generationFailureContent).toEqual({
      photo_rejected: {
        message: "We couldn't use this photo after the safety check. Try a different photo.",
        retryable: true,
      },
      moderation_unavailable: {
        message: "We couldn't check your photo. Please try again.",
        retryable: true,
      },
      generation_failed: {
        message: "We couldn't create your caricature. Please try again.",
        retryable: true,
      },
      composition_failed: {
        message: "We couldn't finish your postcard. Please try again.",
        retryable: true,
      },
      unknown_failure: {
        message: "We couldn't create your postcard. Please try again.",
        retryable: true,
      },
    });
  });

  it('uses fixed retryable attendee copy without reflecting input text', () => {
    const untrustedText = 'private provider response and database details';
    const code = toGenerationFailureCode('invalid', untrustedText);
    const content = generationFailureContent[code];

    expect(content.retryable).toBe(true);
    expect(content.message).toBe("We couldn't create your postcard. Please try again.");
    expect(JSON.stringify(content)).not.toContain(untrustedText);
  });

  it('migrates legacy sessions and enforces failure codes through session persistence', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE events (id INTEGER PRIMARY KEY);
      INSERT INTO events (id) VALUES (1);
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id),
        status TEXT NOT NULL DEFAULT 'pending',
        scene_id TEXT NOT NULL,
        scene_name TEXT,
        selfie_key TEXT NOT NULL,
        caricature_key TEXT,
        postcard_key TEXT,
        workflow_instance_id TEXT,
        error_msg TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        selfie_sha256 TEXT NOT NULL DEFAULT '',
        pipeline_ms INTEGER,
        UNIQUE(workflow_instance_id)
      );
      INSERT INTO sessions (id, event_id, status, scene_id, selfie_key, error_msg)
      VALUES ('legacy-session', 1, 'errored', 'scene-1', 'legacy/selfie.jpg', 'legacy attendee message');
      INSERT INTO sessions (id, event_id, status, scene_id, selfie_key)
      VALUES ('helper-session', 1, 'generating', 'scene-1', 'helper/selfie.jpg');
    `);

    sqlite.exec(await readFile(migrationUrl, 'utf8'));

    expect(sqlite.prepare('SELECT error_code, error_msg FROM sessions WHERE id = ?').get('legacy-session')).toEqual({
      error_code: null,
      error_msg: 'legacy attendee message',
    });

    const updateCode = sqlite.prepare('UPDATE sessions SET error_code = ? WHERE id = ?');
    for (const code of GENERATION_FAILURE_CODES) {
      expect(updateCode.run(code, 'legacy-session').changes).toBe(1);
      expect(sqlite.prepare('SELECT error_code FROM sessions WHERE id = ?').get('legacy-session')).toEqual({ error_code: code });
    }
    expect(() => updateCode.run('invalid_failure', 'legacy-session')).toThrow();

    const database = asD1(sqlite);
    await transitionSession(database, 'helper-session', 'errored', { error_code: 'composition_failed' });
    await expect(loadSession(database, 'helper-session')).resolves.toMatchObject({
      status: 'errored',
      error_code: 'composition_failed',
    });
  });
});
