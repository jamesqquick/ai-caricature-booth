import { abortableSleep } from "./job-handler.js";
import { MemoryAckOutbox, type AckOutbox, type PendingPrintState, type TerminalAckIntent } from "./outbox.js";
import { PrintOutcomeUncertainError } from "./printer.js";
import { QueueRequestError } from "./queue.js";
import type { AgentConfig, Logger, PrintJob, PrintStatus, Sleep } from "./types.js";

const OFFLINE_WARNING_THRESHOLD = 3;

type PollerDependencies = {
  claimJobs: () => Promise<PrintJob[]>;
  handleJob: (job: PrintJob, beforeSubmit: () => Promise<void>) => Promise<void>;
  ackJob: (job: PrintJob, status: PrintStatus, error?: string) => Promise<unknown>;
  releaseJob: (job: PrintJob) => Promise<unknown>;
  outbox?: AckOutbox;
  sleep?: Sleep;
  logger?: Logger;
  printedAckAttempts?: number;
};

export class FatalPrintStateError extends Error {
  readonly name = "FatalPrintStateError";

  constructor(public readonly jobId: string | undefined, message: string, options?: ErrorOptions) {
    super(`${jobId ? `Print job ${jobId}` : "Print agent"}: ${message} Current claim and local state were retained; operator intervention required.`, options);
  }
}

export class PrintPoller {
  private consecutivePollFailures = 0;
  private readonly sleep: Sleep;
  private readonly logger: Logger;
  private readonly printedAckAttempts: number;
  private readonly outbox: AckOutbox;

  constructor(private readonly config: AgentConfig, private readonly dependencies: PollerDependencies) {
    this.sleep = dependencies.sleep ?? abortableSleep;
    this.logger = dependencies.logger ?? console;
    this.printedAckAttempts = dependencies.printedAckAttempts ?? 3;
    this.outbox = dependencies.outbox ?? new MemoryAckOutbox();
  }

  async pollOnce(signal?: AbortSignal): Promise<void> {
    if (!await this.flushOutbox()) return;
    for (let claimedCount = 0; claimedCount < this.config.batchSize; claimedCount += 1) {
      if (signal?.aborted) return;
      let jobs: PrintJob[];
      try {
        jobs = await this.dependencies.claimJobs();
      } catch (error) {
        this.consecutivePollFailures += 1;
        if (this.consecutivePollFailures === OFFLINE_WARNING_THRESHOLD) {
          this.logger.error(`[poll] OFFLINE after ${OFFLINE_WARNING_THRESHOLD} consecutive failed polls; check network connectivity.`);
        }
        this.logger.error(`[poll] claim failed (#${this.consecutivePollFailures}): ${errorMessage(error)}`);
        return;
      }

      if (this.consecutivePollFailures >= OFFLINE_WARNING_THRESHOLD) {
        this.logger.info(`[poll] recovered after ${this.consecutivePollFailures} failed polls.`);
      }
      this.consecutivePollFailures = 0;

      if (jobs.length === 0) return;
      if (jobs.length !== 1) {
        await this.releaseJobs(jobs, "invalid multi-job claim");
        throw new FatalPrintStateError(jobs[0]!.id, `Worker returned ${jobs.length} jobs for a single-job claim.`);
      }
      const job = jobs[0]!;
      if (signal?.aborted) {
        await this.releaseJobs([job], "shutdown");
        return;
      }
      if (!await this.processJob(job)) return;
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.pollOnce(signal);
      if (signal.aborted) break;
      await this.sleep(this.config.pollIntervalMs, signal);
    }
  }

  private async processJob(job: PrintJob): Promise<boolean> {
    let intent: TerminalAckIntent;
    let submissionMarked = false;
    try {
      await this.dependencies.handleJob(job, async () => {
        await this.outbox.put({ job, status: "submitting" });
        submissionMarked = true;
      });
      intent = { job, status: "printed" };
    } catch (error) {
      if (submissionMarked && hasUncertainPrintOutcome(error)) {
        const fatalError = new FatalPrintStateError(job.id, "Printer submission failed after invocation, so CUPS acceptance cannot be determined.", { cause: error });
        this.logger.error(`[job ${job.id}] ${fatalError.message} Cause: ${safeJobError(error, job)}`);
        throw fatalError;
      }
      const message = sanitizeJobText(errorMessage(error), job).slice(0, 500);
      this.logger.error(`[job ${job.id}] processing failed: ${message}`);
      intent = { job, status: "failed", error: message };
    }

    try {
      await this.outbox.put(intent);
    } catch (error) {
      const fatalError = new FatalPrintStateError(job.id, "Terminal acknowledgement could not be persisted after processing.", { cause: error });
      this.logger.error(`[job ${job.id}] ${fatalError.message} Cause: ${safeJobError(error, job)}`);
      throw fatalError;
    }
    return this.flushIntent(intent, intent.status === "printed" ? this.printedAckAttempts : 1);
  }

  private async flushOutbox(): Promise<boolean> {
    let intents: PendingPrintState[];
    try {
      intents = await this.outbox.list();
    } catch (error) {
      throw new FatalPrintStateError(undefined, `Durable print state could not be loaded safely: ${errorMessage(error)}.`, { cause: error });
    }
    for (const intent of intents) {
      if (intent.status === "submitting") {
        throw new FatalPrintStateError(intent.job.id, "An unresolved pre-submission marker makes the prior printer outcome uncertain.");
      }
      if (!await this.flushIntent(intent, intent.status === "printed" ? this.printedAckAttempts : 1)) return false;
    }
    try {
      return (await this.outbox.list()).length === 0;
    } catch (error) {
      throw new FatalPrintStateError(undefined, `Durable print state could not be verified safely: ${errorMessage(error)}.`, { cause: error });
    }
  }

  private async flushIntent(intent: TerminalAckIntent, attempts: number): Promise<boolean> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.dependencies.ackJob(intent.job, intent.status, intent.error);
      } catch (error) {
        if (error instanceof QueueRequestError && error.status === 409) {
          if (intent.status === "printed") {
            throw new FatalPrintStateError(intent.job.id, "Worker rejected a printed acknowledgement as stale; automatic retry could duplicate a physical print.", { cause: error });
          }
          this.logger.warn(`[job ${intent.job.id}] dropping stale terminal acknowledgement after claim conflict.`);
          return this.removeIntent(intent.job);
        }
        lastError = error;
        if (attempt < attempts) await this.sleep(250 * 2 ** (attempt - 1));
        continue;
      }
      const removed = await this.removeIntent(intent.job);
      if (removed) this.logger.info(`[job ${intent.job.id}] ${intent.status} and acknowledged.`);
      return removed;
    }
    this.logger.error(`[job ${intent.job.id}] ${intent.status} acknowledgement failed after ${attempts} attempt${attempts === 1 ? "" : "s"}; retained for retry: ${safeJobError(lastError, intent.job)}`);
    return false;
  }

  private async removeIntent(job: PrintJob): Promise<boolean> {
    try {
      await this.outbox.remove(job.id);
      return true;
    } catch (error) {
      this.logger.error(`[job ${job.id}] acknowledged but could not be removed from the outbox: ${safeJobError(error, job)}`);
      return false;
    }
  }

  private async releaseJobs(jobs: PrintJob[], reason: string): Promise<void> {
    for (const job of jobs) {
      try {
        await this.dependencies.releaseJob(job);
      } catch (error) {
        this.logger.error(`[job ${job.id}] ${reason} release failed: ${safeJobError(error, job)}`);
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeJobError(error: unknown, job: PrintJob): string {
  return sanitizeJobText(errorMessage(error), job);
}

function sanitizeJobText(value: string, job: PrintJob): string {
  return value.replaceAll(job.claimToken, "[redacted]");
}

function hasUncertainPrintOutcome(error: unknown): boolean {
  if (error instanceof PrintOutcomeUncertainError) return true;
  return error instanceof Error && error.cause !== undefined && hasUncertainPrintOutcome(error.cause);
}
