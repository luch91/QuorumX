import type { GovernanceProposal, ProposalSource } from "../domain/governance_proposal";

export interface ProposalSourceAdapter {
  readonly kind: ProposalSource["kind"];
  listEligible(): Promise<GovernanceProposal[]>;
  get(reference: ProposalSource): Promise<GovernanceProposal>;
}

export class ProposalSourceError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_reference" | "unavailable" | "not_found" | "unsafe_url" | "invalid_response",
  ) {
    super(message);
    this.name = "ProposalSourceError";
  }
}
