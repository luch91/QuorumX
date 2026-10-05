import { parseSnapshotReference } from "../../src/cli/proposal_reference";

describe("parseSnapshotReference", () => {
  it.each([
    ["snapshot:velvet-solace.test:mirage", { kind: "snapshot", space: "velvet-solace.test", proposalId: "mirage" }],
    ["velvet-solace.test:mirage", { kind: "snapshot", space: "velvet-solace.test", proposalId: "mirage" }],
    ["https://snapshot.org/#/velvet-solace.test/proposal/mirage", { kind: "snapshot", space: "velvet-solace.test", proposalId: "mirage" }],
    ["https://snapshot.box/#/s:velvet-solace.test/proposal/mirage", { kind: "snapshot", space: "velvet-solace.test", proposalId: "mirage" }],
    ["mirage", { kind: "snapshot", space: "velvet-solace.test", proposalId: "mirage" }],
  ])("normalizes %s", (input, expected) => {
    expect(parseSnapshotReference(input, ["velvet-solace.test"])).toEqual(expected);
  });

  it.each([
    "snapshot:other.test:mirage",
    "https://evil.example/proposal/mirage",
    "https://snapshot.org/#/missing",
    "space:",
  ])("rejects unsupported or malformed reference %s", (input) => {
    expect(() => parseSnapshotReference(input, ["velvet-solace.test"])).toThrow(/proposal reference|configured Snapshot space/);
  });

  it("rejects a bare id when more than one Snapshot space is configured", () => {
    expect(() => parseSnapshotReference("mirage", ["velvet-solace.test", "other.test"]))
      .toThrow("ambiguous");
  });
});
