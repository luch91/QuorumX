import { loadGenLayerConfig, loadProposalSourceConfig } from "./config";
import { createGenLayerClient } from "./genlayer/client";
import { GenLayerGatewayImpl } from "./genlayer/gateway";
import { JsonlTransactionEvidenceStore } from "./genlayer/transaction_evidence";
import { SnapshotProposalSource } from "./ingest/sources/snapshot_source";
import { FallbackProposalSource, type SourceAttempt } from "./ingest/sources/fallback_source";
import type { GovernanceProposal } from "./domain/governance_proposal";
import type { GovernanceRiskAssessment } from "./domain/governance_risk_assessment";
import type { AssessmentWorkflowResult } from "./workflows/genlayer_assessment";
import { runGenLayerAssessment } from "./workflows/genlayer_assessment";
import { runLegacyTelegraphCycle } from "./workflows/telegraph_legacy";
import { presentSourceAttempts } from "./cli/commands/sources_check";
import { presentProposals } from "./cli/commands/proposals_list";
import { LEGACY_WARNING } from "./cli/commands/legacy_telegraph";

export interface QuorumXCliDependencies {
  checkSources(): Promise<SourceAttempt[]>;
  listProposals(): Promise<GovernanceProposal[]>;
  assess(options: { source?: string; proposal?: string }): Promise<AssessmentWorkflowResult>;
  getAssessment(proposalKey: string): Promise<GovernanceRiskAssessment | undefined>;
  runLegacy(): Promise<void>;
}

const HELP = `QuorumX — validator consensus for governance risk

quorumx sources check [--json]
quorumx proposals list [--json]
quorumx assess --source <source> --proposal <id-or-url> [--json]
quorumx assessment get <proposal-key> [--json]
quorumx legacy telegraph`;

function option(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }

export async function runQuorumXCli(args: string[], deps: QuorumXCliDependencies, write: (line: string) => void = console.log): Promise<number> {
  const json = args.includes("--json");
  const emit = (value: unknown) => write(json ? JSON.stringify(value, null, 2) : typeof value === "string" ? value : JSON.stringify(value, null, 2));
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) { emit(HELP); return 0; }
  if (args[0] === "sources" && args[1] === "check") { emit(presentSourceAttempts(await deps.checkSources())); return 0; }
  if (args[0] === "proposals" && args[1] === "list") { const proposals = await deps.listProposals(); emit(presentProposals(proposals)); return proposals.length ? 0 : 2; }
  if (args[0] === "assess") {
    const source = option(args, "--source"); const proposal = option(args, "--proposal");
    if (!source || !proposal) { emit("assess requires --source and --proposal"); return 4; }
    const result = await deps.assess({ source, proposal }); emit(result);
    if (!result.transaction) return 2;
    return result.transaction.state === "accepted" ? 0 : result.transaction.state === "undetermined" ? 3 : 4;
  }
  if (args[0] === "assessment" && args[1] === "get" && args[2]) { const result = await deps.getAssessment(args[2]); emit(result ?? { found: false }); return result ? 0 : 2; }
  if (args[0] === "legacy" && args[1] === "telegraph") { emit(LEGACY_WARNING); await deps.runLegacy(); return 0; }
  emit(HELP); return 4;
}

export function createDefaultCliDependencies(env: NodeJS.ProcessEnv = process.env): QuorumXCliDependencies {
  const sourceConfig = loadProposalSourceConfig(env);
  const snapshot = new SnapshotProposalSource(sourceConfig.snapshotSpaces);
  const fallback = new FallbackProposalSource([snapshot], { allowFixtures: false });
  const gateway = async () => { const config = loadGenLayerConfig(env); return new GenLayerGatewayImpl(await createGenLayerClient(config), config.contractAddress); };
  return {
    checkSources: async () => (await fallback.findEligible()).attempts,
    listProposals: async () => snapshot.listEligible(),
    assess: async ({ proposal }) => {
      const proposals = await snapshot.listEligible();
      const selected = proposals.find((item) => item.canonicalId === proposal || (item.source.kind === "snapshot" && item.source.proposalId === proposal));
      const selectedSource = { findEligible: async () => ({ proposal: selected, attempts: selected ? [{ kind: selected.source.kind, outcome: "selected" as const, provenance: "live" as const }] : [] }) };
      return runGenLayerAssessment({}, { source: selectedSource, gateway: await gateway(), evidence: new JsonlTransactionEvidenceStore(".quorumx-evidence/transactions.jsonl") });
    },
    getAssessment: async (key) => (await gateway()).getAssessment(key),
    runLegacy: runLegacyTelegraphCycle,
  };
}
