import { env } from 'cloudflare:workers';
import { loadAdminSessions } from '../../../db/admin';
import { adminErrorResponse, adminJsonResponse } from '../../../lib/admin-response';
import { ADMIN_SESSION_PAGE_SIZE, normalizeAdminFilters, parseAdminPageSize } from '../../../lib/admin-filters';
import { toAdminSessionListResult } from '../../../lib/admin-session-list';

export const prerender = false;

export async function GET({ url }: { url: URL }) {
  try {
    const pageSizeValue = url.searchParams.get('pageSize');
    const pageSize = pageSizeValue === null ? ADMIN_SESSION_PAGE_SIZE : parseAdminPageSize(pageSizeValue);
    const filters = normalizeAdminFilters(url.searchParams, undefined, { pageSize });
    const sessions = await loadAdminSessions(env.DB, filters);
    return adminJsonResponse(toAdminSessionListResult(sessions));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
