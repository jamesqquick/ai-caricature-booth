import { transform } from '@astrojs/compiler';
import { getViteConfig } from 'astro/config';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';

async function render500Page(error: Error) {
  const createViteConfig = getViteConfig(
    { logLevel: 'silent' },
    { configFile: false, root: fileURLToPath(new URL('../', import.meta.url)) },
  );
  const viteConfig = await createViteConfig({ command: 'serve', mode: 'test' });
  const server = await createServer({
    ...viteConfig,
    configFile: false,
    server: { middlewareMode: true, hmr: { port: 24680 } },
  });

  try {
    const page = await server.ssrLoadModule('/src/pages/500.astro');
    const container = await AstroContainer.create();
    return await container.renderToString(page.default, {
      props: { error },
      request: new Request('https://booth.test/500'),
      partial: false,
    });
  } finally {
    await server.close();
  }
}

describe('public 500 page', () => {
  it('compiles and renders fixed recovery copy without technical error data', async () => {
    const source = await readFile(new URL('../src/pages/500.astro', import.meta.url), 'utf8');
    const technicalSentinel = 'technical-error-sentinel-f917ac';
    const technicalAccess = /Astro\.props|\berror\b|\.message\b|\.stack\b|\.cause\b/i;
    const compiled = await transform(source, { filename: 'src/pages/500.astro' });
    const page = await render500Page(new Error(technicalSentinel));

    for (const artifact of [source, compiled.code]) {
      expect(artifact).not.toContain(technicalSentinel);
      expect(artifact).not.toMatch(technicalAccess);
    }
    expect(page).toContain('Something went wrong.');
    expect(page).toContain('Try this page again');
    expect(page).toContain('Back to home');
    expect(page).not.toContain(technicalSentinel);
  });
});
