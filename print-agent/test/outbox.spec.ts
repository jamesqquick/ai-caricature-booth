import { mkdtemp, readdir } from "node:fs/promises";
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
});
