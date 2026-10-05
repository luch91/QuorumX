import {
  assertGovernanceProposal,
  canonicalProposalId,
  type GovernanceProposal,
  type ProposalSource,
} from "../../src/domain/governance_proposal";
import { assertGovernanceRiskAssessment } from "../../src/domain/governance_risk_assessment";

describe("governance proposal domain", () => {
  const snapshotSource: ProposalSource = {
    kind: "snapshot",
    space: "balancer.eth",
    proposalId: "proposal-1",
  };

  const proposal: GovernanceProposal = {
    canonicalId: "snapshot:balancer.eth:proposal-1",
    source: snapshotSource,
    title: "Fund security review",
    bodyText: "Review the protocol",
    choices: ["For", "Against"],
    linkedEvidenceUrls: [],
    submittedAt: "2026-08-21T09:28:31.000Z",
    votingEndsAt: "2026-08-22T09:28:31.000Z",
    status: "active",
  };

  it("accepts_snapshot_source", () => {
    expect(() => assertGovernanceProposal(proposal)).not.toThrow();
    expect(proposal.source.kind).toBe("snapshot");
  });

  it("rejects_invalid_status", () => {
    expect(() => assertGovernanceProposal({ ...proposal, status: "running" })).toThrow(
      "Governance proposal status is invalid",
    );
  });

  it("rejects_score_outside_range", () => {
    expect(() =>
      assertGovernanceRiskAssessment({
        assessmentVersion: "1",
        proposalKey: proposal.canonicalId,
        sourceLocatorHash: "0xsource",
        contentHash: "0xcontent",
        riskLevel: "high",
        riskScore: 101,
        riskCategories: ["treasury-impact"],
        recommendation: "manual_review",
        summary: "Manual review is required.",
        assessedAt: "2026-09-28T00:00:00.000Z",
        consensusState: "accepted",
        provenance: "live",
      }),
    ).toThrow("Governance risk score must be an integer from 0 to 100");
  });

  it("derives_stable_canonical_id", () => {
    expect(canonicalProposalId(snapshotSource)).toBe("snapshot:balancer.eth:proposal-1");
    expect(canonicalProposalId({ kind: "public_url", url: "https://example.org/proposal/1" })).toBe(
      "public_url:https://example.org/proposal/1",
    );
    expect(
      canonicalProposalId({
        kind: "fixture",
        fixtureId: "balancer-archived",
        canonicalUrl: "https://snapshot.box/#/s:balancer.eth/proposal/1",
      }),
    ).toBe("fixture:balancer-archived");
  });
});
