import type { ProposalProvenance } from "./governance_proposal";

export type RiskLevel = "low" | "medium" | "high";
export type RiskRecommendation = "allow" | "manual_review" | "block";
export type AssessmentConsensusState = "submitted" | "accepted" | "undetermined" | "reverted" | "failed_source";

export interface GovernanceRiskAssessment {
  assessmentVersion: "1";
  proposalKey: string;
  sourceLocatorHash: string;
  contentHash: string;
  riskLevel: RiskLevel;
  riskScore: number;
  riskCategories: string[];
  recommendation: RiskRecommendation;
  summary: string;
  assessedAt: string;
  consensusState: "accepted";
  provenance: ProposalProvenance;
}

export interface AssessmentTransaction {
  transactionId: string;
  proposalKey: string;
  state: AssessmentConsensusState;
  assessment?: GovernanceRiskAssessment;
  error?: string;
}

const RISK_LEVELS = new Set<RiskLevel>(["low", "medium", "high"]);
const RECOMMENDATIONS = new Set<RiskRecommendation>(["allow", "manual_review", "block"]);

export function assertGovernanceRiskAssessment(value: unknown): asserts value is GovernanceRiskAssessment {
  if (!value || typeof value !== "object") {
    throw new Error("Governance risk assessment must be an object");
  }
  const assessment = value as Record<string, unknown>;
  if (!Number.isInteger(assessment.riskScore) || (assessment.riskScore as number) < 0 || (assessment.riskScore as number) > 100) {
    throw new Error("Governance risk score must be an integer from 0 to 100");
  }
  if (!RISK_LEVELS.has(assessment.riskLevel as RiskLevel)) {
    throw new Error("Governance risk level is invalid");
  }
  if (!RECOMMENDATIONS.has(assessment.recommendation as RiskRecommendation)) {
    throw new Error("Governance risk recommendation is invalid");
  }
  if (!Array.isArray(assessment.riskCategories) || assessment.riskCategories.some((entry) => typeof entry !== "string")) {
    throw new Error("Governance risk categories must be a string array");
  }
  if (
    typeof assessment.proposalKey !== "string" ||
    assessment.assessmentVersion !== "1" ||
    typeof assessment.sourceLocatorHash !== "string" ||
    typeof assessment.contentHash !== "string" ||
    typeof assessment.summary !== "string" ||
    typeof assessment.assessedAt !== "string" ||
    assessment.consensusState !== "accepted" ||
    (assessment.provenance !== "live" && assessment.provenance !== "fixture")
  ) {
    throw new Error("Governance risk assessment fields are invalid");
  }
}
