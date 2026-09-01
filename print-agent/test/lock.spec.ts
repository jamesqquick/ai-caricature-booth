import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentLock, AgentLockError } from "../src/lock.js";
import { resolveAgentDirectories } from "../src/paths.js";
import { config } from "./fixtures.js";

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

  it("contends across package roots targeting the same event and printer", async () => {
    const home = await mkdtemp(join(tmpdir(), "print-agent-home-"));
    const firstPath = resolveAgentDirectories(config, "/checkout/one", home).stateDir;
    const secondPath = resolveAgentDirectories(config, "/checkout/two", home).stateDir;
    const first = await AgentLock.acquire(firstPath);

    await expect(AgentLock.acquire(secondPath)).rejects.toBeInstanceOf(AgentLockError);
    await first.release();
  });
});
