import type { Client } from "pg";
import { createBackfillDryRun, ingestSnapshotProposals } from "./database";
import { fetchClosedSnapshotBackfill } from "./snapshot";
import { snapshotSourceDefinitions } from "./sources";
import { BACKFILL_DAOS, type BackfillRunConfig, type BackfillState } from "./backfill_types";

export { BACKFILL_DAOS } from "./backfill_types";

export interface BackfillOptions { perDaoLimit?: number; totalLimit?: number; windowDays?: number; dailySubmissionBudget?: number }
export type BoundedBackfillOptions = BackfillRunConfig;
export type BackfillCommand = { action: "dry-run"; options: BoundedBackfillOptions }
  | { action: "start" | "pause" | "resume" | "status"; runId: string };

export function parseBackfillCommand(value: unknown): BackfillCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("invalid_request_body");
  const body = value as Record<string, unknown>;
  if (body.action === "dry-run") {
    const optionNames = ["perDaoLimit", "totalLimit", "windowDays", "dailySubmissionBudget"] as const;
    for (const name of optionNames) {
      if (body[name] !== undefined && typeof body[name] !== "number") throw new RangeError(`invalid_${name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`);
    }
    return { action: "dry-run", options: boundedBackfillOptions(body as BackfillOptions) };
  }
  if (body.action !== "start" && body.action !== "pause" && body.action !== "resume" && body.action !== "status") {
    throw new RangeError("invalid_action");
  }
  if (typeof body.runId !== "string" || !/^\d+$/.test(body.runId)) throw new RangeError("invalid_run_id");
  return { action: body.action, runId: body.runId };
}

export function boundedBackfillOptions(value: BackfillOptions): BoundedBackfillOptions {
  const result = { perDaoLimit: value.perDaoLimit ?? 25, totalLimit: value.totalLimit ?? 100,
    windowDays: value.windowDays ?? 90, dailySubmissionBudget: value.dailySubmissionBudget ?? 4 };
  if (!Number.isInteger(result.perDaoLimit) || result.perDaoLimit < 1 || result.perDaoLimit > 25) throw new RangeError("invalid_per_dao_limit");
  if (!Number.isInteger(result.totalLimit) || result.totalLimit < 1 || result.totalLimit > 100) throw new RangeError("invalid_total_limit");
  if (!Number.isInteger(result.windowDays) || result.windowDays < 1 || result.windowDays > 90) throw new RangeError("invalid_window_days");
  if (!Number.isInteger(result.dailySubmissionBudget) || result.dailySubmissionBudget < 1 || result.dailySubmissionBudget > 25) throw new RangeError("invalid_daily_submission_budget");
  return result;
}

const emptyCounts = () => ({ eligible: 0, queued: 0, processing: 0, accepted: 0, skipped: 0, retrying: 0, failed: 0, remaining: 0 });

export function summarizeBackfill(rows: Array<{ dao: string; state: BackfillState }>) {
  const byDao = Object.fromEntries(BACKFILL_DAOS.map((dao) => [dao, emptyCounts()]));
  const total = emptyCounts();
  for (const row of rows) {
    const counts = byDao[row.dao];
    if (!counts) continue;
    counts[row.state] += 1;
    total[row.state] += 1;
  }
  for (const counts of [...Object.values(byDao), total]) {
    counts.remaining = counts.eligible + counts.queued + counts.processing + counts.retrying;
  }
  return { byDao, total };
}

export function roundRobinBackfill(groups: Map<string, string[]>, totalLimit: number) {
  const result: Array<{ dao: string; canonicalId: string }> = [];
  for (let index = 0; result.length < totalLimit; index += 1) {
    let added = false;
    for (const dao of BACKFILL_DAOS) {
      const canonicalId = groups.get(dao)?.[index];
      if (canonicalId && result.length < totalLimit) {
        result.push({ dao, canonicalId });
        added = true;
      }
    }
    if (!added) break;
  }
  return result;
}

export async function prepareBackfillDryRun(
  client: Client, value: BackfillOptions, fetcher: typeof fetch = fetch, now = new Date(),
): Promise<string> {
  const options = boundedBackfillOptions(value);
  const groups = new Map<string, string[]>();
  const fetched = [];
  for (const source of snapshotSourceDefinitions) {
    const proposals = await fetchClosedSnapshotBackfill(source.space, now, options.perDaoLimit, options.windowDays, fetcher);
    fetched.push({ source, proposals });
  }
  for (const { source, proposals } of fetched) {
    await ingestSnapshotProposals(client, source, proposals, now, "3", "3.3");
    groups.set(source.displayName, proposals.map((proposal) => proposal.canonicalId));
  }
  return createBackfillDryRun(client, roundRobinBackfill(groups, options.totalLimit), options);
}
