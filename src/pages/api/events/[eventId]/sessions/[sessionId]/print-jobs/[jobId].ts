import { env } from 'cloudflare:workers';
import { loadAttendeePrintJob, parseEventId, parseJobId, parseSessionId } from '../../../../../../../db/print-jobs';
import { printJobErrorResponse, printJobJson } from '../../../../../../../lib/print-job-response';

export const prerender = false;

export async function GET({ params }: { params: Record<string, string | undefined> }) {
  try {
    const eventId = parseEventId(params.eventId);
    const sessionId = parseSessionId(params.sessionId);
    const jobId = parseJobId(params.jobId);
    const job = await loadAttendeePrintJob(env.DB, eventId, sessionId, jobId);
    return printJobJson({ job: { status: job.status, printedAt: job.printedAt } });
  } catch (error) {
    return printJobErrorResponse(error);
  }
}
