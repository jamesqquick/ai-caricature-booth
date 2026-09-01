import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentLock, AgentLockError } from "../src/lock.js";

describe("AgentLock", () => {
  it("prevents a second agent in the same state directory until graceful release", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-lock-"));
    const first = await AgentLock.acquire(directory);

    if (process.platform !== "win32") expect((await stat(join(directory, "agent.lock"))).mode & 0o777).toBe(0o600);

    await expect(AgentLock.acquire(directory)).rejects.toBeInstanceOf(AgentLockError);
    await first.release();

    const replacement = await AgentLock.acquire(directory);
    await replacement.release();
  });
});
