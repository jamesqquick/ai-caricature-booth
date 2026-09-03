import { randomUUID } from "node:crypto";
import { chmod, link, open, readFile, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { ensurePrivateDirectory } from "./filesystem.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InstallationIdentityError extends Error {
  readonly name = "InstallationIdentityError";

  constructor(public readonly path: string, message: string, options?: ErrorOptions) {
    super(`Print agent installation identity ${path}: ${message}`, options);
  }
}

export async function loadOrCreateInstallationId(stateDirectory: string): Promise<string> {
  await ensurePrivateDirectory(stateDirectory);
  const path = join(stateDirectory, "installation-id");
  try {
    return await loadInstallationId(path);
  } catch (cause) {
    if (!(isNodeError(cause) && cause.code === "ENOENT")) {
      throw new InstallationIdentityError(path, "could not load a valid identity", { cause });
    }
  }

  const installationId = randomUUID();
  const candidatePath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let candidate: FileHandle | undefined;
  try {
    candidate = await open(candidatePath, "wx", 0o600);
    await candidate.writeFile(`${installationId}\n`, "utf8");
    await candidate.sync();
    await candidate.close();
    candidate = undefined;
    await link(candidatePath, path);
    await syncDirectory(stateDirectory);
    return installationId;
  } catch (cause) {
    if (isNodeError(cause) && cause.code === "EEXIST") {
      try {
        return await loadInstallationId(path);
      } catch (loadCause) {
        throw new InstallationIdentityError(path, "could not load the concurrently created identity", { cause: loadCause });
      }
    }
    throw new InstallationIdentityError(path, "could not atomically persist identity", { cause });
  } finally {
    await candidate?.close().catch(() => undefined);
    await unlink(candidatePath).catch(() => undefined);
  }
}

async function loadInstallationId(path: string) {
  const installationId = (await readFile(path, "utf8")).trim().toLowerCase();
  if (!UUID_PATTERN.test(installationId)) throw new Error("invalid installation UUID");
  await chmod(path, 0o600);
  return installationId;
}

async function syncDirectory(path: string) {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
