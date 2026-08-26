import { describe, expect, it } from 'vitest';
import {
  ADMIN_PAGE_SIZE,
  AdminFilterValidationError,
  normalizeAdminFilters,
} from '../src/lib/admin-filters';

describe('normalizeAdminFilters', () => {
  it('returns the default all-session filter contract', () => {
    expect(normalizeAdminFilters(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: ADMIN_PAGE_SIZE,
    });
    expect(ADMIN_PAGE_SIZE).toBeLessThanOrEqual(30);
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
      pageSize: ADMIN_PAGE_SIZE,
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
