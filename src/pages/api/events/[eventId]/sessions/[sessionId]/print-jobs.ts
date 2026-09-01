import { env } from 'cloudflare:workers';
import { createAttendeePrintJob, parseAttendeeMutation, parseEventId, parseSessionId } from '../../../../../../db/print-jobs';
import { assertPrintJobMutationRequest, printJobErrorResponse, printJobJson, readPrintJobJson } from '../../../../../../lib/print-job-response';

export const prerender = false;

export async function POST({ params, request }: { params: Record<string, string | undefined>; request: Request }) {
  try {
    assertPrintJobMutationRequest(request, 'idempotencyKey');
    const eventId = parseEventId(params.eventId);
    const sessionId = parseSessionId(params.sessionId);
    const { idempotencyKey } = parseAttendeeMutation(await readPrintJobJson(request, 'idempotencyKey'));
    return printJobJson({ job: await createAttendeePrintJob(env.DB, eventId, sessionId, idempotencyKey) });
  } catch (error) {
    return printJobErrorResponse(error);
  }
}
