import { env } from 'cloudflare:workers';
import { parseReconciliationInput, reconcilePrintJobs } from '../../../../db/print-jobs';
import { printJobErrorResponse, printJobJson, readPrintJobJson } from '../../../../lib/print-job-response';

export const prerender = false;

export async function POST({ request }: { request: Request }) {
  try {
    const input = parseReconciliationInput(await readPrintJobJson(request, 'agentId'));
    return printJobJson(await reconcilePrintJobs(env.DB, input.agentId, input.knownClaims));
  } catch (error) {
    return printJobErrorResponse(error);
  }
}
