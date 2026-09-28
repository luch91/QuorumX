import type { GenLayerClientPort } from "./types";

export interface GenLayerClientConfig {
  network: "localnet" | "studionet" | "testnetAsimov" | "testnetBradbury";
  rpcUrl?: string;
  privateKey?: `0x${string}`;
}

export async function createGenLayerClient(config: GenLayerClientConfig): Promise<GenLayerClientPort> {
  const [{ createAccount, createClient }, chainModule] = await Promise.all([
    import("genlayer-js"),
    import("genlayer-js/chains"),
  ]);
  const chains = {
    localnet: chainModule.localnet, studionet: chainModule.studionet,
    testnetAsimov: chainModule.testnetAsimov, testnetBradbury: chainModule.testnetBradbury,
  };
  const account = config.privateKey ? createAccount(config.privateKey) : undefined;
  return createClient({ chain: chains[config.network], endpoint: config.rpcUrl, account }) as unknown as GenLayerClientPort;
}
