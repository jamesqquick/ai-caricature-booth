import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { loadOrCreateInstallationId } from "./installation.js";
import { AgentLock } from "./lock.js";
import { FileAckOutbox, type AckOutbox } from "./outbox.js";
import { resolveAgentDirectories } from "./paths.js";
import { QueueRequestError, ackJob as sendAck, releaseJob as sendRelease } from "./queue.js";
import type { AgentConfig, ClaimIdentity, PrintStatus } from "./types.js";

const JOB_ID_PATTERN = /^[0-9a-f]{32}$/i;
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type RecoveryOutcome = "printed" | "not-submitted";

type RecoveryDependencies = {
  ackJob?: (job: ClaimIdentity, status: PrintStatus) => Promise<unknown>;
  releaseJob?: (job: ClaimIdentity) => Promise<unknown>;
  outbox?: AckOutbox;
};

type RecoveryErrorCode = "USAGE" | "MARKER_NOT_FOUND" | "ACK_FAILED" | "RELEASE_FAILED" | "STATE_FAILED";

export const RECOVERY_USAGE = "Usage: pnpm print-agent:resolve -- --job-id <32-character-job-id> --outcome printed|not-submitted --confirm";

export class RecoveryCommandError extends Error {
  readonly name = "RecoveryCommandError";

  constructor(public readonly code: RecoveryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export async function runRecoveryCommand(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  argv: string[],
  dependencies: RecoveryDependencies = {},
): Promise<void> {
  const options = parseRecoveryArguments(argv);
  const config = loadConfig(env, argv);
  const { stateDir } = resolveAgentDirectories(config, packageRoot, homedir());
  const lock = await AgentLock.acquire(stateDir);

  try {
    await loadOrCreateInstallationId(stateDir);
    const outbox = dependencies.outbox ?? new FileAckOutbox(join(stateDir, "pending-acks.json"));
    await resolveMarker(config, outbox, options, dependencies);
  } finally {
    await lock.release();
  }
}

async function resolveMarker(
  config: AgentConfig,
  outbox: AckOutbox,
  options: { jobId: string; outcome: RecoveryOutcome },
  dependencies: RecoveryDependencies,
): Promise<void> {
  const states = await outbox.list();
  const marker = states.find((state) => state.job.id === options.jobId && state.status === "submitting");
  if (!marker) {
    throw new RecoveryCommandError(
      "MARKER_NOT_FOUND",
      `No unresolved submitting marker exists for print job ${options.jobId}. No state was changed.`,
    );
  }

  const secrets = [marker.job.claimToken, config.printAgentToken];
  if (options.outcome === "printed") {
    try {
      await outbox.put({ job: marker.job, status: "printed" });
    } catch (cause) {
      throw safeError("STATE_FAILED", "Could not persist the printed ACK intent. No network request was sent.", cause, secrets);
    }
    try {
      await (dependencies.ackJob ?? ((job, status) => sendAck(config, job, status)))(marker.job, "printed");
    } catch (cause) {
      throw safeError("ACK_FAILED", "Printed ACK failed. The printed intent was retained for normal startup replay.", cause, secrets);
    }
  } else {
    try {
      await (dependencies.releaseJob ?? ((job) => sendRelease(config, job)))(marker.job);
    } catch (cause) {
      if (!(cause instanceof QueueRequestError && cause.status === 409)) {
        throw safeError("RELEASE_FAILED", "Claim release failed. The submitting marker was retained; verify connectivity and retry.", cause, secrets);
      }
    }
  }

  try {
    await outbox.remove(marker.job.id);
  } catch (cause) {
    throw safeError("STATE_FAILED", "The Worker operation succeeded, but local recovery state could not be removed.", cause, secrets);
  }
}

function parseRecoveryArguments(argv: string[]): { jobId: string; outcome: RecoveryOutcome } {
  let jobId: string | undefined;
  let outcome: RecoveryOutcome | undefined;
  let confirmed = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--" && index === 0) continue;
    if (argument === "--confirm") {
      if (confirmed) usageError("Pass --confirm exactly once.");
      confirmed = true;
      continue;
    }
    if (argument === "--event-slug") {
      index += 1;
      continue;
    }
    if (argument.startsWith("--event-slug=")) continue;
    if (argument === "--job-id" || argument.startsWith("--job-id=")) {
      if (jobId !== undefined) usageError("Pass --job-id exactly once.");
      const value = argument === "--job-id" ? argv[++index] : argument.slice("--job-id=".length);
      if (!value || !JOB_ID_PATTERN.test(value)) usageError("--job-id must be the exact 32-character hexadecimal ID shown in print history.");
      jobId = value.toLowerCase();
      continue;
    }
    if (argument === "--outcome" || argument.startsWith("--outcome=")) {
      if (outcome !== undefined) usageError("Pass --outcome exactly once.");
      const value = argument === "--outcome" ? argv[++index] : argument.slice("--outcome=".length);
      if (value !== "printed" && value !== "not-submitted") usageError('--outcome must be "printed" or "not-submitted".');
      outcome = value;
      continue;
    }
    usageError(`Unknown recovery argument: ${argument}`);
  }

  if (!jobId) usageError("Missing --job-id.");
  if (!outcome) usageError("Missing --outcome.");
  if (!confirmed) usageError("Missing --confirm. Inspect CUPS and the physical printer before confirming an outcome.");
  return { jobId, outcome };
}

function usageError(message: string): never {
  throw new RecoveryCommandError("USAGE", `${message}\n${RECOVERY_USAGE}`);
}

function safeError(code: RecoveryErrorCode, message: string, cause: unknown, secrets: string[]): RecoveryCommandError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new RecoveryCommandError(code, `${message} Cause: ${redact(detail, secrets)}`, { cause });
}

export function formatRecoveryFailure(error: unknown, secret?: string): string {
  return redact(error instanceof Error ? error.message : String(error), secret ? [secret] : []);
}

function redact(value: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((text, secret) => text.replaceAll(secret, "[redacted]"), value);
}
