import { assertGovernanceRiskAssessment, type AssessmentTransaction, type GovernanceRiskAssessment } from "../domain/governance_risk_assessment";
import { canonicalProposalId, type ProposalSource } from "../domain/governance_proposal";
import type { GenLayerClientPort } from "./types";

export interface GenLayerGateway {
  submitAssessment(source: ProposalSource, idempotencyKey: string): Promise<string>;
  waitForAssessment(transactionId: string, proposalKey?: string): Promise<AssessmentTransaction>;
  getAssessment(proposalKey: string): Promise<GovernanceRiskAssessment | undefined>;
}

export class GenLayerGatewayImpl implements GenLayerGateway {
  constructor(private readonly client: GenLayerClientPort, private readonly contractAddress: `0x${string}`) {}

  async submitAssessment(source: ProposalSource, idempotencyKey: string): Promise<string> {
    return this.client.writeContract({
      address: this.contractAddress,
      functionName: "assess",
      args: [JSON.stringify(source), idempotencyKey],
      value: 0n,
    });
  }

  async waitForAssessment(transactionId: string, proposalKey = ""): Promise<AssessmentTransaction> {
    try {
      const receipt = await this.client.waitForTransactionReceipt({ hash: transactionId });
      const status = receipt.statusName?.toUpperCase();
      const execution = receipt.txExecutionResultName?.toUpperCase();
      if (execution?.includes("ERROR") || status?.includes("REVERT")) {
        return { transactionId, proposalKey, state: "reverted", error: receipt.error ?? execution ?? status };
      }
      if (status?.includes("UNDETERMINED")) return { transactionId, proposalKey, state: "undetermined" };
      if (status?.includes("TIMEOUT")) return { transactionId, proposalKey, state: "undetermined", error: status };
      if (status?.includes("ACCEPT") || status?.includes("FINAL")) {
        const assessment = proposalKey ? await this.getAssessment(proposalKey) : undefined;
        if (!assessment) {
          return { transactionId, proposalKey, state: "undetermined", error: "Consensus accepted without stored assessment state" };
        }
        return { transactionId, proposalKey, state: "accepted", assessment };
      }
      return { transactionId, proposalKey, state: "undetermined", error: `Unexpected transaction state: ${status ?? "unknown"}` };
    } catch (error) {
      return { transactionId, proposalKey, state: "undetermined", error: error instanceof Error ? error.message : "Transaction wait failed" };
    }
  }

  async getAssessment(proposalKey: string): Promise<GovernanceRiskAssessment | undefined> {
    const raw = await this.client.readContract({
      address: this.contractAddress,
      functionName: "get_assessment",
      args: [proposalKey],
    });
    if (raw === "" || raw === undefined || raw === null) return undefined;
    const record = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>;
    const assessment: GovernanceRiskAssessment = {
      assessmentVersion: "1",
      proposalKey: String(record.proposal_key),
      sourceLocatorHash: String(record.locator_hash),
      contentHash: String(record.content_hash),
      riskLevel: record.risk_level as GovernanceRiskAssessment["riskLevel"],
      riskScore: record.score as number,
      riskCategories: record.categories as string[],
      recommendation: record.recommendation as GovernanceRiskAssessment["recommendation"],
      summary: String(record.summary),
      assessedAt: String(record.assessed_at ?? ""),
      consensusState: "accepted",
      provenance: record.source_kind === "fixture" ? "fixture" : "live",
    };
    assertGovernanceRiskAssessment(assessment);
    if (assessment.proposalKey !== proposalKey) throw new Error("Contract assessment proposal key mismatch");
    return assessment;
  }
}

export function proposalKeyForSource(source: ProposalSource): string {
  return canonicalProposalId(source);
}
