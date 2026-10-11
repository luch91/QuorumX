jest.mock("../src/database", () => ({
  advanceSnapshotReconciliation: jest.fn(),
  claimAssessmentJob: jest.fn(),
  deferSubmittedPoll: jest.fn(),
  finalizeAssessment: jest.fn(),
  getSnapshotScanState: jest.fn(),
  ingestSnapshotProposals: jest.fn(),
  isSourcePollDue: jest.fn().mockResolvedValue(true),
  listOpenSnapshotProposalIds: jest.fn(),
  listSubmittedJobs: jest.fn(),
  markJobRetry: jest.fn(),
  markSubmittedTerminal: jest.fn(),
  quarantineSubmittedAssessment: jest.fn(),
  prepareSubmissionIntent: jest.fn().mockResolvedValue({ created: true, state: "prepared" }),
  repairStrandedSubmittedJobs: jest.fn().mockResolvedValue(0),
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
  readDueDiligenceV3: jest.fn(),
  submitAssessment: jest.fn(),
  submitDueDiligence: jest.fn(),
  submitDueDiligenceV3: jest.fn(),
}));
jest.mock("../src/snapshot", () => ({ fetchOpenSnapshotProposalPage: jest.fn(), fetchSnapshotProposalsByIds: jest.fn() }));

import {
  advanceSnapshotReconciliation,
  claimAssessmentJob,
  deferSubmittedPoll,
  finalizeAssessment,
  getSnapshotScanState,
  ingestSnapshotProposals,
  isSourcePollDue,
  listOpenSnapshotProposalIds,
  listSubmittedJobs,
  recordSourceFailure,
  recordSubmittedTransaction,
  quarantineSubmittedAssessment,
  prepareSubmissionIntent,
  repairStrandedSubmittedJobs,
  markSubmissionUncertain,
} from "../src/database";
import { DueDiligenceBoundaryError } from "../src/due_diligence";
import { runIndexerCycle } from "../src/cycle";
import { findSubmittedTransaction, getTransactionState, readAssessment, readDueDiligence, readDueDiligenceV3, submitAssessment, submitDueDiligence, submitDueDiligenceV3 } from "../src/genlayer";
import { fetchOpenSnapshotProposalPage, fetchSnapshotProposalsByIds } from "../src/snapshot";
import type { StoredAssessment, StoredDueDiligenceAssessment, StoredDueDiligenceV3Assessment } from "../src/domain";
import { contractCanonicalJson, sha256 } from "../src/canonical";

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

beforeAll(async () => {
  assessment.sourceLocatorHash = await sha256(contractCanonicalJson(job.source));
});

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
    jest.mocked(repairStrandedSubmittedJobs).mockResolvedValue(0);
    jest.mocked(recordSourceFailure).mockResolvedValue();
    jest.mocked(getSnapshotScanState).mockResolvedValue({ generation: 1, skip: 0, newProposalCount: 0, stableSweepCount: 0, sweepFingerprint: "", coverage: "scanning", reconciliationOffset: 0 });
    jest.mocked(fetchOpenSnapshotProposalPage).mockResolvedValue({ proposals: [], first: 20, skip: 0, exhausted: true });
    jest.mocked(listOpenSnapshotProposalIds).mockResolvedValue([]);
    jest.mocked(fetchSnapshotProposalsByIds).mockResolvedValue([]);
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

  it("checks the newest page while resuming an older page so new proposals meet the freshness target", async () => {
    jest.mocked(getSnapshotScanState).mockResolvedValue({ generation: 1, skip: 50, newProposalCount: 50, stableSweepCount: 0, sweepFingerprint: "page-1", coverage: "scanning", reconciliationOffset: 0 });
    const open = { externalId: "new", canonicalId: "snapshot:balancer.eth:new", source: { kind: "snapshot" as const, space: "balancer.eth", proposalId: "new" },
      authorAddress: "0x1111111111111111111111111111111111111111" as const, canonicalUrl: "https://snapshot.box/new", title: "New", bodyText: "Body", choices: [], linkedEvidenceUrls: [], status: "active" as const, assessmentEligible: true };
    jest.mocked(fetchOpenSnapshotProposalPage)
      .mockResolvedValueOnce({ proposals: [], first: 50, skip: 50, exhausted: true })
      .mockResolvedValueOnce({ proposals: [open], first: 50, skip: 0, exhausted: true });
    await runIndexerCycle({ ...settings, snapshotLimit: 50, enableWrites: false });
    expect(fetchOpenSnapshotProposalPage).toHaveBeenNthCalledWith(1, "balancer.eth", 50, expect.anything(), 50);
    expect(fetchOpenSnapshotProposalPage).toHaveBeenNthCalledWith(2, "balancer.eth", 0, expect.anything(), 50);
    expect(ingestSnapshotProposals).toHaveBeenCalledWith(expect.anything(), expect.anything(), [open], expect.any(Date), "1", "1",
      { skip: 50, first: 50, exhausted: true, pageIds: [] });
  });

  it("does not commit progress when a resumed Snapshot page fails", async () => {
    jest.mocked(getSnapshotScanState).mockResolvedValue({ generation: 2, skip: 50, newProposalCount: 50, stableSweepCount: 0, sweepFingerprint: "page-1", coverage: "scanning", reconciliationOffset: 0 });
    jest.mocked(fetchOpenSnapshotProposalPage).mockRejectedValueOnce(new Error("middle page failed"));
    const result = await runIndexerCycle({ ...settings, enableWrites: false });
    expect(result.errors).toContain("snapshot:balancer.eth: middle page failed");
    expect(ingestSnapshotProposals).not.toHaveBeenCalled();
    expect(advanceSnapshotReconciliation).not.toHaveBeenCalled();
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

  it("submits a fresh Format 3 attempt after a definitively reverted attempt is rearmed", async () => {
    const freshHash = `0x${"b".repeat(64)}`;
    const v3Address = "0x3333333333333333333333333333333333333333" as const;
    jest.mocked(claimAssessmentJob).mockResolvedValue({
      ...job,
      assessmentVersion: "3",
      assessmentSchemaVersion: "3.3",
      assessmentRunId: "backfill:3.3:1:1644",
      jobKind: "backfill",
    });
    // A database rearm retains the intent row for audit/idempotency, but makes a
    // new attempt explicitly eligible after the recorded transaction reverted.
    jest.mocked(prepareSubmissionIntent).mockResolvedValueOnce({
      created: false,
      state: "prepared",
      retryRearmed: true,
    });
    jest.mocked(submitDueDiligenceV3).mockResolvedValueOnce(freshHash);

    await runIndexerCycle({ ...settings, assessmentVersion: "3", assessmentSchemaVersion: "3.3",
      genlayer: { ...settings.genlayer, dueDiligenceV3ContractAddress: v3Address } });

    expect(findSubmittedTransaction).not.toHaveBeenCalled();
    expect(submitDueDiligenceV3).toHaveBeenCalledWith(expect.anything(), job.source, "backfill:3.3:1:1644", v3Address);
    expect(recordSubmittedTransaction).toHaveBeenCalledWith(expect.anything(), expect.anything(), freshHash,
      "studionet", v3Address);
  });

  it("routes a new schema 3.4 job to the separately configured immutable contract", async () => {
    const v34Address = "0x4444444444444444444444444444444444444444" as const;
    const transaction = `0x${"c".repeat(64)}`;
    jest.mocked(claimAssessmentJob).mockResolvedValue({
      ...job,
      assessmentVersion: "3",
      assessmentSchemaVersion: "3.4",
      assessmentRunId: "qx:v3:3.4:revision",
    });
    jest.mocked(submitDueDiligenceV3).mockResolvedValueOnce(transaction);

    await runIndexerCycle({ ...settings, assessmentVersion: "3", assessmentSchemaVersion: "3.4",
      genlayer: { ...settings.genlayer, dueDiligenceContracts: { "3.4": v34Address } } });

    expect(submitDueDiligenceV3).toHaveBeenCalledWith(expect.anything(), job.source, "qx:v3:3.4:revision", v34Address);
    expect(recordSubmittedTransaction).toHaveBeenCalledWith(expect.anything(), expect.anything(), transaction, "studionet", v34Address);
  });

  it("continues queued schema 3.3 work under a schema 3.4 rollout without bypassing queue priority", async () => {
    const v33Address = "0x3333333333333333333333333333333333333333" as const;
    const v34Address = "0x4444444444444444444444444444444444444444" as const;
    const transaction = `0x${"d".repeat(64)}`;
    jest.mocked(claimAssessmentJob).mockResolvedValue({
      ...job,
      assessmentVersion: "3",
      assessmentSchemaVersion: "3.3",
      assessmentRunId: "backfill:3.3:1:preserved",
      jobKind: "backfill",
    });
    jest.mocked(submitDueDiligenceV3).mockResolvedValueOnce(transaction);

    await runIndexerCycle({ ...settings, assessmentVersion: "3", assessmentSchemaVersion: "3.4",
      genlayer: { ...settings.genlayer, dueDiligenceContracts: { "3.3": v33Address, "3.4": v34Address } } });

    expect(claimAssessmentJob).toHaveBeenCalledWith(expect.anything(), expect.any(String), "3", ["3.3", "3.4"]);
    expect(submitDueDiligenceV3).toHaveBeenCalledWith(expect.anything(), job.source, "backfill:3.3:1:preserved", v33Address);
  });

  it("claims only jobs for the enabled assessment version", async () => {
    await runIndexerCycle(settings);
    expect(claimAssessmentJob).toHaveBeenCalledWith(expect.anything(), expect.any(String), "1", "1");
    await runIndexerCycle({ ...settings, assessmentVersion: "2" });
    expect(claimAssessmentJob).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), "2", "2");
  });

  it("skips a source while its persisted failure backoff is active", async () => {
    jest.mocked(isSourcePollDue).mockResolvedValueOnce(false);
    const result = await runIndexerCycle({ ...settings, enableWrites: false });
    expect(fetchOpenSnapshotProposalPage).not.toHaveBeenCalled();
    expect(result.sourcesPolled).toBe(0);
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
    }), assessment.proposalKey, expectedHash, undefined);
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

  it("recovers an in-flight v3 transaction through its stored historical contract address", async () => {
    const historical = "0x4444444444444444444444444444444444444444" as const;
    jest.mocked(listSubmittedJobs).mockResolvedValue([{
      jobId: "9", attemptCount: 1, maxAttempts: 20, revisionId: "2", proposalKey: assessment.proposalKey,
      transactionId: `0x${"9".repeat(64)}`, transactionRowId: "8", assessmentVersion: "3",
      assessmentSchemaVersion: "3.2", assessmentRunId: "legacy-run", contractAddress: historical,
      expectedContractContentHash: assessment.contentHash,
    }]);
    jest.mocked(getTransactionState).mockResolvedValue({ state: "accepted" });
    jest.mocked(readDueDiligenceV3).mockResolvedValue({ ...assessment, assessmentVersion: "3",
      assessmentSchemaVersion: "3.2" } as unknown as StoredDueDiligenceV3Assessment);
    await runIndexerCycle({ ...settings, enableWrites: false });
    expect(readDueDiligenceV3).toHaveBeenCalledWith(settings.genlayer, assessment.proposalKey,
      assessment.contentHash, historical, undefined);
    expect(finalizeAssessment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      assessmentRunId: "legacy-run", assessmentSchemaVersion: "3.2",
    }));
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
