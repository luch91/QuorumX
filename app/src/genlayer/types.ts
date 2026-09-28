export type GenLayerTerminalState = "accepted" | "undetermined" | "reverted" | "timeout";

export interface GenLayerReceipt {
  statusName?: string;
  txExecutionResultName?: string;
  error?: string;
}

export interface GenLayerClientPort {
  writeContract(input: {
    address: `0x${string}`;
    functionName: string;
    args: unknown[];
    value: bigint;
  }): Promise<string>;
  waitForTransactionReceipt(input: { hash: string }): Promise<GenLayerReceipt>;
  readContract(input: {
    address: `0x${string}`;
    functionName: string;
    args: unknown[];
  }): Promise<unknown>;
}
