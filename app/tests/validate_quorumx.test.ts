import { assertReadableProbe } from "../../scripts/validate_quorumx";

describe("QuorumX live validation probe", () => {
  it("fails when a requested contract record is missing", () => {
    expect(() => assertReadableProbe("snapshot:balancer.eth:proposal", undefined)).toThrow(
      "Studionet probe did not return stored state",
    );
  });

  it("accepts readable stored state and permits an omitted probe", () => {
    expect(() => assertReadableProbe("snapshot:balancer.eth:proposal", { riskLevel: "high" })).not.toThrow();
    expect(() => assertReadableProbe(undefined, undefined)).not.toThrow();
  });
});
