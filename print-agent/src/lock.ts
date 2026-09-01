import { open, unlink, type FileHandle } from "node:fs/promises";
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
    let handle: FileHandle | undefined;
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.sync();
      return new AgentLock(path, handle);
    } catch (cause) {
      await handle?.close().catch(() => undefined);
      if (handle) await unlink(path).catch(() => undefined);
      if (isNodeError(cause) && cause.code === "EEXIST") {
        throw new AgentLockError(path, "another agent may be running. Verify no agent is active, then remove this stale lock file if the prior process crashed.", { cause });
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
