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
});
