import { env } from 'cloudflare:workers';
import { acknowledgePrintJob, parseAcknowledgement, parseJobId } from '../../../../../db/print-jobs';
import { printJobErrorResponse, printJobJson, readPrintJobJson } from '../../../../../lib/print-job-response';

export const prerender = false;

export async function POST({ params, request }: { params: Record<string, string | undefined>; request: Request }) {
  try {
    const jobId = parseJobId(params.jobId);
    const acknowledgement = parseAcknowledgement(await readPrintJobJson(request, 'status'));
    return printJobJson({ job: await acknowledgePrintJob(env.DB, jobId, acknowledgement) });
  } catch (error) {
    return printJobErrorResponse(error);
  }
}
