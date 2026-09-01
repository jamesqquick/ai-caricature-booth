import { describe, expect, it, vi } from "vitest";
import { PrintPoller } from "../src/poller.js";
import { config, job } from "./fixtures.js";

describe("PrintPoller", () => {
  it("processes claimed jobs serially and continues after processing failures", async () => {
    const secondJob = { ...job, id: "c".repeat(32), claimToken: "d".repeat(32) };
    const order: string[] = [];
    const handleJob = vi.fn(async (_job: typeof job) => {
      order.push(`start:${_job.id}`);
      if (_job.id === job.id) throw new Error("printer jam");
      order.push(`end:${_job.id}`);
    });
    const ackJob = vi.fn(async (_job: typeof job, status: "printed" | "failed") => order.push(`ack:${_job.id}:${status}`));
    const poller = new PrintPoller(config, { claimJobs: async () => [job, secondJob], handleJob, ackJob, sleep: async () => undefined });
    await poller.pollOnce();
    expect(order).toEqual([
      `start:${job.id}`,
      `ack:${job.id}:failed`,
      `start:${secondJob.id}`,
      `end:${secondJob.id}`,
      `ack:${secondJob.id}:printed`,
    ]);
  });

  it("retries printed ACK and never sends a false failed ACK after printing", async () => {
    const ackJob = vi.fn(async (_job: typeof job, status: "printed" | "failed") => {
      if (status === "printed") throw new Error("ack offline");
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const poller = new PrintPoller(config, {
      claimJobs: async () => [job],
      handleJob: async () => undefined,
      ackJob,
      sleep: async () => undefined,
      printedAckAttempts: 3,
      logger,
    });
    await poller.pollOnce();
    expect(ackJob.mock.calls.map(([, status]) => status)).toEqual(["printed", "printed", "printed"]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("printed but acknowledgement failed"));
  });

  it("never overlaps polls and stops through AbortSignal without arbitrary waits", async () => {
    const controller = new AbortController();
    let active = 0;
    let maxActive = 0;
    let claims = 0;
    let releaseFirst!: () => void;
    const firstPoll = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const claimJobs = vi.fn(async () => {
      claims += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (claims === 1) await firstPoll;
      active -= 1;
      if (claims === 2) controller.abort();
      return [];
    });
    const sleep = vi.fn(async (_ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) return;
    });
    const poller = new PrintPoller(config, { claimJobs, handleJob: async () => undefined, ackJob: async () => undefined, sleep });
    const running = poller.run(controller.signal);
    await Promise.resolve();
    expect(claimJobs).toHaveBeenCalledOnce();
    releaseFirst();
    await running;
    expect(maxActive).toBe(1);
    expect(claimJobs).toHaveBeenCalledTimes(2);
  });

  it("tracks offline failure threshold and recovery", async () => {
    const claimJobs = vi.fn()
      .mockRejectedValueOnce(new Error("offline 1"))
      .mockRejectedValueOnce(new Error("offline 2"))
      .mockRejectedValueOnce(new Error("offline 3"))
      .mockResolvedValueOnce([]);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const poller = new PrintPoller(config, { claimJobs, handleJob: async () => undefined, ackJob: async () => undefined, sleep: async () => undefined, logger });
    await poller.pollOnce();
    await poller.pollOnce();
    await poller.pollOnce();
    await poller.pollOnce();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("OFFLINE"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("recovered after 3"));
  });
});
