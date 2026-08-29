import type { AdminSessionSummary } from '../db/admin';

export type AdminSessionListItem = Pick<
  AdminSessionSummary,
  'id' | 'eventName' | 'eventSlug' | 'sceneId' | 'sceneName' | 'status' | 'updatedAt'
>;

type AdminSessionResult = {
  sessions: AdminSessionSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function toAdminSessionListResult(result: AdminSessionResult) {
  return {
    sessions: result.sessions.map((session): AdminSessionListItem => ({
      id: session.id,
      eventName: session.eventName,
      eventSlug: session.eventSlug,
      sceneId: session.sceneId,
      sceneName: session.sceneName,
      status: session.status,
      updatedAt: session.updatedAt,
    })),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    totalPages: result.totalPages,
  };
}
