import { execFile as nodeExecFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigurationError } from "./config.js";
import { ensurePrivateDirectory, writePrivateFile } from "./filesystem.js";
import { cupsPrintTitle, printArtifactFilename } from "./print-artifact.js";
import type { AgentConfig, PrintJob } from "./types.js";

export type PrintResult = {
  message: string;
  durationMs: number;
  path?: string;
};

export type PrintJobMetadata = Pick<PrintJob, "id">;

export interface Printer {
  readonly name: string;
  print(pdfBytes: Uint8Array, job: PrintJobMetadata): Promise<PrintResult>;
}

type ExecFile = (
  file: string,
  args: readonly string[],
  options: { timeout: number },
  callback: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void,
) => unknown;

export class PrintSubmissionError extends Error {
  readonly name = "PrintSubmissionError";

  constructor(public readonly jobId: string, message: string, options?: ErrorOptions) {
    super(`Print job ${jobId}: ${message}`, options);
  }
}

export class PrintOutcomeUncertainError extends Error {
  readonly name = "PrintOutcomeUncertainError";

  constructor(public readonly jobId: string, message: string, options?: ErrorOptions) {
    super(`Print job ${jobId}: submission outcome is uncertain: ${message}`, options);
  }
}

export class MockPrinter implements Printer {
  readonly name = "MockPrinter";

  constructor(private readonly spoolDir: string) {}

  async print(pdfBytes: Uint8Array, job: PrintJobMetadata): Promise<PrintResult> {
    const startedAt = Date.now();
    try {
      const path = join(this.spoolDir, printArtifactFilename(job.id));
      await ensurePrivateDirectory(this.spoolDir);
      await writePrivateFile(path, pdfBytes);
      return { message: `${this.name}: wrote spool file ${path}`, durationMs: Date.now() - startedAt, path };
    } catch (cause) {
      throw new PrintSubmissionError(job.id, "could not write mock spool file", { cause });
    }
  }
}

export class CupsPrinter implements Printer {
  readonly name: string;
  private readonly printerName: string;
  private readonly execFile: ExecFile;
  private readonly temporaryDirectory: string;

  constructor(printerName: string, dependencies: { execFile?: ExecFile; temporaryDirectory?: string } = {}) {
    this.printerName = printerName.trim();
    if (!this.printerName) {
      throw new ConfigurationError("PRINTER_NAME", "A nonempty CUPS printer name is required.");
    }
    this.name = `CUPS(${this.printerName})`;
    this.execFile = dependencies.execFile ?? (nodeExecFile as ExecFile);
    this.temporaryDirectory = dependencies.temporaryDirectory ?? join(tmpdir(), "ai-caricature-booth-print-agent");
  }

  async print(pdfBytes: Uint8Array, job: PrintJobMetadata): Promise<PrintResult> {
    const startedAt = Date.now();
    let path: string | undefined;
    try {
      path = join(this.temporaryDirectory, printArtifactFilename(job.id));
      await ensurePrivateDirectory(this.temporaryDirectory);
      await writePrivateFile(path, pdfBytes);
      const stdout = await this.submit(path, job);
      return {
        message: `${this.name}: CUPS accepted the job${stdout ? ` (${stdout})` : ""}`,
        durationMs: Date.now() - startedAt,
      };
    } catch (cause) {
      if (cause instanceof PrintSubmissionError || cause instanceof PrintOutcomeUncertainError) throw cause;
      throw new PrintSubmissionError(job.id, "could not create or submit temporary PDF", { cause });
    } finally {
      if (path) await unlink(path).catch(() => undefined);
    }
  }

  private submit(path: string, job: PrintJobMetadata): Promise<string> {
    return new Promise((resolve, reject) => {
      this.execFile(
        "lp",
        ["-d", this.printerName, "-t", cupsPrintTitle(job.id), "-o", "media=4x6", "-o", "fit-to-page", path],
        { timeout: 30_000 },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout.toString().trim());
            return;
          }
          const detail = stderr.toString().trim();
          reject(new PrintOutcomeUncertainError(job.id, `lp failed or timed out after invocation${detail ? `: ${detail}` : `: ${error.message}`}`, { cause: error }));
        },
      );
    });
  }
}

export function createPrinter(config: AgentConfig, packageRoot: string): Printer {
  if (config.printerDriver === "mock") return new MockPrinter(join(packageRoot, "spool"));
  return new CupsPrinter(config.printerName ?? "");
}
