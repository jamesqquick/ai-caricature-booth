import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('homepage before and after comparison', () => {
  it('uses the demo images and an accessible range control', async () => {
    const source = await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8');

    expect(source).toContain('aria-label="Before and after selfie comparison"');
    expect(source).toContain('src="/demo-selfie.jpg"');
    expect(source).toContain('src="/demo-postcard.jpg"');
    expect(source).toContain('data-comparison');
    expect(source).toContain('data-comparison-input');
    expect(source).toContain('type="range"');
    expect(source).toContain('aria-label="Compare selfie and final result"');
    expect(source).toContain("--comparison-position");
    expect(source).toContain("comparisonInput.value}%");
    expect(source).not.toContain('landing-postcard');
    expect(source).not.toContain('id="compare"');
  });
});
