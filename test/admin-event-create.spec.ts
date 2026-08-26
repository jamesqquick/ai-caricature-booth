import { describe, expect, it } from 'vitest';
import { EventValidationError, validateCreateEvent } from '../src/lib/event-validation';
import { createEvent } from '../src/db/events';

describe('event creation validation', () => {
  it('validates core fields and preserves normalized values', () => {
    expect(validateCreateEvent({
      name: '  Spring Booth  ',
      slug: 'spring-booth',
      status: 'draft',
    })).toEqual({
      name: 'Spring Booth',
      slug: 'spring-booth',
      status: 'draft',
    });
  });

  it('reports field-level errors', () => {
    expect(() => validateCreateEvent({ name: '', slug: 'Not Valid', status: 'live' }))
      .toThrowError(EventValidationError);
    try {
      validateCreateEvent({ name: '', slug: 'Not Valid', status: 'live' });
    } catch (error) {
      expect(error).toMatchObject({ fields: { name: expect.any(String), slug: expect.any(String), status: expect.any(String) } });
    }
  });
});

describe('createEvent', () => {
  it('writes only the core fields and verified creator', async () => {
    const calls: unknown[][] = [];
    const database = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            calls.push([query, ...values]);
            return { async run() { return { meta: { last_row_id: 9 } }; } };
          },
        };
      },
    } as unknown as D1Database;

    await expect(createEvent(database, {
      name: 'New Event', slug: 'new-event', status: 'draft',
    }, 'admin@example.com')).resolves.toMatchObject({ id: 9, slug: 'new-event', createdBy: 'admin@example.com' });
    expect(calls[0]).toEqual(expect.arrayContaining(['new-event', 'New Event', 'draft', 'admin@example.com']));
    expect(calls[0][0]).toContain('created_by');
  });
});
