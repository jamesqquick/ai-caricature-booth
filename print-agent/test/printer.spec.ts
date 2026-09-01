import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../src/config.js";
import { CupsPrinter, MockPrinter } from "../src/printer.js";

describe("printers", () => {
  it("writes mock jobs to a spool filename containing the job ID", async () => {
    const spoolDir = await mkdtemp(join(tmpdir(), "print-agent-spool-"));
    const printer = new MockPrinter(spoolDir);
    const result = await printer.print(Uint8Array.of(1, 2, 3), "job-123");
    expect(result.path).toBe(join(spoolDir, "job-123.pdf"));
    expect(await readFile(result.path!)).toEqual(Buffer.from([1, 2, 3]));
  });

  it("submits to lp with an argument array and never a shell command", async () => {
    const execFile = vi.fn((_file, _args, _options, callback) => callback(null, "request id is 1", ""));
    const printer = new CupsPrinter("DNP Printer; touch /tmp/pwned", { execFile });
    await printer.print(Uint8Array.of(1), "job-456");
    expect(execFile).toHaveBeenCalledWith(
      "lp",
      ["-d", "DNP Printer; touch /tmp/pwned", "-o", "media=4x6", "-o", "fit-to-page", expect.stringMatching(/print-job-456-/)],
      { timeout: 30_000 },
      expect.any(Function),
    );
  });

  it("rejects an empty CUPS printer name", () => {
    expect(() => new CupsPrinter("  ")).toThrow(ConfigurationError);
  });
});
