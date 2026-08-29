import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { ADMIN_NAV_ITEMS, getAdminEmail, isAdminNavItemActive } from '../src/lib/admin-layout';

describe('admin layout', () => {
  it('provides the shared admin navigation links', () => {
    expect(ADMIN_NAV_ITEMS).toEqual([
      { label: 'Dashboard', href: '/admin' },
      { label: 'Events', href: '/admin/events' },
    ]);
  });

  it('reads the verified admin identity from the internal request header', () => {
    const request = new Request('https://booth.example.com/admin', {
      headers: { 'x-booth-admin-email': 'admin@example.com' },
    });

    expect(getAdminEmail(request)).toBe('admin@example.com');
  });

  it('marks only the matching navigation section active', () => {
    expect(isAdminNavItemActive('/admin', '/admin')).toBe(true);
    expect(isAdminNavItemActive('/admin/events/summer-party', '/admin/events')).toBe(true);
    expect(isAdminNavItemActive('/admin/events', '/admin')).toBe(false);
  });

  it('keeps the mobile menu keyboard-contained, scrollable, and scroll-locked', async () => {
    const source = await readFile(new URL('../src/components/admin/AdminNavbar.astro', import.meta.url), 'utf8');
    expect(source).toContain('max-[800px]:overflow-y-auto');
    expect(source).toContain("document.body.style.overflow = 'hidden'");
    expect(source).toContain("event.key === 'Tab' && open");
    expect(source).toContain("event.key === 'Escape' && open");
    expect(source).toContain('inline-flex min-h-11 items-center font-display');
  });

  it('pushes page header actions to the right from the root layout', async () => {
    const source = await readFile(new URL('../src/components/admin/PageHeader.astro', import.meta.url), 'utf8');

    expect(source).toContain('<header class="flex flex-wrap items-end justify-between');
    expect(source).toContain('ml-auto flex');
  });
});
