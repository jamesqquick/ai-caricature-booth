import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { deleteSessionWithAssets, SessionDeletionConflictError } from '../src/db/sessions';

function createDatabase(beforeDelete?: (sqlite: DatabaseSync) => void) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      selfie_key TEXT NOT NULL,
      caricature_key TEXT,
      postcard_key TEXT
    );
    CREATE TABLE print_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id)
    );
  `);

  const database = {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      let values: SQLInputValue[] = [];
      const prepared = {
        bind(...bindings: unknown[]) {
          values = bindings as SQLInputValue[];
          return prepared;
        },
        async first(column?: string) {
          const row = statement.get(...values) as Record<string, unknown> | undefined;
          return column ? row?.[column] ?? null : row ?? null;
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async run() {
          if (query.includes('DELETE FROM sessions')) beforeDelete?.(sqlite);
          const result = statement.run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
      return prepared;
    },
  } as unknown as D1Database;

  return { database, sqlite };
}

function insertSession(sqlite: DatabaseSync, status = 'completed') {
  sqlite.prepare(`
    INSERT INTO sessions (id, status, selfie_key, caricature_key, postcard_key)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'session-1',
    status,
    'sessions/session-1/selfie.jpg',
    'sessions/session-1/workflow-1/caricature.jpg',
    'sessions/session-1/workflow-1/postcard.jpg',
  );
}

describe('deleteSessionWithAssets', () => {
  it('returns a missing result when the session does not exist', async () => {
    const { database, sqlite } = createDatabase();
    try {
      await expect(deleteSessionWithAssets(database, 'missing')).resolves.toEqual({ deleted: false, session: null });
    } finally {
      sqlite.close();
    }
  });

  it.each(['completed', 'errored'])('deletes a %s session and returns its asset keys', async (status) => {
    const { database, sqlite } = createDatabase();
    try {
      insertSession(sqlite, status);

      await expect(deleteSessionWithAssets(database, 'session-1')).resolves.toEqual({
        deleted: true,
        session: {
          id: 'session-1',
          status,
          selfie_key: 'sessions/session-1/selfie.jpg',
          caricature_key: 'sessions/session-1/workflow-1/caricature.jpg',
          postcard_key: 'sessions/session-1/workflow-1/postcard.jpg',
        },
      });
      expect(sqlite.prepare('SELECT id FROM sessions WHERE id = ?').get('session-1')).toBeUndefined();
    } finally {
      sqlite.close();
    }
  });

  it('rejects deletion while the session is active', async () => {
    const { database, sqlite } = createDatabase();
    try {
      insertSession(sqlite, 'generating');

      await expect(deleteSessionWithAssets(database, 'session-1')).rejects.toMatchObject({
        name: 'SessionDeletionConflictError',
        reason: 'active',
      });
      expect(sqlite.prepare('SELECT id FROM sessions WHERE id = ?').get('session-1')).toBeTruthy();
    } finally {
      sqlite.close();
    }
  });

  it('rejects deletion when print history references the session', async () => {
    const { database, sqlite } = createDatabase();
    try {
      insertSession(sqlite);
      sqlite.prepare('INSERT INTO print_jobs (id, session_id) VALUES (?, ?)').run('print-1', 'session-1');

      await expect(deleteSessionWithAssets(database, 'session-1')).rejects.toEqual(
        expect.objectContaining<Partial<SessionDeletionConflictError>>({
          name: 'SessionDeletionConflictError',
          reason: 'print-history',
        }),
      );
    } finally {
      sqlite.close();
    }
  });

  it('reports a conditional-delete race without losing the loaded session', async () => {
    const { database, sqlite } = createDatabase((database) => {
      database.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('generating', 'session-1');
    });
    try {
      insertSession(sqlite);

      const result = await deleteSessionWithAssets(database, 'session-1');

      expect(result.deleted).toBe(false);
      expect(result.session).toMatchObject({ id: 'session-1', status: 'completed' });
      expect(sqlite.prepare('SELECT status FROM sessions WHERE id = ?').get('session-1')).toEqual({ status: 'generating' });
    } finally {
      sqlite.close();
    }
  });

  it('does not delete when print history appears after the precheck', async () => {
    const { database, sqlite } = createDatabase((database) => {
      database.prepare('INSERT INTO print_jobs (id, session_id) VALUES (?, ?)').run('print-race', 'session-1');
    });
    try {
      insertSession(sqlite);

      const result = await deleteSessionWithAssets(database, 'session-1');

      expect(result.deleted).toBe(false);
      expect(result.session).toMatchObject({ id: 'session-1', status: 'completed' });
      expect(sqlite.prepare('SELECT id FROM sessions WHERE id = ?').get('session-1')).toBeTruthy();
      expect(sqlite.prepare('SELECT id FROM print_jobs WHERE session_id = ?').get('session-1')).toEqual({ id: 'print-race' });
    } finally {
      sqlite.close();
    }
  });
});
