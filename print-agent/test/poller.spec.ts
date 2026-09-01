import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileAckOutbox, MemoryAckOutbox } from "../src/outbox.js";
import { JobProcessingError } from "../src/job-handler.js";
import { FatalPrintStateError, PrintPoller } from "../src/poller.js";
import { PrintOutcomeUncertainError } from "../src/printer.js";
import { QueueRequestError } from "../src/queue.js";
import { config, job } from "./fixtures.js";

describe("PrintPoller", () => {
  it("reconciles durable claims before recovery ACKs, releases, or new claims", async () => {
    const outbox = new MemoryAckOutbox();
    await outbox.put({ job, status: "printed" });
    const order: string[] = [];
    const reconcileClaims = vi.fn(async (claims: Array<{ id: string; claimToken: string }>) => {
      order.push("reconcile");
      expect(claims).toEqual([{ id: job.id, claimToken: job.claimToken }]);
    });
    const ackJob = vi.fn(async () => { order.push("ack"); });
    const claimJobs = vi.fn(async () => { order.push("claim"); return []; });

    await new PrintPoller(config, {
      reconcileClaims, claimJobs, handleJob: async () => undefined, ackJob,
      releaseJob: async () => undefined, outbox, sleep: async () => undefined,
    }).pollOnce();

    expect(order).toEqual(["reconcile", "ack", "claim"]);
    expect(reconcileClaims).toHaveBeenCalledOnce();
  });

  it("fails closed when startup reconciliation fails", async () => {
    const outbox = new MemoryAckOutbox();
    await outbox.put({ job, status: "claimed" });
    const claimJobs = vi.fn(async () => [job]);
    const ackJob = vi.fn(async () => undefined);
    const releaseJob = vi.fn(async () => undefined);

    await expect(new PrintPoller(config, {
      reconcileClaims: async () => { throw new Error(`offline ${job.claimToken}`); },
      claimJobs, handleJob: async () => undefined, ackJob, releaseJob, outbox,
    }).pollOnce()).rejects.toBeInstanceOf(FatalPrintStateError);

    expect(claimJobs).not.toHaveBeenCalled();
    expect(ackJob).not.toHaveBeenCalled();
    expect(releaseJob).not.toHaveBeenCalled();
    expect(await outbox.list()).toEqual([{ job: { id: job.id, claimToken: job.claimToken }, status: "claimed" }]);
  });

  it("claims and processes one job at a time up to the poll-cycle batch limit", async () => {
    const secondJob = { ...job, id: "c".repeat(32), claimToken: "d".repeat(32) };
    const order: string[] = [];
    const claimJobs = vi.fn()
      .mockImplementationOnce(async () => { order.push("claim:1"); return [job]; })
      .mockImplementationOnce(async () => { order.push("claim:2"); return [secondJob]; })
      .mockImplementationOnce(async () => { order.push("claim:3"); return []; });
    const handleJob = vi.fn(async (_job: typeof job) => {
      order.push(`start:${_job.id}`);
      if (_job.id === job.id) throw new Error("printer jam");
      order.push(`end:${_job.id}`);
    });
    const ackJob = vi.fn(async (_job: { id: string }, status: "printed" | "failed") => order.push(`ack:${_job.id}:${status}`));
    const poller = new PrintPoller(config, { claimJobs, handleJob, ackJob, releaseJob: async () => undefined, sleep: async () => undefined });
    await poller.pollOnce();
    expect(order).toEqual([
      "claim:1",
      `start:${job.id}`,
      `ack:${job.id}:failed`,
      "claim:2",
      `start:${secondJob.id}`,
      `end:${secondJob.id}`,
      `ack:${secondJob.id}:printed`,
      "claim:3",
    ]);
  });

  it("retries printed ACK and never sends a false failed ACK after printing", async () => {
    const ackJob = vi.fn(async (_job: { id: string }, status: "printed" | "failed") => {
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
    expect(await new FileAckOutbox(path).list()).toEqual([{ job: { id: job.id, claimToken: job.claimToken }, status: "printed" }]);

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

  it("halts on a stale printed acknowledgement without dropping it or printing more", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-poller-"));
    const outbox = new FileAckOutbox(join(directory, "acks.json"));
    await outbox.put({ job, status: "printed" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const claimJobs = vi.fn(async () => [job]);
    const handleJob = vi.fn(async () => undefined);
    const poller = new PrintPoller(config, {
      claimJobs, handleJob,
      ackJob: async () => { throw new QueueRequestError("ack", "HTTP 409", 409); },
      releaseJob: async () => undefined,
      outbox, logger, sleep: async () => undefined,
    });
    await expect(poller.pollOnce()).rejects.toBeInstanceOf(FatalPrintStateError);
    expect(await outbox.list()).toEqual([{ job: { id: job.id, claimToken: job.claimToken }, status: "printed" }]);
    expect(claimJobs).not.toHaveBeenCalled();
    expect(handleJob).not.toHaveBeenCalled();
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

  it("does not claim another job when shutdown is requested after the active job", async () => {
    const controller = new AbortController();
    const handleJob = vi.fn(async () => { controller.abort(); });
    const releaseJob = vi.fn(async (_job: { id: string }) => undefined);
    const claimJobs = vi.fn(async () => [job]);
    const poller = new PrintPoller(config, {
      claimJobs, handleJob,
      ackJob: async () => undefined, releaseJob, sleep: async () => undefined,
    });
    await poller.pollOnce(controller.signal);
    expect(handleJob).toHaveBeenCalledOnce();
    expect(claimJobs).toHaveBeenCalledOnce();
    expect(releaseJob).not.toHaveBeenCalled();
  });

  it("persists the claimed marker before processing starts", async () => {
    const outbox = new MemoryAckOutbox();
    const handleJob = vi.fn(async () => {
      expect(await outbox.list()).toEqual([{
        job: { id: job.id, claimToken: job.claimToken },
        status: "claimed",
      }]);
    });
    const claimJobs = vi.fn().mockResolvedValueOnce([job]).mockResolvedValueOnce([]);

    await new PrintPoller(config, {
      claimJobs, handleJob, ackJob: async () => undefined,
      releaseJob: async () => undefined, outbox, sleep: async () => undefined,
    }).pollOnce();

    expect(handleJob).toHaveBeenCalledOnce();
    expect(await outbox.list()).toEqual([]);
  });

  it("stops after an outbox write failure and releases only unprocessed claims", async () => {
    let currentStatus = "printing";
    const claimJobs = vi.fn(async () => [job]);
    const handleJob = vi.fn(async () => undefined);
    const ackJob = vi.fn(async (claimed: { id: string }, status: "printed" | "failed") => {
      if (claimed.id === job.id) currentStatus = status;
    });
    const releaseJob = vi.fn(async (claimed: { id: string }) => {
      if (claimed.id === job.id) currentStatus = "pending";
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let outboxWrites = 0;
    const outbox = {
      list: async () => [],
      put: async () => {
        outboxWrites += 1;
        if (outboxWrites === 2) throw new Error(`disk full ${job.claimToken}`);
      },
      remove: async () => undefined,
    };
    const poller = new PrintPoller(config, {
      claimJobs, handleJob, ackJob, releaseJob, outbox,
      sleep: async () => undefined, logger,
    });

    await expect(poller.run(new AbortController().signal)).rejects.toBeInstanceOf(FatalPrintStateError);
    expect(claimJobs).toHaveBeenCalledOnce();
    expect(handleJob).toHaveBeenCalledOnce();
    expect(handleJob).toHaveBeenCalledWith(job, expect.any(Function));
    expect(ackJob).not.toHaveBeenCalled();
    expect(currentStatus).toBe("printing");
    expect(releaseJob).not.toHaveBeenCalled();
    const logs = [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join("\n");
    expect(logs).toContain("operator intervention required");
    expect(logs).not.toContain(job.claimToken);
  });

  it("halts on restart when a pre-submission marker remains", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-poller-"));
    const outbox = new FileAckOutbox(join(directory, "state.json"));
    const claim = { id: job.id, claimToken: job.claimToken };
    await outbox.put({ job: claim, status: "submitting" });
    const claimJobs = vi.fn(async () => [job]);
    const handleJob = vi.fn(async () => undefined);
    const poller = new PrintPoller(config, {
      claimJobs, handleJob, ackJob: async () => undefined,
      releaseJob: async () => undefined, outbox,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(poller.pollOnce()).rejects.toMatchObject({ name: "FatalPrintStateError", jobId: job.id });
    expect(claimJobs).not.toHaveBeenCalled();
    expect(handleJob).not.toHaveBeenCalled();
    expect(await outbox.list()).toEqual([{ job: claim, status: "submitting" }]);
  });

  it("releases a durable claimed marker before claiming after process recreation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-poller-"));
    const path = join(directory, "state.json");
    const claim = { id: job.id, claimToken: job.claimToken };
    await new FileAckOutbox(path).put({ job: claim, status: "claimed" });
    const order: string[] = [];
    const releaseJob = vi.fn(async () => { order.push("release"); });
    const claimJobs = vi.fn(async () => { order.push("claim"); return []; });

    await new PrintPoller(config, {
      claimJobs, handleJob: async () => undefined, ackJob: async () => undefined, releaseJob,
      outbox: new FileAckOutbox(path), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }).pollOnce();

    expect(order).toEqual(["release", "claim"]);
    expect(releaseJob).toHaveBeenCalledWith(claim);
    expect(await new FileAckOutbox(path).list()).toEqual([]);
  });

  it("retains a recreated claimed marker and fails closed when release fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-poller-"));
    const path = join(directory, "state.json");
    const claim = { id: job.id, claimToken: job.claimToken };
    await new FileAckOutbox(path).put({ job: claim, status: "claimed" });
    const claimJobs = vi.fn(async () => [job]);

    await expect(new PrintPoller(config, {
      claimJobs, handleJob: async () => undefined, ackJob: async () => undefined,
      releaseJob: async () => { throw new Error(`offline ${job.claimToken}`); },
      outbox: new FileAckOutbox(path), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }).pollOnce()).rejects.toBeInstanceOf(FatalPrintStateError);

    expect(claimJobs).not.toHaveBeenCalled();
    expect(await new FileAckOutbox(path).list()).toEqual([{ job: claim, status: "claimed" }]);
  });

  it("removes a claimed marker when recovery release is already resolved", async () => {
    const outbox = new MemoryAckOutbox();
    const claim = { id: job.id, claimToken: job.claimToken };
    await outbox.put({ job: claim, status: "claimed" });
    const claimJobs = vi.fn(async () => []);

    await new PrintPoller(config, {
      claimJobs, handleJob: async () => undefined, ackJob: async () => undefined,
      releaseJob: async () => { throw new QueueRequestError("release", "HTTP 409", 409); },
      outbox, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }).pollOnce();

    expect(claimJobs).toHaveBeenCalledOnce();
    expect(await outbox.list()).toEqual([]);
  });

  it("retains a claimed marker when graceful-shutdown release fails", async () => {
    const controller = new AbortController();
    const outbox = new MemoryAckOutbox();
    const claim = { id: job.id, claimToken: job.claimToken };
    const handleJob = vi.fn(async () => undefined);

    await expect(new PrintPoller(config, {
      claimJobs: async () => { controller.abort(); return [job]; }, handleJob, ackJob: async () => undefined,
      releaseJob: async () => { throw new Error("offline"); }, outbox,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }).pollOnce(controller.signal)).rejects.toBeInstanceOf(FatalPrintStateError);

    expect(handleJob).not.toHaveBeenCalled();
    expect(await outbox.list()).toEqual([{ job: claim, status: "claimed" }]);
  });

  it("halts instead of polling when durable state cannot be read", async () => {
    const claimJobs = vi.fn(async () => [job]);
    const poller = new PrintPoller(config, {
      claimJobs,
      handleJob: async () => undefined,
      ackJob: async () => undefined,
      releaseJob: async () => undefined,
      outbox: { list: async () => { throw new Error("corrupt state"); }, put: async () => undefined, remove: async () => undefined },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(poller.pollOnce()).rejects.toBeInstanceOf(FatalPrintStateError);
    expect(claimJobs).not.toHaveBeenCalled();
  });

  it("retains the submission marker and halts when lp outcome is uncertain", async () => {
    const outbox = new MemoryAckOutbox();
    const claimJobs = vi.fn().mockResolvedValueOnce([job]).mockResolvedValueOnce([]);
    const handleJob = vi.fn(async (_job: typeof job, beforeSubmit: () => Promise<void>) => {
      await beforeSubmit();
      throw new JobProcessingError(job.id, "print", new PrintOutcomeUncertainError(job.id, "lp timed out"));
    });
    const ackJob = vi.fn(async () => undefined);
    const poller = new PrintPoller(config, {
      claimJobs, handleJob, ackJob, releaseJob: async () => undefined,
      outbox, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(poller.run(new AbortController().signal)).rejects.toBeInstanceOf(FatalPrintStateError);
    expect(claimJobs).toHaveBeenCalledOnce();
    expect(handleJob).toHaveBeenCalledOnce();
    expect(ackJob).not.toHaveBeenCalled();
    expect(await outbox.list()).toEqual([{ job: { id: job.id, claimToken: job.claimToken }, status: "submitting" }]);
  });

  it("redacts claim tokens from persisted failed acknowledgement errors", async () => {
    const outbox = new MemoryAckOutbox();
    const poller = new PrintPoller(config, {
      claimJobs: vi.fn().mockResolvedValueOnce([job]).mockResolvedValueOnce([]),
      handleJob: async () => { throw new Error(`prepare failed ${job.claimToken}`); },
      ackJob: async () => { throw new Error("offline"); },
      releaseJob: async () => undefined, outbox,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await poller.pollOnce();
    const [intent] = await outbox.list();
    expect(intent).toMatchObject({ status: "failed", error: expect.stringContaining("[redacted]") });
    expect(intent?.status).toBe("failed");
    if (intent?.status === "failed") expect(intent.error).not.toContain(job.claimToken);
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
