import { describe, expect, it } from "vitest";
import { resolveAgentDirectories, resolveAgentId } from "../src/paths.js";
import { config } from "./fixtures.js";

describe("resolveAgentDirectories", () => {
  it("uses one machine-level state directory across distinct package roots", () => {
    const first = resolveAgentDirectories(config, "/checkouts/one/print-agent", "/Users/operator");
    const second = resolveAgentDirectories(config, "/checkouts/two/print-agent", "/Users/operator");

    expect(first.stateDir).toBe(second.stateDir);
    expect(first.stateDir).toMatch(/^\/Users\/operator\/\.ai-caricature-booth\/print-agent\/test-event-[0-9a-f]{16}$/);
    expect(first.outputDir).not.toBe(second.outputDir);
  });

  it("keys default state by event and printer identity without secrets", () => {
    const first = resolveAgentDirectories({ ...config, printerDriver: "dnp", printerName: "DNP DS620" }, "/app", "/home/operator");
    const second = resolveAgentDirectories({ ...config, eventSlug: "other-event", printerDriver: "dnp", printerName: "DNP DS620" }, "/app", "/home/operator");
    const third = resolveAgentDirectories({ ...config, printerDriver: "dnp", printerName: "Lobby Printer" }, "/app", "/home/operator");
    const fourth = resolveAgentDirectories({ ...config, workerUrl: "https://other.example.com", printerDriver: "dnp", printerName: "DNP DS620" }, "/app", "/home/operator");

    expect(new Set([first.stateDir, second.stateDir, third.stateDir, fourth.stateDir]).size).toBe(4);
    expect(first.stateDir).not.toContain(config.printAgentToken);
    expect(first.stateDir).not.toContain("DNP DS620");
  });

  it("normalizes a configured absolute state directory", () => {
    expect(resolveAgentDirectories({ ...config, stateDir: "/private/other/../print-state" }, "/app", "/home/operator").stateDir)
      .toBe("/private/print-state");
  });

  it("canonicalizes Worker origins and DNP aliases for agent and lock identity", () => {
    const first = { ...config, workerUrl: "https://booth.example.com/path/", printerDriver: "dnp" as const, printerName: "DNP DS620" };
    const second = { ...config, workerUrl: "https://booth.example.com/other", printerDriver: "dnp-ds620" as const, printerName: "DNP DS620" };

    expect(resolveAgentId(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveAgentId(first)).toBe(resolveAgentId(second));
    expect(resolveAgentDirectories(first, "/app", "/home/operator").stateDir)
      .toBe(resolveAgentDirectories(second, "/app", "/home/operator").stateDir);
    expect(resolveAgentId(first)).not.toContain(config.printAgentToken);
  });
});
