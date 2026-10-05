import { assessmentContentHash, assessmentIdempotencyKey, resumeGenLayerAssessment, runGenLayerAssessment } from "../../src/workflows/genlayer_assessment";
import type { GovernanceProposal } from "../../src/domain/governance_proposal";
import type { GenLayerGateway } from "../../src/genlayer/gateway";
import type { TransactionEvidenceRecord, TransactionEvidenceStore } from "../../src/genlayer/transaction_evidence";

const proposal: GovernanceProposal = { canonicalId: "fixture:archived", source: { kind: "fixture", fixtureId: "archived", canonicalUrl: "https://example.org/p" }, title: "Upgrade", bodyText: "Execute", choices: ["For", "Against"], linkedEvidenceUrls: [], votingEndsAt: "2026-10-01T00:00:00Z", status: "active" };

function evidenceStore() {
  const records: TransactionEvidenceRecord[] = [];
  const store: TransactionEvidenceStore = { append: async (r) => { records.push(r); }, find: async (id) => records.slice().reverse().find((r) => r.transactionId === id) };
  return { records, store };
}

function gateway(overrides: Partial<GenLayerGateway> = {}): GenLayerGateway {
  return { submitAssessment: jest.fn().mockResolvedValue("0xtx"), waitForAssessment: jest.fn().mockResolvedValue({ transactionId: "0xtx", proposalKey: proposal.canonicalId, state: "accepted" }), getAssessment: jest.fn().mockResolvedValue(undefined), ...overrides };
}

describe("GenLayer assessment workflow", () => {
  it("does not submit without an eligible proposal", async () => {
    const gw = gateway(); const evidence = evidenceStore();
    const result = await runGenLayerAssessment({}, { source: { findEligible: async () => ({ attempts: [] }) }, gateway: gw, evidence: evidence.store });
    expect(result.reason).toBe("no_eligible_proposal"); expect(gw.submitAssessment).not.toHaveBeenCalled();
  });

  it("uses a deterministic idempotency key", () => {
    expect(assessmentIdempotencyKey(proposal)).toBe(assessmentIdempotencyKey({ ...proposal }));
  });

  it("matches the Python contract content hash for Snapshot material", () => {
    expect(assessmentContentHash({
      ...proposal,
      canonicalId: "snapshot:velvet-solace.test:p1",
      source: { kind: "snapshot", space: "velvet-solace.test", proposalId: "p1" },
    })).toBe("a015f38adc11098f119be10871c46356a7356de2b9167618e22a3bdf5f287d7c");
  });

  it("reuses an accepted assessment only when its content hash matches", async () => {
    const matching = gateway({ getAssessment: jest.fn().mockResolvedValue({
      assessmentVersion: "1", proposalKey: proposal.canonicalId, sourceLocatorHash: "a".repeat(64),
      contentHash: assessmentContentHash(proposal), riskLevel: "low", riskScore: 10,
      riskCategories: ["governance"], recommendation: "allow", summary: "Current",
      assessedAt: "2026-09-28T00:00:00Z", consensusState: "accepted", provenance: "fixture",
    }) });
    const result = await runGenLayerAssessment({}, {
      source: { findEligible: async () => ({ proposal, attempts: [] }) }, gateway: matching,
      evidence: evidenceStore().store, now: () => new Date("2026-09-28T00:00:00Z"),
    });
    expect(result.transaction?.transactionId).toBe("existing");
    expect(matching.submitAssessment).not.toHaveBeenCalled();
  });

  it("does not present a stale accepted assessment as current", async () => {
    const stale = gateway({ getAssessment: jest.fn().mockResolvedValue({
      assessmentVersion: "1", proposalKey: proposal.canonicalId, sourceLocatorHash: "a".repeat(64), contentHash: "b".repeat(64),
      riskLevel: "low", riskScore: 10, riskCategories: ["governance"], recommendation: "allow",
      summary: "Stale", assessedAt: "2026-09-27T00:00:00Z", consensusState: "accepted", provenance: "fixture",
    }) });
    const result = await runGenLayerAssessment({}, {
      source: { findEligible: async () => ({ proposal, attempts: [] }) }, gateway: stale,
      evidence: evidenceStore().store, now: () => new Date("2026-09-28T00:00:00Z"),
    });
    expect(result.transaction?.transactionId).toBe("0xtx");
    expect(stale.submitAssessment).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong proposal identity", { proposalKey: "fixture:ember" }],
    ["wrong assessment version", { assessmentVersion: "2" }],
    ["unreadable provenance", { provenance: "unknown" }],
  ])("does not reuse an assessment with %s", async (_label, override) => {
    const candidate = gateway({ getAssessment: jest.fn().mockResolvedValue({
      assessmentVersion: "1", proposalKey: proposal.canonicalId, sourceLocatorHash: "a".repeat(64),
      contentHash: assessmentContentHash(proposal), riskLevel: "low", riskScore: 10,
      riskCategories: ["governance"], recommendation: "allow", summary: "Candidate",
      assessedAt: "2026-09-28T00:00:00Z", consensusState: "accepted", provenance: "fixture",
      ...override,
    }) });
    await runGenLayerAssessment({}, {
      source: { findEligible: async () => ({ proposal, attempts: [] }) }, gateway: candidate,
      evidence: evidenceStore().store, now: () => new Date("2026-09-28T00:00:00Z"),
    });
    expect(candidate.submitAssessment).toHaveBeenCalledTimes(1);
  });

  it("records submission before waiting and keeps fixture provenance", async () => {
    const events: string[] = []; const evidence = evidenceStore();
    const originalAppend = evidence.store.append; evidence.store.append = async (r) => { events.push(`evidence:${r.state}`); await originalAppend(r); };
    const gw = gateway({ waitForAssessment: jest.fn().mockImplementation(async () => { events.push("wait"); return { transactionId: "0xtx", proposalKey: proposal.canonicalId, state: "accepted" }; }) });
    await runGenLayerAssessment({}, { source: { findEligible: async () => ({ proposal, attempts: [] }) }, gateway: gw, evidence: evidence.store, now: () => new Date("2026-09-28T00:00:00Z") });
    expect(events).toEqual(["evidence:submitted", "wait", "evidence:accepted"]);
    expect(evidence.records.every((r) => r.provenance === "fixture")).toBe(true);
  });

  it("resumes without a second submission", async () => {
    const evidence = evidenceStore(); await evidence.store.append({ recordedAt: "2026-09-28T00:00:00Z", transactionId: "0xtx", proposalKey: proposal.canonicalId, state: "submitted", source: proposal.source, provenance: "fixture" });
    const gw = gateway(); await resumeGenLayerAssessment("0xtx", { gateway: gw, evidence: evidence.store });
    expect(gw.submitAssessment).not.toHaveBeenCalled(); expect(gw.waitForAssessment).toHaveBeenCalledWith("0xtx", proposal.canonicalId);
  });
});
