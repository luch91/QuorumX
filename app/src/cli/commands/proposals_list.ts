import type { GovernanceProposal } from "../../domain/governance_proposal";
export function presentProposals(proposals: GovernanceProposal[]): object[] { return proposals.map((p) => ({ proposalKey: p.canonicalId, title: p.title, status: p.status, source: p.source, provenance: p.source.kind === "fixture" ? "fixture" : "live" })); }
