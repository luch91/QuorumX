jest.mock("../src/database", () => ({
  claimAssessmentJob: jest.fn(),
  deferSubmittedPoll: jest.fn(),
  finalizeAssessment: jest.fn(),
  ingestSnapshotProposals: jest.fn(),
  isSourcePollDue: jest.fn().mockResolvedValue(true),
  sourcePollOffset: jest.fn().mockResolvedValue(0),
  listSubmittedJobs: jest.fn(),
  markJobRetry: jest.fn(),
  markSubmittedTerminal: jest.fn(),
  quarantineSubmittedAssessment: jest.fn(),
  prepareSubmissionIntent: jest.fn().mockResolvedValue({ created: true, state: "prepared" }),
  markSubmissionUncertain: jest.fn(),
  recordSourceFailure: jest.fn(),
  recordSubmittedTransaction: jest.fn(),
  withDatabase: jest.fn(async (_url: string, task: (client: object) => Promise<unknown>) => task({})),
}));
jest.mock("../src/genlayer", () => ({
  findSubmittedTransaction: jest.fn(),
  getTransactionState: jest.fn(),
  readAssessment: jest.fn(),
  readDueDiligence: jest.fn(),
  submitAssessment: jest.fn(),
  submitDueDiligence: jest.fn(),
}));
jest.mock("../src/snapshot", () => ({ fetchRecentSnapshotProposals: jest.fn() }));

import {
  claimAssessmentJob,
  deferSubmittedPoll,
  finalizeAssessment,
  ingestSnapshotProposals,
  isSourcePollDue,
  sourcePollOffset,
  listSubmittedJobs,
  recordSubmittedTransaction,
  quarantineSubmittedAssessment,
  prepareSubmissionIntent,
  markSubmissionUncertain,
} from "../src/database";
import { DueDiligenceBoundaryError } from "../src/due_diligence";
import { runIndexerCycle } from "../src/cycle";
import { findSubmittedTransaction, getTransactionState, readAssessment, readDueDiligence, submitAssessment, submitDueDiligence } from "../src/genlayer";
import { fetchRecentSnapshotProposals } from "../src/snapshot";
import type { StoredAssessment, StoredDueDiligenceAssessment } from "../src/domain";

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

  it("durably schedules the next poll for a still-pending transaction", async () => {
    const submitted = { jobId: "1", attemptCount: 1, maxAttempts: 20, revisionId: "2",
      proposalKey: assessment.proposalKey, transactionId: `0x${"4".repeat(64)}`, transactionRowId: "3" };
    jest.mocked(listSubmittedJobs).mockResolvedValue([submitted]);
    jest.mocked(getTransactionState).mockResolvedValue({ state: "pending" });
    await runIndexerCycle({ ...settings, enableWrites: false });
    expect(deferSubmittedPoll).toHaveBeenCalledWith(expect.anything(), submitted);
  });

  it("submits v2 to its separate contract without reading or overwriting v1 state", async () => {
    const v2Address = "0x3333333333333333333333333333333333333333" as const;
    jest.mocked(claimAssessmentJob).mockResolvedValue({ ...job, assessmentVersion: "2" });
    jest.mocked(submitDueDiligence).mockResolvedValue(`0x${"5".repeat(64)}`);
    await runIndexerCycle({ ...settings, assessmentVersion: "2",
      genlayer: { ...settings.genlayer, dueDiligenceContractAddress: v2Address } });
    expect(readAssessment).not.toHaveBeenCalled();
    expect(submitDueDiligence).toHaveBeenCalledWith(expect.anything(), job.source, `qx:v2:${job.expectedContractContentHash}`);
    expect(recordSubmittedTransaction).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      `0x${"5".repeat(64)}`, "studionet", v2Address);
  });

  it("never resubmits Wanderlust when a prepared intent has an unknown outcome", async () => {
    jest.mocked(claimAssessmentJob).mockResolvedValue({ ...job, proposalKey: "snapshot:velvet-solace.test:wanderlust", assessmentVersion: "2" });
    jest.mocked(prepareSubmissionIntent).mockResolvedValueOnce({ created: false, state: "prepared" });
    const result = await runIndexerCycle({ ...settings, assessmentVersion: "2",
      genlayer: { ...settings.genlayer, dueDiligenceContractAddress: "0x3333333333333333333333333333333333333333" } });
    expect(submitDueDiligence).not.toHaveBeenCalled();
    expect(markSubmissionUncertain).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      proposalKey: "snapshot:velvet-solace.test:wanderlust",
    }));
    expect(result.errors).toContain("job 1: submission_outcome_unknown");
  });

  it("reconciles Wanderlust to the original external submission after restart", async () => {
    const recoveredHash = `0x${"a".repeat(64)}`;
    jest.mocked(claimAssessmentJob).mockResolvedValue({ ...job, proposalKey: "snapshot:velvet-solace.test:wanderlust", assessmentVersion: "2" });
    jest.mocked(prepareSubmissionIntent).mockResolvedValueOnce({ created: false, state: "prepared" });
    jest.mocked(findSubmittedTransaction).mockResolvedValueOnce(recoveredHash);
    const configured = { ...settings, assessmentVersion: "2" as const,
      genlayer: { ...settings.genlayer, dueDiligenceContractAddress: "0x3333333333333333333333333333333333333333" as const } };
    const result = await runIndexerCycle(configured);
    expect(submitDueDiligence).not.toHaveBeenCalled();
    expect(recordSubmittedTransaction).toHaveBeenCalledWith(expect.anything(), expect.anything(), recoveredHash,
      "studionet", configured.genlayer.dueDiligenceContractAddress);
    expect(result.transactionsRecovered).toBe(1);
  });

  it("claims only jobs for the enabled assessment version", async () => {
    await runIndexerCycle(settings);
    expect(claimAssessmentJob).toHaveBeenCalledWith(expect.anything(), expect.any(String), "1");
    await runIndexerCycle({ ...settings, assessmentVersion: "2" });
    expect(claimAssessmentJob).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), "2");
  });

  it("skips a source while its persisted failure backoff is active", async () => {
    jest.mocked(isSourcePollDue).mockResolvedValueOnce(false);
    const result = await runIndexerCycle({ ...settings, enableWrites: false });
    expect(fetchRecentSnapshotProposals).not.toHaveBeenCalled();
    expect(result.sourcesPolled).toBe(0);
  });

  it("advances the persisted page offset when a full Snapshot page is returned", async () => {
    jest.mocked(sourcePollOffset).mockResolvedValueOnce(40);
    jest.mocked(fetchRecentSnapshotProposals).mockResolvedValueOnce(Array.from({ length: 20 }, () => ({} as never)));
    await runIndexerCycle({ ...settings, enableWrites: false });
    expect(fetchRecentSnapshotProposals).toHaveBeenCalledWith("balancer.eth", expect.any(Function), 20, 15_000, 40);
    expect(ingestSnapshotProposals).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(),
      expect.any(Date), "1", 60);
  });

  it("reads the exact accepted v2 revision before finalizing", async () => {
    const expectedHash = assessment.contentHash;
    jest.mocked(listSubmittedJobs).mockResolvedValue([{
      jobId: "1", attemptCount: 1, maxAttempts: 20, revisionId: "2", proposalKey: assessment.proposalKey,
      transactionId: `0x${"6".repeat(64)}`, transactionRowId: "3", assessmentVersion: "2",
      expectedContractContentHash: expectedHash,
    }]);
    jest.mocked(getTransactionState).mockResolvedValue({ state: "accepted" });
    jest.mocked(readDueDiligence).mockResolvedValue({ ...assessment, assessmentVersion: "2" } as unknown as StoredDueDiligenceAssessment);
    await runIndexerCycle({ ...settings, enableWrites: false, assessmentVersion: "2",
      genlayer: { ...settings.genlayer, dueDiligenceContractAddress: "0x3333333333333333333333333333333333333333" } });
    expect(readDueDiligence).toHaveBeenCalledWith(expect.objectContaining({
      dueDiligenceContractAddress: "0x3333333333333333333333333333333333333333",
    }), assessment.proposalKey, expectedHash);
    expect(finalizeAssessment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ transactionRowId: "3" }));
  });

  it("leaves in-flight v2 transactions untouched when the v2 contract is disabled", async () => {
    jest.mocked(listSubmittedJobs).mockResolvedValue([{
      jobId: "1", attemptCount: 1, maxAttempts: 20, revisionId: "2", proposalKey: assessment.proposalKey,
      transactionId: `0x${"8".repeat(64)}`, transactionRowId: "3", assessmentVersion: "2",
      expectedContractContentHash: assessment.contentHash,
    }]);
    const result = await runIndexerCycle({ ...settings, enableWrites: false });
    expect(getTransactionState).not.toHaveBeenCalled();
    expect(result.errors).toEqual([]);
  });

  it("quarantines a deterministically invalid accepted v2 record", async () => {
    const submitted = {
      jobId: "1", attemptCount: 1, maxAttempts: 20, revisionId: "2", proposalKey: assessment.proposalKey,
      transactionId: `0x${"9".repeat(64)}`, transactionRowId: "3", assessmentVersion: "2" as const,
      expectedContractContentHash: assessment.contentHash,
    };
    jest.mocked(listSubmittedJobs).mockResolvedValue([submitted]);
    jest.mocked(getTransactionState).mockResolvedValue({ state: "accepted" });
    jest.mocked(readDueDiligence).mockRejectedValue(new DueDiligenceBoundaryError("Invalid v2 findings"));
    const result = await runIndexerCycle({ ...settings, enableWrites: false, assessmentVersion: "2",
      genlayer: { ...settings.genlayer, dueDiligenceContractAddress: "0x3333333333333333333333333333333333333333" } });
    expect(quarantineSubmittedAssessment).toHaveBeenCalledWith(expect.anything(), submitted, "invalid_v2_contract_record");
    expect(result.errors).toEqual([`transaction ${submitted.transactionId}: invalid_v2_contract_record`]);
  });

  it("does not finalize a transaction against the wrong source revision", async () => {
    jest.mocked(listSubmittedJobs).mockResolvedValue([{
      jobId: "1", attemptCount: 1, maxAttempts: 20, revisionId: "2", proposalKey: assessment.proposalKey,
      transactionId: `0x${"7".repeat(64)}`, transactionRowId: "3",
      expectedContractContentHash: "d".repeat(64),
    }]);
    jest.mocked(getTransactionState).mockResolvedValue({ state: "accepted" });
    jest.mocked(readAssessment).mockResolvedValue(assessment);
    await runIndexerCycle({ ...settings, enableWrites: false });
    expect(finalizeAssessment).not.toHaveBeenCalled();
  });
});
