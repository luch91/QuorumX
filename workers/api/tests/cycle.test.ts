jest.mock("../src/database", () => ({
  claimAssessmentJob: jest.fn(),
  finalizeAssessment: jest.fn(),
  ingestSnapshotProposals: jest.fn(),
  listSubmittedJobs: jest.fn(),
  markJobRetry: jest.fn(),
  markSubmittedTerminal: jest.fn(),
  recordSourceFailure: jest.fn(),
  recordSubmittedTransaction: jest.fn(),
  withDatabase: jest.fn(async (_url: string, task: (client: object) => Promise<unknown>) => task({})),
}));
jest.mock("../src/genlayer", () => ({
  getTransactionState: jest.fn(),
  readAssessment: jest.fn(),
  submitAssessment: jest.fn(),
}));
jest.mock("../src/snapshot", () => ({ fetchRecentSnapshotProposals: jest.fn() }));

import {
  claimAssessmentJob,
  finalizeAssessment,
  ingestSnapshotProposals,
  listSubmittedJobs,
  recordSubmittedTransaction,
} from "../src/database";
import { runIndexerCycle } from "../src/cycle";
import { getTransactionState, readAssessment, submitAssessment } from "../src/genlayer";
import { fetchRecentSnapshotProposals } from "../src/snapshot";
import type { StoredAssessment } from "../src/domain";

const assessment: StoredAssessment = {
  proposalKey: "snapshot:balancer.eth:p1",
  sourceLocatorHash: "a".repeat(64),
  contentHash: "b".repeat(64),
  riskLevel: "high",
  riskScore: 80,
  riskCategories: ["governance"],
  recommendation: "manual_review",
  summary: "Review this proposal.",
  assessedAt: "2026-09-29T00:00:00Z",
  provenance: "live",
};

const job = {
  id: "1",
  attemptCount: 1,
  maxAttempts: 20,
  revisionId: "2",
  revisionHash: "c".repeat(64),
  expectedContractContentHash: assessment.contentHash,
  proposalKey: assessment.proposalKey,
  source: { kind: "snapshot" as const, space: "balancer.eth", proposalId: "p1" },
};

const settings = {
  databaseUrl: "postgresql://runtime.invalid/quorumx",
  snapshotSpaces: ["balancer.eth"],
  snapshotLimit: 20,
  enableWrites: true,
  genlayer: {
    contractAddress: "0x1111111111111111111111111111111111111111" as const,
    privateKey: `0x${"2".repeat(64)}` as `0x${string}`,
  },
};

describe("indexer cycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(listSubmittedJobs).mockResolvedValue([]);
    jest.mocked(fetchRecentSnapshotProposals).mockResolvedValue([]);
    jest.mocked(ingestSnapshotProposals).mockResolvedValue({ proposalsSeen: 0, revisionsCreated: 0, jobsCreated: 0 });
    jest.mocked(claimAssessmentJob).mockResolvedValue(undefined);
  });

  it("indexes existing contract state only when its content matches the claimed revision", async () => {
    jest.mocked(claimAssessmentJob).mockResolvedValue(job);
    jest.mocked(readAssessment).mockResolvedValue(assessment);
    const result = await runIndexerCycle(settings);
    expect(finalizeAssessment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      jobId: job.id,
      indexedFrom: "existing_contract_state",
    }));
    expect(submitAssessment).not.toHaveBeenCalled();
    expect(result.jobsProcessed).toBe(1);
  });

  it("submits a changed revision instead of accepting stale contract state", async () => {
    jest.mocked(claimAssessmentJob).mockResolvedValue({ ...job, expectedContractContentHash: "d".repeat(64) });
    jest.mocked(readAssessment).mockResolvedValue(assessment);
    jest.mocked(submitAssessment).mockResolvedValue(`0x${"3".repeat(64)}`);
    await runIndexerCycle(settings);
    expect(submitAssessment).toHaveBeenCalledWith(
      settings.genlayer,
      job.source,
      `qx:${job.revisionHash}`,
    );
    expect(recordSubmittedTransaction).toHaveBeenCalledTimes(1);
    expect(finalizeAssessment).not.toHaveBeenCalled();
  });

  it("recovers an accepted submitted transaction into a finalized assessment", async () => {
    jest.mocked(listSubmittedJobs).mockResolvedValue([{
      jobId: "1",
      attemptCount: 1,
      maxAttempts: 20,
      revisionId: "2",
      proposalKey: assessment.proposalKey,
      transactionId: `0x${"4".repeat(64)}`,
      transactionRowId: "3",
    }]);
    jest.mocked(getTransactionState).mockResolvedValue({ state: "accepted" });
    jest.mocked(readAssessment).mockResolvedValue(assessment);
    const result = await runIndexerCycle({ ...settings, enableWrites: false });
    expect(finalizeAssessment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      transactionRowId: "3",
      indexedFrom: "submitted_transaction",
    }));
    expect(result.transactionsRecovered).toBe(1);
  });
});
