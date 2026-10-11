import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";
import type { TransactionHash } from "genlayer-js/types";
import type { StoredAssessment } from "./domain";
import type { StoredDueDiligenceAssessment } from "./domain";
import type { StoredDueDiligenceV3Assessment } from "./domain";
import { parseDueDiligence } from "./due_diligence";
import { parseDueDiligenceV3 } from "./due_diligence_v3";
import { classifyTransaction, type TransactionState } from "./transaction";

export interface GenLayerSettings {
  contractAddress: `0x${string}`;
  dueDiligenceContractAddress?: `0x${string}`;
  dueDiligenceV3ContractAddress?: `0x${string}`;
  dueDiligenceContracts?: Partial<Record<"2" | "3.1" | "3.2" | "3.3" | "3.4", `0x${string}`>>;
  privateKey?: `0x${string}`;
  rpcUrl?: string;
}

export async function readDueDiligenceV3(
  settings: GenLayerSettings, proposalKey: string, contentHash?: string, storedContractAddress?: `0x${string}`,
  assessmentRunId?: string,
): Promise<StoredDueDiligenceV3Assessment | undefined> {
  const address = storedContractAddress ?? settings.dueDiligenceContracts?.["3.3"] ?? settings.dueDiligenceV3ContractAddress;
  if (!address) throw new Error("V3 contract address is not configured");
  const raw = await clientFor(settings).readContract({
    address,
    functionName: assessmentRunId ? "get_assessment_by_run" : contentHash ? "get_assessment_for_revision" : "get_assessment",
    args: assessmentRunId ? [assessmentRunId] : contentHash ? [proposalKey, contentHash] : [proposalKey],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  return parseDueDiligenceV3(raw, proposalKey);
}

export async function submitDueDiligenceV3(
  settings: GenLayerSettings,
  source: { kind: "snapshot"; space: string; proposalId: string },
  idempotencyKey: string,
  contractAddress?: `0x${string}`,
): Promise<string> {
  const address = contractAddress ?? settings.dueDiligenceContracts?.["3.3"] ?? settings.dueDiligenceV3ContractAddress;
  if (!settings.privateKey || !address) {
    throw new Error("V3 contract or signing key is not configured");
  }
  return clientFor(settings).writeContract({
    address,
    functionName: "assess",
    args: [JSON.stringify(source), idempotencyKey],
    value: 0n,
  });
}

export async function readDueDiligence(
  settings: GenLayerSettings, proposalKey: string, contentHash?: string, storedContractAddress?: `0x${string}`,
): Promise<StoredDueDiligenceAssessment | undefined> {
  const address = storedContractAddress ?? settings.dueDiligenceContracts?.["2"] ?? settings.dueDiligenceContractAddress;
  if (!address) throw new Error("V2 contract address is not configured");
  const raw = await clientFor(settings).readContract({
    address,
    functionName: contentHash ? "get_assessment_for_revision" : "get_assessment",
    args: contentHash ? [proposalKey, contentHash] : [proposalKey],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  return parseDueDiligence(raw, proposalKey);
}

export async function submitDueDiligence(
  settings: GenLayerSettings,
  source: { kind: "snapshot"; space: string; proposalId: string },
  idempotencyKey: string,
): Promise<string> {
  if (!settings.privateKey || !settings.dueDiligenceContractAddress) {
    throw new Error("V2 contract or signing key is not configured");
  }
  return clientFor(settings).writeContract({
    address: settings.dueDiligenceContractAddress,
    functionName: "assess",
    args: [JSON.stringify(source), idempotencyKey],
    value: 0n,
  });
}

export async function findSubmittedTransaction(
  settings: GenLayerSettings,
  idempotencyKey: string,
  contractAddress: `0x${string}`,
): Promise<string | undefined> {
  if (!settings.privateKey) throw new Error("GenLayer signing key is not configured");
  const account = createAccount(settings.privateKey);
  const client = clientFor(settings);
  const raw = await client.request({ method: "sim_getTransactionsForAddress", params: [contractAddress] });
  if (!Array.isArray(raw)) throw new Error("GenLayer transaction index returned an invalid response");
  const matches = raw.filter((entry): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== "object") return false;
    const transaction = entry as Record<string, unknown>;
    const data = transaction.data as { calldata?: unknown } | undefined;
    if (typeof transaction.hash !== "string" || typeof transaction.from_address !== "string"
      || transaction.from_address.toLowerCase() !== account.address.toLowerCase()
      || typeof data?.calldata !== "string") return false;
    try {
      const decoded = atob(data.calldata);
      return decoded.includes(idempotencyKey) && decoded.includes("assess");
    } catch { return false; }
  });
  // A retry deliberately reuses a stable assessment run ID. Bound the scan and
  // classify each matching attempt: definitively reverted predecessors are
  // historical audit records, not recoverable active submissions.
  if (matches.length > 8) throw new Error("Too many GenLayer transactions match the submission intent");
  const viable: string[] = [];
  for (const match of matches) {
    const hash = match.hash;
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) continue;
    const state = classifyTransaction(await client.getTransaction({ hash: hash as TransactionHash }));
    if (state.state === "pending" || state.state === "accepted") viable.push(hash);
  }
  if (viable.length > 1) throw new Error("Multiple viable GenLayer transactions match the submission intent");
  return viable[0];
}

function clientFor(settings: GenLayerSettings) {
  const account = settings.privateKey ? createAccount(settings.privateKey) : undefined;
  return createClient({ chain: studionet, endpoint: settings.rpcUrl, account });
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Contract assessment categories are invalid");
  }
  return value;
}

function parseAssessment(raw: unknown, proposalKey: string): StoredAssessment | undefined {
  if (raw === "" || raw === null || raw === undefined) return undefined;
  const record = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>;
  const assessment: StoredAssessment = {
    proposalKey: String(record.proposal_key ?? ""),
    sourceLocatorHash: String(record.locator_hash ?? ""),
    contentHash: String(record.content_hash ?? ""),
    riskLevel: record.risk_level as StoredAssessment["riskLevel"],
    riskScore: Number(record.score),
    riskCategories: stringArray(record.categories),
    recommendation: record.recommendation as StoredAssessment["recommendation"],
    summary: String(record.summary ?? ""),
    assessedAt: String(record.assessed_at ?? ""),
    provenance: record.source_kind === "fixture" ? "fixture" : "live",
  };
  if (assessment.proposalKey !== proposalKey) throw new Error("Contract assessment proposal key mismatch");
  if (!["low", "medium", "high"].includes(assessment.riskLevel)) throw new Error("Contract risk level is invalid");
  if (!Number.isInteger(assessment.riskScore) || assessment.riskScore < 0 || assessment.riskScore > 100) {
    throw new Error("Contract risk score is invalid");
  }
  if (!["allow", "manual_review", "block"].includes(assessment.recommendation)) {
    throw new Error("Contract recommendation is invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(assessment.contentHash) || !/^[0-9a-f]{64}$/.test(assessment.sourceLocatorHash)) {
    throw new Error("Contract assessment hashes are invalid");
  }
  if (!assessment.summary || !assessment.assessedAt) throw new Error("Contract assessment is incomplete");
  return assessment;
}

export async function readAssessment(settings: GenLayerSettings, proposalKey: string): Promise<StoredAssessment | undefined> {
  const client = clientFor(settings);
  const raw = await client.readContract({
    address: settings.contractAddress,
    functionName: "get_assessment",
    args: [proposalKey],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  return parseAssessment(raw, proposalKey);
}

export async function submitAssessment(
  settings: GenLayerSettings,
  source: { kind: "snapshot"; space: string; proposalId: string },
  idempotencyKey: string,
): Promise<string> {
  if (!settings.privateKey) throw new Error("GenLayer signing key is not configured");
  const client = clientFor(settings);
  return client.writeContract({
    address: settings.contractAddress,
    functionName: "assess",
    args: [JSON.stringify(source), idempotencyKey],
    value: 0n,
  });
}

export async function getTransactionState(settings: GenLayerSettings, transactionId: string): Promise<TransactionState> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionId)) throw new Error("GenLayer transaction hash is invalid");
  const client = clientFor(settings);
  const transaction = await client.getTransaction({ hash: transactionId as TransactionHash });
  return classifyTransaction(transaction);
}
