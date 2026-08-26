import { SESSION_STATUSES, type SessionStatus } from '../db/sessions';

export const ADMIN_PAGE_SIZE = 30 as const;

export type AdminFilters = {
  eventId?: number;
  status?: SessionStatus;
  from?: number;
  to?: number;
  page: number;
  pageSize: typeof ADMIN_PAGE_SIZE;
};

export class AdminFilterValidationError extends Error {
  constructor(
    public readonly field: 'eventId' | 'status' | 'from' | 'to' | 'page',
    message: string,
  ) {
    super(message);
    this.name = 'AdminFilterValidationError';
  }
}

type AdminFilterInput = URLSearchParams | Record<string, string | null | undefined>;

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

export function normalizeAdminFilters(input: AdminFilterInput): AdminFilters {
  const eventIdValue = getFilterValue(input, 'eventId');
  const statusValue = getFilterValue(input, 'status');
  const fromValue = getFilterValue(input, 'from');
  const toValue = getFilterValue(input, 'to');
  const pageValue = getFilterValue(input, 'page');

  const eventId = eventIdValue === undefined ? undefined : parsePositiveInteger(eventIdValue, 'eventId');
  if (statusValue !== undefined && !SESSION_STATUSES.some((status) => status === statusValue)) {
    throw new AdminFilterValidationError('status', 'status must be a valid session status.');
  }
  const status = statusValue as SessionStatus | undefined;
  const from = fromValue === undefined ? undefined : parseDate(fromValue, 'from');
  const to = toValue === undefined ? undefined : parseDate(toValue, 'to');
  const page = pageValue === undefined ? 1 : parsePositiveInteger(pageValue, 'page');

  if (from !== undefined && to !== undefined && from > to) {
    throw new AdminFilterValidationError('from', 'from must be earlier than or equal to to.');
  }

  return {
    ...(eventId === undefined ? {} : { eventId }),
    ...(status === undefined ? {} : { status }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    page,
    pageSize: ADMIN_PAGE_SIZE,
  };
}
