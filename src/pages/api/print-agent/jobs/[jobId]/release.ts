import { env } from 'cloudflare:workers';
import { parseJobId, parseRelease, releasePrintJob } from '../../../../../db/print-jobs';
import { printJobErrorResponse, printJobJson, readPrintJobJson } from '../../../../../lib/print-job-response';

export const prerender = false;

export async function POST({ params, request }: { params: Record<string, string | undefined>; request: Request }) {
  try {
    const jobId = parseJobId(params.jobId);
    const { claimToken } = parseRelease(await readPrintJobJson(request, 'claimToken'));
    return printJobJson({ job: await releasePrintJob(env.DB, jobId, claimToken) });
  } catch (error) {
    return printJobErrorResponse(error);
  }
}
