import { loadGenLayerConfig, loadGenLayerReadConfig, loadProposalSourceConfig, type GenLayerConfig } from "./config";
import { createGenLayerClient } from "./genlayer/client";
import { GenLayerGatewayImpl } from "./genlayer/gateway";
import { JsonlTransactionEvidenceStore } from "./genlayer/transaction_evidence";
import { SnapshotProposalSource } from "./ingest/sources/snapshot_source";
import { FallbackProposalSource, type SourceAttempt } from "./ingest/sources/fallback_source";
import type { GovernanceProposal } from "./domain/governance_proposal";
import type { GovernanceRiskAssessment } from "./domain/governance_risk_assessment";
import type { AssessmentWorkflowResult } from "./workflows/genlayer_assessment";
import { runGenLayerAssessment } from "./workflows/genlayer_assessment";
import type { GenLayerGateway } from "./genlayer/gateway";
import type { ProposalSourceAdapter } from "./ingest/proposal_source";
import { runLegacyTelegraphCycle } from "./workflows/telegraph_legacy";
import { presentSourceAttempts } from "./cli/commands/sources_check";
import { presentProposals } from "./cli/commands/proposals_list";
import { LEGACY_WARNING } from "./cli/commands/legacy_telegraph";
import { parseSnapshotReference } from "./cli/proposal_reference";

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

export async function runQuorumXCli(
  args: string[],
  deps: QuorumXCliDependencies,
  write: (line: string) => void = console.log,
  writeError: (line: string) => void = console.error,
): Promise<number> {
  const json = args.includes("--json");
  const emit = (value: unknown) => write(json ? JSON.stringify(value, null, 2) : typeof value === "string" ? value : JSON.stringify(value, null, 2));
  const emitError = (code: string, details: Record<string, unknown> = {}) => writeError(
    json ? JSON.stringify({ error: code, ...details }) : [code, ...Object.values(details).map(String)].join(": "),
  );
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) { emit(HELP); return 0; }
  if (args[0] === "sources" && args[1] === "check") { emit(presentSourceAttempts(await deps.checkSources())); return 0; }
  if (args[0] === "proposals" && args[1] === "list") { const proposals = await deps.listProposals(); emit(presentProposals(proposals)); return proposals.length ? 0 : 2; }
  if (args[0] === "assess") {
    const source = option(args, "--source"); const proposal = option(args, "--proposal");
    if (!source || !proposal) { emitError("missing_assessment_options"); return 4; }
    if (source !== "snapshot") { emitError("unsupported_source", { source }); return 4; }
    const result = await deps.assess({ source, proposal }); emit(result);
    if (!result.transaction) return 2;
    return result.transaction.state === "accepted" ? 0 : result.transaction.state === "undetermined" ? 3 : 4;
  }
  if (args[0] === "assessment" && args[1] === "get" && args[2]) { const result = await deps.getAssessment(args[2]); emit(result ?? { found: false }); return result ? 0 : 2; }
  if (args[0] === "legacy" && args[1] === "telegraph") { emit(LEGACY_WARNING); await deps.runLegacy(); return 0; }
  emit(HELP); return 4;
}

export interface DefaultCliOverrides {
  snapshot?: ProposalSourceAdapter;
  createGateway?: (config: GenLayerConfig) => Promise<GenLayerGateway>;
  runAssessment?: typeof runGenLayerAssessment;
}

export function createDefaultCliDependencies(env: NodeJS.ProcessEnv = process.env, overrides: DefaultCliOverrides = {}): QuorumXCliDependencies {
  const sourceConfig = loadProposalSourceConfig(env);
  const snapshot = overrides.snapshot ?? new SnapshotProposalSource(sourceConfig.snapshotSpaces);
  const fallback = new FallbackProposalSource([snapshot], { allowFixtures: false });
  const gateway = overrides.createGateway ?? (async (config: GenLayerConfig) => new GenLayerGatewayImpl(await createGenLayerClient(config), config.contractAddress));
  const assessWorkflow = overrides.runAssessment ?? runGenLayerAssessment;
  return {
    checkSources: async () => (await fallback.findEligible()).attempts,
    listProposals: async () => snapshot.listEligible(),
    assess: async ({ source, proposal }) => {
      if (source !== "snapshot" || !proposal) throw new Error(`Unsupported proposal source: ${source ?? "missing"}`);
      const reference = parseSnapshotReference(proposal, sourceConfig.snapshotSpaces);
      const selected = await snapshot.get(reference);
      const selectedSource = { findEligible: async () => ({ proposal: selected, attempts: [{ kind: selected.source.kind, outcome: "selected" as const, provenance: "live" as const }] }) };
      const configuredGateway = await gateway(loadGenLayerReadConfig(env));
      const guardedGateway = {
        getAssessment: configuredGateway.getAssessment.bind(configuredGateway),
        waitForAssessment: configuredGateway.waitForAssessment.bind(configuredGateway),
        submitAssessment: async (...args: Parameters<typeof configuredGateway.submitAssessment>) => {
          const writeConfig = loadGenLayerConfig(env);
          if (!writeConfig.privateKey) throw new Error("QUORUMX_GENLAYER_PRIVATE_KEY is required for assessment submission");
          return (await gateway(writeConfig)).submitAssessment(...args);
        },
      };
      return assessWorkflow({}, { source: selectedSource, gateway: guardedGateway, evidence: new JsonlTransactionEvidenceStore(".quorumx-evidence/transactions.jsonl") });
    },
    getAssessment: async (key) => (await gateway(loadGenLayerReadConfig(env))).getAssessment(key),
    runLegacy: runLegacyTelegraphCycle,
  };
}
