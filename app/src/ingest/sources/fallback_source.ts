import type { GovernanceProposal, ProposalProvenance, ProposalSource } from "../../domain/governance_proposal";
import type { ProposalSourceAdapter } from "../proposal_source";

export interface SourceAttempt {
  kind: ProposalSource["kind"];
  outcome: "selected" | "empty" | "unavailable" | "disabled";
  provenance?: ProposalProvenance;
  detail?: string;
}

export interface FallbackResult { proposal?: GovernanceProposal; attempts: SourceAttempt[]; }

export class FallbackProposalSource {
  constructor(private readonly sources: ProposalSourceAdapter[], private readonly options: { allowFixtures: boolean }) {}
  async findEligible(): Promise<FallbackResult> {
    const attempts: SourceAttempt[] = [];
    for (const source of this.sources) {
      if (source.kind === "fixture" && !this.options.allowFixtures) {
        attempts.push({ kind: source.kind, outcome: "disabled", provenance: "fixture" });
        continue;
      }
      try {
        const proposals = await source.listEligible();
        if (proposals.length === 0) { attempts.push({ kind: source.kind, outcome: "empty" }); continue; }
        const proposal = proposals[0];
        attempts.push({ kind: source.kind, outcome: "selected", provenance: proposal.source.kind === "fixture" ? "fixture" : "live" });
        return { proposal, attempts };
      } catch (error) {
        attempts.push({ kind: source.kind, outcome: "unavailable", detail: error instanceof Error ? error.message : String(error) });
      }
    }
    return { attempts };
  }
}
