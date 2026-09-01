import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { ensurePrivateDirectory } from "./filesystem.js";
import type { PrintJob, PrintStatus } from "./types.js";

export type TerminalAckIntent = {
  job: PrintJob;
  status: PrintStatus;
  error?: string;
};

export type SubmissionMarker = {
  job: PrintJob;
  status: "submitting";
};

export type PendingPrintState = TerminalAckIntent | SubmissionMarker;

export interface AckOutbox {
  list(): Promise<PendingPrintState[]>;
  put(intent: PendingPrintState): Promise<void>;
  remove(jobId: string): Promise<void>;
}

export class AckOutboxError extends Error {
  readonly name = "AckOutboxError";

  constructor(public readonly path: string, message: string, options?: ErrorOptions) {
    super(`ACK outbox ${path}: ${message}`, options);
  }
}

export class FileAckOutbox implements AckOutbox {
  constructor(private readonly path: string) {}

  async list(): Promise<PendingPrintState[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (cause) {
      if (isNodeError(cause) && cause.code === "ENOENT") return [];
      throw new AckOutboxError(this.path, "could not read persisted acknowledgements", { cause });
    }
    try {
      const data = JSON.parse(text) as unknown;
      if (!isOutboxFile(data)) throw new Error("invalid outbox format");
      return data.intents.map(sanitizeState);
    } catch (cause) {
      throw new AckOutboxError(this.path, "contains invalid JSON or acknowledgement data", { cause });
    }
  }

  async put(intent: PendingPrintState): Promise<void> {
    intent = sanitizeState(intent);
    const intents = (await this.list()).filter((existing) => existing.job.id !== intent.job.id);
    intents.push(intent);
    await this.write(intents);
  }

  async remove(jobId: string): Promise<void> {
    const intents = (await this.list()).filter((intent) => intent.job.id !== jobId);
    await this.write(intents);
  }

  private async write(intents: PendingPrintState[]): Promise<void> {
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const directory = dirname(this.path);
    let temporaryFile: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await ensurePrivateDirectory(directory);
      temporaryFile = await open(temporaryPath, "wx", 0o600);
      await temporaryFile.writeFile(JSON.stringify({ version: 1, intents }), "utf8");
      await temporaryFile.sync();
      await temporaryFile.close();
      temporaryFile = undefined;
      await rename(temporaryPath, this.path);
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (cause) {
      await temporaryFile?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw new AckOutboxError(this.path, "could not atomically persist acknowledgements", { cause });
    }
  }
}

export class MemoryAckOutbox implements AckOutbox {
  private readonly intents = new Map<string, PendingPrintState>();

  async list(): Promise<PendingPrintState[]> {
    return [...this.intents.values()];
  }

  async put(intent: PendingPrintState): Promise<void> {
    this.intents.set(intent.job.id, sanitizeState(intent));
  }

  async remove(jobId: string): Promise<void> {
    this.intents.delete(jobId);
  }
}

function isOutboxFile(value: unknown): value is { version: 1; intents: PendingPrintState[] } {
  if (!value || typeof value !== "object") return false;
  const file = value as { version?: unknown; intents?: unknown };
  return file.version === 1 && Array.isArray(file.intents) && file.intents.every(isIntent);
}

function isIntent(value: unknown): value is PendingPrintState {
  if (!value || typeof value !== "object") return false;
  const intent = value as { job?: Partial<PrintJob>; status?: unknown; error?: unknown };
  return typeof intent.job?.id === "string"
    && typeof intent.job.claimToken === "string"
    && (intent.status === "submitting" || intent.status === "printed" || intent.status === "failed")
    && (intent.error === undefined || typeof intent.error === "string");
}

function sanitizeState(state: PendingPrintState): PendingPrintState {
  if (state.status !== "failed" || state.error === undefined) return state;
  return { ...state, error: state.error.replaceAll(state.job.claimToken, "[redacted]") };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
