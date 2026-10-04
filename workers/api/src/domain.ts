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

export type ReviewPriority = "low" | "normal" | "high" | "urgent";

export interface DueDiligenceEvidence {
  id: string;
  type: "proposal";
  locator: string;
  description: string;
  contentHash: string;
  verificationScope: "validator_retrieved_proposal";
}

export interface DueDiligenceClaim {
  id: string;
  claim: string;
  sourceExcerpt: string;
  counterExcerpt: string;
  claimScope: "proposal_action" | "external_factual";
  status: "supported" | "partially_supported" | "unverified" | "contradicted" | "not_applicable";
  explanation: string;
  evidence: string[];
  confidence: "low" | "medium" | "high";
}

export interface DueDiligenceFinding {
  id: string;
  type: string;
  title: string;
  sourceExcerpt: string;
  observation: string;
  whyItMatters: string;
  severity: "informational" | "low" | "medium" | "high" | "critical";
  confidence: "low" | "medium" | "high";
  evidence: string[];
  impact: string;
  existingSafeguards: string[];
  missingSafeguards: string[];
  enforcementMechanism: string;
  recoveryMechanism: string;
  humanDependencies: string[];
  technicalDependencies: string[];
  reversible: boolean | "partial" | "unknown";
  uncertainty: string;
  consensus: { state: "accepted"; method: "source_grounded_material_facts_v2" };
}

export interface StoredDueDiligenceAssessment {
  assessmentVersion: "2";
  proposalKey: string;
  contentHash: string;
  sourceLocatorHash: string;
  overview: {
    purpose: string;
    requestedActions: string[];
    assetsAffected: string[];
    permissionsChanged: string[];
    controlChanges: string[];
  };
  evidence: DueDiligenceEvidence[];
  materialClaims: DueDiligenceClaim[];
  findings: DueDiligenceFinding[];
  executionMap: Array<{
    id: string; order: number; action: string; actor: string; target: string;
    asset: string; amount: string; dependency: string;
    reversible: boolean | "partial" | "unknown"; evidence: string[];
  }>;
  unresolvedQuestions: Array<{
    id: string; question: string; whyItMatters: string;
    relatedFindingIds: string[]; evidenceGap: string;
  }>;
  reviewPriority: ReviewPriority;
  reviewPriorityExplanation: string;
  assessedAt: string;
  provenance: "live" | "fixture";
  consensus: { state: "accepted"; method: "source_grounded_material_facts_v2" };
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
