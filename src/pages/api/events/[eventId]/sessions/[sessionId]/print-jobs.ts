import { env } from 'cloudflare:workers';
import { createAttendeePrintJob, parseAttendeeMutation, parseEventId, PrintJobForbiddenError, parseSessionId } from '../../../../../../db/print-jobs';
import { printJobErrorResponse, printJobJson, readPrintJobJson } from '../../../../../../lib/print-job-response';

export const prerender = false;

export async function POST({ params, request }: { params: Record<string, string | undefined>; request: Request }) {
  try {
    assertSameOriginBrowserRequest(request);
    const eventId = parseEventId(params.eventId);
    const sessionId = parseSessionId(params.sessionId);
    const { idempotencyKey } = parseAttendeeMutation(await readPrintJobJson(request, 'idempotencyKey'));
    return printJobJson({ job: await createAttendeePrintJob(env.DB, eventId, sessionId, idempotencyKey) });
  } catch (error) {
    return printJobErrorResponse(error);
  }
}

function assertSameOriginBrowserRequest(request: Request) {
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  // Headerless clients are allowed; supplied browser metadata must prove the request is not cross-origin.
  if ((origin && origin !== new URL(request.url).origin) || fetchSite === 'cross-site') {
    throw new PrintJobForbiddenError('Cross-origin print requests are not allowed.');
  }
}
