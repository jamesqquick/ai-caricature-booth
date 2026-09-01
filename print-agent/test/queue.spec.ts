import { describe, expect, it, vi } from "vitest";
import { QueueRequestError, ackJob, claimJobs } from "../src/queue.js";
import { config, job } from "./fixtures.js";

describe("queue client", () => {
  it("claims with the hardened POST contract, bearer auth, and timeout signal", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ jobs: [job] }));
    await expect(claimJobs(config, { fetch, timeoutMs: 123 })).resolves.toEqual([job]);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://booth.example.com/api/print-agent/jobs/claim");
    expect(init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ eventSlug: "test-event", limit: 5 }),
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("acks with status, claim token, and optional error", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ job: { id: job.id } }));
    await ackJob(config, job, "failed", "paper jam", { fetch });
    expect(fetch).toHaveBeenCalledWith(
      `https://booth.example.com/api/print-agent/jobs/${job.id}/ack`,
      expect.objectContaining({ body: JSON.stringify({ status: "failed", claimToken: job.claimToken, error: "paper jam" }) }),
    );
  });

  it("bounds response errors and reports timeout failures with context", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      await new Promise<void>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
      return new Response();
    });
    await expect(claimJobs(config, { fetch, timeoutMs: 1 })).rejects.toMatchObject({ name: "QueueRequestError", operation: "claim" });

    const longBody = "x".repeat(10_000);
    const failedFetch = vi.fn<typeof globalThis.fetch>(async () => new Response(longBody, { status: 503 }));
    const error = await claimJobs(config, { fetch: failedFetch }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueueRequestError);
    expect((error as Error).message.length).toBeLessThan(5_000);
    expect((error as Error).message).toContain("HTTP 503");
  });
});
