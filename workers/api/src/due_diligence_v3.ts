import { contractCanonicalJson, sha256 } from "./canonical";
import { createDecisionIR, type DecisionIR } from "./decision_ir";
import type { StoredDueDiligenceV3Assessment } from "./domain";
import { getAddress } from "viem";

const HASH = /^[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SAFE_LOCATOR = "https://api.safe.global/tx-service/eth/api/v1/safes/";
const BLOCKSCOUT_TX = "https://eth.blockscout.com/tx/";
const SAFE_RPC_PROVIDERS = {
  publicnode: "https://ethereum-rpc.publicnode.com",
  drpc: "https://eth.drpc.org",
} as const;
const STATES = new Set(["supported", "partially_supported", "unverified", "contradicted", "not_applicable"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const SAFE_FAILURE_CODE = /^(?:rpc_(?:publicnode|drpc)_(?:request_error|invalid_http_status|http_[1-5][0-9]{2}|invalid_body|response_too_large|invalid_json|invalid_envelope|remote_error|batch_http_error|invalid_batch)|rpc_(?:not_mainnet|no_finalized_block|invalid_block_pin|invalid_block_hash|block_disagreement|safe_call_disagreement|safe_threshold_invalid|safe_owners_invalid|safe_threshold_exceeds_owners|invalid_safe_address|invalid_batch|adapter_error|invalid_historical_time|historical_boundary_disagreement|historical_state_unavailable|historical_time_not_finalized|historical_lookup_limit))$/;
const TEMPORAL_SCOPES = new Set(["historically_anchored", "current_state_observed", "inherently_historical", "unknown"]);
const PLAN_ADAPTERS = new Set(["ethereum_rpc_contract_state", "safe_state", "blockscout_transaction", "snapshot_governance_history", "github_execution_pr"]);
const PLAN_SOURCES = new Set(["ethereum_rpc", "blockscout", "snapshot", "github"]);
const PLAN_ADAPTER_SOURCE: Record<string, string> = {
  ethereum_rpc_contract_state: "ethereum_rpc", safe_state: "ethereum_rpc", blockscout_transaction: "blockscout",
  snapshot_governance_history: "snapshot", github_execution_pr: "github",
};
function iso(value: unknown, field: string, optional = false): string {
  const result = str(value, field, 80, optional);
  if (result && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(result) || Number.isNaN(Date.parse(result)))) throw new Error(`Invalid v3 ${field}`);
  return result;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid v3 ${field}`);
  return value as Record<string, unknown>;
}
function str(value: unknown, field: string, max = 400, optional = false): string {
  if (typeof value !== "string" || value.length > max || (!optional && !value.trim())) throw new Error(`Invalid v3 ${field}`);
  return value;
}
function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid v3 ${field}`);
  return value;
}
function strings(value: unknown, field: string, max: number): string[] {
  return list(value, field, max).map((entry) => str(entry, field, 300));
}
function reversible(value: unknown): boolean {
  return value === true || value === false || value === "partial" || value === "unknown";
}
function ethToMicro(value: string): bigint {
  const match = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new Error("Invalid v3 ETH amount");
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function parseDecisionPlan(raw: unknown, proposalKey: string, decisionActionIds: Set<string>, decisionClaimIds: Set<string>): void {
  const plan = object(raw, "evidence plan");
  if (plan.schemaVersion !== "3.4" || !["live", "retrospective"].includes(String(plan.assessmentContext))) {
    throw new Error("Invalid v3 evidence plan");
  }
  const source = object(plan.source, "evidence plan source");
  if (source.kind !== "snapshot" || typeof source.space !== "string" || typeof source.proposalId !== "string"
      || `snapshot:${source.space}:${source.proposalId}` !== proposalKey) throw new Error("Invalid v3 evidence plan source");
  const ids = new Set<string>();
  for (const item of list(plan.items, "evidence plan items", 12)) {
    const candidate = object(item, "evidence plan item");
    const id = str(candidate.id, "evidence plan ID", 120);
    if (ids.has(id)) throw new Error("Duplicate v3 evidence plan ID");
    ids.add(id);
    if (!PLAN_ADAPTERS.has(String(candidate.adapter)) || !PLAN_SOURCES.has(String(candidate.source))
        || PLAN_ADAPTER_SOURCE[String(candidate.adapter)] !== candidate.source
        || !["primary", "secondary", "contextual"].includes(String(candidate.authority))
        || !["validator_retrieved_proposal", "validator_retrieved_external_source"].includes(String(candidate.verificationScope))
        || !TEMPORAL_SCOPES.has(String(candidate.temporalScope))) throw new Error("Invalid v3 evidence plan item");
    str(candidate.locator, "evidence plan locator", 300);
    const actionIds = strings(candidate.actionIds, "evidence plan action IDs", 8);
    const claimIds = strings(candidate.claimIds, "evidence plan claim IDs", 8);
    if (!actionIds.length && !claimIds.length || actionIds.some((id) => !decisionActionIds.has(id))
        || claimIds.some((id) => !decisionClaimIds.has(id))) throw new Error("Invalid v3 evidence plan relationship");
    if (candidate.historicalLookupRequired !== undefined && typeof candidate.historicalLookupRequired !== "boolean") throw new Error("Invalid v3 evidence plan historical lookup");
    if (candidate.fallbackTemporalScope !== undefined && !TEMPORAL_SCOPES.has(String(candidate.fallbackTemporalScope))) throw new Error("Invalid v3 evidence plan fallback scope");
    if (candidate.isExecutionProof !== undefined && candidate.isExecutionProof !== false) throw new Error("Invalid v3 execution evidence plan");
  }
}

export async function parseDueDiligenceV3(raw: unknown, proposalKey: string): Promise<StoredDueDiligenceV3Assessment | undefined> {
  if (raw === "" || raw === null || raw === undefined) return undefined;
  const record = object(typeof raw === "string" ? JSON.parse(raw) as unknown : raw, "record");
  const recordBytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
  if (recordBytes > 25_000 || record.assessmentVersion !== "3" || record.proposalKey !== proposalKey) {
    throw new Error("Invalid v3 assessment identity or size");
  }
  if (record.assessmentSchemaVersion !== undefined && !["3.1", "3.2", "3.3", "3.4"].includes(String(record.assessmentSchemaVersion))) throw new Error("Unsupported v3 schema version");
  const schema34 = record.assessmentSchemaVersion === "3.4";
  const schema33 = record.assessmentSchemaVersion === "3.3" || schema34;
  if (record.assessmentSchemaVersion === "3.3" && recordBytes > 22_000) throw new Error("Invalid v3.3 assessment size");
  if (schema33) str(record.assessmentRunId, "assessment run ID", 120);
  let decisionIR: DecisionIR | undefined;
  if (schema34) {
    let decision: DecisionIR;
    try { decision = createDecisionIR(object(record.decisionIR, "Decision IR") as unknown as DecisionIR); }
    catch { throw new Error("Invalid v3 Decision IR"); }
    if (decision.grounding?.proposalObjective !== "grounded" || decision.grounding.actions.length !== decision.actions.length
        || decision.actions.some((action) => !decision.grounding?.actions.some((grounding) => grounding.id === action.id && grounding.retained && grounding.state !== "unresolved"))) {
      throw new Error("Invalid v3 Decision IR grounding");
    }
    parseDecisionPlan(record.evidencePlan, proposalKey, new Set(decision.actions.map((action) => action.id)), new Set(decision.claims.map((claim) => claim.id)));
    decisionIR = decision;
  }
  const hasTemporalContext = record.assessmentContext !== undefined || record.proposalCloseTime !== undefined || record.evidenceRetrievedAt !== undefined;
  if (hasTemporalContext) {
    if (!schema33 || !["live", "retrospective"].includes(String(record.assessmentContext))) throw new Error("Invalid v3 assessment context");
    iso(record.proposalCloseTime, "proposal close time");
    iso(record.evidenceRetrievedAt, "evidence retrieval time");
  }
  if (typeof record.contentHash !== "string" || !HASH.test(record.contentHash)
      || typeof record.sourceLocatorHash !== "string" || !HASH.test(record.sourceLocatorHash)) throw new Error("Invalid v3 hashes");

  const overview = object(record.overview, "overview");
  // The contract deterministically bounds this field to 700 characters.
  str(overview.purpose, "purpose", 700);
  strings(overview.requestedActions, "actions", 8);
  strings(overview.assetsAffected, "assets", 6); strings(overview.permissionsChanged, "permissions", 6); strings(overview.controlChanges, "controls", 6);

  const evidence = await Promise.all(list(record.evidence, "evidence", 12).map(async (rawEvidence) => {
    const item = object(rawEvidence, "evidence");
    str(item.id, "evidence ID", 32); str(item.description, "evidence description", 180);
    if (typeof item.contentHash !== "string" || !HASH.test(item.contentHash)) throw new Error("Invalid v3 evidence hash");
    if (item.type === "proposal") {
      if (item.verificationScope !== "validator_retrieved_proposal" || item.authority !== "primary"
          || !String(item.locator).startsWith("https://snapshot.box/#/s:") || item.contentHash !== record.contentHash) {
        throw new Error("Invalid v3 proposal evidence authority");
      }
    } else if (item.type === "safe") {
      const structured = object(item.structuredData, "Safe data");
      if (item.verificationScope !== "validator_retrieved_external_source" || item.authority !== "secondary"
          || typeof item.locator !== "string" || !item.locator.startsWith(SAFE_LOCATOR)) throw new Error("Invalid v3 Safe evidence authority");
      const address = item.locator.slice(SAFE_LOCATOR.length).replace(/\/$/, "");
      let checksummedAddress: string;
      try { checksummedAddress = getAddress(address); } catch { throw new Error("Invalid v3 Safe evidence locator"); }
      if (!ADDRESS.test(address) || checksummedAddress !== address
          || structured.address !== address.toLowerCase() || !ADDRESS.test(String(structured.address))) {
        throw new Error("Invalid v3 Safe evidence locator");
      }
      if (!Number.isInteger(structured.threshold) || Number(structured.threshold) < 1 || Number(structured.threshold) > 20) {
        throw new Error("Invalid v3 Safe threshold");
      }
      const owners = strings(structured.owners, "Safe owners", 20);
      if (!owners.length || owners.some((owner) => !ADDRESS.test(owner)) || Number(structured.threshold) > owners.length
          || [...owners].sort().join(":") !== owners.join(":")) throw new Error("Invalid v3 Safe owners");
      str(structured.version, "Safe version", 40, true);
      if (await sha256(contractCanonicalJson(structured)) !== item.contentHash) throw new Error("V3 Safe evidence hash mismatch");
    } else if (item.type === "safe_onchain") {
      const structured = object(item.structuredData, "on-chain Safe state");
      const provider = String(structured.provider);
      if (!["3.2", "3.3", "3.4"].includes(String(record.assessmentSchemaVersion)) || !Object.hasOwn(SAFE_RPC_PROVIDERS, provider)
          || item.verificationScope !== "validator_retrieved_external_source" || item.authority !== "secondary"
          || item.locator !== SAFE_RPC_PROVIDERS[provider as keyof typeof SAFE_RPC_PROVIDERS]
          || item.id !== `safe-rpc-${provider}` || structured.chainId !== 1
          || !Number.isInteger(structured.blockNumber) || Number(structured.blockNumber) < 1
          || typeof structured.blockHash !== "string" || !/^0x[0-9a-f]{64}$/.test(structured.blockHash)
          || typeof structured.address !== "string" || !ADDRESS.test(structured.address)
          || String(structured.address) !== String(structured.address).toLowerCase()
          || !Number.isInteger(structured.threshold) || Number(structured.threshold) < 1 || Number(structured.threshold) > 20) {
        throw new Error("Malformed v3 on-chain Safe evidence");
      }
      const owners = strings(structured.owners, "on-chain Safe owners", 20);
      if (!owners.length || owners.some((owner) => !ADDRESS.test(owner) || owner !== owner.toLowerCase())
          || Number(structured.threshold) > owners.length || [...owners].sort().join(":") !== owners.join(":")) {
        throw new Error("Invalid v3 on-chain Safe owners");
      }
      if (await sha256(contractCanonicalJson(structured)) !== item.contentHash) throw new Error("V3 on-chain Safe evidence hash mismatch");
    } else if (item.type === "onchain") {
      const structured = object(item.structuredData, "onchain transaction data");
      if (item.verificationScope !== "validator_retrieved_external_source" || item.authority !== "secondary"
          || typeof item.locator !== "string" || !item.locator.startsWith(BLOCKSCOUT_TX)) {
        throw new Error("Invalid v3 onchain evidence authority");
      }
      const txHash = String(structured.transactionHash ?? "");
      if (!/^0x[0-9a-f]{64}$/.test(txHash) || item.locator !== BLOCKSCOUT_TX + txHash
          || structured.status !== "success" || !Number.isInteger(structured.blockNumber) || Number(structured.blockNumber) < 1
          || typeof structured.blockHash !== "string" || !/^0x[0-9a-f]{64}$/.test(structured.blockHash)
          || typeof structured.valueWei !== "string" || !/^\d{1,78}$/.test(structured.valueWei)
          || typeof structured.amountEth !== "string" || typeof structured.from !== "string" || !ADDRESS.test(structured.from)
          || typeof structured.to !== "string" || !ADDRESS.test(structured.to)
          || structured.chainId !== 1
          || !["transaction_value", "internal_call"].includes(String(structured.transferType))
          || (structured.transferType === "transaction_value" && structured.internalTransactionIndex !== null)
          || (structured.transferType === "internal_call" && (!Number.isInteger(structured.internalTransactionIndex)
            || Number(structured.internalTransactionIndex) < 0))) {
        throw new Error("Malformed v3 onchain transaction data");
      }
      if (BigInt(String(structured.valueWei)) / 1_000_000_000_000n !== ethToMicro(String(structured.amountEth))) {
        throw new Error("V3 onchain transaction amount does not match its source row precision");
      }
      if (await sha256(contractCanonicalJson(structured)) !== item.contentHash) throw new Error("V3 onchain evidence hash mismatch");
    } else if (item.type === "governance_history" && schema33) {
      const structured = object(item.structuredData, "governance history data");
      const historyId = str(structured.id, "governance history proposal ID", 66);
      const space = str(structured.space, "governance history space", 100);
      strings(structured.choices, "governance history choices", 20);
      str(structured.title, "governance history title", 300, true);
      str(structured.body, "governance history body", 12_000, true);
      str(structured.state, "governance history state", 40);
      if (!/^0x[0-9a-f]{64}$/.test(historyId) || item.authority !== "primary"
          || item.verificationScope !== "validator_retrieved_external_source"
          || item.locator !== `https://snapshot.box/#/s:${space}/proposal/${historyId}`
          || await sha256(contractCanonicalJson(structured)) !== item.contentHash) {
        throw new Error("Invalid v3 governance history evidence");
      }
    } else {
      throw new Error("Unsupported v3 evidence type");
    }
    if (hasTemporalContext) {
      const temporal = object(item.temporal, "evidence temporal metadata");
      iso(temporal.retrievedAt, "evidence retrievedAt");
      if (temporal.retrievedAt !== record.evidenceRetrievedAt) throw new Error("Invalid v3 evidence retrieval time");
      if (temporal.sourceTimestamp !== undefined) iso(temporal.sourceTimestamp, "evidence source timestamp", true);
      if (!TEMPORAL_SCOPES.has(String(temporal.temporalScope)) || typeof temporal.historicallyAnchored !== "boolean"
          || (temporal.historicallyAnchored !== ["historically_anchored", "inherently_historical"].includes(String(temporal.temporalScope)))) {
        throw new Error("Invalid v3 evidence temporal scope");
      }
      if (item.type === "safe_onchain" || item.type === "onchain") {
        const structured = object(item.structuredData, "temporal structured data");
        if (temporal.blockNumber !== structured.blockNumber || temporal.blockHash !== structured.blockHash) throw new Error("Invalid v3 temporal block anchor");
      }
    }
    str(item.locator, "evidence locator", 300);
    return item;
  }));
  const evidenceById = new Map(evidence.map((item) => [String(item.id), item]));
  if (evidenceById.size !== evidence.length || !evidenceById.has("proposal")) throw new Error("Duplicate or missing v3 evidence");
  const safeRpcEvidence = [evidenceById.get("safe-rpc-publicnode"), evidenceById.get("safe-rpc-drpc")];
  const anySafeRpcEvidence = safeRpcEvidence.some(Boolean);
  const hasSafeRpc = safeRpcEvidence.every(Boolean);
  if ((["3.2", "3.3", "3.4"].includes(String(record.assessmentSchemaVersion)) && anySafeRpcEvidence !== hasSafeRpc)
      || (!["3.2", "3.3", "3.4"].includes(String(record.assessmentSchemaVersion)) && anySafeRpcEvidence)) {
    throw new Error("Incomplete or version-incompatible dual-RPC Safe evidence");
  }
  if (["3.2", "3.3", "3.4"].includes(String(record.assessmentSchemaVersion)) && hasSafeRpc) {
    const first = object(safeRpcEvidence[0]!.structuredData, "first on-chain Safe provider data");
    const second = object(safeRpcEvidence[1]!.structuredData, "second on-chain Safe provider data");
    for (const field of ["address", "chainId", "blockNumber", "blockHash", "threshold"]) {
      if (first[field] !== second[field]) throw new Error("V3 RPC providers disagree on Safe state");
    }
    if (contractCanonicalJson(first.owners) !== contractCanonicalJson(second.owners)) throw new Error("V3 RPC providers disagree on Safe owners");
    if (first.provider !== "publicnode" || second.provider !== "drpc") throw new Error("V3 Safe provider evidence is not in canonical provider order");
  }
  const safeEvidenceStateConsistent = ["3.2", "3.3", "3.4"].includes(String(record.assessmentSchemaVersion))
    ? (record.externalEvidenceState === "retrieved") === hasSafeRpc
    : (record.externalEvidenceState === "retrieved") === evidenceById.has("safe-mainnet");
  if (!["not_attempted", "retrieved", "unavailable"].includes(String(record.externalEvidenceState)) || !safeEvidenceStateConsistent) {
    throw new Error("Invalid v3 external evidence state");
  }
  if (record.externalEvidenceFailureCode !== undefined) {
    const code = str(record.externalEvidenceFailureCode, "external evidence failure code", 64, true);
    const retrospectiveFallback = record.assessmentContext === "retrospective" && record.externalEvidenceState === "retrieved"
      && safeRpcEvidence.every((item) => item && object(item.temporal, "Safe temporal metadata").temporalScope === "current_state_observed");
    if ((code && ((!retrospectiveFallback && record.externalEvidenceState !== "unavailable") || !SAFE_FAILURE_CODE.test(code)))
        || (!code && record.externalEvidenceState === "unavailable" && ["3.2", "3.3", "3.4"].includes(String(record.assessmentSchemaVersion)))) {
      throw new Error("Invalid v3 external evidence failure code");
    }
  }
  const onchainEvidence = evidence.filter((item) => item.type === "onchain");
  if (["3.1", "3.2", "3.3", "3.4"].includes(String(record.assessmentSchemaVersion))) {
    if (!["not_attempted", "retrieved", "unavailable"].includes(String(record.returnedFundsState))
        || (record.returnedFundsState === "retrieved") !== (schema33 ? onchainEvidence.length >= 1 && onchainEvidence.length <= 5 : onchainEvidence.length === 5)
        || (record.returnedFundsState !== "retrieved" && onchainEvidence.length !== 0)) {
      throw new Error("Invalid v3.1 returned-funds evidence state");
    }
  } else if (onchainEvidence.length || record.returnedFundsState !== undefined) {
    throw new Error("Legacy v3 assessment cannot contain v3.1 returned-funds fields");
  }
  const refs = (value: unknown, field: string, max = 6): string[] => {
    const ids = strings(value, field, max);
    if (!ids.length || ids.some((id) => !evidenceById.has(id))) throw new Error(`Invalid v3 ${field}`);
    return ids;
  };
  const actions = schema33 ? list(record.materialActions, "material actions", 8).map((rawAction) => {
    const action = object(rawAction, "material action");
    str(action.id, "action ID", 32); str(action.sourceExcerpt, "action excerpt", 280);
    str(action.summary, "action summary", 300);
    for (const key of ["actor", "target", "asset", "amount", "method"]) str(action[key], key, 250, true);
    if (!reversible(action.reversible)) throw new Error("Invalid v3 action reversibility");
    return action;
  }) : [];
  const actionIds = new Set(actions.map((action) => String(action.id)));
  if (actionIds.size !== actions.length) throw new Error("Duplicate v3 action ID");

  const claims = list(record.materialClaims, "claims", 8).map((rawClaim) => {
    const item = object(rawClaim, "claim");
    str(item.id, "claim ID", 32); str(item.claim, "claim", 300);
    const claimExcerpt = str(item.sourceExcerpt, "claim excerpt", 280);
    str(item.explanation, "claim explanation", 400);
    if (!["proposal_action", "external_factual"].includes(String(item.claimScope)) || !STATES.has(String(item.status))
        || !["low", "medium", "high"].includes(String(item.confidence))) throw new Error("Invalid v3 claim classification");
    str(item.counterExcerpt, "counter excerpt", 280, true); str(item.verificationMethod, "verification method", 100, true);
    const claimEvidence = refs(item.evidence, "claim evidence");
    if (schema33) {
      if (item.proposalAssertion !== true) throw new Error("Invalid v3 proposal assertion marker");
      const authorities = strings(item.evidenceAuthority, "claim evidence authority", 3);
      const actualAuthorities = [...new Set(claimEvidence.map((id) => String(evidenceById.get(id)?.authority)))];
      if (contractCanonicalJson(authorities) !== contractCanonicalJson(actualAuthorities)) throw new Error("Invalid v3 claim evidence authority");
      const relatedActions = strings(item.relatedActionIds, "claim related actions", 8);
      if (relatedActions.some((id) => !actionIds.has(id))) throw new Error("Unknown v3 claim action");
      if (item.status === "partially_supported"
          && (!item.verificationMethod || !claimEvidence.some((id) => evidenceById.get(id)?.verificationScope === "validator_retrieved_external_source"))) {
        throw new Error("V3 partially supported claim lacks external evidence and method");
      }
    }
    if (!(schema33 ? STATES : new Set(["supported", "contradicted", "unverified"])).has(String(item.status))) {
      throw new Error("Unsupported v3 claim status");
    }
    if (item.claimScope === "proposal_action") {
      if (item.status !== (schema33 ? "not_applicable" : "supported") || item.verificationMethod !== "proposal_presence_only"
          || claimEvidence.length !== 1 || claimEvidence[0] !== "proposal" || item.counterExcerpt) {
        throw new Error("Invalid v3 proposal-action claim semantics");
      }
    } else if (["supported", "partially_supported", "contradicted"].includes(String(item.status))) {
      if (item.verificationMethod === "safe_transaction_service_eth_mainnet_config_comparison") {
        if (record.assessmentSchemaVersion === "3.2" || record.externalEvidenceState !== "retrieved" || !claimEvidence.some((id) => evidenceById.get(id)?.type === "safe")) {
          throw new Error("V3 verified claim lacks matching independently retrieved evidence");
        }
        const safeEvidence = evidenceById.get(claimEvidence.find((id) => evidenceById.get(id)?.type === "safe")!)!;
        const safeData = object(safeEvidence.structuredData, "verified Safe data");
        const claimedAddress = claimExcerpt.match(/0x[0-9a-f]{40}/i)?.[0].toLowerCase();
        const threshold = claimExcerpt.match(/\b(\d{1,2})\s*(?:\/|of)\s*(\d{1,2})\b/i);
        if (!claimedAddress || claimedAddress !== safeData.address || !threshold) throw new Error("V3 Safe claim does not identify the verified address and threshold");
        const matchingParts = Number(Number(threshold[1]) === Number(safeData.threshold))
          + Number(Number(threshold[2]) === (safeData.owners as string[]).length);
        const expectedStatus = matchingParts === 2 ? "supported" : matchingParts === 1 ? "partially_supported" : "contradicted";
        if (item.status !== expectedStatus) throw new Error("V3 Safe claim status conflicts with structured evidence");
        if (item.status === "contradicted") {
          if (!item.counterExcerpt) throw new Error("V3 contradicted claim needs opposing evidence");
          if (item.counterExcerpt !== `${safeData.threshold}/${(safeData.owners as string[]).length} threshold and owners returned by the Safe Transaction Service`) {
            throw new Error("V3 Safe counter-evidence does not match structured evidence");
          }
        }
      } else if (item.verificationMethod === "ethereum_mainnet_dual_rpc_safe_config_comparison_v1") {
        if (!["3.2", "3.3", "3.4"].includes(String(record.assessmentSchemaVersion)) || record.externalEvidenceState !== "retrieved"
            || !claimEvidence.includes("safe-rpc-publicnode") || !claimEvidence.includes("safe-rpc-drpc")) {
          throw new Error("V3 verified Safe claim lacks matching dual-RPC evidence");
        }
        const safeData = object(evidenceById.get("safe-rpc-publicnode")?.structuredData, "verified on-chain Safe state");
        if (record.assessmentContext === "retrospective") {
          const temporal = object(evidenceById.get("safe-rpc-publicnode")?.temporal, "verified Safe temporal metadata");
          if (temporal.temporalScope !== "historically_anchored") throw new Error("Retrospective Safe claim lacks historical anchor");
        }
        const claimedAddress = claimExcerpt.match(/0x[0-9a-f]{40}/i)?.[0].toLowerCase();
        const threshold = claimExcerpt.match(/\b(\d{1,2})\s*(?:\/|of)\s*(\d{1,2})\b/i);
        if (!claimedAddress || claimedAddress !== safeData.address || !threshold) throw new Error("V3 Safe claim does not identify the verified address and threshold");
        const matchingParts = Number(Number(threshold[1]) === Number(safeData.threshold))
          + Number(Number(threshold[2]) === (safeData.owners as string[]).length);
        const expectedStatus = matchingParts === 2 ? "supported" : matchingParts === 1 ? "partially_supported" : "contradicted";
        if (item.status !== expectedStatus) throw new Error("V3 Safe claim status conflicts with dual-RPC evidence");
        if (item.status === "contradicted" && item.counterExcerpt !== `${safeData.threshold}/${(safeData.owners as string[]).length} threshold and owners reported by two Ethereum RPC providers at block ${safeData.blockNumber}`) {
          throw new Error("V3 Safe counter-evidence does not match dual-RPC data");
        }
      } else if (item.verificationMethod === "blockscout_mainnet_transfer_amount_comparison") {
        if (!["3.1", "3.2", "3.3", "3.4"].includes(String(record.assessmentSchemaVersion)) || record.returnedFundsState !== "retrieved"
            || item.status !== "supported" || claimEvidence[0] !== "proposal"
            || claimEvidence.length < 2 || claimEvidence.length > 6) {
          throw new Error("V3.1 returned-funds claim lacks complete evidence");
        }
        const safeEvidenceId = ["3.2", "3.3", "3.4"].includes(String(record.assessmentSchemaVersion)) ? "safe-rpc-publicnode" : "safe-mainnet";
        const safeData = object(evidenceById.get(safeEvidenceId)?.structuredData, "returned-funds Safe");
        const listedAmount = String(item.claim).match(/reports ([\d,]+(?:\.\d+)?) ETH returned/i)?.[1]?.replace(/,/g, "");
        const sourceTotal = claimExcerpt.match(/\*\*([\d,]+(?:\.\d+)?)\*\*/)?.[1]?.replace(/,/g, "");
        if (!listedAmount || !sourceTotal || ethToMicro(listedAmount) !== ethToMicro(sourceTotal)) {
          throw new Error("V3.1 returned-funds claim does not match the cited proposal total");
        }
        const values = claimEvidence.slice(1).map((id, index) => {
          if (id !== `return-tx-${index + 1}`) throw new Error("V3.1 return transaction evidence order mismatch");
          const evidenceItem = evidenceById.get(id);
          if (!evidenceItem || evidenceItem.type !== "onchain") throw new Error("V3.1 returned-funds claim lacks transaction evidence");
          const data = object(evidenceItem.structuredData, "returned-funds transaction");
          if (data.to !== safeData.address || data.status !== "success" || data.chainId !== 1) throw new Error("Returned-funds transaction recipient/status mismatch");
          return ethToMicro(String(data.amountEth));
        });
        const txHashes = onchainEvidence.map((evidenceItem) => String(object(evidenceItem.structuredData, "transaction data").transactionHash));
        if (new Set(txHashes).size !== onchainEvidence.length || onchainEvidence.some((evidenceItem, index) => evidenceItem.id !== `return-tx-${index + 1}`)) {
          throw new Error("V3 returned-funds evidence must contain unique ordered transactions");
        }
        if (values.reduce((sum, value) => sum + value, 0n) !== ethToMicro(listedAmount)) {
          throw new Error("V3.1 transaction rows do not add up to the supported proposal total");
        }
      } else if (schema33 && item.verificationMethod === "snapshot_governance_history_amount_comparison_v1") {
        const historyEvidence = evidenceById.get(claimEvidence.find((id) => evidenceById.get(id)?.type === "governance_history") ?? "");
        if (!historyEvidence) {
          throw new Error("V3 governance-history claim lacks matching evidence");
        }
        const history = object(historyEvidence.structuredData, "governance history claim evidence");
        const amountPattern = /\b(\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|million|billion)?)\s*(ARB|BAL|SAFE|ENS|ETH|USDC|USDT|DAI)\b/i;
        const claimed = claimExcerpt.match(amountPattern);
        const historyText = `${String(history.title ?? "")}\n${String(history.body ?? "")}`;
        const historical = historyText.match(amountPattern);
        if (!claimed || !historical) throw new Error("V3 governance-history claim lacks comparable values");
        const normalizeAmount = (value: string) => value.replace(/[\s,]/g, "").toLowerCase();
        const exact = normalizeAmount(claimed[1]) === normalizeAmount(historical[1]) && claimed[2].toUpperCase() === historical[2].toUpperCase();
        const sameAsset = claimed[2].toUpperCase() === historical[2].toUpperCase();
        const rejected = /\b(?:do not|does not|did not|never)\b.{0,50}\b(?:transfer|allocate|approve|fund)\b|\b(?:rejected|defeated)\b/i.test(historyText);
        const claimsOutcome = /\b(?:approved|passed|executed|transferred|returned|already)\b/i.test(claimExcerpt);
        const expectedStatus = exact && rejected ? "contradicted" : exact && claimsOutcome ? "partially_supported"
          : exact ? "supported" : sameAsset ? "contradicted" : "unverified";
        if (item.status !== expectedStatus) throw new Error("V3 governance-history claim status conflicts with structured evidence");
      } else {
        throw new Error("V3 verified claim uses an unsupported verification method");
      }
    }
    if (item.status === "contradicted" && !item.counterExcerpt) throw new Error("V3 contradicted claim needs opposing evidence");
    return item;
  });
  if (new Set(claims.map((claim) => String(claim.id))).size !== claims.length) throw new Error("Duplicate v3 claim ID");
  const claimIds = new Set(claims.map((claim) => String(claim.id)));

  const gaps = (value: unknown, field: string) => list(value, field, schema33 ? 72 : 8).map((rawGap) => {
    const gap = object(rawGap, field);
    str(gap.safeguard, "safeguard", 80); str(gap.scope, "safeguard scope", 200);
    if (!["present", "explicitly_absent", "not_identified", "unknown"].includes(String(gap.state))) throw new Error("Invalid v3 safeguard state");
    const gapActionIds = strings(gap.relatedActionIds, "related action IDs", 8);
    if (gapActionIds.some((id) => !/^a[1-8]$/.test(id) || (schema33 && !actionIds.has(id)))) throw new Error("Invalid v3 safeguard action mapping");
    refs(gap.evidence, "safeguard evidence");
    return gap;
  });
  const safeguardGaps = gaps(record.safeguardGaps, "safeguard gaps");
  if (schema33 && new Set(safeguardGaps.map((gap) => String(gap.id))).size !== safeguardGaps.length) throw new Error("Duplicate v3 safeguard gap ID");
  const findings = list(record.findings, "findings", 6).map((rawFinding) => {
    const finding = object(rawFinding, "finding");
    str(finding.id, "finding ID", 32); str(finding.title, "finding title", 120);
    str(finding.sourceExcerpt, "finding excerpt", 280); str(finding.observation, "observation", 400);
    str(finding.whyItMatters, "reason", 400); str(finding.impact, "impact", 300);
    if (!["treasury_exposure", "governance_change", "execution_dependency"].includes(String(finding.type))
        || !["informational", "low", "medium", "high", "critical"].includes(String(finding.severity))
        || !["low", "medium", "high"].includes(String(finding.confidence)) || !reversible(finding.reversible)) throw new Error("Invalid v3 finding");
    refs(finding.evidence, "finding evidence"); strings(finding.existingSafeguards, "safeguards", 8);
    if (!schema33) gaps(finding.safeguardGaps, "finding safeguard gaps");
    if (schema33 && strings(finding.relatedActionIds, "finding related actions", 8).some((id) => !actionIds.has(id))) {
      throw new Error("Unknown v3 finding action");
    }
    if (schema33 && strings(finding.relatedClaimIds, "finding related claims", 8).some((id) => !claimIds.has(id))) {
      throw new Error("Unknown v3 finding claim");
    }
    strings(finding.humanDependencies, "human dependencies", 20); strings(finding.technicalDependencies, "technical dependencies", 4);
    str(finding.uncertainty, "uncertainty", 300);
    const consensus = object(finding.consensus, "finding consensus");
    if (consensus.state !== "accepted" || consensus.method !== (schema33 ? "independent_structured_derivation_v3_3" : "independent_structured_derivation_v3")) throw new Error("Invalid v3 finding consensus");
    return finding;
  });
  if (new Set(findings.map((finding) => String(finding.id))).size !== findings.length) throw new Error("Duplicate v3 finding ID");
  const findingIds = new Set(findings.map((finding) => String(finding.id)));
  if (schema33) {
    const gapIds = new Set(safeguardGaps.map((gap) => String(gap.id)));
    for (const finding of findings) {
      const ids = strings(finding.safeguardGapIds, "finding safeguard gap IDs", 72);
      if (ids.some((id) => !gapIds.has(id))) throw new Error("Unknown v3 safeguard gap");
    }
  }

  const execution = list(record.executionMap, "execution map", 8).map((rawStep, index) => {
    const step = object(rawStep, "execution step");
    str(step.id, "step ID", 32); str(step.action, "step action", 250);
    if (step.order !== index + 1 || !reversible(step.reversible)) throw new Error("Invalid v3 execution step");
    for (const key of ["actor", "target", "asset", "amount", "dependency", "impact"]) str(step[key], key, 250, true);
    strings(step.humanDependencies, "human dependencies", 20); strings(step.technicalDependencies, "technical dependencies", 4);
    refs(step.evidence, "step evidence");
    if (schema33) {
      const relatedActions = strings(step.relatedActionIds, "execution related actions", 8);
      if (relatedActions.some((id) => !actionIds.has(id))) throw new Error("Unknown v3 execution action");
      if (strings(step.relatedClaimIds, "execution related claims", 8).some((id) => !claimIds.has(id))) throw new Error("Unknown v3 execution claim");
    }
    return step;
  });
  const executionIds = new Set(execution.map((step) => String(step.id)));
  if (schema33) {
    for (const gap of safeguardGaps) {
      if (strings(gap.relatedFindingIds, "safeguard related findings", 6).some((id) => !findingIds.has(id))) throw new Error("Unknown v3 safeguard finding");
      if (strings(gap.relatedExecutionStepIds, "safeguard related execution steps", 8).some((id) => !executionIds.has(id))) throw new Error("Unknown v3 safeguard execution step");
    }
  }
  const questions = list(record.unresolvedQuestions, "questions", 6).map((rawQuestion) => {
    const question = object(rawQuestion, "question");
    str(question.id, "question ID", 32); str(question.question, "question", 240);
    str(question.whyItMatters, "question reason", 300); str(question.evidenceGap, "evidence gap", 240, true);
    const related = strings(question.relatedFindingIds, "related findings", 6);
    if (related.some((id) => !findingIds.has(id))) throw new Error("Unknown v3 related finding");
    if (schema33) {
      const relatedActions = strings(question.relatedActionIds, "question related actions", 8);
      const relatedSteps = strings(question.relatedExecutionStepIds, "question related execution steps", 8);
      const relatedClaims = strings(question.relatedClaimIds, "question related claims", 8);
      if (relatedActions.some((id) => !actionIds.has(id))) throw new Error("Unknown v3 question action");
      if (relatedSteps.some((id) => !executionIds.has(id))) throw new Error("Unknown v3 question execution step");
      if (relatedClaims.some((id) => !claimIds.has(id))) throw new Error("Unknown v3 question claim");
    }
    return question;
  });
  const contradictedClaim = claims.some((claim) => claim.claimScope === "external_factual" && claim.status === "contradicted");
  const priority = findings.some((finding) => finding.severity === "critical") ? "urgent"
    : findings.some((finding) => finding.severity === "high") || contradictedClaim ? "high"
      : findings.length || questions.length ? "normal" : "low";
  if (!PRIORITIES.has(String(record.reviewPriority)) || (!schema33 && record.reviewPriority !== priority)) throw new Error("Invalid v3 review priority");
  str(record.reviewPriorityExplanation, "priority explanation", 350); str(record.assessedAt, "assessedAt", 80);
  if (record.provenance !== "live" && record.provenance !== "fixture") throw new Error("Invalid v3 provenance");
  const consensus = object(record.consensus, "consensus");
  if (consensus.state !== "accepted" || consensus.method !== (schema33 ? "independent_structured_derivation_v3_3" : "independent_structured_derivation_v3")) throw new Error("Invalid v3 consensus");

  return { ...record, ...(decisionIR ? { decisionIR } : {}), evidence, materialClaims: claims, findings, safeguardGaps, executionMap: execution,
    unresolvedQuestions: questions } as unknown as StoredDueDiligenceV3Assessment;
}
