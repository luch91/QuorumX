const request = jest.fn();
const getTransaction = jest.fn();

jest.mock("genlayer-js", () => ({
  createAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  createClient: () => ({ request, getTransaction }),
}));
jest.mock("genlayer-js/chains", () => ({ studionet: {} }));
jest.mock("genlayer-js/types", () => ({ TransactionHashVariant: { LATEST_FINAL: "LATEST_FINAL" } }));

import { findSubmittedTransaction } from "../src/genlayer";

const idempotencyKey = "backfill:3.3:1:1644";
const calldata = Buffer.from(`assess ${idempotencyKey}`).toString("base64");
const oldHash = `0x${"1".repeat(64)}`;
const retryHash = `0x${"2".repeat(64)}`;
const settings = {
  contractAddress: "0x3333333333333333333333333333333333333333" as const,
  privateKey: `0x${"3".repeat(64)}` as const,
};

function entry(hash: string) {
  return { hash, from_address: "0x1111111111111111111111111111111111111111", data: { calldata } };
}

describe("GenLayer retry reconciliation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    request.mockResolvedValue([entry(oldHash), entry(retryHash)]);
  });

  it("recovers a viable retry while ignoring a definitively reverted predecessor", async () => {
    getTransaction
      .mockResolvedValueOnce({ statusName: "FINALIZED", consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] } })
      .mockResolvedValueOnce({ statusName: "PROPOSING" });

    await expect(findSubmittedTransaction(settings, idempotencyKey, settings.contractAddress)).resolves.toBe(retryHash);
  });

  it("keeps multiple viable attempts as an integrity error", async () => {
    getTransaction.mockResolvedValue({ statusName: "PROPOSING" });

    await expect(findSubmittedTransaction(settings, idempotencyKey, settings.contractAddress))
      .rejects.toThrow("Multiple viable GenLayer transactions");
  });

  it("does not treat an undetermined attempt as a retryable submission", async () => {
    request.mockResolvedValue([entry(oldHash)]);
    getTransaction.mockResolvedValue({ statusName: "UNDETERMINED" });

    await expect(findSubmittedTransaction(settings, idempotencyKey, settings.contractAddress)).resolves.toBeUndefined();
  });
});
