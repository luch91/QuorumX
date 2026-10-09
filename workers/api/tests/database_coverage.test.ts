import { claimAssessmentJob, nextSnapshotScanState } from "../src/database";

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
    expect(sql.indexOf("candidate.attempt_count asc")).toBeLessThan(sql.indexOf("case proposals.status"));
    expect(sql).toContain("case proposals.status when 'active' then 0 when 'pending' then 1 else 2 end");
    expect(sql).toContain("proposals.voting_ends_at asc nulls last");
    expect(sql).toContain("revisions.created_at asc");
    expect(sql).toContain("candidate.id asc");
  });
});
