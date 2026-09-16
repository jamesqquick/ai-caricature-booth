import { describe, expect, it } from 'vitest';
import {
  ADMIN_DASHBOARD_PAGE_SIZE,
  ADMIN_SESSION_PAGE_SIZE,
  AdminFilterValidationError,
  adminSessionsPublicSearchParams,
  canonicalAdminSessionsFilterUrl,
  canonicalAdminSessionsPageUrl,
  normalizeAdminFilters,
} from '../src/lib/admin-filters';

describe('normalizeAdminFilters', () => {
  it('returns the default all-session filter contract', () => {
    expect(normalizeAdminFilters(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: ADMIN_SESSION_PAGE_SIZE,
    });
    expect(ADMIN_SESSION_PAGE_SIZE).toBe(30);
  });

  it('allows trusted callers to select the dashboard page size', () => {
    expect(normalizeAdminFilters(
      new URLSearchParams({ page: '2', pageSize: '30' }),
      undefined,
      { pageSize: ADMIN_DASHBOARD_PAGE_SIZE, paginate: false },
    )).toEqual({
      page: 1,
      pageSize: 10,
    });
  });

  it('normalizes supported filters', () => {
    const filters = normalizeAdminFilters(new URLSearchParams({
      eventId: '42',
      status: 'completed',
      from: '2026-08-01',
      to: '2026-08-21T18:30:00Z',
      page: '3',
    }));

    expect(filters).toEqual({
      eventId: 42,
      status: 'completed',
      from: Date.parse('2026-08-01T00:00:00Z') / 1000,
      to: Date.parse('2026-08-21T18:30:00Z') / 1000,
      page: 3,
      pageSize: ADMIN_SESSION_PAGE_SIZE,
    });
  });

  it('normalizes a date-only upper bound to the final UTC second of that day', () => {
    const filters = normalizeAdminFilters(new URLSearchParams({ to: '2026-08-21' }));

    expect(filters.to).toBe(Date.parse('2026-08-21T23:59:59Z') / 1000);
  });

  it('preserves an explicit timestamp upper bound exactly', () => {
    const filters = normalizeAdminFilters(new URLSearchParams({ to: '2026-08-21T18:30:00Z' }));

    expect(filters.to).toBe(Date.parse('2026-08-21T18:30:00Z') / 1000);
  });

  it.each([
    ['eventId', 'abc'],
    ['eventId', '0'],
    ['eventId', '1.5'],
    ['status', 'finished'],
    ['from', 'not-a-date'],
    ['from', '2026-02-30'],
    ['to', '2026-02-30T12:00:00Z'],
    ['to', 'tomorrow'],
    ['page', '0'],
    ['page', '-1'],
    ['page', '1.5'],
  ])('rejects invalid %s values', (field, value) => {
    expect(() => normalizeAdminFilters(new URLSearchParams({ [field]: value }))).toThrow(
      expect.objectContaining({
        name: 'AdminFilterValidationError',
        field,
      }),
    );
  });

  it('rejects an inverted date range', () => {
    try {
      normalizeAdminFilters(new URLSearchParams({
        from: '2026-08-22',
        to: '2026-08-21',
      }));
      expect.fail('Expected date range validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminFilterValidationError);
      expect(error).toMatchObject({ field: 'from' });
    }
  });
});

describe('canonicalAdminSessionsPageUrl', () => {
  it('redirects to the last valid page while preserving filters and excluding pageSize', () => {
    const params = new URLSearchParams({
      eventId: '7',
      from: '2026-09-01',
      to: '2026-09-16',
      status: 'completed',
      page: '9',
      pageSize: '30',
    });

    expect(canonicalAdminSessionsPageUrl(params, 9, 3)).toBe(
      '/admin/sessions?eventId=7&from=2026-09-01&to=2026-09-16&status=completed&page=3',
    );
  });

  it('uses page one for an empty result and skips valid pages', () => {
    expect(canonicalAdminSessionsPageUrl(new URLSearchParams({ status: 'completed', page: '4' }), 4, 0))
      .toBe('/admin/sessions?status=completed');
    expect(canonicalAdminSessionsPageUrl(new URLSearchParams({ page: '2' }), 2, 3)).toBeNull();
  });
});

describe('admin sessions public URLs', () => {
  it('serializes active public filters and pages without pageSize or empty defaults', () => {
    const params = adminSessionsPublicSearchParams({
      eventId: 7,
      status: 'completed',
      from: Date.parse('2026-09-01T00:00:00.000Z') / 1000,
      to: Date.parse('2026-09-16T23:59:59.000Z') / 1000,
      page: 2,
      pageSize: ADMIN_SESSION_PAGE_SIZE,
    });

    expect(params.toString()).toBe(
      'eventId=7&status=completed&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-16T23%3A59%3A59.000Z&page=2',
    );
    expect(params.has('pageSize')).toBe(false);
    expect(adminSessionsPublicSearchParams({ page: 1, pageSize: ADMIN_SESSION_PAGE_SIZE }).toString()).toBe('');
  });

  it('canonicalizes any incoming pageSize from normalized 30-row session filters', () => {
    const params = new URLSearchParams({
      eventId: '7',
      status: 'completed',
      from: '2026-09-01',
      to: '2026-09-16',
      page: '2',
      pageSize: '10',
    });
    const filters = normalizeAdminFilters(params, undefined, { pageSize: ADMIN_SESSION_PAGE_SIZE });

    expect(filters.pageSize).toBe(30);
    expect(canonicalAdminSessionsFilterUrl(params, filters)).toBe(
      '/admin/sessions?eventId=7&status=completed&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-16T23%3A59%3A59.000Z&page=2',
    );
    expect(canonicalAdminSessionsFilterUrl(new URLSearchParams({ page: '2' }), filters)).toBeNull();
  });
});
