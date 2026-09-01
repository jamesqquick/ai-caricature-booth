import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../src/config.js";
import { CupsPrinter, MockPrinter } from "../src/printer.js";

describe("printers", () => {
  it("writes mock jobs to unique private spool files", async () => {
    const parent = await mkdtemp(join(tmpdir(), "print-agent-spool-"));
    const spoolDir = join(parent, "spool");
    const printer = new MockPrinter(spoolDir);
    const first = await printer.print(Uint8Array.of(1, 2, 3), "../../job-123");
    const second = await printer.print(Uint8Array.of(1, 2, 3), "../../job-123");
    expect(first.path).not.toBe(second.path);
    expect(first.path).toMatch(new RegExp(`^${spoolDir}/print-[0-9a-f-]{36}\\.pdf$`));
    expect(await readFile(first.path!)).toEqual(Buffer.from([1, 2, 3]));
    if (process.platform !== "win32") {
      expect((await stat(spoolDir)).mode & 0o777).toBe(0o700);
      expect((await stat(first.path!)).mode & 0o777).toBe(0o600);
    }
  });

  it("classifies any lp callback error as an uncertain submission outcome", async () => {
    const execFile = vi.fn((_file, _args, _options, callback) => callback(new Error("timeout"), "", "unknown"));
    const printer = new CupsPrinter("DNP", { execFile, temporaryDirectory: await mkdtemp(join(tmpdir(), "print-agent-cups-")) });
    await expect(printer.print(Uint8Array.of(1), "job-456")).rejects.toMatchObject({ name: "PrintOutcomeUncertainError" });
  });

  it("submits to lp with an argument array and never a shell command", async () => {
    const parent = await mkdtemp(join(tmpdir(), "print-agent-cups-"));
    const temporaryDirectory = join(parent, "private");
    let submittedFileMode: number | undefined;
    const execFile = vi.fn(async (_file, args, _options, callback) => {
      submittedFileMode = (await stat(args.at(-1)!)).mode & 0o777;
      callback(null, "request id is 1", "");
    });
    const printer = new CupsPrinter("DNP Printer; touch /tmp/pwned", { execFile, temporaryDirectory });
    await printer.print(Uint8Array.of(1), "job-456");
    expect(execFile).toHaveBeenCalledWith(
      "lp",
      ["-d", "DNP Printer; touch /tmp/pwned", "-o", "media=4x6", "-o", "fit-to-page", expect.stringMatching(/print-[0-9a-f-]{36}\.pdf$/)],
      { timeout: 30_000 },
      expect.any(Function),
    );
    if (process.platform !== "win32") {
      expect((await stat(temporaryDirectory)).mode & 0o777).toBe(0o700);
      expect(submittedFileMode).toBe(0o600);
    }
  });

  it("rejects an empty CUPS printer name", () => {
    expect(() => new CupsPrinter("  ")).toThrow(ConfigurationError);
  });
});
