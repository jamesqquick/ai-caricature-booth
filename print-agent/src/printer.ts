import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConfigurationError } from "./config.js";
import type { AgentConfig } from "./types.js";

export type PrintResult = {
  message: string;
  durationMs: number;
  path?: string;
};

export interface Printer {
  readonly name: string;
  print(pdfBytes: Uint8Array, jobId: string): Promise<PrintResult>;
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

export class MockPrinter implements Printer {
  readonly name = "MockPrinter";

  constructor(private readonly spoolDir: string) {}

  async print(pdfBytes: Uint8Array, jobId: string): Promise<PrintResult> {
    const startedAt = Date.now();
    const path = join(this.spoolDir, `${safeFilePart(jobId)}.pdf`);
    try {
      await mkdir(this.spoolDir, { recursive: true });
      await writeFile(path, pdfBytes);
      return { message: `${this.name}: wrote spool file ${path}`, durationMs: Date.now() - startedAt, path };
    } catch (cause) {
      throw new PrintSubmissionError(jobId, `could not write mock spool file ${path}`, { cause });
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
    this.temporaryDirectory = dependencies.temporaryDirectory ?? tmpdir();
  }

  async print(pdfBytes: Uint8Array, jobId: string): Promise<PrintResult> {
    const startedAt = Date.now();
    const path = join(this.temporaryDirectory, `print-${safeFilePart(jobId)}-${randomUUID()}.pdf`);
    try {
      await writeFile(path, pdfBytes);
      const stdout = await this.submit(path, jobId);
      return {
        message: `${this.name}: CUPS accepted the job${stdout ? ` (${stdout})` : ""}`,
        durationMs: Date.now() - startedAt,
      };
    } catch (cause) {
      if (cause instanceof PrintSubmissionError) throw cause;
      throw new PrintSubmissionError(jobId, `could not create or submit temporary PDF ${path}`, { cause });
    } finally {
      await unlink(path).catch(() => undefined);
    }
  }

  private submit(path: string, jobId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.execFile(
        "lp",
        ["-d", this.printerName, "-o", "media=4x6", "-o", "fit-to-page", path],
        { timeout: 30_000 },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout.toString().trim());
            return;
          }
          const detail = stderr.toString().trim();
          reject(new PrintSubmissionError(jobId, `lp submission failed${detail ? `: ${detail}` : `: ${error.message}`}`, { cause: error }));
        },
      );
    });
  }
}

export function createPrinter(config: AgentConfig, packageRoot: string): Printer {
  if (config.printerDriver === "mock") return new MockPrinter(join(packageRoot, "spool"));
  return new CupsPrinter(config.printerName ?? "");
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
