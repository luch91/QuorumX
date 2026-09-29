export type TransactionState =
  | { state: "pending" }
  | { state: "accepted" }
  | { state: "undetermined" | "reverted"; error: string };

export function classifyTransaction(transaction: {
  status?: unknown;
  statusName?: unknown;
  consensus_data?: { leader_receipt?: Array<{ execution_result?: unknown }> };
}): TransactionState {
  const status = String(transaction.statusName ?? transaction.status ?? "").toUpperCase();
  const execution = String(transaction.consensus_data?.leader_receipt?.[0]?.execution_result ?? "").toUpperCase();
  if (execution.includes("ERROR") || status === "CANCELED") {
    return { state: "reverted", error: execution || status || "transaction reverted" };
  }
  if (["UNDETERMINED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"].includes(status)) {
    return { state: "undetermined", error: status };
  }
  if (["ACCEPTED", "FINALIZED"].includes(status)) return { state: "accepted" };
  return { state: "pending" };
}
