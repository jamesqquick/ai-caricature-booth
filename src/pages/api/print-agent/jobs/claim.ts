import { env } from 'cloudflare:workers';
import { claimPrintJobs, parseClaimInput } from '../../../../db/print-jobs';
import { printJobErrorResponse, printJobJson, readPrintJobJson } from '../../../../lib/print-job-response';

export const prerender = false;

export async function POST({ request }: { request: Request }) {
  try {
    const input = parseClaimInput(await readPrintJobJson(request, 'eventSlug'));
    return printJobJson({ jobs: await claimPrintJobs(env.DB, input.eventSlug, input.agentId, input.limit) });
  } catch (error) {
    return printJobErrorResponse(error);
  }
}
