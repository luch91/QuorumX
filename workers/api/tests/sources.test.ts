import { snapshotSourceDefinitions, snapshotSourceForSpace } from "../src/sources";

describe("Snapshot source registry", () => {
  it("contains the four approved DAO sources with bounded budgets", () => {
    expect(snapshotSourceDefinitions.map((source) => source.space)).toEqual([
      "balancer.eth",
      "safe.eth",
      "arbitrumfoundation.eth",
      "ens.eth",
    ]);
    expect(snapshotSourceForSpace(" SAFE.ETH ").dailyAssessmentBudget).toBe(1);
  });

  it("rejects unregistered spaces", () => {
    expect(() => snapshotSourceForSpace("attacker.eth")).toThrow("not registered");
  });
});
