import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { AgentConfig } from "./types.js";

export type AgentDirectories = {
  outputDir: string;
  stateDir: string;
};

export function resolveAgentDirectories(config: AgentConfig, packageRoot: string, homeDir: string): AgentDirectories {
  const instanceHash = resolveConfigIdentity(config).slice(0, 16);

  return {
    outputDir: join(packageRoot, "output"),
    stateDir: config.stateDir
      ? resolve(config.stateDir)
      : join(homeDir, ".ai-caricature-booth", "print-agent", `${config.eventSlug}-${instanceHash}`),
  };
}

export function resolveAgentId(config: AgentConfig, installationId: string): string {
  return createHash("sha256")
    .update(`${resolveConfigIdentity(config)}\0${installationId}`)
    .digest("hex");
}

function resolveConfigIdentity(config: AgentConfig): string {
  const workerOrigin = new URL(config.workerUrl).origin;
  const printerDriver = config.printerDriver === "mock" ? "mock" : "dnp-ds620";
  const printerIdentity = config.printerName ?? "default";
  return createHash("sha256")
    .update(`${workerOrigin}\0${config.eventSlug}\0${printerDriver}\0${printerIdentity}`)
    .digest("hex");
}
