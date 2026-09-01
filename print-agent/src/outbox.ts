import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PrintJob, PrintStatus } from "./types.js";

export type TerminalAckIntent = {
  job: PrintJob;
  status: PrintStatus;
  error?: string;
};

export interface AckOutbox {
  list(): Promise<TerminalAckIntent[]>;
  put(intent: TerminalAckIntent): Promise<void>;
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

  async list(): Promise<TerminalAckIntent[]> {
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
      return data.intents;
    } catch (cause) {
      throw new AckOutboxError(this.path, "contains invalid JSON or acknowledgement data", { cause });
    }
  }

  async put(intent: TerminalAckIntent): Promise<void> {
    const intents = (await this.list()).filter((existing) => existing.job.id !== intent.job.id);
    intents.push(intent);
    await this.write(intents);
  }

  async remove(jobId: string): Promise<void> {
    const intents = (await this.list()).filter((intent) => intent.job.id !== jobId);
    await this.write(intents);
  }

  private async write(intents: TerminalAckIntent[]): Promise<void> {
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(temporaryPath, JSON.stringify({ version: 1, intents }), { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporaryPath, this.path);
    } catch (cause) {
      throw new AckOutboxError(this.path, "could not atomically persist acknowledgements", { cause });
    }
  }
}

export class MemoryAckOutbox implements AckOutbox {
  private readonly intents = new Map<string, TerminalAckIntent>();

  async list(): Promise<TerminalAckIntent[]> {
    return [...this.intents.values()];
  }

  async put(intent: TerminalAckIntent): Promise<void> {
    this.intents.set(intent.job.id, intent);
  }

  async remove(jobId: string): Promise<void> {
    this.intents.delete(jobId);
  }
}

function isOutboxFile(value: unknown): value is { version: 1; intents: TerminalAckIntent[] } {
  if (!value || typeof value !== "object") return false;
  const file = value as { version?: unknown; intents?: unknown };
  return file.version === 1 && Array.isArray(file.intents) && file.intents.every(isIntent);
}

function isIntent(value: unknown): value is TerminalAckIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as { job?: Partial<PrintJob>; status?: unknown; error?: unknown };
  return typeof intent.job?.id === "string"
    && typeof intent.job.claimToken === "string"
    && (intent.status === "printed" || intent.status === "failed")
    && (intent.error === undefined || typeof intent.error === "string");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
