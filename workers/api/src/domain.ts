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

export type V3EvidenceAuthority = "primary" | "secondary" | "contextual";
export type V3VerificationScope = "validator_retrieved_proposal" | "validator_retrieved_external_source";
export type V3TemporalScope = "historically_anchored" | "current_state_observed" | "inherently_historical" | "unknown";

export interface DueDiligenceV3Evidence {
  id: string;
  type: "proposal" | "safe" | "safe_onchain" | "onchain" | "governance_history";
  locator: string;
  description: string;
  contentHash: string;
  verificationScope: V3VerificationScope;
  authority: V3EvidenceAuthority;
  temporal?: { retrievedAt: string; sourceTimestamp?: string; blockNumber?: number; blockHash?: string;
    historicallyAnchored: boolean; temporalScope: V3TemporalScope };
  structuredData?: { address: string; threshold: number; owners: string[]; version: string }
    | { provider: "publicnode" | "drpc"; address: string; chainId: 1; blockNumber: number;
        blockHash: string; threshold: number; owners: string[] }
    | { transactionHash: string; status: "success"; blockNumber: number; blockHash: string; amountEth: string;
        valueWei: string; from: string; to: string; transferType: "transaction_value" | "internal_call";
        internalTransactionIndex: number | null; chainId: 1 }
    | { id: string; space: string; title: string; body: string; choices: string[]; state: string };
}

export interface StoredDueDiligenceV3Assessment {
  assessmentVersion: "3";
  assessmentSchemaVersion?: "3.1" | "3.2" | "3.3";
  assessmentRunId?: string;
  assessmentContext?: "live" | "retrospective";
  proposalCloseTime?: string;
  evidenceRetrievedAt?: string;
  proposalKey: string;
  contentHash: string;
  sourceLocatorHash: string;
  overview: StoredDueDiligenceAssessment["overview"];
  evidence: DueDiligenceV3Evidence[];
  externalEvidenceState: "not_attempted" | "retrieved" | "unavailable";
  externalEvidenceFailureCode?: string;
  returnedFundsState?: "not_attempted" | "retrieved" | "unavailable";
  externalEvidenceStates?: { safe: "not_attempted" | "retrieved" | "unavailable"; returnedFunds: "not_attempted" | "retrieved" | "unavailable"; governanceHistory: "not_attempted" | "retrieved" | "unavailable" };
  materialActions?: Array<{ id: string; kind: string; sourceExcerpt: string; summary: string; actor: string; target: string; amount: string; asset: string; method: string; reversible: boolean | "partial" | "unknown" }>;
  materialClaims: Array<{
    id: string; claim: string; sourceExcerpt: string; counterExcerpt: string;
    claimScope: "proposal_action" | "external_factual"; status: DueDiligenceClaim["status"];
    explanation: string; evidence: string[]; confidence: "low" | "medium" | "high";
    verificationMethod: string; proposalAssertion?: boolean; evidenceAuthority?: V3EvidenceAuthority[];
    relatedActionIds?: string[];
  }>;
  findings: Array<{
    id: string; type: string; title: string; sourceExcerpt: string; observation: string;
    whyItMatters: string; impact: string; severity: "informational" | "low" | "medium" | "high" | "critical";
    confidence: "low" | "medium" | "high"; evidence: string[]; existingSafeguards: string[];
    safeguardGaps?: Array<{ safeguard: string; state: "present" | "explicitly_absent" | "not_identified" | "unknown"; scope: string; relatedActionIds: string[]; evidence: string[] }>;
    safeguardGapIds?: string[]; relatedActionIds?: string[]; relatedClaimIds?: string[];
    humanDependencies: string[]; technicalDependencies: string[];
    reversible: boolean | "partial" | "unknown"; uncertainty: string;
    consensus: { state: "accepted"; method: "independent_structured_derivation_v3" | "independent_structured_derivation_v3_3" };
  }>;
  safeguardGaps: Array<{ id?: string; safeguard: string; state: "present" | "explicitly_absent" | "not_identified" | "unknown"; scope: string; explanation?: string; confidence?: "low" | "medium" | "high"; relatedActionIds: string[]; relatedFindingIds?: string[]; relatedExecutionStepIds?: string[]; evidence: string[] }>;
  executionMap: Array<{
    id: string; order: number; action: string; actor: string; target: string; asset: string; amount: string;
    dependency: string; impact: string; humanDependencies: string[]; technicalDependencies: string[];
    reversible: boolean | "partial" | "unknown"; evidence: string[]; relatedActionIds?: string[]; relatedClaimIds?: string[];
  }>;
  unresolvedQuestions: Array<{ id: string; question: string; whyItMatters: string; relatedFindingIds: string[]; evidenceGap: string; relatedActionIds?: string[]; relatedClaimIds?: string[]; relatedExecutionStepIds?: string[] }>;
  reviewPriority: ReviewPriority;
  reviewPriorityExplanation: string;
  assessedAt: string;
  provenance: "live" | "fixture";
  consensus: { state: "accepted"; method: "independent_structured_derivation_v3" | "independent_structured_derivation_v3_3" };
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
