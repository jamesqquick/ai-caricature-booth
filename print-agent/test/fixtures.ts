import type { AgentConfig, PrintJob } from "../src/types.js";

export const config: AgentConfig = {
  workerUrl: "https://booth.example.com",
  eventSlug: "test-event",
  printAgentToken: "test-token",
  pollIntervalMs: 5_000,
  batchSize: 5,
  printerDriver: "mock",
};

export const job: PrintJob = {
  id: "a".repeat(32),
  sessionId: "123e4567-e89b-12d3-a456-426614174000",
  eventId: 42,
  eventSlug: "test-event",
  sceneName: "Central Park",
  postcardUrl: "/api/events/42/sessions/123/postcard",
  createdAt: 1_700_000_000,
  claimToken: "b".repeat(32),
};
