import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPrintPdf } from "./pdf.js";
import { readBoundedText } from "./queue.js";
import type { Printer } from "./printer.js";
import type { AgentConfig, PrintJob, Sleep } from "./types.js";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAYS_MS = [500, 1_500, 4_000];

type Fetch = typeof globalThis.fetch;

type DownloadDependencies = {
  fetch?: Fetch;
  sleep?: Sleep;
  retryDelaysMs?: number[];
  timeoutMs?: number;
};

type JobDependencies = {
  outputDir: string;
  download?: (config: AgentConfig, job: PrintJob) => Promise<Uint8Array>;
  buildPdf?: (jpegBytes: Uint8Array) => Promise<Uint8Array>;
};

export class DownloadError extends Error {
  readonly name = "DownloadError";

  constructor(
    public readonly url: string,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(`Postcard download ${url}: ${message}`, options);
  }
}

export class ArchiveError extends Error {
  readonly name = "ArchiveError";

  constructor(public readonly jobId: string, message: string, options?: ErrorOptions) {
    super(`Print job ${jobId}: ${message}`, options);
  }
}

export class JobProcessingError extends Error {
  readonly name = "JobProcessingError";

  constructor(public readonly jobId: string, public readonly stage: "download" | "pdf" | "archive" | "print", cause: unknown) {
    super(`Print job ${jobId} failed during ${stage}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

export async function downloadPostcard(
  config: AgentConfig,
  job: PrintJob,
  dependencies: DownloadDependencies = {},
): Promise<Uint8Array> {
  const url = new URL(job.postcardUrl, `${config.workerUrl}/`).toString();
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const sleep = dependencies.sleep ?? abortableSleep;
  const retryDelays = dependencies.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  let lastError: DownloadError | undefined;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const response = await fetchImplementation(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const detail = await readBoundedText(response);
        throw new DownloadError(url, `HTTP ${response.status}${detail ? `: ${detail}` : ""}`, retryable, response.status);
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "image/jpeg") {
        throw new DownloadError(url, `expected image/jpeg but received ${contentType || "no content type"}`, false, response.status);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) throw new DownloadError(url, "received an empty JPEG body", false, response.status);
      return bytes;
    } catch (cause) {
      const error = cause instanceof DownloadError
        ? cause
        : new DownloadError(url, cause instanceof Error ? cause.message : String(cause), true, undefined, { cause });
      lastError = error;
      if (!error.retryable || attempt === retryDelays.length) throw error;
      await sleep(retryDelays[attempt]!);
    }
  }
  throw lastError ?? new DownloadError(url, "download failed", true);
}

export async function handleJob(
  config: AgentConfig,
  job: PrintJob,
  printer: Printer,
  dependencies: JobDependencies,
): Promise<void> {
  if (job.eventSlug !== config.eventSlug) {
    throw new JobProcessingError(
      job.id,
      "download",
      new DownloadError(job.postcardUrl, `event mismatch: job is ${job.eventSlug}, agent is ${config.eventSlug}`, false),
    );
  }
  const jpegBytes = await runStage(job.id, "download", () => (dependencies.download ?? downloadPostcard)(config, job));
  const pdfBytes = await runStage(job.id, "pdf", () => (dependencies.buildPdf ?? buildPrintPdf)(jpegBytes));
  await runStage(job.id, "archive", () => archivePdf(dependencies.outputDir, job, pdfBytes));
  await runStage(job.id, "print", () => printer.print(pdfBytes, job.id));
}

export async function archivePdf(outputDir: string, job: PrintJob, pdfBytes: Uint8Array): Promise<string> {
  const filename = `${safeFilePart(job.sessionId)}-${safeFilePart(job.id)}.pdf`;
  const path = join(outputDir, filename);
  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(path, pdfBytes);
    return path;
  } catch (cause) {
    throw new ArchiveError(job.id, `could not archive PDF at ${path}`, { cause });
  }
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function runStage<T>(jobId: string, stage: JobProcessingError["stage"], operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw new JobProcessingError(jobId, stage, cause);
  }
}

export function abortableSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
