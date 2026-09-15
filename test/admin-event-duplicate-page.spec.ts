import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('event duplication page wiring', () => {
  it('places the duplicate control beside delete in the event page header', async () => {
    const source = await readFile(new URL('../src/pages/admin/events/[slug].astro', import.meta.url), 'utf8');
    const result = await transform(source, { filename: 'src/pages/admin/events/[slug].astro' });

    expect(result.diagnostics).toEqual([]);
    expect(source).toContain("import { EventDuplicateControl }");
    expect(source).toContain('<EventDuplicateControl');
    expect(source).toContain('endpoint={`/api/admin/events/${encodeURIComponent(event.slug)}/duplicate`}');
    expect(source.indexOf('<EventDuplicateControl')).toBeLessThan(source.indexOf('<EventDeleteControl'));
    expect(source).toContain('class="flex flex-wrap justify-end gap-3" slot="actions"');
  });
});
