import type { SourceAttempt } from "../../ingest/sources/fallback_source";
export function presentSourceAttempts(attempts: SourceAttempt[]): object { return { sources: attempts }; }
