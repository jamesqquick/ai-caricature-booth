import { describe, expect, it, vi } from "vitest";
import { QueueRequestError, ackJob, claimJobs, reconcileJobs, releaseJob } from "../src/queue.js";
import { config, job } from "./fixtures.js";

describe("queue client", () => {
  const agentId = "c".repeat(64);

  it("claims with the hardened POST contract, bearer auth, and timeout signal", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ jobs: [job] }));
    await expect(claimJobs(config, agentId, 1, { fetch, timeoutMs: 123 })).resolves.toEqual([job]);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://booth.example.com/api/print-agent/jobs/claim");
    expect(init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ eventSlug: "test-event", agentId, limit: 1 }),
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reconciles locally durable claim identities without exposing them in the response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ released: 1 }));
    await expect(reconcileJobs(config, agentId, [{ id: job.id, claimToken: job.claimToken }], { fetch })).resolves.toEqual({ released: 1 });

    expect(fetch).toHaveBeenCalledWith(
      "https://booth.example.com/api/print-agent/jobs/reconcile",
      expect.objectContaining({ body: JSON.stringify({ agentId, knownClaims: [{ id: job.id, claimToken: job.claimToken }] }) }),
    );
  });

  it("rejects a malformed successful claim response as an ambiguous claim failure", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ jobs: [{ id: job.id }] }));

    await expect(claimJobs(config, agentId, 1, { fetch })).rejects.toMatchObject({
      name: "QueueRequestError",
      operation: "claim",
      status: 200,
    });
  });

  it("acks with status, claim token, and optional error", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ job: { id: job.id } }));
    await ackJob(config, job, "failed", "paper jam", { fetch });
    expect(fetch).toHaveBeenCalledWith(
      `https://booth.example.com/api/print-agent/jobs/${job.id}/ack`,
      expect.objectContaining({ body: JSON.stringify({ status: "failed", claimToken: job.claimToken, error: "paper jam" }) }),
    );
  });

  it("releases with the claim token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ job: { id: job.id } }));
    await releaseJob(config, job, { fetch });
    expect(fetch).toHaveBeenCalledWith(
      `https://booth.example.com/api/print-agent/jobs/${job.id}/release`,
      expect.objectContaining({ body: JSON.stringify({ claimToken: job.claimToken }) }),
    );
  });

  it.each([
    ["ack", (fetch: typeof globalThis.fetch) => ackJob(config, job, "printed", undefined, { fetch })],
    ["release", (fetch: typeof globalThis.fetch) => releaseJob(config, job, { fetch })],
  ] as const)("bounds and consumes successful %s response bodies", async (_operation, request) => {
    const cancel = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(300_000)); },
      cancel,
    })));
    await expect(request(fetch)).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ["ack", (fetch: typeof globalThis.fetch) => ackJob(config, job, "printed", undefined, { fetch })],
    ["release", (fetch: typeof globalThis.fetch) => releaseJob(config, job, { fetch })],
  ] as const)("wraps successful %s response stream failures", async (operation, request) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("stream failed")); },
    })));
    await expect(request(fetch)).rejects.toMatchObject({ name: "QueueRequestError", operation });
  });

  it("bounds response errors and reports timeout failures with context", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      await new Promise<void>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
      return new Response();
    });
    await expect(claimJobs(config, agentId, 1, { fetch, timeoutMs: 1 })).rejects.toMatchObject({ name: "QueueRequestError", operation: "claim" });

    const longBody = "x".repeat(10_000);
    const failedFetch = vi.fn<typeof globalThis.fetch>(async () => new Response(longBody, { status: 503 }));
    const error = await claimJobs(config, agentId, 1, { fetch: failedFetch }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueueRequestError);
    expect((error as Error).message.length).toBeLessThan(5_000);
    expect((error as Error).message).toContain("HTTP 503");
  });
});
