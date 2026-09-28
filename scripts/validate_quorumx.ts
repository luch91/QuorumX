import { loadGenLayerConfig, loadProposalSourceConfig } from "../app/src/config";
import { createGenLayerClient } from "../app/src/genlayer/client";
import { GenLayerGatewayImpl } from "../app/src/genlayer/gateway";
import { SnapshotProposalSource } from "../app/src/ingest/sources/snapshot_source";

export async function validateQuorumX(env: NodeJS.ProcessEnv = process.env): Promise<object> {
  const sources = loadProposalSourceConfig(env);
  const proposals = await new SnapshotProposalSource(sources.snapshotSpaces).listEligible();
  const config = loadGenLayerConfig(env);
  const gateway = new GenLayerGatewayImpl(await createGenLayerClient(config), config.contractAddress);
  const probeKey = env.QUORUMX_PROBE_PROPOSAL_KEY;
  const assessment = probeKey ? await gateway.getAssessment(probeKey) : undefined;
  return { ok: true, network: config.network, snapshotSpaces: sources.snapshotSpaces, eligibleProposals: proposals.length, contractReadable: probeKey ? assessment !== undefined : "not_probed", writesEnabled: process.argv.includes("--allow-write") };
}

if (require.main === module) {
  void validateQuorumX().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  });
}
