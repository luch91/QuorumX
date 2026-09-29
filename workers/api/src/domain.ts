export type ProposalStatus = "pending" | "active" | "closed" | "unknown";

export interface SnapshotProposal {
  externalId: string;
  canonicalId: string;
  source: { kind: "snapshot"; space: string; proposalId: string };
  authorAddress: `0x${string}`;
  canonicalUrl: string;
  title: string;
  bodyText: string;
  choices: string[];
  linkedEvidenceUrls: string[];
  status: ProposalStatus;
  submittedAt?: string;
  votingStartsAt?: string;
  votingEndsAt?: string;
  assessmentEligible: boolean;
}

export interface StoredAssessment {
  proposalKey: string;
  sourceLocatorHash: string;
  contentHash: string;
  riskLevel: "low" | "medium" | "high";
  riskScore: number;
  riskCategories: string[];
  recommendation: "allow" | "manual_review" | "block";
  summary: string;
  assessedAt: string;
  provenance: "live" | "fixture";
}

export interface CycleResult {
  sourcesPolled: number;
  proposalsSeen: number;
  revisionsCreated: number;
  jobsCreated: number;
  transactionsRecovered: number;
  jobsProcessed: number;
  errors: string[];
}
