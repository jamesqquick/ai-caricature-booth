import { PrintJobConflictError, PrintJobForbiddenError, PrintJobNotFoundError, PrintJobValidationError, type PrintJobField } from '../db/print-jobs';

export async function readPrintJobJson(request: Request, field: PrintJobField) {
  try {
    return await request.json() as unknown;
  } catch {
    throw new PrintJobValidationError(field, 'Request body must be valid JSON.');
  }
}

export function assertPrintJobMutationRequest(request: Request, field: PrintJobField) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new PrintJobValidationError(field, 'Content-Type must be application/json.');
  }
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  // Headerless non-browser clients are allowed; supplied browser metadata must be same-origin.
  if ((origin && origin !== new URL(request.url).origin) || fetchSite?.toLowerCase() === 'cross-site') {
    throw new PrintJobForbiddenError('Cross-origin print requests are not allowed.');
  }
}

export function printJobJson<T>(body: T, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function printJobErrorResponse(error: unknown) {
  if (error instanceof PrintJobValidationError) {
    return printJobJson({ error: error.message, field: error.field }, 400);
  }
  if (error instanceof PrintJobNotFoundError) return printJobJson({ error: error.message }, 404);
  if (error instanceof PrintJobForbiddenError) return printJobJson({ error: error.message }, 403);
  if (error instanceof PrintJobConflictError) return printJobJson({ error: error.message }, 409);
  console.error('Print job API request failed', error);
  return printJobJson({ error: "Couldn't process the print job request." }, 500);
}
