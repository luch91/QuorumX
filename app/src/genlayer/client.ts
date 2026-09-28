import type { GenLayerClientPort } from "./types";

export interface GenLayerClientConfig {
  network: "localnet" | "studionet" | "testnetAsimov" | "testnetBradbury";
  rpcUrl?: string;
  privateKey?: `0x${string}`;
}

export async function createGenLayerClient(config: GenLayerClientConfig): Promise<GenLayerClientPort> {
  const [{ createAccount, createClient }, chainModule, typeModule] = await Promise.all([
    import("genlayer-js"),
    import("genlayer-js/chains"),
    import("genlayer-js/types"),
  ]);
  const chains = {
    localnet: chainModule.localnet, studionet: chainModule.studionet,
    testnetAsimov: chainModule.testnetAsimov, testnetBradbury: chainModule.testnetBradbury,
  };
  const account = config.privateKey ? createAccount(config.privateKey) : undefined;
  const client = createClient({ chain: chains[config.network], endpoint: config.rpcUrl, account });
  return {
    writeContract: (input) => client.writeContract(input as never),
    readContract: (input) => client.readContract(input as never),
    waitForTransactionReceipt: async ({ hash }) => {
      const receipt = await client.waitForTransactionReceipt({
        hash: hash as never,
        status: typeModule.TransactionStatus.ACCEPTED,
      }) as unknown as Record<string, unknown>;
      return {
        statusName: String(receipt.statusName ?? receipt.status_name ?? ""),
        txExecutionResultName: String(receipt.txExecutionResultName ?? receipt.tx_execution_result_name ?? ""),
        ...(receipt.error ? { error: String(receipt.error) } : {}),
      };
    },
  };
}
