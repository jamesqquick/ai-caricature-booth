import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const rootButtonPath = join(sourceRoot, 'components/ui/button.tsx');
const sourceExtensions = new Set(['.astro', '.jsx', '.tsx']);

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listSourceFiles(path) : [path];
    }),
  );

  return files.flat().filter((path) => sourceExtensions.has(extname(path)));
}

describe('button source policy', () => {
  it('renders native buttons only through the root Button component', async () => {
    const violations: string[] = [];

    for (const path of await listSourceFiles(sourceRoot)) {
      if (path === rootButtonPath) continue;

      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(/<button\b/g)) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${relative(sourceRoot, path)}:${line}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
