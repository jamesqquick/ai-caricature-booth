import { describe, expect, it } from "vitest";
import { ConfigurationError, loadConfig } from "../src/config.js";

const validEnv = {
  WORKER_URL: "https://booth.example.com/",
  EVENT_SLUG: "env-event",
  PRINT_AGENT_TOKEN: "secret-placeholder",
};

describe("loadConfig", () => {
  it("loads defaults and gives CLI event slug precedence", () => {
    expect(loadConfig(validEnv, ["--event-slug", "cli-event"])).toEqual({
      workerUrl: "https://booth.example.com",
      eventSlug: "cli-event",
      printAgentToken: "secret-placeholder",
      pollIntervalMs: 5_000,
      batchSize: 5,
      printerDriver: "mock",
    });
  });

  it.each([
    [{ ...validEnv, WORKER_URL: "" }, [], "WORKER_URL"],
    [{ ...validEnv, EVENT_SLUG: "" }, [], "EVENT_SLUG"],
    [{ ...validEnv, PRINT_AGENT_TOKEN: "" }, [], "PRINT_AGENT_TOKEN"],
    [{ ...validEnv, POLL_INTERVAL_MS: "0" }, [], "POLL_INTERVAL_MS"],
    [{ ...validEnv, BATCH_SIZE: "1.5" }, [], "BATCH_SIZE"],
    [{ ...validEnv, BATCH_SIZE: "21" }, [], "BATCH_SIZE"],
    [{ ...validEnv, PRINTER_DRIVER: "laser" }, [], "PRINTER_DRIVER"],
    [{ ...validEnv, PRINTER_DRIVER: "dnp", PRINTER_NAME: "  " }, [], "PRINTER_NAME"],
    [{ ...validEnv, EVENT_SLUG: "Invalid Slug" }, [], "EVENT_SLUG"],
    [{ ...validEnv, WORKER_URL: "http://booth.example.com" }, [], "WORKER_URL"],
    [{ ...validEnv, PRINT_AGENT_STATE_DIR: "  " }, [], "PRINT_AGENT_STATE_DIR"],
    [{ ...validEnv, PRINT_AGENT_STATE_DIR: "relative/state" }, [], "PRINT_AGENT_STATE_DIR"],
    [validEnv, ["--event-slug"], "--event-slug"],
  ])("throws an actionable typed error for invalid configuration", (env, argv, field) => {
    expect(() => loadConfig(env, argv)).toThrow(ConfigurationError);
    expect(() => loadConfig(env, argv)).toThrow(String(field));
  });

  it("accepts an absolute custom state directory", () => {
    expect(loadConfig({ ...validEnv, PRINT_AGENT_STATE_DIR: "/var/lib/caricature-print-agent" }, [])).toMatchObject({
      stateDir: "/var/lib/caricature-print-agent",
    });
  });

  it("canonicalizes the Worker URL to its origin", () => {
    expect(loadConfig({ ...validEnv, WORKER_URL: "https://booth.example.com/deployment/path///" }, [])).toMatchObject({
      workerUrl: "https://booth.example.com",
    });
  });

  it("accepts both DNP aliases and strict integer bounds", () => {
    expect(loadConfig({ ...validEnv, BATCH_SIZE: "20", POLL_INTERVAL_MS: "1", PRINTER_DRIVER: "dnp-ds620", PRINTER_NAME: "DNP DS620" }, [])).toMatchObject({
      batchSize: 20,
      pollIntervalMs: 1,
      printerDriver: "dnp-ds620",
      printerName: "DNP DS620",
    });
  });

  it.each(["http://localhost:4321", "http://127.0.0.1:4321", "http://[::1]:4321"])("allows loopback HTTP for local development: %s", (workerUrl) => {
    expect(loadConfig({ ...validEnv, WORKER_URL: workerUrl }, [])).toMatchObject({ workerUrl });
  });
});
