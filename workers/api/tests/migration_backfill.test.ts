import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("bounded backfill migration", () => {
  const sql = readFileSync(resolve(process.cwd(), "database/migrations/0013_bounded_format3_backfill.sql"), "utf8");
  it("adds durable controls, observability, and live-first scheduling metadata", () => {
    expect(sql).toContain("job_kind");
    expect(sql).toContain("backfill_runs");
  expect(sql).toContain("backfill_candidates");
  expect(sql).toContain("backfill_candidates_job_identity_fkey");
  expect(sql).toContain("backfill_runs_one_active_idx");
  expect(sql).toContain("drop constraint if exists assessment_jobs_backfill_shape_check");
    expect(sql).toContain("daily_submission_budget");
    expect(sql).toContain("unique (run_id, revision_id)");
    expect(sql).toContain("quorumx_runtime");
  });
});
