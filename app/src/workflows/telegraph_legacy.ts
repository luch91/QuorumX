import { runSentinelCycle } from "../index";

/** Explicit migration-only entry point. GenLayer failures never call this. */
export const runLegacyTelegraphCycle = runSentinelCycle;
