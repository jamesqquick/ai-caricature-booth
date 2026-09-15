import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('event color migration', () => {
  it('removes the accent column without losing events', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const [initialMigration, removeColorMigration] = await Promise.all([
      readFile(new URL('../drizzle/migrations/0001_events.sql', import.meta.url), 'utf8'),
      readFile(new URL('../drizzle/migrations/0020_remove_event_accent_color.sql', import.meta.url), 'utf8'),
    ]);

    try {
      sqlite.exec(initialMigration);
      sqlite.prepare(`
        INSERT INTO events (id, slug, name, status, accent_color)
        VALUES (?, ?, ?, ?, ?)
      `).run(3, 'existing-event', 'Existing Event', 'draft', '#123456');

      sqlite.exec(removeColorMigration);

      expect(sqlite.prepare("SELECT name FROM pragma_table_info('events')").all())
        .not.toContainEqual({ name: 'accent_color' });
      expect(sqlite.prepare('SELECT slug, name, status FROM events WHERE id = 3').get()).toEqual({
        slug: 'existing-event',
        name: 'Existing Event',
        status: 'draft',
      });

      sqlite.prepare('UPDATE events SET name = ? WHERE id = ?').run('Updated Event', 3);
      expect(sqlite.prepare('SELECT name FROM events WHERE id = 3').get()).toEqual({ name: 'Updated Event' });
      sqlite.prepare('DELETE FROM events WHERE id = ?').run(3);
      expect(sqlite.prepare('SELECT id FROM events WHERE id = 3').get()).toBeUndefined();
    } finally {
      sqlite.close();
    }
  });
});
