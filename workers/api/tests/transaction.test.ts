import { classifyTransaction } from "../src/transaction";

describe("GenLayer transaction classification", () => {
  it("does not confuse finalized consensus with successful contract execution", () => {
    expect(classifyTransaction({
      statusName: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] },
    })).toEqual({ state: "reverted", error: "ERROR" });
  });

  it("accepts a decided transaction with successful execution", () => {
    expect(classifyTransaction({
      statusName: "ACCEPTED",
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    })).toEqual({ state: "accepted" });
  });

  it("keeps incomplete consensus pending", () => {
    expect(classifyTransaction({ statusName: "PROPOSING" })).toEqual({ state: "pending" });
  });
});
