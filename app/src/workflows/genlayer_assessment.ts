import { createHash } from "node:crypto";
import type { AssessmentTransaction } from "../domain/governance_risk_assessment";
import type { GovernanceProposal, ProposalProvenance } from "../domain/governance_proposal";
import type { GenLayerGateway } from "../genlayer/gateway";
import type { TransactionEvidenceStore } from "../genlayer/transaction_evidence";
import type { FallbackProposalSource, SourceAttempt } from "../ingest/sources/fallback_source";

export interface AssessmentWorkflowDependencies {
  source: Pick<FallbackProposalSource, "findEligible">;
  gateway: GenLayerGateway;
  evidence: TransactionEvidenceStore;
  now?: () => Date;
}

export interface AssessmentWorkflowInput { minimumRemainingVoteMinutes?: number; }
export interface AssessmentWorkflowResult { transaction?: AssessmentTransaction; attempts: SourceAttempt[]; reason?: string; }

function provenance(proposal: GovernanceProposal): ProposalProvenance {
  return proposal.source.kind === "fixture" ? "fixture" : "live";
}

export function assessmentIdempotencyKey(proposal: GovernanceProposal): string {
  const content = JSON.stringify({ source: proposal.source, title: proposal.title.trim(), bodyText: proposal.bodyText.trim(), choices: proposal.choices });
  return createHash("sha256").update(content).digest("hex");
}

export function isProposalActionable(proposal: GovernanceProposal, minimumMinutes: number, now: Date): boolean {
  if (!proposal.votingEndsAt) return true;
  const cutoff = new Date(proposal.votingEndsAt).getTime() - minimumMinutes * 60_000;
  return Number.isFinite(cutoff) && now.getTime() < cutoff;
}

export async function runGenLayerAssessment(
  input: AssessmentWorkflowInput,
  dependencies: AssessmentWorkflowDependencies,
): Promise<AssessmentWorkflowResult> {
  const selection = await dependencies.source.findEligible();
  if (!selection.proposal) return { attempts: selection.attempts, reason: "no_eligible_proposal" };
  const proposal = selection.proposal;
  if (!isProposalActionable(proposal, input.minimumRemainingVoteMinutes ?? 60, (dependencies.now ?? (() => new Date()))())) {
    return { attempts: selection.attempts, reason: "deadline" };
  }
  const existing = await dependencies.gateway.getAssessment(proposal.canonicalId);
  if (existing) {
    return { attempts: selection.attempts, transaction: { transactionId: "existing", proposalKey: proposal.canonicalId, state: "accepted", assessment: existing } };
  }
  const transactionId = await dependencies.gateway.submitAssessment(proposal.source, assessmentIdempotencyKey(proposal));
  const recordedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  await dependencies.evidence.append({ recordedAt, transactionId, proposalKey: proposal.canonicalId, state: "submitted", source: proposal.source, provenance: provenance(proposal) });
  const transaction = await dependencies.gateway.waitForAssessment(transactionId, proposal.canonicalId);
  await dependencies.evidence.append({ recordedAt: (dependencies.now ?? (() => new Date()))().toISOString(), transactionId, proposalKey: proposal.canonicalId, state: transaction.state, source: proposal.source, provenance: provenance(proposal), ...(transaction.error ? { error: transaction.error } : {}) });
  return { attempts: selection.attempts, transaction };
}

export async function resumeGenLayerAssessment(
  transactionId: string,
  dependencies: Omit<AssessmentWorkflowDependencies, "source">,
): Promise<AssessmentTransaction> {
  const evidence = await dependencies.evidence.find(transactionId);
  if (!evidence) throw new Error(`No evidence found for transaction ${transactionId}`);
  const transaction = await dependencies.gateway.waitForAssessment(transactionId, evidence.proposalKey);
  await dependencies.evidence.append({ ...evidence, recordedAt: (dependencies.now ?? (() => new Date()))().toISOString(), state: transaction.state, ...(transaction.error ? { error: transaction.error } : {}) });
  return transaction;
}
