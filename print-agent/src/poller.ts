import { abortableSleep } from "./job-handler.js";
import { MemoryAckOutbox, type AckOutbox, type TerminalAckIntent } from "./outbox.js";
import { QueueRequestError } from "./queue.js";
import type { AgentConfig, Logger, PrintJob, PrintStatus, Sleep } from "./types.js";

const OFFLINE_WARNING_THRESHOLD = 3;

type PollerDependencies = {
  claimJobs: () => Promise<PrintJob[]>;
  handleJob: (job: PrintJob) => Promise<void>;
  ackJob: (job: PrintJob, status: PrintStatus, error?: string) => Promise<unknown>;
  releaseJob: (job: PrintJob) => Promise<unknown>;
  outbox?: AckOutbox;
  sleep?: Sleep;
  logger?: Logger;
  printedAckAttempts?: number;
};

export class FatalPrintStateError extends Error {
  readonly name = "FatalPrintStateError";

  constructor(public readonly jobId: string, options?: ErrorOptions) {
    super(`Cannot safely continue after processing print job ${jobId}: terminal acknowledgement could not be persisted; current claim retained and operator intervention required.`, options);
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

    for (let index = 0; index < jobs.length; index += 1) {
      if (signal?.aborted) {
        await this.releaseRemaining(jobs.slice(index));
        return;
      }
      try {
        await this.processJob(jobs[index]!);
      } catch (error) {
        if (error instanceof FatalPrintStateError) {
          await this.releaseRemaining(jobs.slice(index + 1), "fatal cleanup");
        }
        throw error;
      }
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.pollOnce(signal);
      if (signal.aborted) break;
      await this.sleep(this.config.pollIntervalMs, signal);
    }
  }

  private async processJob(job: PrintJob): Promise<void> {
    let intent: TerminalAckIntent;
    try {
      await this.dependencies.handleJob(job);
      intent = { job, status: "printed" };
    } catch (error) {
      const message = errorMessage(error).slice(0, 500);
      this.logger.error(`[job ${job.id}] processing failed: ${message.replaceAll(job.claimToken, "[redacted]")}`);
      intent = { job, status: "failed", error: message };
    }

    try {
      await this.outbox.put(intent);
    } catch (error) {
      const fatalError = new FatalPrintStateError(job.id, { cause: error });
      this.logger.error(`[job ${job.id}] ${fatalError.message} Cause: ${safeJobError(error, job)}`);
      throw fatalError;
    }
    await this.flushIntent(intent, intent.status === "printed" ? this.printedAckAttempts : 1);
  }

  private async flushOutbox(): Promise<boolean> {
    let intents: TerminalAckIntent[];
    try {
      intents = await this.outbox.list();
    } catch (error) {
      this.logger.error(`[outbox] could not load pending acknowledgements; skipping claim: ${errorMessage(error)}`);
      return false;
    }
    for (const intent of intents) {
      await this.flushIntent(intent, intent.status === "printed" ? this.printedAckAttempts : 1);
    }
    try {
      return (await this.outbox.list()).length === 0;
    } catch (error) {
      this.logger.error(`[outbox] could not verify pending acknowledgements; skipping claim: ${errorMessage(error)}`);
      return false;
    }
  }

  private async flushIntent(intent: TerminalAckIntent, attempts: number): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.dependencies.ackJob(intent.job, intent.status, intent.error);
      } catch (error) {
        if (error instanceof QueueRequestError && error.status === 409) {
          this.logger.warn(`[job ${intent.job.id}] dropping stale terminal acknowledgement after claim conflict.`);
          await this.removeIntent(intent.job);
          return;
        }
        lastError = error;
        if (attempt < attempts) await this.sleep(250 * 2 ** (attempt - 1));
        continue;
      }
      await this.removeIntent(intent.job);
      this.logger.info(`[job ${intent.job.id}] ${intent.status} and acknowledged.`);
      return;
    }
    this.logger.error(`[job ${intent.job.id}] ${intent.status} acknowledgement failed after ${attempts} attempt${attempts === 1 ? "" : "s"}; retained for retry: ${safeJobError(lastError, intent.job)}`);
  }

  private async removeIntent(job: PrintJob): Promise<void> {
    try {
      await this.outbox.remove(job.id);
    } catch (error) {
      this.logger.error(`[job ${job.id}] acknowledged but could not be removed from the outbox: ${safeJobError(error, job)}`);
    }
  }

  private async releaseRemaining(jobs: PrintJob[], reason = "shutdown"): Promise<void> {
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
  return errorMessage(error).replaceAll(job.claimToken, "[redacted]");
}
