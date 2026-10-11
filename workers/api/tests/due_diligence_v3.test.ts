import { contractCanonicalJson, sha256 } from "../src/canonical";
import { parseDueDiligenceV3 } from "../src/due_diligence_v3";

const proposalKey = "snapshot:dao.eth:p1";
const proposalHash = "a".repeat(64);
const safeData = {
  address: "0x1111111111111111111111111111111111111111",
  threshold: 2,
  owners: ["0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333"],
  version: "1.4.1",
};

async function record() {
  return {
    assessmentVersion: "3", proposalKey, contentHash: proposalHash, sourceLocatorHash: "b".repeat(64),
    overview: { purpose: "Transfer treasury funds", requestedActions: ["Transfer 5M ARB"], assetsAffected: ["5M ARB"], permissionsChanged: [], controlChanges: [] },
    evidence: [
      { id: "proposal", type: "proposal", locator: "https://snapshot.box/#/s:dao.eth/proposal/p1", description: "Snapshot proposal",
        contentHash: proposalHash, verificationScope: "validator_retrieved_proposal", authority: "primary" },
      { id: "safe-mainnet", type: "safe", locator: `https://api.safe.global/tx-service/eth/api/v1/safes/${safeData.address}/`,
        description: "Safe configuration", contentHash: await sha256(contractCanonicalJson(safeData)),
        verificationScope: "validator_retrieved_external_source", authority: "secondary", structuredData: safeData },
    ],
    externalEvidenceState: "retrieved",
    materialClaims: [{ id: "c1", claim: `Ethereum mainnet Safe ${safeData.address} has a 2/2 threshold`, sourceExcerpt: `Ethereum mainnet Safe ${safeData.address} has a 2/2 threshold`, counterExcerpt: "2/2 threshold and owners returned by the Safe Transaction Service",
      claimScope: "external_factual", status: "supported", explanation: "Compared to Safe service configuration.",
      evidence: ["proposal", "safe-mainnet"], confidence: "medium", verificationMethod: "safe_transaction_service_eth_mainnet_config_comparison" }],
    findings: [{ id: "f1", type: "treasury_exposure", title: "Treasury action", sourceExcerpt: "Transfer 5M ARB", observation: "Transfer 5M ARB",
      whyItMatters: "DAO direct control changes.", impact: "DAO direct control changes.", severity: "high", confidence: "medium", evidence: ["proposal"],
      existingSafeguards: [], safeguardGaps: [{ safeguard: "recovery", state: "not_identified", scope: "reviewed material", relatedActionIds: ["a1"], evidence: ["proposal"] }],
      humanDependencies: [], technicalDependencies: [], reversible: "unknown", uncertainty: "Reviewed sources are bounded.",
      consensus: { state: "accepted", method: "independent_structured_derivation_v3" } }],
    safeguardGaps: [{ safeguard: "recovery", state: "not_identified", scope: "reviewed material", relatedActionIds: ["a1"], evidence: ["proposal"] }],
    executionMap: [{ id: "s1", order: 1, action: "Transfer 5M ARB", actor: "", target: safeData.address, asset: "ARB", amount: "5M",
      dependency: "", impact: "DAO direct control changes.", humanDependencies: [], technicalDependencies: [safeData.address], reversible: "unknown", evidence: ["proposal"] }],
    unresolvedQuestions: [{ id: "q1", question: "Who verifies distribution?", whyItMatters: "Human approval affects release.", relatedFindingIds: ["f1"], evidenceGap: "Reviewer not identified" }],
    reviewPriority: "high", reviewPriorityExplanation: "High review priority because treasury action.", assessedAt: "2026-10-04T00:00:00Z",
    provenance: "live", consensus: { state: "accepted", method: "independent_structured_derivation_v3" },
  };
}

async function returnedFundsRecord() {
  const value = await record();
  const amounts = ["120.000000", "52.061000", "100.219105", "15.948000", "8.173606"];
  const wei = ["120000000000000000000", "52061000000000000000", "100219105090000000000",
    "15948000000000000000", "8173606000000000000"];
  const txHashes = Array.from({ length: 5 }, (_, index) => "0x" + String(index + 1).padStart(64, "0"));
  const onchain = await Promise.all(txHashes.map(async (transactionHash, index) => {
    const structuredData = { transactionHash, status: "success", blockNumber: 100 + index,
      blockHash: "0x" + String(index + 11).padStart(64, "0"), amountEth: amounts[index], valueWei: wei[index],
      from: safeData.owners[index % safeData.owners.length], to: safeData.address,
      transferType: index === 4 ? "internal_call" : "transaction_value",
      internalTransactionIndex: index === 4 ? 1 : null, chainId: 1 as const };
    return { id: "return-tx-" + (index + 1), type: "onchain", locator: "https://eth.blockscout.com/tx/" + transactionHash,
      description: "Ethereum mainnet returned-fund transaction " + (index + 1),
      contentHash: await sha256(contractCanonicalJson(structuredData)),
      verificationScope: "validator_retrieved_external_source", authority: "secondary", structuredData };
  }));
  value.assessmentSchemaVersion = "3.1";
  value.returnedFundsState = "retrieved";
  value.evidence.push(...onchain);
  value.materialClaims.push({ id: "c2", claim: "The proposal reports 296.401711 ETH returned to the DAO Safe in 5 transactions.",
    sourceExcerpt: "| | | **TOTAL** | **296.401711** | |",
    counterExcerpt: "Retrieved transaction calls total 296.40171109 ETH; the proposal displays 296.401711 ETH.",
    claimScope: "external_factual", status: "supported", explanation: "Five successful mainnet traces match the table at six-decimal precision.",
    evidence: ["proposal", ...onchain.map((item) => item.id)], confidence: "high",
    verificationMethod: "blockscout_mainnet_transfer_amount_comparison" });
  return value;
}

async function dualRpcRecord() {
  const value = await record();
  const address = "0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f";
  const rpcState = (provider: "publicnode" | "drpc") => ({ provider, address, chainId: 1 as const,
    blockNumber: 25_000_000, blockHash: "0x" + "d".repeat(64), threshold: 2,
    owners: [...safeData.owners].map((owner) => owner.toLowerCase()).sort() });
  const safeEvidence = await Promise.all((["publicnode", "drpc"] as const).map(async (provider) => {
    const structuredData = rpcState(provider);
    return { id: `safe-rpc-${provider}`, type: "safe_onchain", locator: provider === "publicnode"
      ? "https://ethereum-rpc.publicnode.com" : "https://eth.drpc.org",
      description: `Safe state reported by ${provider} at pinned Ethereum block 25000000`,
      contentHash: await sha256(contractCanonicalJson(structuredData)),
      verificationScope: "validator_retrieved_external_source", authority: "secondary", structuredData };
  }));
  value.assessmentSchemaVersion = "3.2";
  value.returnedFundsState = "not_attempted";
  value.evidence = [value.evidence[0], ...safeEvidence];
  value.materialClaims[0] = { id: "c1", claim: `Ethereum mainnet Safe ${address} has a 2/2 threshold`,
    sourceExcerpt: `Ethereum mainnet Safe ${address} has a 2/2 threshold`,
    counterExcerpt: "2/2 threshold and owners reported by two Ethereum RPC providers at block 25000000",
    claimScope: "external_factual", status: "supported", explanation: "Two fixed Ethereum RPC providers returned matching Safe configuration at the same pinned block.",
    evidence: ["proposal", "safe-rpc-publicnode", "safe-rpc-drpc"], confidence: "medium",
    verificationMethod: "ethereum_mainnet_dual_rpc_safe_config_comparison_v1" };
  return value;
}

async function schema33Record() {
  const value = await dualRpcRecord();
  value.assessmentSchemaVersion = "3.3";
  Object.assign(value, {
    assessmentRunId: "run-safe-p1-1",
    externalEvidenceStates: { safe: "retrieved", returnedFunds: "not_attempted", governanceHistory: "not_attempted" },
    materialActions: [{ id: "a1", kind: "treasury_transfer", sourceExcerpt: "Transfer 5M ARB", summary: "Transfer 5M ARB",
      actor: "", target: safeData.address, amount: "5M", asset: "ARB", method: "", reversible: "unknown" }],
    consensus: { state: "accepted", method: "independent_structured_derivation_v3_3" },
  });
  Object.assign(value.materialClaims[0], { proposalAssertion: true, evidenceAuthority: ["primary", "secondary"], relatedActionIds: [] });
  Object.assign(value.findings[0], { safeguardGapIds: ["sg1"], relatedActionIds: ["a1"], relatedClaimIds: [],
    consensus: { state: "accepted", method: "independent_structured_derivation_v3_3" } });
  delete (value.findings[0] as Record<string, unknown>).safeguardGaps;
  Object.assign(value.safeguardGaps[0], { id: "sg1", explanation: "Not identified; absence is not established.", confidence: "medium",
    relatedFindingIds: ["f1"], relatedExecutionStepIds: ["s1"] });
  Object.assign(value.executionMap[0], { relatedActionIds: ["a1"], relatedClaimIds: [] });
  Object.assign(value.unresolvedQuestions[0], { relatedActionIds: ["a1"], relatedClaimIds: [], relatedExecutionStepIds: ["s1"] });
  return value;
}

async function schema34Record() {
  const value: any = await schema33Record();
  value.assessmentSchemaVersion = "3.4";
  value.decisionIR = {
    schemaVersion: "3.4", proposalObjective: "Recover unclaimed USDC rewards.",
    actions: [{ id: "claim-fees", operation: "token_claim", sourceExcerpt: "Recover unclaimed USDC rewards.",
      actor: "DAO multisig", function: "claimFees", arguments: ["0", "DAO", "FeeDistributor", "USDC"],
      asset: "USDC", amount: "approximately 10,286.807445", recipient: "DAO", frequency: "4 calls",
      conditions: [], dependencies: ["FeeDistributor settles at most 20 weeks per call"] }],
    claims: [], safeguards: [{ id: "recovery", subject: "Fee recovery", state: "present", sourceExcerpt: "Recover unclaimed USDC rewards." }],
    executionConsequences: [{ id: "recover", statement: "The DAO recovers USDC rewards.", sourceExcerpt: "Recover unclaimed USDC rewards." }],
    unknowns: [{ id: "contract", subject: "Exact contract address", state: "unknown", sourceExcerpt: "Recover unclaimed USDC rewards." }],
    evidenceReferences: [], grounding: { proposalObjective: "grounded", actions: [{ id: "claim-fees", state: "grounded", retained: true, fields: [] }] },
  };
  value.evidencePlan = { schemaVersion: "3.4", assessmentContext: "live", source: { kind: "snapshot", space: "dao.eth", proposalId: "p1" },
    items: [{ id: "plan-1", actionIds: ["claim-fees"], claimIds: [], adapter: "ethereum_rpc_contract_state", source: "ethereum_rpc",
      locator: "proposal:claimFees", authority: "contextual", verificationScope: "validator_retrieved_external_source", temporalScope: "unknown" }] };
  return value;
}

async function temporalSchema33Record(scope: "historically_anchored" | "current_state_observed" = "historically_anchored") {
  const value: any = await schema33Record();
  Object.assign(value, { assessmentContext: "retrospective", proposalCloseTime: "2026-09-01T00:00:00Z",
    evidenceRetrievedAt: "2026-10-04T00:00:00Z" });
  for (const item of value.evidence) {
    item.temporal = item.type === "safe_onchain"
      ? { retrievedAt: value.evidenceRetrievedAt, sourceTimestamp: "2026-08-31T23:59:48Z",
          blockNumber: item.structuredData.blockNumber, blockHash: item.structuredData.blockHash,
          historicallyAnchored: scope === "historically_anchored", temporalScope: scope }
      : { retrievedAt: value.evidenceRetrievedAt, sourceTimestamp: value.proposalCloseTime,
          historicallyAnchored: false, temporalScope: "unknown" };
  }
  if (scope === "current_state_observed") {
    Object.assign(value.materialClaims[0], { status: "unverified",
      explanation: "Current Safe state is not proof of configuration at proposal close.",
      verificationMethod: "ethereum_mainnet_dual_rpc_safe_current_state_context_v1" });
  }
  return value;
}

async function schema33ReturnedFundsRecord(count: number) {
  const value = await schema33Record();
  const destination = String((value.evidence.find((item) => item.id === "safe-rpc-publicnode")!.structuredData as Record<string, unknown>).address);
  const rows = await Promise.all(Array.from({ length: count }, async (_, index) => {
    const amountEth = `${index + 1}.000000`;
    const transactionHash = "0x" + String(index + 1).padStart(64, "0");
    const structuredData = { transactionHash, status: "success", blockNumber: 200 + index,
      blockHash: "0x" + String(index + 21).padStart(64, "0"), amountEth,
      valueWei: String(BigInt(index + 1) * 1_000_000_000_000_000_000n), from: safeData.owners[0], to: destination,
      transferType: "transaction_value", internalTransactionIndex: null, chainId: 1 };
    return { id: `return-tx-${index + 1}`, type: "onchain", locator: `https://eth.blockscout.com/tx/${transactionHash}`,
      description: `Returned funds ${index + 1}`, contentHash: await sha256(contractCanonicalJson(structuredData)),
      verificationScope: "validator_retrieved_external_source", authority: "secondary", structuredData };
  }));
  const total = count * (count + 1) / 2;
  value.evidence.push(...rows);
  value.returnedFundsState = "retrieved";
  value.externalEvidenceStates.returnedFunds = "retrieved";
  value.materialClaims.push({ id: "c2", claim: `The proposal reports ${total} ETH returned to the DAO Safe in ${count} transactions.`,
    sourceExcerpt: `**${total}.000000**`, counterExcerpt: `Blockscout-reported transfers total ${total} ETH.`,
    claimScope: "external_factual", proposalAssertion: true, status: "supported", explanation: "Transactions match.",
    evidence: ["proposal", ...rows.map((row) => row.id)], evidenceAuthority: ["primary", "secondary"], relatedActionIds: [],
    confidence: "high", verificationMethod: "blockscout_mainnet_transfer_amount_comparison" });
  return value;
}

describe("v3 due-diligence parser", () => {
  it("accepts retrospective historically anchored Safe evidence", async () => {
    const parsed = await parseDueDiligenceV3(await temporalSchema33Record(), proposalKey);
    expect(parsed?.assessmentContext).toBe("retrospective");
    expect(parsed?.evidence[1].temporal?.temporalScope).toBe("historically_anchored");
    const serialized = JSON.parse(JSON.stringify(parsed));
    expect(serialized.proposalCloseTime).toBe("2026-09-01T00:00:00Z");
    expect(serialized.evidenceRetrievedAt).toBe("2026-10-04T00:00:00Z");
  });

  it("accepts legacy schema 3.3 records without temporal fields", async () => {
    expect((await parseDueDiligenceV3(await schema33Record(), proposalKey))?.assessmentContext).toBeUndefined();
  });

  it("rejects malformed temporal metadata and retrospective current-state claim upgrades", async () => {
    const malformed = await temporalSchema33Record();
    malformed.evidence[1].temporal.blockHash = "0xdead";
    await expect(parseDueDiligenceV3(malformed, proposalKey)).rejects.toThrow("temporal block anchor");

    const upgraded = await temporalSchema33Record("current_state_observed");
    Object.assign(upgraded.materialClaims[0], { status: "supported", verificationMethod: "ethereum_mainnet_dual_rpc_safe_config_comparison_v1" });
    await expect(parseDueDiligenceV3(upgraded, proposalKey)).rejects.toThrow("lacks historical anchor");
  });
  it("accepts the immutable schema 3.3 report and its relationship graph", async () => {
    const parsed = await parseDueDiligenceV3(await schema33Record(), proposalKey);
    expect(parsed?.assessmentSchemaVersion).toBe("3.3");
    expect(parsed?.assessmentRunId).toBe("run-safe-p1-1");
    expect(parsed?.findings[0].safeguardGapIds).toEqual(["sg1"]);
  });

  it("accepts schema 3.4 Decision IR records without reinterpreting schema 3.3", async () => {
    const parsed = await parseDueDiligenceV3(await schema34Record(), proposalKey);
    expect(parsed?.assessmentSchemaVersion).toBe("3.4");
    expect(parsed?.decisionIR?.actions[0].function).toBe("claimFees");
    expect(parsed?.decisionIR?.grounding?.actions[0].retained).toBe(true);
  });

  it("rejects a schema 3.4 record without a grounded Decision IR", async () => {
    const missing = await schema34Record();
    delete missing.decisionIR;
    await expect(parseDueDiligenceV3(missing, proposalKey)).rejects.toThrow("Decision IR");
  });

  it("rejects an evidence-plan adapter paired with the wrong bounded source", async () => {
    const record = await schema34Record();
    record.evidencePlan.items[0].source = "snapshot";
    await expect(parseDueDiligenceV3(record, proposalKey)).rejects.toThrow("Invalid v3 evidence plan item");
  });

  it("rejects dangling schema 3.3 relationship IDs", async () => {
    const value = await schema33Record();
    value.findings[0].safeguardGapIds = ["sg404"];
    await expect(parseDueDiligenceV3(value, proposalKey)).rejects.toThrow("Unknown v3 safeguard gap");
  });

  it("rejects unverified partial support, duplicate actions, and dangling graph edges", async () => {
    const partial = await schema33Record();
    Object.assign(partial.materialClaims[0], { status: "partially_supported", evidence: ["proposal"],
      evidenceAuthority: ["primary"], verificationMethod: "" });
    await expect(parseDueDiligenceV3(partial, proposalKey)).rejects.toThrow("partially supported claim lacks external evidence");

    const duplicate = await schema33Record();
    duplicate.materialActions.push({ ...duplicate.materialActions[0] });
    await expect(parseDueDiligenceV3(duplicate, proposalKey)).rejects.toThrow("Duplicate v3 action ID");

    const danglingStep = await schema33Record();
    danglingStep.executionMap[0].relatedActionIds = ["a404"];
    await expect(parseDueDiligenceV3(danglingStep, proposalKey)).rejects.toThrow("Unknown v3 execution action");

    const danglingQuestion = await schema33Record();
    danglingQuestion.unresolvedQuestions[0].relatedExecutionStepIds = ["s404"];
    await expect(parseDueDiligenceV3(danglingQuestion, proposalKey)).rejects.toThrow("Unknown v3 question execution step");
  });

  it.each([1, 5])("accepts %i bounded transaction evidence records in schema 3.3", async (count) => {
    const parsed = await parseDueDiligenceV3(await schema33ReturnedFundsRecord(count), proposalKey);
    expect(parsed?.evidence.filter((item) => item.type === "onchain")).toHaveLength(count);
  });
  it("accepts schema 3.2 only when both fixed RPC providers agree at one pinned block", async () => {
    const parsed = await parseDueDiligenceV3(await dualRpcRecord(), proposalKey);
    expect(parsed?.assessmentSchemaVersion).toBe("3.2");
    expect(parsed?.evidence.filter((item) => item.type === "safe_onchain")).toHaveLength(2);
    expect(parsed?.materialClaims[0].verificationMethod).toBe("ethereum_mainnet_dual_rpc_safe_config_comparison_v1");
  });

  it("validates allowlisted external lookup failure codes without accepting raw diagnostics", async () => {
    const unavailable = await record();
    unavailable.assessmentSchemaVersion = "3.2";
    unavailable.returnedFundsState = "unavailable";
    unavailable.externalEvidenceState = "unavailable";
    unavailable.externalEvidenceFailureCode = "rpc_publicnode_http_503";
    unavailable.evidence = [unavailable.evidence[0]];
    unavailable.materialClaims[0] = { id: "c1", claim: "Safe configuration claim", sourceExcerpt: "Safe configuration claim",
      counterExcerpt: "", claimScope: "external_factual", status: "unverified", explanation: "RPC source unavailable.",
      evidence: ["proposal"], confidence: "low", verificationMethod: "" };
    await expect(parseDueDiligenceV3(unavailable, proposalKey)).resolves.toBeDefined();

    const raw = await record();
    raw.assessmentSchemaVersion = "3.2";
    raw.returnedFundsState = "unavailable";
    raw.externalEvidenceState = "unavailable";
    raw.externalEvidenceFailureCode = "https://attacker.example/private?token=secret";
    raw.evidence = [raw.evidence[0]];
    raw.materialClaims[0] = { id: "c1", claim: "Safe configuration claim", sourceExcerpt: "Safe configuration claim",
      counterExcerpt: "", claimScope: "external_factual", status: "unverified", explanation: "RPC source unavailable.",
      evidence: ["proposal"], confidence: "low", verificationMethod: "" };
    await expect(parseDueDiligenceV3(raw, proposalKey)).rejects.toThrow("Invalid v3 external evidence failure code");
  });

  it("rejects partial, mismatched, wrongly attributed, or forged dual-RPC evidence", async () => {
    const partial = await dualRpcRecord();
    partial.evidence = partial.evidence.filter((item) => item.id !== "safe-rpc-drpc");
    await expect(parseDueDiligenceV3(partial, proposalKey)).rejects.toThrow("Incomplete or version-incompatible");

    const disagreement = await dualRpcRecord();
    const drpc = disagreement.evidence.find((item) => item.id === "safe-rpc-drpc")!;
    (drpc.structuredData as Record<string, unknown>).blockHash = "0x" + "e".repeat(64);
    drpc.contentHash = await sha256(contractCanonicalJson(drpc.structuredData));
    await expect(parseDueDiligenceV3(disagreement, proposalKey)).rejects.toThrow("providers disagree");

    const providerForgery = await dualRpcRecord();
    const publicnode = providerForgery.evidence.find((item) => item.id === "safe-rpc-publicnode")!;
    (publicnode.structuredData as Record<string, unknown>).provider = "drpc";
    publicnode.contentHash = await sha256(contractCanonicalJson(publicnode.structuredData));
    await expect(parseDueDiligenceV3(providerForgery, proposalKey)).rejects.toThrow("Malformed v3 on-chain Safe evidence");

    const claimForgery = await dualRpcRecord();
    claimForgery.materialClaims[0].evidence = ["proposal", "safe-rpc-publicnode"];
    await expect(parseDueDiligenceV3(claimForgery, proposalKey)).rejects.toThrow("lacks matching dual-RPC evidence");
  });

  it("accepts independently retrieved Safe evidence with a recomputed content hash", async () => {
    const parsed = await parseDueDiligenceV3(await record(), proposalKey);
    expect(parsed?.assessmentVersion).toBe("3");
    expect(parsed?.evidence[1].authority).toBe("secondary");
    expect(parsed?.materialClaims[0].status).toBe("supported");
  });

  it("accepts a v3.1 supported return-total claim only when all five bounded onchain records validate", async () => {
    const parsed = await parseDueDiligenceV3(await returnedFundsRecord(), proposalKey);
    expect(parsed?.assessmentSchemaVersion).toBe("3.1");
    expect(parsed?.returnedFundsState).toBe("retrieved");
    expect(parsed?.materialClaims.find((claim) => claim.verificationMethod === "blockscout_mainnet_transfer_amount_comparison")?.status).toBe("supported");
    expect(parsed?.evidence.filter((item) => item.type === "onchain")).toHaveLength(5);
  });

  it("rejects mismatched v3.1 transaction data, source locators and aggregate totals", async () => {
    const badAmount = await returnedFundsRecord();
    const tx = badAmount.evidence.find((item) => item.type === "onchain")!;
    const txData = tx.structuredData as Record<string, unknown>;
    txData.valueWei = "1";
    tx.contentHash = await sha256(contractCanonicalJson(txData));
    await expect(parseDueDiligenceV3(badAmount, proposalKey)).rejects.toThrow("does not match its source row precision");

    const badLocator = await returnedFundsRecord();
    badLocator.evidence.find((item) => item.type === "onchain")!.locator = "https://attacker.example/tx";
    await expect(parseDueDiligenceV3(badLocator, proposalKey)).rejects.toThrow("onchain evidence authority");

    const badTotal = await returnedFundsRecord();
    badTotal.materialClaims.find((claim) => claim.verificationMethod === "blockscout_mainnet_transfer_amount_comparison")!.claim =
      "The proposal reports 300 ETH returned to the DAO Safe in 5 transactions.";
    await expect(parseDueDiligenceV3(badTotal, proposalKey)).rejects.toThrow("proposal total");
  });

  it("rejects reused transaction hashes and non-mainnet evidence", async () => {
    const duplicate = await returnedFundsRecord();
    const first = duplicate.evidence.find((item) => item.id === "return-tx-1")!;
    const second = duplicate.evidence.find((item) => item.id === "return-tx-2")!;
    const firstData = first.structuredData as Record<string, unknown>;
    const secondData = second.structuredData as Record<string, unknown>;
    secondData.transactionHash = firstData.transactionHash;
    second.locator = first.locator;
    second.contentHash = await sha256(contractCanonicalJson(secondData));
    await expect(parseDueDiligenceV3(duplicate, proposalKey)).rejects.toThrow("unique ordered transactions");

    const wrongChain = await returnedFundsRecord();
    const evidence = wrongChain.evidence.find((item) => item.id === "return-tx-1")!;
    const structuredData = evidence.structuredData as Record<string, unknown>;
    structuredData.chainId = 10;
    evidence.contentHash = await sha256(contractCanonicalJson(structuredData));
    await expect(parseDueDiligenceV3(wrongChain, proposalKey)).rejects.toThrow("Malformed v3 onchain transaction data");
  });

  it("rejects Safe evidence whose authority, locator, or hash is forged", async () => {
    const badAuthority = await record();
    badAuthority.evidence[1].authority = "primary";
    await expect(parseDueDiligenceV3(badAuthority, proposalKey)).rejects.toThrow("Safe evidence authority");
    const badLocator = await record();
    badLocator.evidence[1].locator = "https://attacker.example/";
    await expect(parseDueDiligenceV3(badLocator, proposalKey)).rejects.toThrow("Safe evidence authority");
    const badHash = await record();
    badHash.evidence[1].contentHash = "c".repeat(64);
    await expect(parseDueDiligenceV3(badHash, proposalKey)).rejects.toThrow("Safe evidence hash mismatch");
  });

  it("requires a checksummed Safe locator that can be fetched from Safe Transaction Service", async () => {
    const value = await record();
    const checksumAddress = "0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f";
    const lowerAddress = checksumAddress.toLowerCase();
    const structured = { ...safeData, address: lowerAddress };
    value.evidence[1].locator = `https://api.safe.global/tx-service/eth/api/v1/safes/${checksumAddress}/`;
    value.evidence[1].structuredData = structured;
    value.evidence[1].contentHash = await sha256(contractCanonicalJson(structured));
    value.materialClaims[0].claim = `Ethereum mainnet Safe ${lowerAddress} has a 2/2 threshold`;
    value.materialClaims[0].sourceExcerpt = value.materialClaims[0].claim;
    await expect(parseDueDiligenceV3(value, proposalKey)).resolves.toBeDefined();

    value.evidence[1].locator = `https://api.safe.global/tx-service/eth/api/v1/safes/${lowerAddress}/`;
    await expect(parseDueDiligenceV3(value, proposalKey)).rejects.toThrow("Invalid v3 Safe evidence locator");
  });

  it("rejects verified claim statuses without the designated evidence and method", async () => {
    const value = await record();
    value.materialClaims[0].evidence = ["proposal"];
    await expect(parseDueDiligenceV3(value, proposalKey)).rejects.toThrow("lacks matching independently retrieved evidence");
  });

  it("rejects contradicted claims without counter-evidence", async () => {
    const value = await record();
    value.materialClaims[0].status = "contradicted";
    value.materialClaims[0].claim = `Ethereum mainnet Safe ${safeData.address} has a 3/3 threshold`;
    value.materialClaims[0].sourceExcerpt = value.materialClaims[0].claim;
    value.materialClaims[0].counterExcerpt = "";
    await expect(parseDueDiligenceV3(value, proposalKey)).rejects.toThrow("needs opposing evidence");
  });

  it("keeps v3 schema and priority validation bounded", async () => {
    const value = await record();
    value.safeguardGaps[0].state = "missing";
    await expect(parseDueDiligenceV3(value, proposalKey)).rejects.toThrow("Invalid v3 safeguard state");
    const wrongPriority = await record();
    wrongPriority.reviewPriority = "low";
    await expect(parseDueDiligenceV3(wrongPriority, proposalKey)).rejects.toThrow("Invalid v3 review priority");
  });

  it("accepts the contract's maximum 700-character purpose and rejects larger values", async () => {
    const atLimit = await record();
    atLimit.overview.purpose = "p".repeat(700);
    await expect(parseDueDiligenceV3(atLimit, proposalKey)).resolves.toBeDefined();

    const overLimit = await record();
    overLimit.overview.purpose = "p".repeat(701);
    await expect(parseDueDiligenceV3(overLimit, proposalKey)).rejects.toThrow("Invalid v3 purpose");
  });

  it("does not label medium-severity findings low priority just because no question was emitted", async () => {
    const value = await record();
    value.findings[0].severity = "medium";
    value.unresolvedQuestions = [];
    value.reviewPriority = "normal";
    value.reviewPriorityExplanation = "Normal review priority because a material finding was identified.";
    await expect(parseDueDiligenceV3(value, proposalKey)).resolves.toBeDefined();
  });

  it("accepts a no-action assessment when it exposes the extraction gap instead of fabricating an action", async () => {
    const value = await record();
    value.evidence = [value.evidence[0]];
    value.externalEvidenceState = "not_attempted";
    value.overview.requestedActions = [];
    value.materialClaims = [];
    value.findings = [];
    value.safeguardGaps = [];
    value.executionMap = [];
    value.unresolvedQuestions = [{ id: "q1", question: "What action is requested?",
      whyItMatters: "No action was established by the bounded extraction.", relatedFindingIds: [],
      evidenceGap: "Review original proposal." }];
    value.reviewPriority = "normal";
    value.reviewPriorityExplanation = "Normal review priority because the proposed action remains unresolved.";
    await expect(parseDueDiligenceV3(value, proposalKey)).resolves.toBeDefined();
  });
});
