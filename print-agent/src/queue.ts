import type { AgentConfig, ClaimIdentity, PrintJob, PrintStatus } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY_BYTES = 4_096;
const MAX_RESPONSE_BODY_BYTES = 256 * 1_024;
const JOB_ID_PATTERN = /^[0-9a-f]{32}$/;

type Fetch = typeof globalThis.fetch;

type RequestDependencies = {
  fetch?: Fetch;
  timeoutMs?: number;
};

type QueueOperation = "claim" | "reconcile" | "ack" | "release";

export class QueueRequestError extends Error {
  readonly name = "QueueRequestError";

  constructor(
    public readonly operation: QueueOperation,
    message: string,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(`${operation} request failed: ${message}`, options);
  }
}

export async function claimJobs(config: AgentConfig, agentId: string, limit: number, dependencies: RequestDependencies = {}): Promise<PrintJob[]> {
  const response = await request(
    "claim",
    new URL("/api/print-agent/jobs/claim", config.workerUrl),
    {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({ eventSlug: config.eventSlug, agentId, limit }),
    },
    dependencies,
  );
  const body = await parseJson(response, "claim");
  if (!isRecord(body) || !Array.isArray(body.jobs) || !body.jobs.every(isPrintJob)) {
    throw new QueueRequestError("claim", "Worker returned an invalid jobs payload.");
  }
  return body.jobs;
}

export async function reconcileJobs(
  config: AgentConfig,
  agentId: string,
  knownClaims: ClaimIdentity[],
  dependencies: RequestDependencies = {},
): Promise<{ released: number }> {
  const response = await request(
    "reconcile",
    new URL("/api/print-agent/jobs/reconcile", config.workerUrl),
    {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({ agentId, knownClaims }),
    },
    dependencies,
  );
  const body = await parseJson(response, "reconcile");
  if (!isRecord(body) || !Number.isSafeInteger(body.released) || (body.released as number) < 0) {
    throw new QueueRequestError("reconcile", "Worker returned an invalid reconciliation payload.");
  }
  return { released: body.released as number };
}

export async function ackJob(
  config: AgentConfig,
  job: ClaimIdentity,
  status: PrintStatus,
  error?: string,
  dependencies: RequestDependencies = {},
): Promise<void> {
  const body = status === "failed"
    ? { status, claimToken: job.claimToken, error }
    : { status, claimToken: job.claimToken };
  const response = await request(
    "ack",
    new URL(`/api/print-agent/jobs/${encodeURIComponent(job.id)}/ack`, config.workerUrl),
    { method: "POST", headers: headers(config), body: JSON.stringify(body) },
    dependencies,
  );
  await consumeSuccessfulResponse(response, "ack");
}

export async function releaseJob(config: AgentConfig, job: ClaimIdentity, dependencies: RequestDependencies = {}): Promise<void> {
  const response = await request(
    "release",
    new URL(`/api/print-agent/jobs/${encodeURIComponent(job.id)}/release`, config.workerUrl),
    { method: "POST", headers: headers(config), body: JSON.stringify({ claimToken: job.claimToken }) },
    dependencies,
  );
  await consumeSuccessfulResponse(response, "release");
}

async function request(
  operation: QueueOperation,
  url: URL,
  init: RequestInit,
  { fetch: fetchImplementation = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestDependencies,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImplementation(url.toString(), { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new QueueRequestError(operation, `network or timeout error (${reason})`, undefined, { cause });
  }
  if (!response.ok) {
    const detail = await readResponseText(response, operation, MAX_ERROR_BODY_BYTES);
    throw new QueueRequestError(operation, `HTTP ${response.status}${detail ? `: ${detail}` : ""}`, response.status);
  }
  return response;
}

async function parseJson(response: Response, operation: QueueOperation): Promise<unknown> {
  const text = await readResponseText(response, operation, MAX_RESPONSE_BODY_BYTES);
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new QueueRequestError(operation, "Worker returned invalid JSON.", response.status, { cause });
  }
}

async function consumeSuccessfulResponse(response: Response, operation: QueueOperation): Promise<void> {
  await readResponseText(response, operation, MAX_RESPONSE_BODY_BYTES);
}

async function readResponseText(response: Response, operation: QueueOperation, limit: number): Promise<string> {
  try {
    return await readBoundedText(response, limit);
  } catch (cause) {
    throw new QueueRequestError(operation, "could not consume Worker response body.", response.status, { cause });
  }
}

export async function readBoundedText(response: Response, limit = MAX_ERROR_BODY_BYTES): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let output = "";
  while (bytesRead < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = limit - bytesRead;
    output += decoder.decode(value.subarray(0, remaining), { stream: value.byteLength <= remaining });
    bytesRead += Math.min(value.byteLength, remaining);
    if (value.byteLength > remaining || bytesRead === limit) {
      await reader.cancel();
      output += "...";
      break;
    }
  }
  output += decoder.decode();
  return output;
}

function headers(config: AgentConfig): Record<string, string> {
  return {
    authorization: `Bearer ${config.printAgentToken}`,
    "content-type": "application/json",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPrintJob(value: unknown): value is PrintJob {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && JOB_ID_PATTERN.test(value.id)
    && typeof value.sessionId === "string" && value.sessionId.length > 0
    && typeof value.eventId === "number" && Number.isSafeInteger(value.eventId) && value.eventId > 0
    && typeof value.eventSlug === "string" && value.eventSlug.length > 0
    && typeof value.sceneName === "string" && value.sceneName.length > 0
    && typeof value.postcardUrl === "string" && value.postcardUrl.length > 0
    && typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
    && typeof value.claimToken === "string" && JOB_ID_PATTERN.test(value.claimToken);
}
