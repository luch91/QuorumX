import { projectTransactionEvidence } from "../../src/genlayer/transaction_evidence";

it("projects only redacted transaction evidence", () => {
  const record = projectTransactionEvidence({ recordedAt: "2026-09-28T00:00:00Z", transactionId: "0xtx", proposalKey: "fixture:x", state: "submitted", source: { kind: "fixture", fixtureId: "x", canonicalUrl: "https://example.org/x" }, provenance: "fixture" });
  const encoded = JSON.stringify(record);
  expect(encoded).toContain('"provenance":"fixture"');
  expect(encoded).not.toContain("privateKey");
  expect(encoded).not.toContain("bodyText");
});
