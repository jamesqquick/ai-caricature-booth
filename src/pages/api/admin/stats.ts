import { env } from 'cloudflare:workers';
import { loadAdminSessionStats } from '../../../db/admin';
import { adminErrorResponse, adminJsonResponse } from '../../../lib/admin-response';
import { normalizeAdminFilters } from '../../../lib/admin-filters';

export const prerender = false;

export async function GET({ url }: { url: URL }) {
  try {
    const filters = normalizeAdminFilters(url.searchParams);
    const stats = await loadAdminSessionStats(env.DB, filters);
    return adminJsonResponse(stats);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
