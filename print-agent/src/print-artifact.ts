import { randomUUID } from "node:crypto";

const PRINT_JOB_ID_PATTERN = /^[0-9a-f]{32}$/i;

export class InvalidPrintJobIdError extends Error {
  readonly name = "InvalidPrintJobIdError";

  constructor() {
    super("Print job ID must be exactly 32 hexadecimal characters.");
  }
}

export function printArtifactFilename(jobId: string): string {
  if (!PRINT_JOB_ID_PATTERN.test(jobId)) throw new InvalidPrintJobIdError();
  return `print-${jobId.toLowerCase()}-${randomUUID()}.pdf`;
}

export function cupsPrintTitle(jobId: string): string {
  if (!PRINT_JOB_ID_PATTERN.test(jobId)) throw new InvalidPrintJobIdError();
  return `AI Caricature Booth ${jobId.toLowerCase()}`;
}
