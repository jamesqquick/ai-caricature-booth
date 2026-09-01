import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPrintPdf } from "./pdf.js";
import { readBoundedText } from "./queue.js";
import type { Printer } from "./printer.js";
import type { AgentConfig, PrintJob, Sleep } from "./types.js";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAYS_MS = [500, 1_500, 4_000];
export const MAX_POSTCARD_BYTES = 15 * 1_024 * 1_024;

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
  const url = validatePostcardUrl(config, job);
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const sleep = dependencies.sleep ?? abortableSleep;
  const retryDelays = dependencies.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  let lastError: DownloadError | undefined;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const response = await fetchImplementation(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const detail = await readBoundedText(response);
        throw new DownloadError(url, `HTTP ${response.status}${detail ? `: ${detail}` : ""}`, retryable, response.status);
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "image/jpeg") {
        throw new DownloadError(url, `expected image/jpeg but received ${contentType || "no content type"}`, false, response.status);
      }
      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_POSTCARD_BYTES)) {
        throw new DownloadError(url, `invalid or oversized content-length (${declaredLength})`, false, response.status);
      }
      const bytes = await readPostcardBody(response, url);
      if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
        throw new DownloadError(url, "body does not have valid JPEG boundary markers", false, response.status);
      }
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

function validatePostcardUrl(config: AgentConfig, job: PrintJob): string {
  let workerUrl: URL;
  let postcardUrl: URL;
  try {
    workerUrl = new URL(config.workerUrl);
    postcardUrl = new URL(job.postcardUrl, workerUrl);
  } catch (cause) {
    throw new DownloadError(job.postcardUrl, "invalid URL", false, undefined, { cause });
  }
  const expectedPath = `/api/events/${job.eventId}/sessions/${job.sessionId}/postcard`;
  if (postcardUrl.origin !== workerUrl.origin) {
    throw new DownloadError(postcardUrl.toString(), "must use the configured Worker origin", false);
  }
  if (postcardUrl.protocol !== "https:" && !(postcardUrl.protocol === "http:" && isLoopback(postcardUrl.hostname))) {
    throw new DownloadError(postcardUrl.toString(), "must use HTTPS except on loopback", false);
  }
  if (postcardUrl.pathname !== expectedPath || postcardUrl.search || postcardUrl.hash) {
    throw new DownloadError(postcardUrl.toString(), `must use the exact path ${expectedPath}`, false);
  }
  return postcardUrl.toString();
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]";
}

async function readPostcardBody(response: Response, url: string): Promise<Uint8Array> {
  if (!response.body) throw new DownloadError(url, "received an empty JPEG body", false, response.status);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_POSTCARD_BYTES) {
      await reader.cancel();
      throw new DownloadError(url, `JPEG exceeds ${MAX_POSTCARD_BYTES} bytes`, false, response.status);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
