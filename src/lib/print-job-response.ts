import { PrintJobConflictError, PrintJobNotFoundError, PrintJobValidationError, type PrintJobField } from '../db/print-jobs';

export async function readPrintJobJson(request: Request, field: PrintJobField) {
  try {
    return await request.json() as unknown;
  } catch {
    throw new PrintJobValidationError(field, 'Request body must be valid JSON.');
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
  if (error instanceof PrintJobConflictError) return printJobJson({ error: error.message }, 409);
  console.error('Print job API request failed', error);
  return printJobJson({ error: "Couldn't process the print job request." }, 500);
}
