import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOrCreateInstallationId } from "../src/installation.js";
import { AgentLock } from "../src/lock.js";
import { resolveAgentId } from "../src/paths.js";
import { config } from "./fixtures.js";

const directories: string[] = [];

async function createStateDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "print-agent-installation-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("installation identity", () => {
  it("reuses one private installation ID across restarts in the same state directory", async () => {
    const directory = await createStateDirectory();
    const firstLock = await AgentLock.acquire(directory);
    const first = await loadOrCreateInstallationId(directory);
    await firstLock.release();
    const secondLock = await AgentLock.acquire(directory);
    const second = await loadOrCreateInstallationId(directory);
    await secondLock.release();

    expect(second).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    if (process.platform !== "win32") expect((await stat(join(directory, "installation-id"))).mode & 0o777).toBe(0o600);
  });

  it("gives equivalent configurations in separate state directories distinct claim owners", async () => {
    const firstDirectory = await createStateDirectory();
    const secondDirectory = await createStateDirectory();
    const firstLock = await AgentLock.acquire(firstDirectory);
    const firstInstallation = await loadOrCreateInstallationId(firstDirectory);
    await firstLock.release();
    const secondLock = await AgentLock.acquire(secondDirectory);
    const secondInstallation = await loadOrCreateInstallationId(secondDirectory);
    await secondLock.release();

    expect(firstInstallation).not.toBe(secondInstallation);
    expect(resolveAgentId(config, firstInstallation)).not.toBe(resolveAgentId(config, secondInstallation));
  });
});
