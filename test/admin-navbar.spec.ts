/** @vitest-environment jsdom */

import { readFile } from 'node:fs/promises';
import { URL as NodeURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('admin mobile navigation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    vi.restoreAllMocks();
  });

  it('restores body overflow when an open mobile menu becomes desktop navigation', async () => {
    const source = await readFile(new NodeURL('../src/components/admin/AdminNavbar.astro', import.meta.url), 'utf8');
    const script = source.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();

    document.body.innerHTML = `
      <button data-admin-menu-toggle aria-expanded="false"></button>
      <div data-admin-menu hidden>
        <button data-admin-menu-close></button>
        <a href="/admin">Dashboard</a>
      </div>
    `;
    document.body.style.overflow = 'auto';
    let mobile = true;
    let onChange: (() => void) | undefined;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        get matches() { return mobile; },
        addEventListener: (_event: string, listener: () => void) => { onChange = listener; },
      })),
    });

    new Function(script!)();
    const toggle = document.querySelector<HTMLElement>('[data-admin-menu-toggle]')!;
    const menu = document.querySelector<HTMLElement>('[data-admin-menu]')!;
    toggle.click();
    expect(document.body.style.overflow).toBe('hidden');

    mobile = false;
    onChange?.();

    expect(document.body.style.overflow).toBe('auto');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(menu.hidden).toBe(false);
  });
});
