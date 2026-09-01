import "dotenv/config";
import { formatRecoveryFailure, runRecoveryCommand } from "./recovery.js";

runRecoveryCommand(process.env, process.argv.slice(2)).catch((error: unknown) => {
  console.error(`[recovery] fatal: ${formatRecoveryFailure(error, process.env.PRINT_AGENT_TOKEN)}`);
  process.exitCode = 1;
});
