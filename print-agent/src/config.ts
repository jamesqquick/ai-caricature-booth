import type { AgentConfig, PrinterDriver } from "./types.js";

export class ConfigurationError extends Error {
  readonly name = "ConfigurationError";

  constructor(public readonly field: string, message: string) {
    super(`${field}: ${message}`);
  }
}

const EVENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>, argv: string[]): AgentConfig {
  const cliEventSlug = parseEventSlugFlag(argv);
  const workerUrl = required(env.WORKER_URL, "WORKER_URL", "Set it to the booth Worker origin, for example https://booth.example.com.");
  const eventSlug = cliEventSlug ?? required(env.EVENT_SLUG, "EVENT_SLUG", "Set EVENT_SLUG or pass --event-slug <slug>.");
  const printAgentToken = required(env.PRINT_AGENT_TOKEN, "PRINT_AGENT_TOKEN", "Set it to the Worker print-agent bearer token.");
  const printerDriver = parsePrinterDriver(env.PRINTER_DRIVER);
  const printerName = env.PRINTER_NAME?.trim() || undefined;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(workerUrl);
  } catch {
    throw new ConfigurationError("WORKER_URL", "Must be a valid http:// or https:// URL.");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new ConfigurationError("WORKER_URL", "Must use http:// or https://.");
  }
  if (!EVENT_SLUG_PATTERN.test(eventSlug.trim()) || eventSlug.length > 120) {
    throw new ConfigurationError("EVENT_SLUG", "Must be at most 120 characters using lowercase letters, numbers, and single hyphens.");
  }
  if (printerDriver !== "mock" && !printerName) {
    throw new ConfigurationError("PRINTER_NAME", "A nonempty CUPS printer name is required for dnp and dnp-ds620.");
  }

  return {
    workerUrl: parsedUrl.origin + parsedUrl.pathname.replace(/\/+$/, ""),
    eventSlug: eventSlug.trim(),
    printAgentToken,
    pollIntervalMs: parseInteger(env.POLL_INTERVAL_MS, "POLL_INTERVAL_MS", 5_000, 1),
    batchSize: parseInteger(env.BATCH_SIZE, "BATCH_SIZE", 5, 1, 20),
    printerDriver,
    ...(printerName ? { printerName } : {}),
  };
}

function parseEventSlugFlag(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument?.startsWith("--event-slug=")) {
      const value = argument.slice("--event-slug=".length).trim();
      if (!value) throw new ConfigurationError("--event-slug", "Provide a nonempty slug.");
      return value;
    }
    if (argument === "--event-slug") {
      const value = argv[index + 1]?.trim();
      if (!value || value.startsWith("--")) {
        throw new ConfigurationError("--event-slug", "Provide a value, for example --event-slug nyc-2026.");
      }
      return value;
    }
  }
  return undefined;
}

function required(value: string | undefined, field: string, action: string): string {
  if (!value?.trim()) throw new ConfigurationError(field, `Missing required value. ${action}`);
  return value.trim();
}

function parseInteger(value: string | undefined, field: string, defaultValue: number, min: number, max?: number): number {
  if (value === undefined || value.trim() === "") return defaultValue;
  if (!/^\d+$/.test(value.trim())) {
    throw new ConfigurationError(field, `Must be an integer${max ? ` from ${min} to ${max}` : ` of at least ${min}`}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    throw new ConfigurationError(field, `Must be an integer${max ? ` from ${min} to ${max}` : ` of at least ${min}`}.`);
  }
  return parsed;
}

function parsePrinterDriver(value: string | undefined): PrinterDriver {
  const driver = value?.trim().toLowerCase() || "mock";
  if (driver === "mock" || driver === "dnp" || driver === "dnp-ds620") return driver;
  throw new ConfigurationError("PRINTER_DRIVER", 'Must be one of "mock", "dnp", or "dnp-ds620".');
}
