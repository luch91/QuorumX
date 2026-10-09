import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { claimStatusCounts, parseDueDiligence } from "../src/due_diligence";
import { revisionChanges } from "../src/revision_changes";
import { claimAssessmentJob } from "../src/database";

const key = "snapshot:dao.eth:p1";
const hash = "a".repeat(64);

function report() {
  return {
    assessmentVersion: "2", proposalKey: key, contentHash: hash, sourceLocatorHash: "b".repeat(64),
    overview: { purpose: "Fund a program", requestedActions: ["Transfer 5M ARB"], assetsAffected: ["5M ARB"],
      permissionsChanged: [], controlChanges: [] },
    evidence: [{ id: "e1", type: "proposal", locator: "https://snapshot.box/#/s:dao.eth/proposal/p1",
      contentHash: hash, description: "Proposal body", verificationScope: "validator_retrieved_proposal" }],
    materialClaims: [{ id: "c1", claim: "200k users", sourceExcerpt: "200k users", counterExcerpt: "",
      claimScope: "external_factual", status: "unverified", explanation: "No independent data reviewed",
      evidence: ["e1"], confidence: "low" }],
    findings: [{ id: "f1", type: "treasury_exposure", title: "Treasury transfer", sourceExcerpt: "5M ARB",
      observation: "5M ARB would move", whyItMatters: "Control changes", severity: "high",
      confidence: "medium", evidence: ["e1"], impact: "", existingSafeguards: ["3/5 Safe"],
      missingSafeguards: ["Clawback not identified"], enforcementMechanism: "3/5 signatures",
      recoveryMechanism: "", humanDependencies: ["Safe signers"], technicalDependencies: [],
      reversible: false, uncertainty: "",
      consensus: { state: "accepted", method: "source_grounded_material_facts_v2" } }],
    executionMap: [{ id: "s1", order: 1, action: "Transfer 5M ARB", actor: "DAO", target: "Safe",
      asset: "ARB", amount: "5000000", dependency: "", reversible: false, evidence: ["e1"] }],
    unresolvedQuestions: [{ id: "q1", question: "Who verifies milestones?", whyItMatters: "Disbursement depends on it",
      relatedFindingIds: ["f1"], evidenceGap: "" }],
    reviewPriority: "high", reviewPriorityExplanation: "High review priority: Treasury transfer.",
    assessedAt: "2026-10-03T00:00:00Z", provenance: "live",
    consensus: { state: "accepted", method: "source_grounded_material_facts_v2" },
  };
}

describe("due diligence v2 boundary", () => {
  it("filters durable job claims by the enabled assessment version", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await claimAssessmentJob(client as never, "worker-a", "1");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("candidate.assessment_version = $2"),
      ["worker-a", "1", "1"]);
    const sql = jest.mocked(client.query).mock.calls
      .map(([query]) => String(query)).find((query) => query.includes("eligible_candidate"))!;
    expect(sql).toContain("lease_expires_at");
    expect(sql).toContain("next_poll_at");
    expect(sql).toContain("attempt_count asc");
  });
  it("parses a bounded finding with proposal evidence and counts claim statuses", () => {
    const parsed = parseDueDiligence(JSON.stringify(report()), key);
    expect(parsed?.reviewPriority).toBe("high");
    expect(parsed?.findings[0].evidence).toEqual(["e1"]);
    expect(claimStatusCounts(parsed!.materialClaims)).toMatchObject({ unverified: 1, supported: 0 });
  });

  it("accepts the contract maximum of six existing safeguards", () => {
    const eclipse = report();
    eclipse.proposalKey = "snapshot:velvet-solace.test:eclipse";
    eclipse.findings[0].existingSafeguards = Array.from({ length: 6 }, (_, index) => `Safeguard ${index + 1}`);
    expect(parseDueDiligence(eclipse, eclipse.proposalKey)?.findings[0].existingSafeguards).toHaveLength(6);
  });

  it("rejects fabricated authority, unsupported external claims and false priority", () => {
    const badEvidence = report();
    badEvidence.evidence[0].verificationScope = "operator_assertion";
    expect(() => parseDueDiligence(badEvidence, key)).toThrow("evidence authority");
    const badClaim = report();
    badClaim.materialClaims[0].status = "supported";
    expect(() => parseDueDiligence(badClaim, key)).toThrow("cannot verify");
    const badPriority = report();
    badPriority.reviewPriority = "low";
    expect(() => parseDueDiligence(badPriority, key)).toThrow("review priority");
  });

  it("rejects unknown fields with the stable boundary category", () => {
    const future = { ...report(), futureField: true };
    try {
      parseDueDiligence(future, key);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ category: "invalid_v2_contract_record" });
      expect((error as Error).message).not.toContain(JSON.stringify(future));
    }
  });

  it("detects concrete revision changes without naming an unverified recipient", () => {
    const changes = revisionChanges(
      { title: "Program", bodyText: "Send 3M ARB to 0x1111111111111111111111111111111111111111 with 3/5 Safe and clawback.", choices: ["Yes", "No"] },
      { title: "Program", bodyText: "Send 5M ARB to 0x2222222222222222222222222222222222222222 with 2/3 Safe.", choices: ["Yes", "No"] },
    );
    expect(changes.map((change) => change.field)).toEqual(expect.arrayContaining([
      "Token amounts mentioned", "Funding amount", "Addresses mentioned", "Recipient address",
      "Signature thresholds mentioned", "Safe/multisig threshold", "Clawback language",
    ]));
    expect(changes.every((change) => change.significance === "material")).toBe(true);
  });

  it("compares material claims and distinguishes addresses by evidenced role", () => {
    const changes = revisionChanges(
      { title: "Incentive program", bodyText: "The protocol has 120,000 monthly active users.\nTransfer 3M ARB to 0x1111111111111111111111111111111111111111.\nSafe owners: 0x3333333333333333333333333333333333333333.", choices: ["Yes", "No"] },
      { title: "Incentive program", bodyText: "The protocol has 200,000 monthly active users.\nTransfer 5M ARB to 0x2222222222222222222222222222222222222222.\nSafe owners: 0x4444444444444444444444444444444444444444.", choices: ["Yes", "No"] },
    );
    expect(changes.map((change) => change.field)).toEqual(expect.arrayContaining([
      "Material claim text", "Funding amount", "Recipient address", "Signer addresses",
    ]));
    expect(changes.find((change) => change.field === "Material claim text")?.explanation)
      .toContain("does not independently verify either claim");
  });

  it("detects permission-holder and audit/reference changes only in explicit context", () => {
    const changes = revisionChanges(
      { bodyText: "Grant upgrade permission to Council Alpha.\nAudit report: https://audit.example/v1.pdf" },
      { bodyText: "Grant upgrade permission to Council Beta.\nAudit report: https://audit.example/v2.pdf" },
    );
    expect(changes.map((change) => change.field)).toEqual(expect.arrayContaining([
      "Permission holder", "Audit/reference",
    ]));
  });

  it("does not label an unrelated metric amount as a funding change", () => {
    const changes = revisionChanges(
      { bodyText: "Transfer 10 ETH to the grants Safe.\nLast year revenue was 20 ETH." },
      { bodyText: "Transfer 10 ETH to the grants Safe.\nLast year revenue was 30 ETH." },
    );
    expect(changes.find((change) => change.field === "Funding amount")).toBeUndefined();
    expect(changes.find((change) => change.field === "Material claim text")).toBeDefined();
  });

  it("uses the material revision fixture to identify changes without asserting absent safeguards", () => {
    const fixturePath = (name: string) => resolve(process.cwd(), "fixtures/due_diligence_v3", name);
    const before = JSON.parse(readFileSync(fixturePath("semantic_revision_previous.json"), "utf8"));
    const after = JSON.parse(readFileSync(fixturePath("semantic_revision_current.json"), "utf8"));
    const changes = revisionChanges({ title: before.title, bodyText: before.body }, { title: after.title, bodyText: after.body });
    expect(changes.map((change) => change.field)).toEqual(expect.arrayContaining([
      "Funding amount", "Recipient address", "Safe/multisig threshold", "Clawback language",
    ]));
    const clawback = changes.find((change) => change.field === "Clawback language");
    expect(clawback?.explanation).toContain("before inferring a safeguard change");
    expect(clawback?.currentValue).toBe("Not mentioned");
  });
});
