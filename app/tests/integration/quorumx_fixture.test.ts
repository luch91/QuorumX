import { runGenLayerAssessment, resumeGenLayerAssessment } from "../../src/workflows/genlayer_assessment";
import type { TransactionEvidenceRecord } from "../../src/genlayer/transaction_evidence";

it("runs and recovers a fixture-labelled assessment", async () => {
  const records: TransactionEvidenceRecord[] = [];
  const evidence = { append: async (record: TransactionEvidenceRecord) => { records.push(record); }, find: async (id: string) => records.slice().reverse().find((r) => r.transactionId === id) };
  const proposal = { canonicalId: "fixture:balancer-archived", source: { kind: "fixture" as const, fixtureId: "balancer-archived", canonicalUrl: "https://snapshot.box/#/proposal/archived" }, title: "Archived proposal", bodyText: "Review", choices: ["For", "Against"], linkedEvidenceUrls: [], status: "closed" as const };
  const gateway = { submitAssessment: jest.fn().mockResolvedValue("0xfixture"), waitForAssessment: jest.fn().mockResolvedValue({ transactionId: "0xfixture", proposalKey: proposal.canonicalId, state: "accepted" as const }), getAssessment: jest.fn().mockResolvedValue(undefined) };
  await runGenLayerAssessment({}, { source: { findEligible: async () => ({ proposal, attempts: [{ kind: "fixture" as const, outcome: "selected" as const, provenance: "fixture" as const }] }) }, gateway, evidence });
  await resumeGenLayerAssessment("0xfixture", { gateway, evidence });
  expect(gateway.submitAssessment).toHaveBeenCalledTimes(1);
  expect(records.map((record) => record.provenance)).toEqual(["fixture", "fixture", "fixture"]);
});
