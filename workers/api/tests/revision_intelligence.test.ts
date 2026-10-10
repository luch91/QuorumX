import { buildRevisionIntelligence, stableMaterialClaimId } from "../src/revision_intelligence";

const revision = (observedAt: string, bodyText: string, claims: Array<Record<string, unknown>> = [], extra: Record<string, unknown> = {}) => ({
  id: observedAt,
  observedAt,
  payload: { bodyText, title: "Grants program", choices: ["For", "Against"] },
  assessment: { assessmentVersion: "3", materialClaims: claims, executionMap: [], safeguardGaps: [], findings: [], reviewPriority: "normal", ...extra },
});

const claim = (claimText: string, status: string, evidence = ["proposal"]) => ({
  id: "c1", claim: claimText, claimScope: "external_factual", status, evidence, evidenceAuthority: ["primary"],
  sourceExcerpt: claimText, explanation: "Reviewed.", confidence: "medium", verificationMethod: "bounded_method",
});

describe("revision intelligence", () => {
  it("keeps an obvious rewritten monthly-active-users claim on one stable identity", () => {
    expect(stableMaterialClaimId(claim("The protocol has 120,000 monthly active users.", "unverified")))
      .toBe(stableMaterialClaimId(claim("Monthly active users reached 200k for the protocol.", "supported")));
  });

  it("reports status and evidence lineage for a matched claim", () => {
    const entries = buildRevisionIntelligence([
      revision("2026-01-01T00:00:00Z", "The protocol has 120,000 monthly active users.", [claim("The protocol has 120,000 monthly active users.", "unverified")]),
      revision("2026-01-02T00:00:00Z", "Monthly active users reached 200k for the protocol.", [claim("Monthly active users reached 200k for the protocol.", "supported", ["proposal", "safe-rpc-publicnode"])]),
    ]);
    expect(entries[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "claim_status", previousValue: "Unverified", currentValue: "Supported" }),
      expect.objectContaining({ kind: "claim_evidence", evidenceImpact: "changed" }),
    ]));
  });

  it("reports introduced and removed claims without treating unrelated text as a match", () => {
    const entries = buildRevisionIntelligence([
      revision("2026-01-01T00:00:00Z", "Revenue was 2M USDC.", [claim("Revenue was 2M USDC.", "unverified")]),
      revision("2026-01-02T00:00:00Z", "The protocol has 200k monthly active users.", [claim("The protocol has 200k monthly active users.", "unverified")]),
    ]);
    expect(entries[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "claim_removed" }),
      expect.objectContaining({ kind: "claim_introduced" }),
    ]));
  });

  it("classifies amount, recipient, safeguard, execution, and priority changes", () => {
    const entries = buildRevisionIntelligence([
      revision("2026-01-01T00:00:00Z", "Transfer 3M ARB to 0x1111111111111111111111111111111111111111. Clawback applies.", [], {
        executionMap: [{ action: "Transfer ARB", actor: "DAO", target: "Safe A", amount: "3M", asset: "ARB", dependency: "3/5", reversible: false }],
        safeguardGaps: [{ safeguard: "clawback", state: "present", scope: "proposal" }], reviewPriority: "normal",
      }),
      revision("2026-01-02T00:00:00Z", "Transfer 5M ARB to 0x2222222222222222222222222222222222222222.", [], {
        executionMap: [{ action: "Transfer ARB", actor: "DAO", target: "Safe B", amount: "5M", asset: "ARB", dependency: "2/3", reversible: "unknown" }],
        safeguardGaps: [{ safeguard: "clawback", state: "not_identified", scope: "reviewed material" }], reviewPriority: "high",
      }),
    ]);
    expect(entries[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "Funding amount" }),
      expect.objectContaining({ field: "Recipient address" }),
      expect.objectContaining({ kind: "safeguard_change" }),
      expect.objectContaining({ kind: "execution_change" }),
      expect.objectContaining({ kind: "review_priority" }),
    ]));
  });

  it("reports introduced and removed execution steps and safeguards", () => {
    const entries = buildRevisionIntelligence([
      revision("2026-01-01T00:00:00Z", "", [], {
        executionMap: [{ id: "transfer", action: "Transfer ARB" }],
        safeguardGaps: [{ id: "recovery", safeguard: "Recovery mechanism", state: "not_identified" }],
      }),
      revision("2026-01-02T00:00:00Z", "", [], {
        executionMap: [{ id: "safe", action: "Safe approval" }],
        safeguardGaps: [{ id: "timelock", safeguard: "Timelock", state: "present" }],
      }),
    ]);

    expect(entries[0].changes.map((change) => change.currentValue)).toEqual(expect.arrayContaining([
      "Execution step no longer identified", "Execution step added", "Safeguard no longer identified", "Safeguard added",
    ]));
  });
});
