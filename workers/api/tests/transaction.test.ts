import { classifyTransaction } from "../src/transaction";

describe("GenLayer transaction classification", () => {
  it("does not confuse finalized consensus with successful contract execution", () => {
    expect(classifyTransaction({
      statusName: "FINALIZED",
      consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] },
    })).toEqual({ state: "reverted", error: "ERROR" });
  });

  it("waits for finality even after a successful accepted receipt", () => {
    expect(classifyTransaction({
      statusName: "ACCEPTED",
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    })).toEqual({ state: "pending" });
  });

  it("accepts only a finalized successful receipt", () => {
    expect(classifyTransaction({
      statusName: "FINALIZED",
      result_name: "MAJORITY_AGREE",
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    })).toEqual({ state: "accepted" });
  });

  it("rejects a finalized success receipt without agreeing consensus", () => {
    expect(classifyTransaction({
      statusName: "FINALIZED",
      result_name: "MAJORITY_DISAGREE",
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    })).toEqual({ state: "undetermined", error: "FINALIZED_WITHOUT_AGREEMENT" });
  });

  it("does not accept finalized consensus without a successful execution receipt", () => {
    expect(classifyTransaction({ statusName: "FINALIZED" })).toEqual({
      state: "undetermined", error: "FINALIZED_WITHOUT_SUCCESS_RECEIPT",
    });
  });

  it("keeps incomplete consensus pending", () => {
    expect(classifyTransaction({ statusName: "PROPOSING" })).toEqual({ state: "pending" });
  });
});
