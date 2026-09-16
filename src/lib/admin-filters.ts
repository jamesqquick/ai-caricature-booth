import { SESSION_STATUSES, type SessionStatus } from '../db/sessions';

export const ADMIN_DASHBOARD_PAGE_SIZE = 10 as const;
export const ADMIN_SESSION_PAGE_SIZE = 30 as const;
export type AdminPageSize = typeof ADMIN_DASHBOARD_PAGE_SIZE | typeof ADMIN_SESSION_PAGE_SIZE;
export const ADMIN_TIME_RANGES = ['24h', '7d', '30d', 'all'] as const;
export type AdminTimeRange = (typeof ADMIN_TIME_RANGES)[number];

export type AdminFilters = {
  eventId?: number;
  status?: SessionStatus;
  from?: number;
  to?: number;
  range?: AdminTimeRange;
  page: number;
  pageSize: AdminPageSize;
};

export class AdminFilterValidationError extends Error {
  constructor(
    public readonly field: 'eventId' | 'status' | 'from' | 'to' | 'range' | 'page' | 'pageSize',
    message: string,
  ) {
    super(message);
    this.name = 'AdminFilterValidationError';
  }
}

type AdminFilterInput = URLSearchParams | Record<string, string | null | undefined>;
type NormalizeAdminFilterOptions = {
  pageSize?: AdminPageSize;
  paginate?: boolean;
};

function getFilterValue(input: AdminFilterInput, field: string) {
  const value = input instanceof URLSearchParams ? input.get(field) : input[field];
  return value?.trim() || undefined;
}

function parsePositiveInteger(value: string, field: 'eventId' | 'page') {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new AdminFilterValidationError(field, `${field} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new AdminFilterValidationError(field, `${field} must be a positive integer.`);
  }
  return parsed;
}

export function parseAdminPageSize(value: string): AdminPageSize {
  if (value !== String(ADMIN_DASHBOARD_PAGE_SIZE) && value !== String(ADMIN_SESSION_PAGE_SIZE)) {
    throw new AdminFilterValidationError('pageSize', 'pageSize must be 10 or 30.');
  }

  return Number(value) as AdminPageSize;
}

export function adminSessionsPublicSearchParams(filters: AdminFilters, includePage = true) {
  const params = new URLSearchParams();
  if (filters.eventId !== undefined) params.set('eventId', String(filters.eventId));
  if (filters.status !== undefined) params.set('status', filters.status);
  if (filters.from !== undefined) params.set('from', new Date(filters.from * 1000).toISOString());
  if (filters.to !== undefined) params.set('to', new Date(filters.to * 1000).toISOString());
  if (includePage && filters.page > 1) params.set('page', String(filters.page));
  return params;
}

export function canonicalAdminSessionsFilterUrl(params: URLSearchParams, filters: AdminFilters) {
  if (!params.has('pageSize')) return null;

  const query = adminSessionsPublicSearchParams(filters).toString();
  return query ? `/admin/sessions?${query}` : '/admin/sessions';
}

export function canonicalAdminSessionsPageUrl(
  params: URLSearchParams,
  requestedPage: number,
  totalPages: number,
) {
  const lastValidPage = Math.max(totalPages, 1);
  if (requestedPage <= lastValidPage) return null;

  const canonicalParams = new URLSearchParams(params);
  canonicalParams.delete('pageSize');
  if (lastValidPage === 1) canonicalParams.delete('page');
  else canonicalParams.set('page', String(lastValidPage));

  const query = canonicalParams.toString();
  return query ? `/admin/sessions?${query}` : '/admin/sessions';
}

function parseDate(value: string, field: 'from' | 'to') {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const timestamp = dateOnly ? `${value}T${field === 'to' ? '23:59:59' : '00:00:00'}Z` : value;
  const parts = timestamp.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  const parsed = Date.parse(timestamp);
  const year = Number(parts?.[1]);
  const month = Number(parts?.[2]);
  const day = Number(parts?.[3]);
  const hour = Number(parts?.[4]);
  const minute = Number(parts?.[5]);
  const second = Number(parts?.[6] ?? 0);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;

  if (
    parts === null
    || Number.isNaN(parsed)
    || day < 1
    || day > daysInMonth
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    throw new AdminFilterValidationError(field, `${field} must be a valid ISO date.`);
  }

  return parsed / 1000;
}

export function normalizeAdminFilters(
  input: AdminFilterInput,
  now = Date.now(),
  { pageSize = ADMIN_SESSION_PAGE_SIZE, paginate = true }: NormalizeAdminFilterOptions = {},
): AdminFilters {
  const eventIdValue = getFilterValue(input, 'eventId');
  const statusValue = getFilterValue(input, 'status');
  const fromValue = getFilterValue(input, 'from');
  const toValue = getFilterValue(input, 'to');
  const rangeValue = getFilterValue(input, 'range');
  const pageValue = getFilterValue(input, 'page');

  const eventId = eventIdValue === undefined ? undefined : parsePositiveInteger(eventIdValue, 'eventId');
  if (statusValue !== undefined && !SESSION_STATUSES.some((status) => status === statusValue)) {
    throw new AdminFilterValidationError('status', 'status must be a valid session status.');
  }
  const status = statusValue as SessionStatus | undefined;
  const from = fromValue === undefined ? undefined : parseDate(fromValue, 'from');
  const to = toValue === undefined ? undefined : parseDate(toValue, 'to');
  if (rangeValue !== undefined && !ADMIN_TIME_RANGES.some((range) => range === rangeValue)) {
    throw new AdminFilterValidationError('range', 'range must be 24h, 7d, 30d, or all.');
  }
  const range = rangeValue as AdminTimeRange | undefined;
  const rangeStart = range && range !== 'all'
    ? Math.floor((now - Number(range.slice(0, -1)) * (range.endsWith('h') ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000)) / 1000)
    : undefined;
  const page = !paginate || pageValue === undefined ? 1 : parsePositiveInteger(pageValue, 'page');

  if (from !== undefined && to !== undefined && from > to) {
    throw new AdminFilterValidationError('from', 'from must be earlier than or equal to to.');
  }

  return {
    ...(eventId === undefined ? {} : { eventId }),
    ...(status === undefined ? {} : { status }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(range === undefined ? {} : { range }),
    ...(from !== undefined || to !== undefined || rangeStart === undefined
      ? {}
      : { from: rangeStart, to: Math.floor(now / 1000) }),
    page,
    pageSize,
  };
}
