import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AgentConfig } from "./types.js";

export type AgentDirectories = {
  outputDir: string;
  stateDir: string;
};

export function resolveAgentDirectories(config: AgentConfig, packageRoot: string, homeDir: string): AgentDirectories {
  const printerIdentity = `${config.printerDriver}\0${config.printerName ?? "default"}`;
  const instanceHash = createHash("sha256")
    .update(`${config.workerUrl}\0${config.eventSlug}\0${printerIdentity}`)
    .digest("hex")
    .slice(0, 16);

  return {
    outputDir: join(packageRoot, "output"),
    stateDir: config.stateDir ?? join(homeDir, ".ai-caricature-booth", "print-agent", `${config.eventSlug}-${instanceHash}`),
  };
}
