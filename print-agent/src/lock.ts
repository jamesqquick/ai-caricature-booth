import { randomUUID } from "node:crypto";
import { link, open, readFile, rename, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { ensurePrivateDirectory } from "./filesystem.js";

type GuardOwner = {
  pid: number;
  identity: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AgentLockError extends Error {
  readonly name = "AgentLockError";

  constructor(public readonly path: string, message: string, options?: ErrorOptions) {
    super(`Print agent lock ${path}: ${message}`, options);
  }
}

export class AgentLock {
  private released = false;

  private constructor(private readonly path: string, private readonly handle: FileHandle) {}

  static async acquire(stateDirectory: string): Promise<AgentLock> {
    await ensurePrivateDirectory(stateDirectory);
    const path = join(stateDirectory, "agent.lock");
    const acquisitionGuard = `${path}.acquire`;
    const guardOwner = await acquireGuard(acquisitionGuard, path);
    let lock: AgentLock | undefined;
    try {
      lock = await AgentLock.acquireGuarded(path);
      return lock;
    } finally {
      try {
        await releaseGuard(acquisitionGuard, path, guardOwner);
      } catch (error) {
        await lock?.release().catch(() => undefined);
        throw error;
      }
    }
  }

  private static async acquireGuarded(path: string): Promise<AgentLock> {
    try {
      return new AgentLock(path, await createLockFile(path));
    } catch (cause) {
      if (!(isNodeError(cause) && cause.code === "EEXIST")) {
        throw new AgentLockError(path, "could not acquire the exclusive process lock.", { cause });
      }
      return AgentLock.reclaim(path, cause);
    }
  }

  private static async reclaim(path: string, conflict: unknown): Promise<AgentLock> {
    let owner: string;
    try {
      owner = (await readFile(path, "utf8")).trim();
    } catch (cause) {
      if (isNodeError(cause) && cause.code === "ENOENT") return AgentLock.acquireAfterRace(path);
      throw new AgentLockError(path, "could not verify the existing lock owner.", { cause });
    }
    if (!/^[1-9]\d*$/.test(owner)) {
      throw new AgentLockError(path, "contains an invalid PID; refusing to remove an ambiguous lock.", { cause: conflict });
    }
    const pid = Number(owner);
    if (!Number.isSafeInteger(pid) || isProcessAlive(pid)) {
      throw new AgentLockError(path, `process ${owner} may still be running.`, { cause: conflict });
    }

    const stalePath = `${path}.stale.${owner}.${randomUUID()}`;
    try {
      await rename(path, stalePath);
    } catch (cause) {
      if (isNodeError(cause) && cause.code === "ENOENT") return AgentLock.acquireAfterRace(path);
      throw new AgentLockError(path, "could not atomically quarantine the stale lock.", { cause });
    }
    try {
      return await AgentLock.acquireAfterRace(path);
    } finally {
      await unlink(stalePath).catch(() => undefined);
    }
  }

  private static async acquireAfterRace(path: string): Promise<AgentLock> {
    let handle: FileHandle | undefined;
    try {
      handle = await createLockFile(path);
      return new AgentLock(path, handle);
    } catch (cause) {
      await handle?.close().catch(() => undefined);
      if (isNodeError(cause) && cause.code === "EEXIST") {
        throw new AgentLockError(path, "another agent acquired the lock during stale-lock recovery.", { cause });
      }
      throw new AgentLockError(path, "could not acquire the exclusive process lock.", { cause });
    }
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await this.handle.close();
    await unlink(this.path);
  }
}

async function acquireGuard(path: string, lockPath: string): Promise<GuardOwner> {
  const owner = { pid: process.pid, identity: randomUUID() };
  try {
    await installGuard(path, owner);
    return owner;
  } catch (cause) {
    if (!(isNodeError(cause) && cause.code === "EEXIST")) {
      throw new AgentLockError(lockPath, "could not serialize lock acquisition.", { cause });
    }
  }

  let existingOwner: GuardOwner;
  try {
    existingOwner = parseGuardOwner(await readFile(path, "utf8"));
  } catch (cause) {
    throw new AgentLockError(lockPath, "acquisition guard ownership is ambiguous; refusing to remove it.", { cause });
  }
  if (isProcessAlive(existingOwner.pid)) {
    throw new AgentLockError(lockPath, `process ${existingOwner.pid} is acquiring or recovering this lock.`);
  }

  return reclaimGuard(path, lockPath, existingOwner, owner);
}

async function reclaimGuard(path: string, lockPath: string, existingOwner: GuardOwner, owner: GuardOwner): Promise<GuardOwner> {
  const reclaimPath = `${path}.reclaim.${existingOwner.identity}`;
  try {
    await link(path, reclaimPath);
  } catch (cause) {
    throw new AgentLockError(lockPath, "another process may be recovering the acquisition guard.", { cause });
  }

  try {
    let linkedOwner: GuardOwner;
    try {
      linkedOwner = parseGuardOwner(await readFile(reclaimPath, "utf8"));
    } catch (cause) {
      throw new AgentLockError(lockPath, "acquisition guard ownership changed during recovery.", { cause });
    }
    if (!sameGuardOwner(linkedOwner, existingOwner)) {
      throw new AgentLockError(lockPath, "acquisition guard ownership changed during recovery.");
    }
    await unlink(path);
    try {
      await installGuard(path, owner);
    } catch (cause) {
      throw new AgentLockError(lockPath, "another process acquired the acquisition guard during recovery.", { cause });
    }
    return owner;
  } finally {
    await unlink(reclaimPath).catch(() => undefined);
  }
}

async function releaseGuard(path: string, lockPath: string, owner: GuardOwner): Promise<void> {
  let persistedOwner: GuardOwner;
  try {
    persistedOwner = parseGuardOwner(await readFile(path, "utf8"));
  } catch (cause) {
    throw new AgentLockError(lockPath, "could not verify acquisition guard ownership before release.", { cause });
  }
  if (!sameGuardOwner(persistedOwner, owner)) {
    throw new AgentLockError(lockPath, "acquisition guard ownership changed before release.");
  }
  await unlink(path);
}

async function installGuard(path: string, owner: GuardOwner): Promise<void> {
  const candidatePath = `${path}.candidate.${owner.identity}`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(candidatePath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(candidatePath, path);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(candidatePath).catch(() => undefined);
  }
}

function parseGuardOwner(value: string): GuardOwner {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("invalid guard owner");
  const owner = parsed as Partial<GuardOwner>;
  if (!Number.isSafeInteger(owner.pid) || (owner.pid ?? 0) < 1 || typeof owner.identity !== "string" || !UUID_PATTERN.test(owner.identity)) {
    throw new Error("invalid guard owner");
  }
  return { pid: owner.pid!, identity: owner.identity };
}

function sameGuardOwner(left: GuardOwner, right: GuardOwner): boolean {
  return left.pid === right.pid && left.identity === right.identity;
}

async function createLockFile(path: string): Promise<FileHandle> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`, "utf8");
    await handle.sync();
    return handle;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (handle) await unlink(path).catch(() => undefined);
    throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(isNodeError(error) && error.code === "ESRCH");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
