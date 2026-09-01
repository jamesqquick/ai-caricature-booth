import "dotenv/config";
import { formatRecoveryFailure, recoveryExitCode, runRecoveryCommand } from "./recovery.js";

runRecoveryCommand(process.env, process.argv.slice(2))
  .then(({ jobId, outcome }) => console.log(`[recovery] resolved print job ${jobId} as ${outcome}.`))
  .catch((error: unknown) => {
    console.error(`[recovery] fatal: ${formatRecoveryFailure(error, process.env.PRINT_AGENT_TOKEN)}`);
    process.exitCode = recoveryExitCode(error);
  });
