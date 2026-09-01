import { abortableSleep } from "./job-handler.js";
import type { AgentConfig, Logger, PrintJob, PrintStatus, Sleep } from "./types.js";

const OFFLINE_WARNING_THRESHOLD = 3;

type PollerDependencies = {
  claimJobs: () => Promise<PrintJob[]>;
  handleJob: (job: PrintJob) => Promise<void>;
  ackJob: (job: PrintJob, status: PrintStatus, error?: string) => Promise<unknown>;
  sleep?: Sleep;
  logger?: Logger;
  printedAckAttempts?: number;
};

export class PrintPoller {
  private consecutivePollFailures = 0;
  private readonly sleep: Sleep;
  private readonly logger: Logger;
  private readonly printedAckAttempts: number;

  constructor(private readonly config: AgentConfig, private readonly dependencies: PollerDependencies) {
    this.sleep = dependencies.sleep ?? abortableSleep;
    this.logger = dependencies.logger ?? console;
    this.printedAckAttempts = dependencies.printedAckAttempts ?? 3;
  }

  async pollOnce(): Promise<void> {
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

    for (const job of jobs) {
      await this.processJob(job);
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.pollOnce();
      if (signal.aborted) break;
      await this.sleep(this.config.pollIntervalMs, signal);
    }
  }

  private async processJob(job: PrintJob): Promise<void> {
    try {
      await this.dependencies.handleJob(job);
    } catch (error) {
      const message = errorMessage(error).slice(0, 500);
      this.logger.error(`[job ${job.id}] processing failed: ${message}`);
      try {
        await this.dependencies.ackJob(job, "failed", message);
      } catch (ackError) {
        this.logger.error(`[job ${job.id}] failed acknowledgement also failed: ${errorMessage(ackError)}`);
      }
      return;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.printedAckAttempts; attempt += 1) {
      try {
        await this.dependencies.ackJob(job, "printed");
        this.logger.info(`[job ${job.id}] printed and acknowledged.`);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.printedAckAttempts) await this.sleep(250 * 2 ** (attempt - 1));
      }
    }
    this.logger.error(`[job ${job.id}] printed but acknowledgement failed after ${this.printedAckAttempts} attempts; not sending a failed acknowledgement: ${errorMessage(lastError)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
