import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { handleJob } from "./job-handler.js";
import { FileAckOutbox } from "./outbox.js";
import { PrintPoller } from "./poller.js";
import { createPrinter } from "./printer.js";
import { ackJob, claimJobs, releaseJob } from "./queue.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const config = loadConfig(process.env, process.argv.slice(2));
  const printer = createPrinter(config, packageRoot);
  const outputDir = join(packageRoot, "output");
  const controller = new AbortController();
  const stop = (signal: NodeJS.Signals) => {
    console.info(`[agent] received ${signal}; stopping after the active job and releasing unprocessed claims.`);
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.info("Caricature Booth Print Agent");
  console.info(`worker=${config.workerUrl} event=${config.eventSlug} printer=${printer.name}`);
  console.info(`pollIntervalMs=${config.pollIntervalMs} batchSize=${config.batchSize}`);

  const poller = new PrintPoller(config, {
    claimJobs: () => claimJobs(config),
    handleJob: (job) => handleJob(config, job, printer, { outputDir }),
    ackJob: (job, status, error) => ackJob(config, job, status, error),
    releaseJob: (job) => releaseJob(config, job),
    outbox: new FileAckOutbox(join(outputDir, "state", "pending-acks.json")),
  });
  await poller.run(controller.signal);
}

main().catch((error: unknown) => {
  console.error(`[agent] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
