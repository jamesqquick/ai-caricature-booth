import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAckOutbox } from "../src/outbox.js";
import { job } from "./fixtures.js";

describe("FileAckOutbox", () => {
  it("atomically persists and removes terminal acknowledgements across instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-outbox-"));
    const path = join(directory, "acks.json");
    const intent = { job, status: "printed" as const };

    await new FileAckOutbox(path).put(intent);
    await expect(new FileAckOutbox(path).list()).resolves.toEqual([intent]);
    expect(await readdir(directory)).toEqual(["acks.json"]);

    await new FileAckOutbox(path).remove(job.id);
    await expect(new FileAckOutbox(path).list()).resolves.toEqual([]);
    expect(await readdir(directory)).toEqual(["acks.json"]);
  });

  it("persists a pre-submission marker and atomically replaces it with a printed acknowledgement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-outbox-"));
    const path = join(directory, "state", "print-state.json");
    const outbox = new FileAckOutbox(path);

    await outbox.put({ job, status: "submitting" });
    await expect(new FileAckOutbox(path).list()).resolves.toEqual([{ job, status: "submitting" }]);
    await outbox.put({ job, status: "printed" });
    await expect(new FileAckOutbox(path).list()).resolves.toEqual([{ job, status: "printed" }]);

    if (process.platform !== "win32") {
      expect((await stat(join(directory, "state"))).mode & 0o777).toBe(0o700);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it("redacts the claim token from persisted failure text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-outbox-"));
    const outbox = new FileAckOutbox(join(directory, "state.json"));
    await outbox.put({ job, status: "failed", error: `failure ${job.claimToken}` });
    const [intent] = await outbox.list();
    expect(intent).toMatchObject({ status: "failed", error: "failure [redacted]" });
  });
});
