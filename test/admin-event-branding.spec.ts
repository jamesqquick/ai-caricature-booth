import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { updateEvent } from '../src/db/events';
import { EventValidationError, validateEventUpdate } from '../src/lib/event-validation';

describe('admin event branding', () => {
  it('normalizes and validates attendee copy', () => {
    expect(validateEventUpdate({
      name: 'Event',
      slug: 'event',
      status: 'draft',
      tagline: '  A custom tagline  ',
      kiosk_idle_subhead: '  Welcome to our booth  ',
      scene_picker_heading: '  Choose your backdrop  ',
    })).toEqual({
      name: 'Event',
      slug: 'event',
      status: 'draft',
      tagline: 'A custom tagline',
      kiosk_idle_subhead: 'Welcome to our booth',
      scene_picker_heading: 'Choose your backdrop',
    });
  });

  it('rejects empty or oversized copy', () => {
    expect(() => validateEventUpdate({
      name: 'Event',
      slug: 'event',
      status: 'draft',
      tagline: 'x'.repeat(181),
      kiosk_idle_subhead: '',
      scene_picker_heading: 'Choose',
    })).toThrow(EventValidationError);

    try {
      validateEventUpdate({
        name: 'Event',
        slug: 'event',
        status: 'draft',
        tagline: 'x'.repeat(181),
        kiosk_idle_subhead: '',
        scene_picker_heading: 'Choose',
      });
    } catch (error) {
      expect(error).toMatchObject({ fields: {
        tagline: expect.any(String),
        kiosk_idle_subhead: expect.any(String),
      } });
    }
  });

  it('updates branding fields without requiring them on core-only edits', async () => {
    const calls: unknown[][] = [];
    const database = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            calls.push([query, ...values]);
            return { async run() { return {}; } };
          },
        };
      },
    } as unknown as D1Database;

    await updateEvent(database, 4, {
      name: 'Event',
      slug: 'event',
      status: 'active',
      tagline: 'New copy',
    });

    expect(calls[0][0]).toContain('tagline = ?');
    expect(calls[0][0]).not.toContain('accent_color');
    expect(calls[0]).toEqual(expect.arrayContaining(['New copy', 4]));
  });

  it('compiles the editor and attendee route and consumes every branding field', async () => {
    const files = [
      'src/pages/admin/events/[slug].astro',
      'src/pages/e/[slug].astro',
    ];
    const results = await Promise.all(files.map(async (filename) => {
      const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
      return transform(source, { filename });
    }));

    expect(results.flatMap((result) => result.diagnostics)).toEqual([]);
    const attendeeSource = await readFile(new URL('../src/pages/e/[slug].astro', import.meta.url), 'utf8');
    expect(attendeeSource).toContain('tagline={event.tagline}');
    expect(attendeeSource).toContain('kioskIdleSubhead={event.kiosk_idle_subhead}');
    expect(attendeeSource).toContain('scenePickerHeading={event.scene_picker_heading}');
    expect(attendeeSource).not.toContain('accentColor');
  });

  it('uses brand colors while preserving accessible text, focus, and selection cues', async () => {
    const [booth, styles, button, sceneStep, editor] = await Promise.all([
      readFile(new URL('../src/components/Photobooth.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/ui/button.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/steps/SceneStep.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/pages/admin/events/[slug].astro', import.meta.url), 'utf8'),
    ]);
    expect(booth).toContain('color-mix(in_oklch,var(--primary)_12%');
    expect(booth).not.toContain('--event-accent');
    expect(styles).not.toContain('.booth-event');
    expect(styles).toContain("button:focus-visible, a:focus-visible { outline: 3px solid var(--ring)");
    expect(styles).toContain(".scene-card-visual[data-selected='true']");
    expect(styles).toContain('outline: 2px solid var(--foreground)');
    expect(button).toContain('border border-primary bg-primary text-primary-foreground');
    expect(sceneStep).toContain('bg-primary text-[.7rem] font-black text-primary-foreground');
    expect(editor).toContain('border-foreground bg-primary');
    expect(editor).not.toContain('--preview-accent');
  });
});
