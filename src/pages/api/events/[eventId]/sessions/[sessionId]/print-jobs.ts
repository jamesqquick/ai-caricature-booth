import { env } from 'cloudflare:workers';
import { createAttendeePrintJob, parseEventId, parseSessionId } from '../../../../../../db/print-jobs';
import { printJobErrorResponse, printJobJson } from '../../../../../../lib/print-job-response';

export const prerender = false;

export async function POST({ params }: { params: Record<string, string | undefined> }) {
  try {
    const eventId = parseEventId(params.eventId);
    const sessionId = parseSessionId(params.sessionId);
    return printJobJson({ job: await createAttendeePrintJob(env.DB, eventId, sessionId) });
  } catch (error) {
    return printJobErrorResponse(error);
  }
}
