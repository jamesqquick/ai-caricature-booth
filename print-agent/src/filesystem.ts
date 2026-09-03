import { chmod, mkdir, writeFile } from "node:fs/promises";

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function writePrivateFile(path: string, data: Uint8Array | string): Promise<void> {
  await writeFile(path, data, { mode: 0o600 });
  await chmod(path, 0o600);
}
