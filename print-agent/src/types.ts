export type PrinterDriver = "mock" | "dnp" | "dnp-ds620";

export type AgentConfig = {
  workerUrl: string;
  eventSlug: string;
  printAgentToken: string;
  pollIntervalMs: number;
  batchSize: number;
  printerDriver: PrinterDriver;
  printerName?: string;
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

export type PrintStatus = "printed" | "failed";

export type Logger = Pick<Console, "info" | "warn" | "error">;

export type Sleep = (delayMs: number, signal?: AbortSignal) => Promise<void>;
