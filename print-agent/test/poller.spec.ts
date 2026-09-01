import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileAckOutbox } from "../src/outbox.js";
import { FatalPrintStateError, PrintPoller } from "../src/poller.js";
import { QueueRequestError } from "../src/queue.js";
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
    const poller = new PrintPoller(config, { claimJobs: async () => [job, secondJob], handleJob, ackJob, releaseJob: async () => undefined, sleep: async () => undefined });
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
      releaseJob: async () => undefined,
      sleep: async () => undefined,
      printedAckAttempts: 3,
      logger,
    });
    await poller.pollOnce();
    expect(ackJob.mock.calls.map(([, status]) => status)).toEqual(["printed", "printed", "printed"]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("printed acknowledgement failed"));
  });

  it("replays a durable printed acknowledgement before claiming after process recreation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-poller-"));
    const path = join(directory, "acks.json");
    const handleJob = vi.fn(async () => undefined);
    const offlineAck = vi.fn(async () => { throw new Error("ack offline"); });
    await new PrintPoller(config, {
      claimJobs: async () => [job], handleJob, ackJob: offlineAck,
      releaseJob: async () => undefined,
      outbox: new FileAckOutbox(path), sleep: async () => undefined, printedAckAttempts: 1,
    }).pollOnce();
    expect(await new FileAckOutbox(path).list()).toEqual([{ job, status: "printed" }]);

    const order: string[] = [];
    const recoveredAck = vi.fn(async () => { order.push("ack"); });
    const claimJobs = vi.fn(async () => { order.push("claim"); return []; });
    await new PrintPoller(config, {
      claimJobs, handleJob, ackJob: recoveredAck,
      releaseJob: async () => undefined,
      outbox: new FileAckOutbox(path), sleep: async () => undefined,
    }).pollOnce();
    expect(order).toEqual(["ack", "claim"]);
    expect(handleJob).toHaveBeenCalledOnce();
    expect(await new FileAckOutbox(path).list()).toEqual([]);
  });

  it("drops a stale outbox acknowledgement on conflict without logging its token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-poller-"));
    const outbox = new FileAckOutbox(join(directory, "acks.json"));
    await outbox.put({ job, status: "printed" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await new PrintPoller(config, {
      claimJobs: async () => [], handleJob: async () => undefined,
      ackJob: async () => { throw new QueueRequestError("ack", "HTTP 409", 409); },
      releaseJob: async () => undefined,
      outbox, logger, sleep: async () => undefined,
    }).pollOnce();
    expect(await outbox.list()).toEqual([]);
    const logs = [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join("\n");
    expect(logs).not.toContain(job.claimToken);
  });

  it("does not claim more work while a durable acknowledgement remains pending", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-poller-"));
    const outbox = new FileAckOutbox(join(directory, "acks.json"));
    await outbox.put({ job, status: "printed" });
    const claimJobs = vi.fn(async () => []);
    await new PrintPoller(config, {
      claimJobs, handleJob: async () => undefined,
      ackJob: async () => { throw new Error("offline"); },
      releaseJob: async () => undefined, outbox,
      printedAckAttempts: 1, sleep: async () => undefined,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }).pollOnce();
    expect(claimJobs).not.toHaveBeenCalled();
  });

  it("redacts claim tokens from processing failure logs", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await new PrintPoller(config, {
      claimJobs: async () => [job],
      handleJob: async () => { throw new Error(`failure ${job.claimToken}`); },
      ackJob: async () => undefined,
      releaseJob: async () => undefined,
      sleep: async () => undefined,
      logger,
    }).pollOnce();
    const logs = [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join("\n");
    expect(logs).not.toContain(job.claimToken);
    expect(logs).toContain("[redacted]");
  });

  it("releases every unprocessed claim when shutdown is requested between jobs", async () => {
    const controller = new AbortController();
    const secondJob = { ...job, id: "c".repeat(32), claimToken: "d".repeat(32) };
    const thirdJob = { ...job, id: "e".repeat(32), claimToken: "f".repeat(32) };
    const handleJob = vi.fn(async () => { controller.abort(); });
    const releaseJob = vi.fn(async (_job: typeof job) => undefined);
    const poller = new PrintPoller(config, {
      claimJobs: async () => [job, secondJob, thirdJob], handleJob,
      ackJob: async () => undefined, releaseJob, sleep: async () => undefined,
    });
    await poller.pollOnce(controller.signal);
    expect(handleJob).toHaveBeenCalledOnce();
    expect(releaseJob.mock.calls.map(([claimed]) => claimed.id)).toEqual([secondJob.id, thirdJob.id]);
  });

  it("stops after an outbox write failure and releases only unprocessed claims", async () => {
    const secondJob = { ...job, id: "c".repeat(32), claimToken: "d".repeat(32) };
    const thirdJob = { ...job, id: "e".repeat(32), claimToken: "f".repeat(32) };
    let currentStatus = "printing";
    const claimJobs = vi.fn(async () => [job, secondJob, thirdJob]);
    const handleJob = vi.fn(async () => undefined);
    const ackJob = vi.fn(async (claimed: typeof job, status: "printed" | "failed") => {
      if (claimed.id === job.id) currentStatus = status;
    });
    const releaseJob = vi.fn(async (claimed: typeof job) => {
      if (claimed.id === job.id) currentStatus = "pending";
      if (claimed.id === secondJob.id) throw new Error(`release failed ${claimed.claimToken}`);
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const outbox = {
      list: async () => [],
      put: async () => { throw new Error(`disk full ${job.claimToken}`); },
      remove: async () => undefined,
    };
    const poller = new PrintPoller(config, {
      claimJobs, handleJob, ackJob, releaseJob, outbox,
      sleep: async () => undefined, logger,
    });

    await expect(poller.run(new AbortController().signal)).rejects.toBeInstanceOf(FatalPrintStateError);
    expect(claimJobs).toHaveBeenCalledOnce();
    expect(handleJob).toHaveBeenCalledOnce();
    expect(handleJob).toHaveBeenCalledWith(job);
    expect(ackJob).not.toHaveBeenCalled();
    expect(currentStatus).toBe("printing");
    expect(releaseJob.mock.calls.map(([claimed]) => claimed.id)).toEqual([secondJob.id, thirdJob.id]);
    const logs = [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join("\n");
    expect(logs).toContain("operator intervention required");
    expect(logs).not.toContain(job.claimToken);
    expect(logs).not.toContain(secondJob.claimToken);
    expect(logs).not.toContain(thirdJob.claimToken);
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
    const poller = new PrintPoller(config, { claimJobs, handleJob: async () => undefined, ackJob: async () => undefined, releaseJob: async () => undefined, sleep });
    const running = poller.run(controller.signal);
    await vi.waitFor(() => expect(claimJobs).toHaveBeenCalledOnce());
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
    const poller = new PrintPoller(config, { claimJobs, handleJob: async () => undefined, ackJob: async () => undefined, releaseJob: async () => undefined, sleep: async () => undefined, logger });
    await poller.pollOnce();
    await poller.pollOnce();
    await poller.pollOnce();
    await poller.pollOnce();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("OFFLINE"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("recovered after 3"));
  });
});
