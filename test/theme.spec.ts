import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('default dark theme', () => {
  it('uses the primary red hue', async () => {
    const source = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
    const root = source.match(/^:root \{([\s\S]*?)^\}/m)?.[1];

    expect(root).toContain('--primary: oklch(72% 0.19 25);');
    expect(root).toContain('--primary-hover: oklch(78% 0.17 25);');
    expect(root).toContain('--ring: oklch(72% 0.19 25);');
  });
});
