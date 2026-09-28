import type { GovernanceRiskAssessment } from "../../domain/governance_risk_assessment";
export function presentAssessment(assessment: GovernanceRiskAssessment | undefined): object { return assessment ?? { found: false }; }
