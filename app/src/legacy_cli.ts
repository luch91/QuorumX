import { runLegacyTelegraphCycle } from "./workflows/telegraph_legacy";

void runLegacyTelegraphCycle().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
