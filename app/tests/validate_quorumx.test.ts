import { assertReadableProbe, assertV33Schema } from "../../scripts/validate_quorumx";

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

describe("v3.3 Studionet schema probe", () => {
  it("accepts only the exact deployed schema identity", () => {
    expect(() => assertV33Schema(JSON.stringify({ assessmentVersion: "3", assessmentSchemaVersion: "3.3", consensusMethod: "independent_structured_derivation_v3_3" }))).not.toThrow();
    expect(() => assertV33Schema(JSON.stringify({ assessmentVersion: "3", assessmentSchemaVersion: "3.2", consensusMethod: "independent_structured_derivation_v3" }))).toThrow("schema mismatch");
  });
});
