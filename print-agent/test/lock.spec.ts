import { mkdtemp, stat, writeFile } from "node:fs/promises";
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

  it("reclaims a lock owned by a dead PID", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-lock-"));
    await writeFile(join(directory, "agent.lock"), "2147483647\n", { mode: 0o600 });

    const lock = await AgentLock.acquire(directory);
    await lock.release();
  });

  it("allows only one contender to reclaim a stale lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-lock-"));
    await writeFile(join(directory, "agent.lock"), "2147483647\n", { mode: 0o600 });

    const attempts = await Promise.allSettled([AgentLock.acquire(directory), AgentLock.acquire(directory)]);
    const acquired = attempts.filter((result): result is PromiseFulfilledResult<AgentLock> => result.status === "fulfilled");
    expect(acquired).toHaveLength(1);
    await acquired[0]!.value.release();
  });

  it("blocks conservatively when lock ownership is malformed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "print-agent-lock-"));
    await writeFile(join(directory, "agent.lock"), "unknown\n", { mode: 0o600 });

    await expect(AgentLock.acquire(directory)).rejects.toBeInstanceOf(AgentLockError);
  });
});
