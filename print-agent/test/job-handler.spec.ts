import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DownloadError, downloadPostcard, handleJob, JobProcessingError } from "../src/job-handler.js";
import type { Sleep } from "../src/types.js";
import { config, job } from "./fixtures.js";

describe("downloadPostcard", () => {
  it("resolves postcardUrl against workerUrl and validates JPEG content", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(Uint8Array.of(1), { headers: { "content-type": "image/jpeg" } }));
    await expect(downloadPostcard(config, job, { fetch })).resolves.toEqual(Uint8Array.of(1));
    expect(fetch.mock.calls[0]?.[0]).toBe("https://booth.example.com/api/events/42/sessions/123/postcard");
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries network, 429, and 5xx failures with bounded backoff", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response(Uint8Array.of(1), { headers: { "content-type": "image/jpeg" } }));
    const sleep = vi.fn<Sleep>(async () => undefined);
    await downloadPostcard(config, job, { fetch, sleep, retryDelaysMs: [10, 20, 30] });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([10, 20, 30]);
  });

  it("does not retry permanent 4xx or invalid image responses", async () => {
    for (const response of [new Response("missing", { status: 404 }), new Response("html", { headers: { "content-type": "text/html" } }), new Response(null, { headers: { "content-type": "image/jpeg" } })]) {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
      await expect(downloadPostcard(config, job, { fetch, sleep: vi.fn(), retryDelaysMs: [1, 1] })).rejects.toBeInstanceOf(DownloadError);
      expect(fetch).toHaveBeenCalledOnce();
    }
  });
});

describe("handleJob", () => {
  it("downloads, builds, archives with session and job IDs, then prints", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "print-agent-output-"));
    const printer = { name: "test", print: vi.fn(async () => ({ message: "submitted", durationMs: 1 })) };
    await handleJob(config, job, printer, {
      outputDir,
      download: vi.fn(async () => Uint8Array.of(1)),
      buildPdf: vi.fn(async () => Uint8Array.of(2)),
    });
    expect(await readdir(outputDir)).toEqual([`${job.sessionId}-${job.id}.pdf`]);
    expect(printer.print).toHaveBeenCalledWith(Uint8Array.of(2), job.id);
  });

  it("adds job and stage context to processing failures", async () => {
    const printer = { name: "test", print: vi.fn(async () => ({ message: "submitted", durationMs: 1 })) };
    const error = await handleJob(config, job, printer, {
      outputDir: "unused",
      download: vi.fn(async () => { throw new Error("offline"); }),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JobProcessingError);
    expect(error).toMatchObject({ jobId: job.id, stage: "download" });
  });
});
