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

  it('uses shared outline icon controls and Lucide navbar icons', async () => {
    const source = await readFile(new NodeURL('../src/components/admin/AdminNavbar.astro', import.meta.url), 'utf8');

    expect(source).toContain("import { Menu, Moon, Sun, X } from 'lucide-react'");
    expect(source).toContain("import { Button } from '../ui/button'");
    expect(source).toContain('variant="outline"');
    expect(source).toContain('size="icon"');
    expect(source).toContain('data-admin-menu-toggle');
    expect(source).toContain('data-admin-menu-close');
    expect(source).toContain('hover:text-primary');
    expect(source).toContain('hover:[&_svg]:scale-110');
    expect(source).toContain('hover:[&_svg]:rotate-[4deg]');
    expect(source).toContain('motion-reduce:hover:[&_svg]:scale-100');
    expect(source).toContain('motion-reduce:hover:[&_svg]:rotate-0');
    expect(source).toContain("const navbarHomeIconHover = 'transition-transform duration-200 group-hover:scale-110 group-hover:rotate-[4deg] motion-reduce:transition-none motion-reduce:group-hover:scale-100 motion-reduce:group-hover:rotate-0'");
    expect(source).toContain("class={cn('size-9', navbarHomeIconHover)}");
    expect(source).not.toContain('<path d="M4 6h16M4 12h16M4 18h16"');
    expect(source).not.toContain('<path d="M6 6l12 12M18 6 6 18"');
  });
});
