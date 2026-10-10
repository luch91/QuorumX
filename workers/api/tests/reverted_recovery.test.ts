import { prepareSubmissionIntent, recordSubmittedTransaction, repairStrandedSubmittedJobs } from "../src/database";

const claimedJob = {
  id: "1644",
  attemptCount: 2,
  maxAttempts: 20,
  revisionId: "9",
  revisionHash: "a".repeat(64),
  expectedContractContentHash: "b".repeat(64),
  proposalKey: "snapshot:safe.eth:proposal",
  source: { kind: "snapshot" as const, space: "safe.eth", proposalId: "proposal" },
  assessmentVersion: "3" as const,
  assessmentSchemaVersion: "3.3",
  assessmentRunId: "backfill:3.3:1:9",
  jobKind: "backfill" as const,
};

describe("reverted Format 3 recovery", () => {
  it("rearms only a definitively reverted recorded intent for a fresh retry", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("rearmed as")) {
        return { rows: [{ created: false, state: "prepared", transaction_hash: null, retry_rearmed: true }] };
      }
      // This is the pre-hotfix result: an existing recorded intent prevents
      // resubmission even though its only transaction is reverted.
      return { rows: [{ created: false, state: "recorded", transaction_hash: `0x${"1".repeat(64)}`, retry_rearmed: false }] };
    });

    await expect(prepareSubmissionIntent({ query } as never, claimedJob, claimedJob.assessmentRunId!)).resolves.toEqual({
      created: false, state: "prepared", retryRearmed: true,
    });
    expect(query.mock.calls[0][0]).toContain("transactions.state = 'reverted'");
    expect(query.mock.calls[0][0]).toContain("jobs.attempt_count < jobs.max_attempts");
  });

  it("does not reattach a reverted transaction hash as a submitted attempt", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql === "begin" || sql === "rollback") return { rows: [] };
      if (sql.includes("insert into quorumx.transactions")) return { rows: [{ job_id: claimedJob.id, state: "reverted" }] };
      return { rows: [] };
    });

    await expect(recordSubmittedTransaction({ query } as never, claimedJob, `0x${"2".repeat(64)}`,
      "studionet", "0x3333333333333333333333333333333333333333")).rejects.toThrow("not a viable active attempt");
    expect(query).toHaveBeenCalledWith("rollback");
  });

  it("repairs generic submitted-plus-reverted jobs without touching undetermined attempts", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql === "begin" || sql === "commit" || sql.includes("update quorumx.backfill_candidates")) return { rows: [] };
      if (sql.includes("with stranded as")) {
        return { rows: [{ job_id: claimedJob.id, retryable: true, job_kind: "backfill" }] };
      }
      return { rows: [] };
    });

    await expect(repairStrandedSubmittedJobs({ query } as never)).resolves.toBe(1);
    const repairSql = query.mock.calls.find(([sql]) => String(sql).includes("with stranded as"))?.[0] as string;
    expect(repairSql).toContain("latest.state = 'reverted'");
    expect(repairSql).toContain("active.state = 'submitted'");
    expect(repairSql).not.toContain("latest.state = 'undetermined'");
  });

  it("dead-letters an exhausted stranded retry and fails its backfill candidate", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql === "begin" || sql === "commit" || sql.includes("update quorumx.backfill_candidates") || sql.includes("update quorumx.backfill_runs")) return { rows: [] };
      if (sql.includes("with stranded as")) {
        return { rows: [{ job_id: claimedJob.id, retryable: false, job_kind: "backfill" }] };
      }
      return { rows: [] };
    });

    await expect(repairStrandedSubmittedJobs({ query } as never)).resolves.toBe(1);
    const candidateUpdate = query.mock.calls.find(([sql]) => String(sql).includes("update quorumx.backfill_candidates"));
    expect(candidateUpdate?.[1]).toEqual([claimedJob.id, "failed"]);
  });
});
