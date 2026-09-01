import { env } from 'cloudflare:workers';
import { loadAdminPrintJobs, parseAdminMutation, parseSessionId, queueAdminPrintJob, resolveOrphanedPrintJob, retryAdminPrintJob } from '../../../../../db/print-jobs';
import { assertPrintJobMutationRequest, printJobErrorResponse, printJobJson, readPrintJobJson } from '../../../../../lib/print-job-response';

export const prerender = false;

export async function GET({ params }: { params: Record<string, string | undefined> }) {
  try {
    const sessionId = parseSessionId(params.sessionId);
    return printJobJson({ jobs: await loadAdminPrintJobs(env.DB, sessionId) });
  } catch (error) {
    return printJobErrorResponse(error);
  }
}

export async function POST({ params, request }: { params: Record<string, string | undefined>; request: Request }) {
  try {
    assertPrintJobMutationRequest(request, 'action');
    const sessionId = parseSessionId(params.sessionId);
    const mutation = parseAdminMutation(await readPrintJobJson(request, 'action'));
    const job = mutation.action === 'queue'
      ? await queueAdminPrintJob(env.DB, sessionId, mutation.idempotencyKey)
      : mutation.action === 'retry'
        ? await retryAdminPrintJob(env.DB, sessionId, mutation.jobId, mutation.idempotencyKey)
        : await resolveOrphanedPrintJob(env.DB, sessionId, mutation.jobId, mutation.outcome);
    return printJobJson({ job });
  } catch (error) {
    return printJobErrorResponse(error);
  }
}
