import { claimAssessmentJob, createBackfillDryRun, nextSnapshotScanState } from "../src/database";

describe("durable proposal coverage", () => {
  const initial = { generation: 1, skip: 0, newProposalCount: 0, stableSweepCount: 0,
    sweepFingerprint: "", coverage: "scanning" as const, reconciliationOffset: 0 };

  it("advances bounded pages and requires a zero-discovery sweep before coverage", () => {
    const afterFirst = nextSnapshotScanState({ ...initial, sweepFingerprint: "page-1" }, 50,
      { skip: 0, first: 50, exhausted: false, pageIds: [] }, new Date("2026-10-07T00:00:00Z"));
    expect(afterFirst).toMatchObject({ generation: 1, skip: 50, newProposalCount: 50, coverage: "scanning" });
    const after125 = nextSnapshotScanState({ ...afterFirst, sweepFingerprint: "complete-a" }, 75,
      { skip: 100, first: 50, exhausted: true, pageIds: [] }, new Date("2026-10-07T00:05:00Z"));
    expect(after125).toMatchObject({ generation: 2, skip: 0, newProposalCount: 0, coverage: "scanning" });
    const converged = nextSnapshotScanState({ ...after125, sweepFingerprint: "complete-a" }, 0,
      { skip: 100, first: 50, exhausted: true, pageIds: [] }, new Date("2026-10-07T00:10:00Z"));
    expect(converged).toMatchObject({ generation: 3, skip: 0, coverage: "covered" });
  });

  it("does not certify coverage when a boundary mutation changes the complete page sequence", () => {
    const prior = { ...initial, generation: 3, lastSweepFingerprint: "before-mutation", sweepFingerprint: "after-boundary-shift" };
    const result = nextSnapshotScanState(prior, 0, { skip: 100, first: 50, exhausted: true, pageIds: [] },
      new Date("2026-10-07T00:15:00Z"));
    expect(result).toMatchObject({ coverage: "scanning", lastSweepFingerprint: "after-boundary-shift" });
  });

  it("claims only within source capacity using the documented fair order", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await claimAssessmentJob(client as never, "worker", "3", "3.3");
    const sql = client.query.mock.calls.map((call) => call[0]).find((query) => query.includes("eligible_candidate"));
    expect(sql).toContain("recent_transactions.submitted_at >= now() - interval '24 hours'");
    expect(sql).toContain("reserved_jobs.status = 'processing'");
    expect(client.query.mock.calls.map((call) => call[0]).join("\n")).toContain("for update\n    ");
    expect(sql).toContain("for update of candidate skip locked");
    expect(sql.indexOf("candidate.job_kind")).toBeLessThan(sql.indexOf("candidate.attempt_count asc"));
    expect(sql).toContain("backfill_runs.status = 'running'");
    expect(sql).toContain("daily_submission_budget");
    expect(sql).toContain("backfill_usage");
    expect(sql).toContain("backfill_usage.submitted_count + backfill_usage.reserved_count");
    expect(sql).toContain("select min(daily_submission_budget)");
    expect(sql).toContain("submitted_jobs.job_kind = 'live'");
    expect(sql).toContain("reserved_jobs.job_kind = 'live'");
    expect(sql.indexOf("case proposals.status")).toBeLessThan(sql.indexOf("candidate.attempt_count asc"));
    expect(sql).toContain("case proposals.status when 'active' then 0 when 'pending' then 1 else 2 end");
    expect(sql).toContain("proposals.voting_ends_at asc nulls last");
    expect(sql).toContain("revisions.created_at asc");
    expect(sql).toContain("candidate.id asc");
  });

  it("reports pre-existing accepted format 3 records as skipped", async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: "9" }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({}) };
    await createBackfillDryRun(client as never, [{ dao: "SafeDAO", canonicalId: "snapshot:safe.eth:p1" }],
      { perDaoLimit: 25, totalLimit: 100, windowDays: 90, dailySubmissionBudget: 4 });
    const sql = client.query.mock.calls[2][0];
    expect(sql).toContain("then 'skipped'");
    expect(sql).toContain("then 'existing_format3_assessment'");
  });
});
