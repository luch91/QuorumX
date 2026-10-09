const {
  assertExecutionSucceeded,
  assertReleaseRecord,
  validateReleaseConfig,
} = require("../verify_v3_3_release.cjs");
const { renderDueDiligence } = require("../../frontend/app.js");

describe("v3.3 release verification", () => {
  test("rejects a finalized transaction whose execution failed", () => {
    expect(() => assertExecutionSucceeded({ status_name: "FINALIZED", consensus_data: {
      leader_receipt: [{ mode: "leader", execution_result: "ERROR", genvm_result: { raw_error: "boom" } }],
    } })).toThrow("execution did not succeed");
  });

  test("accepts only an execution-success receipt", () => {
    expect(assertExecutionSucceeded({ status_name: "FINALIZED", consensus_data: {
      leader_receipt: [{ mode: "leader", execution_result: "SUCCESS", genvm_result: { raw_error: null } }],
    } })).toBe(true);
  });

  test("validates exact schema, run, content hash and evidence references", () => {
    expect(assertReleaseRecord({ assessmentVersion: "3", assessmentSchemaVersion: "3.3", assessmentRunId: "run-1",
      proposalKey: "snapshot:safe.eth:p1", contentHash: "a".repeat(64), evidence: [{ id: "proposal" }],
      materialClaims: [{ evidence: ["proposal"] }], findings: [{ evidence: ["proposal"] }],
    }, { runId: "run-1", proposalKey: "snapshot:safe.eth:p1", contentHash: "a".repeat(64) })).toBe(true);
  });

  test("requires all release DAO spaces and preserves a v2 rollback target", () => {
    const active = { assessmentVersion: "3", v3Address: "0x" + "3".repeat(40), v2Address: "0x" + "2".repeat(40),
      spaces: ["balancer.eth", "safe.eth", "arbitrumfoundation.eth", "ens.eth"] };
    expect(validateReleaseConfig(active)).toEqual({ ...active, rollbackAssessmentVersion: "2" });
    expect(() => validateReleaseConfig({ ...active, spaces: ["balancer.eth"] })).toThrow("missing required DAO");
  });

  test("carries a verified release record through Living Index rendering", () => {
    const record = {
      assessmentVersion: "3", assessmentSchemaVersion: "3.3", assessmentRunId: "run-1",
      proposalKey: "snapshot:safe.eth:p1", contentHash: "a".repeat(64),
      overview: { purpose: "Transfer 5M ARB to the grants Safe", requestedActions: ["Transfer 5M ARB"], assetsAffected: ["5M ARB"], permissionsChanged: [], controlChanges: [] },
      evidence: [{ id: "proposal", type: "proposal", locator: "https://snapshot.box/p1", description: "Snapshot proposal", authority: "primary", verificationScope: "validator_retrieved_proposal" }],
      materialClaims: [{ id: "c1", claim: "The proposal asserts 200,000 users", sourceExcerpt: "200,000 users", proposalAssertion: true, claimScope: "external_factual", status: "unverified", explanation: "No independent adapter applies.", evidence: ["proposal"], evidenceAuthority: ["primary"], confidence: "low", verificationMethod: "" }],
      materialActions: [], findings: [], safeguardGaps: [], executionMap: [], unresolvedQuestions: [],
      reviewPriority: "normal", reviewPriorityExplanation: "Normal human review priority.",
      externalEvidenceState: "not_attempted", externalEvidenceStates: { safe: "not_attempted", returnedFunds: "not_attempted", governanceHistory: "not_attempted" },
      consensus: { state: "accepted", method: "independent_structured_derivation_v3_3" },
    };
    expect(assertReleaseRecord(record, { runId: "run-1", proposalKey: record.proposalKey, contentHash: record.contentHash })).toBe(true);
    const html = renderDueDiligence(record);
    expect(html).toContain("Proposal assertions: 1");
    expect(html).toContain("Unverified");
    expect(html).toContain("Independent validators retrieved");
  });
});
