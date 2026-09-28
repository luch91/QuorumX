import type { GovernanceProposal } from "../../src/domain/governance_proposal";
import type { ProposalSourceAdapter } from "../../src/ingest/proposal_source";
import { FallbackProposalSource } from "../../src/ingest/sources/fallback_source";

const fixtureProposal: GovernanceProposal = {
  canonicalId: "fixture:balancer-archived",
  source: { kind: "fixture", fixtureId: "balancer-archived", canonicalUrl: "https://example.org/p" },
  title: "Archived proposal", bodyText: "Body", choices: [], linkedEvidenceUrls: [], status: "closed",
};

function adapter(kind: ProposalSourceAdapter["kind"], result: GovernanceProposal[] | Error): ProposalSourceAdapter {
  return {
    kind,
    listEligible: jest.fn().mockImplementation(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    get: jest.fn(),
  };
}

describe("FallbackProposalSource", () => {
  it("tries sources in order and preserves attempt provenance", async () => {
    const snapshot = adapter("snapshot", []);
    const fixture = adapter("fixture", [fixtureProposal]);
    const result = await new FallbackProposalSource([snapshot, fixture], { allowFixtures: true }).findEligible();
    expect(result.proposal).toEqual(fixtureProposal);
    expect(result.attempts).toEqual([
      expect.objectContaining({ kind: "snapshot", outcome: "empty" }),
      expect.objectContaining({ kind: "fixture", outcome: "selected", provenance: "fixture" }),
    ]);
  });

  it("does not use fixtures unless explicitly enabled", async () => {
    const fixture = adapter("fixture", [fixtureProposal]);
    const result = await new FallbackProposalSource([fixture], { allowFixtures: false }).findEligible();
    expect(result.proposal).toBeUndefined();
    expect(fixture.listEligible).not.toHaveBeenCalled();
    expect(result.attempts[0]).toEqual(expect.objectContaining({ outcome: "disabled" }));
  });

  it("records unavailable sources and continues without side effects", async () => {
    const unavailable = adapter("snapshot", new Error("offline"));
    const result = await new FallbackProposalSource([unavailable], { allowFixtures: false }).findEligible();
    expect(result.proposal).toBeUndefined();
    expect(result.attempts[0]).toEqual(expect.objectContaining({ outcome: "unavailable", detail: "offline" }));
  });
});
