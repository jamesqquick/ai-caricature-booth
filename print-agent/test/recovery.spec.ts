import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentLock } from "../src/lock.js";
import { FileAckOutbox } from "../src/outbox.js";
import { QueueRequestError } from "../src/queue.js";
import { RecoveryCommandError, runRecoveryCommand } from "../src/recovery.js";
import { job } from "./fixtures.js";

const claim = { id: job.id, claimToken: job.claimToken };

describe("submitting marker recovery", () => {
  it("requires explicit confirmation", async () => {
    const { env } = await setup();

    await expect(runRecoveryCommand(env, ["--", "--job-id", job.id, "--outcome", "printed"]))
      .rejects.toMatchObject({ name: "RecoveryCommandError", code: "USAGE", message: expect.stringContaining("Missing --confirm") });
  });

  it("rejects a missing or non-submitting marker", async () => {
    const missing = await setup();
    await expect(runRecoveryCommand(missing.env, args("printed")))
      .rejects.toMatchObject({ name: "RecoveryCommandError", code: "MARKER_NOT_FOUND" });

    const wrong = await setup();
    await wrong.outbox.put({ job: claim, status: "printed" });
    await expect(runRecoveryCommand(wrong.env, args("printed")))
      .rejects.toMatchObject({ name: "RecoveryCommandError", code: "MARKER_NOT_FOUND" });
    await expect(wrong.outbox.list()).resolves.toEqual([{ job: claim, status: "printed" }]);
  });

  it("rejects a submitting marker for a different job", async () => {
    const context = await setup();
    await context.outbox.put({ job: claim, status: "submitting" });

    await expect(runRecoveryCommand(context.env, args("printed", "c".repeat(32))))
      .rejects.toMatchObject({ name: "RecoveryCommandError", code: "MARKER_NOT_FOUND" });
    await expect(context.outbox.list()).resolves.toEqual([{ job: claim, status: "submitting" }]);
  });

  it("persists printed intent before ACK and removes it after success", async () => {
    const context = await setup();
    await context.outbox.put({ job: claim, status: "submitting" });
    const ackJob = vi.fn(async (persistedClaim: typeof claim, status: "printed" | "failed") => {
      expect(persistedClaim).toEqual(claim);
      expect(status).toBe("printed");
      await expect(context.outbox.list()).resolves.toEqual([{ job: claim, status: "printed" }]);
    });

    await runRecoveryCommand(context.env, args("printed"), { ackJob });

    expect(ackJob).toHaveBeenCalledOnce();
    await expect(context.outbox.list()).resolves.toEqual([]);
  });

  it("releases the exact persisted claim and removes the marker after success", async () => {
    const context = await setup();
    await context.outbox.put({ job: claim, status: "submitting" });
    const releaseJob = vi.fn(async (persistedClaim: typeof claim) => {
      expect(persistedClaim).toEqual(claim);
    });

    await runRecoveryCommand(context.env, args("not-submitted"), { releaseJob });

    expect(releaseJob).toHaveBeenCalledOnce();
    await expect(context.outbox.list()).resolves.toEqual([]);
  });

  it("removes the marker when release reports that the exact claim is already resolved", async () => {
    const context = await setup();
    await context.outbox.put({ job: claim, status: "submitting" });

    await runRecoveryCommand(context.env, args("not-submitted"), {
      releaseJob: async () => { throw new QueueRequestError("release", "HTTP 409", 409); },
    });

    await expect(context.outbox.list()).resolves.toEqual([]);
  });

  it.each(["printed", "not-submitted"] as const)("retains %s recovery state when the network fails", async (outcome) => {
    const context = await setup();
    await context.outbox.put({ job: claim, status: "submitting" });
    const failure = async () => { throw new Error("network offline"); };

    await expect(runRecoveryCommand(context.env, args(outcome), {
      ackJob: failure,
      releaseJob: failure,
    })).rejects.toBeInstanceOf(RecoveryCommandError);

    await expect(context.outbox.list()).resolves.toEqual([{
      job: claim,
      status: outcome === "printed" ? "printed" : "submitting",
    }]);
  });

  it("fails on lock contention without changing the marker", async () => {
    const context = await setup();
    await context.outbox.put({ job: claim, status: "submitting" });
    const lock = await AgentLock.acquire(context.stateDir);

    try {
      await expect(runRecoveryCommand(context.env, args("printed")))
        .rejects.toMatchObject({ name: "AgentLockError" });
      await expect(context.outbox.list()).resolves.toEqual([{ job: claim, status: "submitting" }]);
    } finally {
      await lock.release();
    }
  });

  it("redacts the persisted claim token and agent secret from actionable errors", async () => {
    const context = await setup();
    await context.outbox.put({ job: claim, status: "submitting" });
    const ackJob = async () => {
      throw new Error(`request exposed ${job.claimToken} and ${context.env.PRINT_AGENT_TOKEN}`);
    };

    const error = await runRecoveryCommand(context.env, args("printed"), { ackJob }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecoveryCommandError);
    expect((error as Error).message).toContain("[redacted]");
    expect((error as Error).message).not.toContain(job.claimToken);
    expect((error as Error).message).not.toContain(context.env.PRINT_AGENT_TOKEN);
  });
});

function args(outcome: "printed" | "not-submitted", jobId = job.id): string[] {
  return ["--job-id", jobId, "--outcome", outcome, "--confirm"];
}

async function setup() {
  const stateDir = await mkdtemp(join(tmpdir(), "print-agent-recovery-"));
  const outbox = new FileAckOutbox(join(stateDir, "pending-acks.json"));
  const env = {
    WORKER_URL: "https://booth.example.com",
    EVENT_SLUG: "test-event",
    PRINT_AGENT_TOKEN: "agent-secret-placeholder",
    PRINT_AGENT_STATE_DIR: stateDir,
  };
  return { env, outbox, stateDir };
}
