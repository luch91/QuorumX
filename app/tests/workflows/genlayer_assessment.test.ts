import { assessmentIdempotencyKey, resumeGenLayerAssessment, runGenLayerAssessment } from "../../src/workflows/genlayer_assessment";
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
