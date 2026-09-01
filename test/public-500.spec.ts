import { transform } from '@astrojs/compiler';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public 500 page', () => {
  it('compiles with fixed recovery copy and no technical error surface', async () => {
    const source = await readFile(new URL('../src/pages/500.astro', import.meta.url), 'utf8');
    const technicalSentinel = 'technical-error-sentinel-f917ac';

    await expect(transform(source, { filename: 'src/pages/500.astro' })).resolves.toBeTruthy();
    expect(source).toContain('Something went wrong.');
    expect(source).toContain('Try this page again');
    expect(source).toContain('Back to home');
    expect(source).not.toContain(technicalSentinel);
    expect(source).not.toMatch(/Astro\.props|\berror\b|\.message\b|\.stack\b|\.cause\b/i);
  });
});
