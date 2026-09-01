import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DownloadError, MAX_POSTCARD_BYTES, downloadPostcard, handleJob, JobProcessingError } from "../src/job-handler.js";
import type { Sleep } from "../src/types.js";
import { config, job } from "./fixtures.js";

describe("downloadPostcard", () => {
  const jpeg = Uint8Array.of(0xff, 0xd8, 1, 0xff, 0xd9);

  it("resolves postcardUrl against workerUrl and validates JPEG content", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(jpeg, { headers: { "content-type": "image/jpeg" } }));
    await expect(downloadPostcard(config, job, { fetch })).resolves.toEqual(jpeg);
    expect(fetch.mock.calls[0]?.[0]).toBe(`https://booth.example.com/api/events/42/sessions/${job.sessionId}/postcard`);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries network, 429, and 5xx failures with bounded backoff", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response(jpeg, { headers: { "content-type": "image/jpeg" } }));
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

  it.each([
    "https://evil.example.com/api/events/42/sessions/123e4567-e89b-12d3-a456-426614174000/postcard",
    "/api/events/42/sessions/other/postcard",
    "/api/events/42/sessions/123e4567-e89b-12d3-a456-426614174000/postcard/extra",
    "http://[",
  ])("rejects an unsafe postcard URL before fetching: %s", async (postcardUrl) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(downloadPostcard(config, { ...job, postcardUrl }, { fetch })).rejects.toBeInstanceOf(DownloadError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects non-loopback HTTP even if configuration validation is bypassed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(downloadPostcard({ ...config, workerUrl: "http://booth.example.com" }, job, { fetch })).rejects.toBeInstanceOf(DownloadError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects redirects and oversized declared or streamed bodies", async () => {
    const responses = [
      new Response(null, { status: 302, headers: { location: "https://evil.example.com/postcard.jpg" } }),
      new Response(jpeg, { headers: { "content-type": "image/jpeg", "content-length": String(MAX_POSTCARD_BYTES + 1) } }),
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_POSTCARD_BYTES));
          controller.enqueue(Uint8Array.of(1));
          controller.close();
        },
      }), { headers: { "content-type": "image/jpeg" } }),
    ];
    for (const response of responses) {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
      await expect(downloadPostcard(config, job, { fetch, retryDelaysMs: [] })).rejects.toBeInstanceOf(DownloadError);
    }
  });

  it("validates JPEG boundary signatures and wraps stream errors", async () => {
    for (const body of [Uint8Array.of(0, 0, 0xff, 0xd9), Uint8Array.of(0xff, 0xd8, 0, 0)]) {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { headers: { "content-type": "image/jpeg" } }));
      await expect(downloadPostcard(config, job, { fetch, retryDelaysMs: [] })).rejects.toBeInstanceOf(DownloadError);
    }

    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("socket reset")); },
    }), { headers: { "content-type": "image/jpeg" } }));
    await expect(downloadPostcard(config, job, { fetch, retryDelaysMs: [] })).rejects.toMatchObject({ name: "DownloadError", retryable: true });
  });
});

describe("handleJob", () => {
  it("downloads, builds, archives privately, marks submission, then prints", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "print-agent-output-"));
    const printer = { name: "test", print: vi.fn(async () => ({ message: "submitted", durationMs: 1 })) };
    const beforeSubmit = vi.fn(async () => undefined);
    await handleJob(config, job, printer, {
      outputDir,
      download: vi.fn(async () => Uint8Array.of(1)),
      buildPdf: vi.fn(async () => Uint8Array.of(2)),
      beforeSubmit,
    });
    const files = await readdir(outputDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^print-[0-9a-f-]{36}\.pdf$/);
    expect(beforeSubmit).toHaveBeenCalledOnce();
    expect(beforeSubmit.mock.invocationCallOrder[0]).toBeLessThan(printer.print.mock.invocationCallOrder[0]!);
    expect(printer.print).toHaveBeenCalledWith(Uint8Array.of(2), job.id);
    if (process.platform !== "win32") {
      expect((await stat(outputDir)).mode & 0o777).toBe(0o700);
      expect((await stat(join(outputDir, files[0]!))).mode & 0o777).toBe(0o600);
    }
  });

  it("creates a unique archive for repeated handling and does not print when the submission marker fails", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "print-agent-output-"));
    const printer = { name: "test", print: vi.fn(async () => ({ message: "submitted", durationMs: 1 })) };
    const dependencies = {
      outputDir,
      download: vi.fn(async () => Uint8Array.of(1)),
      buildPdf: vi.fn(async () => Uint8Array.of(2)),
      beforeSubmit: vi.fn(async () => undefined),
    };
    await handleJob(config, job, printer, dependencies);
    await handleJob(config, job, printer, dependencies);
    expect(await readdir(outputDir)).toHaveLength(2);

    dependencies.beforeSubmit.mockRejectedValueOnce(new Error("state unavailable"));
    await expect(handleJob(config, job, printer, dependencies)).rejects.toMatchObject({ stage: "print" });
    expect(printer.print).toHaveBeenCalledTimes(2);
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
