export const BACKFILL_DAOS = ["SafeDAO", "Arbitrum DAO", "ENS DAO", "Balancer"] as const;

export type BackfillState = "eligible" | "queued" | "processing" | "accepted" | "skipped" | "retrying" | "failed";

export interface BackfillRunConfig {
  perDaoLimit: number;
  totalLimit: number;
  windowDays: number;
  dailySubmissionBudget: number;
}
