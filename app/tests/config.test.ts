import { loadGenLayerConfig, loadGenLayerReadConfig, STUDIONET_GOVERNANCE_RISK_ORACLE } from "../src/config";

describe("loadGenLayerConfig", () => {
  it("defaults read-only operation to the verified Studionet deployment", () => {
    expect(loadGenLayerConfig({})).toEqual({
      network: "studionet",
      contractAddress: STUDIONET_GOVERNANCE_RISK_ORACLE,
    });
  });

  it("requires an explicit contract for non-default networks", () => {
    expect(() => loadGenLayerConfig({ QUORUMX_GENLAYER_NETWORK: "localnet" })).toThrow("QUORUMX_CONTRACT_ADDRESS");
  });

  it("does not parse signing configuration for read-only client construction", () => {
    expect(loadGenLayerReadConfig({ QUORUMX_GENLAYER_PRIVATE_KEY: "malformed" })).toEqual({
      network: "studionet",
      contractAddress: STUDIONET_GOVERNANCE_RISK_ORACLE,
    });
  });
});
