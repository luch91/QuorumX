import { assertGovernanceProposal, type GovernanceProposal, type ProposalSource } from "../../domain/governance_proposal";
import { ProposalSourceError, type ProposalSourceAdapter } from "../proposal_source";

export type FixtureLoader = (fixtureId: string) => Promise<unknown>;

export class FixtureProposalSource implements ProposalSourceAdapter {
  readonly kind = "fixture" as const;
  constructor(private readonly fixtureIds: string[], private readonly loader: FixtureLoader) {}
  async listEligible(): Promise<GovernanceProposal[]> { return Promise.all(this.fixtureIds.map((id) => this.load(id))); }
  async get(reference: ProposalSource): Promise<GovernanceProposal> {
    if (reference.kind !== "fixture") throw new ProposalSourceError("Fixture source requires a fixture reference", "invalid_reference");
    return this.load(reference.fixtureId);
  }
  private async load(id: string): Promise<GovernanceProposal> {
    const value = await this.loader(id);
    assertGovernanceProposal(value);
    if (value.source.kind !== "fixture") throw new ProposalSourceError("Fixture provenance is missing", "invalid_response");
    return value;
  }
}
