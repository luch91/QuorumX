import { loadGenLayerConfig, loadProposalSourceConfig } from "../app/src/config";
import { createGenLayerClient } from "../app/src/genlayer/client";
import { GenLayerGatewayImpl } from "../app/src/genlayer/gateway";
import { SnapshotProposalSource } from "../app/src/ingest/sources/snapshot_source";

export function assertReadableProbe(probeKey: string | undefined, assessment: unknown): void {
  if (probeKey && assessment === undefined) {
    throw new Error(`Studionet probe did not return stored state for ${probeKey}`);
  }
}

export function assertV33Schema(raw: unknown): void {
  const schema = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>;
  if (schema?.assessmentVersion !== "3" || schema?.assessmentSchemaVersion !== "3.3"
      || schema?.consensusMethod !== "independent_structured_derivation_v3_3") {
    throw new Error("Studionet v3.3 contract schema mismatch");
  }
}

export async function validateQuorumX(env: NodeJS.ProcessEnv = process.env): Promise<object> {
  const sources = loadProposalSourceConfig(env);
  const proposals = await new SnapshotProposalSource(sources.snapshotSpaces).listEligible();
  const config = loadGenLayerConfig(env);
  const gateway = new GenLayerGatewayImpl(await createGenLayerClient(config), config.contractAddress);
  const probeKey = env.QUORUMX_PROBE_PROPOSAL_KEY;
  const assessment = probeKey ? await gateway.getAssessment(probeKey) : undefined;
  assertReadableProbe(probeKey, assessment);
  const v3Address = env.QUORUMX_DUE_DILIGENCE_V3_CONTRACT_ADDRESS;
  let v3SchemaReadable: boolean | "not_configured" = "not_configured";
  if (v3Address) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(v3Address)) throw new Error("QUORUMX_DUE_DILIGENCE_V3_CONTRACT_ADDRESS must be a 20-byte hex address.");
    const client = await createGenLayerClient(config);
    assertV33Schema(await client.readContract({ address: v3Address as `0x${string}`, functionName: "get_contract_schema", args: [] }));
    v3SchemaReadable = true;
  }
  return { ok: true, network: config.network, snapshotSpaces: sources.snapshotSpaces, eligibleProposals: proposals.length, contractReadable: probeKey ? assessment !== undefined : "not_probed", v3SchemaReadable, writesEnabled: process.argv.includes("--allow-write") };
}

if (require.main === module) {
  void validateQuorumX().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  });
}
