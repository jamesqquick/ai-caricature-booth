import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rmdir, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { ensurePrivateDirectory } from "./filesystem.js";

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
    try {
      await mkdir(acquisitionGuard, { mode: 0o700 });
    } catch (cause) {
      if (isNodeError(cause) && cause.code === "EEXIST") {
        throw new AgentLockError(path, "another process is acquiring or recovering this lock.", { cause });
      }
      throw new AgentLockError(path, "could not serialize lock acquisition.", { cause });
    }
    try {
      return await AgentLock.acquireGuarded(path);
    } finally {
      await rmdir(acquisitionGuard).catch(() => undefined);
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
