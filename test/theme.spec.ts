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

  it('uses pointer cursors only for actionable non-button controls', async () => {
    const source = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
    const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const selectorsForCursor = (cursor: 'pointer' | 'default') => {
      const declaration = new RegExp(`cursor\\s*:\\s*${cursor}\\s*;`);
      const rule = rules.find(([, , declarations]) => declaration.test(declarations));

      expect(rule?.[2]).toMatch(declaration);
      return new Set(
        (rule?.[1] ?? '')
          .split(',')
          .filter(Boolean)
          .map((selector) => selector.replace(/\s+/g, '').replaceAll('"', "'")),
      );
    };

    expect(selectorsForCursor('pointer')).toEqual(
      new Set([
        "a[href]:not([aria-disabled='true'])",
        "summary:not([aria-disabled='true'])",
        'select:not(:disabled)',
        "[role='button']:not(button):not(:disabled):not([disabled]):not([aria-disabled='true'])",
      ]),
    );
    expect(selectorsForCursor('default')).toEqual(
      new Set([
        "a[href][aria-disabled='true']",
        "summary[aria-disabled='true']",
        'select:disabled',
        "[role='button']:not(button):disabled",
        "[role='button']:not(button)[disabled]",
        "[role='button']:not(button)[aria-disabled='true']",
      ]),
    );
  });
});
