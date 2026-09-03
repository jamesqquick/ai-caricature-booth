export type PrinterDriver = "mock" | "dnp" | "dnp-ds620";

export type AgentConfig = {
  workerUrl: string;
  eventSlug: string;
  printAgentToken: string;
  pollIntervalMs: number;
  batchSize: number;
  printerDriver: PrinterDriver;
  printerName?: string;
  stateDir?: string;
};

export type PrintJob = {
  id: string;
  sessionId: string;
  eventId: number;
  eventSlug: string;
  sceneName: string;
  postcardUrl: string;
  createdAt: number;
  claimToken: string;
};

export type ClaimIdentity = Pick<PrintJob, "id" | "claimToken">;

export type PrintStatus = "printed" | "failed";

export type Logger = Pick<Console, "info" | "warn" | "error">;

export type Sleep = (delayMs: number, signal?: AbortSignal) => Promise<void>;
