import { loadProposalSourceConfig } from "../../src/config";

describe("loadProposalSourceConfig", () => {
  it("uses Balancer first and disables fixtures by default", () => {
    expect(loadProposalSourceConfig({})).toEqual({ snapshotSpaces: ["balancer.eth"], allowFixtures: false });
  });

  it("parses ordered unique Snapshot spaces and explicit fixture enablement", () => {
    expect(loadProposalSourceConfig({
      QUORUMX_SNAPSHOT_SPACES: "balancer.eth, genlayer.eth,balancer.eth",
      QUORUMX_ALLOW_FIXTURES: "true",
    })).toEqual({ snapshotSpaces: ["balancer.eth", "genlayer.eth"], allowFixtures: true });
  });

  it("rejects invalid fixture booleans and empty space lists", () => {
    expect(() => loadProposalSourceConfig({ QUORUMX_ALLOW_FIXTURES: "yes" })).toThrow("QUORUMX_ALLOW_FIXTURES");
    expect(() => loadProposalSourceConfig({ QUORUMX_SNAPSHOT_SPACES: " , " })).toThrow("QUORUMX_SNAPSHOT_SPACES");
  });
});
