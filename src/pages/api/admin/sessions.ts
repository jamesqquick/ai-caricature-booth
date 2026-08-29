import { env } from 'cloudflare:workers';
import { loadAdminSessions } from '../../../db/admin';
import { adminErrorResponse, adminJsonResponse } from '../../../lib/admin-response';
import { normalizeAdminFilters } from '../../../lib/admin-filters';
import { toAdminSessionListResult } from '../../../lib/admin-session-list';

export const prerender = false;

export async function GET({ url }: { url: URL }) {
  try {
    const filters = normalizeAdminFilters(url.searchParams);
    const sessions = await loadAdminSessions(env.DB, filters);
    return adminJsonResponse(toAdminSessionListResult(sessions));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
