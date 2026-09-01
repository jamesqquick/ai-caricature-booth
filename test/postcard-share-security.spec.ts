import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('postcard sharing security', () => {
  it('uses canonical share and QR URLs without source or capability data', async () => {
    const source = await readFile(new URL('../src/pages/p/[sessionId].astro', import.meta.url), 'utf8');

    expect(source).toContain('const resultUrl = new URL(`/p/${sessionId}`, Astro.url).toString();');
    expect(source).toContain('const canonicalUrl = new URL(window.location.pathname, window.location.origin).toString();');
    expect(source).toContain('url: canonicalUrl');
    expect(source).toContain('navigator.clipboard.writeText(canonicalUrl)');
    expect(source).not.toMatch(/printToken|print-capability/);
  });
});
