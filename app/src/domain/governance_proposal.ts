export type ProposalSource =
  | { kind: "snapshot"; space: string; proposalId: string }
  | { kind: "public_url"; url: string }
  | { kind: "fixture"; fixtureId: string; canonicalUrl: string };

export type GovernanceProposalStatus = "pending" | "active" | "closed" | "unknown";
export type ProposalProvenance = "live" | "fixture";

export interface GovernanceProposal {
  canonicalId: string;
  source: ProposalSource;
  title: string;
  bodyText: string;
  choices: string[];
  linkedEvidenceUrls: string[];
  submittedAt?: string;
  votingStartsAt?: string;
  votingEndsAt?: string;
  status: GovernanceProposalStatus;
}

const PROPOSAL_STATUSES = new Set<GovernanceProposalStatus>(["pending", "active", "closed", "unknown"]);

export function canonicalProposalId(source: ProposalSource): string {
  switch (source.kind) {
    case "snapshot":
      return `snapshot:${source.space.trim().toLowerCase()}:${source.proposalId.trim()}`;
    case "public_url":
      return `public_url:${new URL(source.url).toString()}`;
    case "fixture":
      return `fixture:${source.fixtureId.trim()}`;
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Governance proposal ${field} must be a string array`);
  }
}

function assertProposalSource(value: unknown): asserts value is ProposalSource {
  if (!value || typeof value !== "object") {
    throw new Error("Governance proposal source is invalid");
  }
  const source = value as Record<string, unknown>;
  if (
    (source.kind === "snapshot" && typeof source.space === "string" && typeof source.proposalId === "string") ||
    (source.kind === "public_url" && typeof source.url === "string") ||
    (source.kind === "fixture" && typeof source.fixtureId === "string" && typeof source.canonicalUrl === "string")
  ) {
    return;
  }
  throw new Error("Governance proposal source is invalid");
}

export function assertGovernanceProposal(value: unknown): asserts value is GovernanceProposal {
  if (!value || typeof value !== "object") {
    throw new Error("Governance proposal must be an object");
  }
  const proposal = value as Record<string, unknown>;
  assertProposalSource(proposal.source);
  if (typeof proposal.canonicalId !== "string" || proposal.canonicalId !== canonicalProposalId(proposal.source)) {
    throw new Error("Governance proposal canonical ID does not match its source");
  }
  if (typeof proposal.title !== "string" || typeof proposal.bodyText !== "string") {
    throw new Error("Governance proposal title and body must be strings");
  }
  assertStringArray(proposal.choices, "choices");
  assertStringArray(proposal.linkedEvidenceUrls, "linked evidence URLs");
  if (!PROPOSAL_STATUSES.has(proposal.status as GovernanceProposalStatus)) {
    throw new Error("Governance proposal status is invalid");
  }
}
