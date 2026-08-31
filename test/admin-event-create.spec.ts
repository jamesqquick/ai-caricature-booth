import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { EventValidationError, validateCreateEvent } from '../src/lib/event-validation';
import { createEvent } from '../src/db/events';

describe('event creation validation', () => {
  it('progressively enhances creation with recoverable field errors and retained values', async () => {
    const source = await readFile(new URL('../src/pages/admin/events/new.astro', import.meta.url), 'utf8');
    expect(source).toContain('method="post" action="/api/admin/events"');
    expect(source).toContain("headers: { 'Content-Type': 'application/json' }");
    expect(source).toContain("field.setAttribute('aria-invalid', 'true')");
    expect(source).toContain("field.setAttribute('aria-errormessage', output.id)");
    expect(source).toContain("querySelector<HTMLElement>('[aria-invalid=\"true\"]')?.focus()");
    expect(source).toContain('window.location.assign(response.url)');
    expect(source).not.toContain('form.reset()');
  });

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
  it('writes the core fields, attendee default copy, and verified creator', async () => {
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
    expect(calls[0]).toEqual(expect.arrayContaining([
      'new-event',
      'New Event',
      'draft',
      'Take a selfie, choose a scene, and download your caricature postcard.',
      'admin@example.com',
    ]));
    expect(calls[0][0]).toContain('created_by');
  });
});
