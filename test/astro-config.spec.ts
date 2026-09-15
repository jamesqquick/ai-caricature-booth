import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import config from '../astro.config.mjs';

describe('Astro request limits', () => {
  it('allows the validated 6 MiB selfie plus action encoding overhead', () => {
    expect(config.security?.actionBodySizeLimit).toBe(7 * 1024 * 1024);
  });

  it('uses Cloudflare Images for Astro asset transformations', async () => {
    const source = await readFile(new URL('../astro.config.mjs', import.meta.url), 'utf8');

    expect(source).toContain("imageService: { build: 'cloudflare-binding', runtime: 'cloudflare-binding' }");
  });
});
