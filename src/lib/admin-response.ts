import { AdminFilterValidationError } from './admin-filters';

type AdminErrorResponse = {
  error: string;
  field?: AdminFilterValidationError['field'];
};

export function adminJsonResponse<T>(body: T, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function adminErrorResponse(error: unknown) {
  if (error instanceof AdminFilterValidationError) {
    const body: AdminErrorResponse = { error: error.message, field: error.field };
    return adminJsonResponse(body, 400);
  }

  console.error('Admin API request failed', error);
  return adminJsonResponse({ error: "Couldn't load admin data." }, 500);
}
