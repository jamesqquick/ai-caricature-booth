import { env } from 'cloudflare:workers';
import { createAttendeePrintJob, parseAttendeeMutation, parseEventId, parseSessionId, PrintJobForbiddenError } from '../../../../../../db/print-jobs';
import { verifyPrintCapability } from '../../../../../../lib/print-capability';
import { assertPrintJobMutationRequest, printJobErrorResponse, printJobJson, readBoundedPrintJobJson } from '../../../../../../lib/print-job-response';

export const prerender = false;

export async function POST({ params, request }: { params: Record<string, string | undefined>; request: Request }) {
  try {
    assertPrintJobMutationRequest(request, 'idempotencyKey');
    const eventId = parseEventId(params.eventId);
    const sessionId = parseSessionId(params.sessionId);
    const { idempotencyKey, printToken } = parseAttendeeMutation(await readBoundedPrintJobJson(request, 'idempotencyKey', 2_048));
    try {
      await verifyPrintCapability(env.PRINT_CAPABILITY_SECRET, printToken, { sessionId, eventId });
    } catch {
      throw new PrintJobForbiddenError('This postcard does not have permission to print.');
    }
    return printJobJson({ job: await createAttendeePrintJob(env.DB, eventId, sessionId, idempotencyKey) });
  } catch (error) {
    return printJobErrorResponse(error);
  }
}
