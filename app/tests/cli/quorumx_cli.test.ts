import { createDefaultCliDependencies, runQuorumXCli, type QuorumXCliDependencies } from "../../src/cli";
import type { GovernanceProposal } from "../../src/domain/governance_proposal";

function dependencies(overrides: Partial<QuorumXCliDependencies> = {}): QuorumXCliDependencies {
  return {
    checkSources: jest.fn().mockResolvedValue([{ kind: "snapshot", outcome: "empty" }]),
    listProposals: jest.fn().mockResolvedValue([]),
    assess: jest.fn().mockResolvedValue({ attempts: [], transaction: { transactionId: "0xtx", proposalKey: "fixture:x", state: "accepted" } }),
    getAssessment: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("QuorumX CLI", () => {
  it("shows QuorumX commands", async () => {
    const output: string[] = [];
    const code = await runQuorumXCli(["--help"], dependencies(), (line) => output.push(line));
    expect(code).toBe(0); expect(output.join("\n")).toContain("quorumx sources check"); expect(output.join("\n")).toContain("quorumx assess");
  });
  it("runs read-only commands without wallet configuration", async () => {
    const deps = dependencies(); await runQuorumXCli(["sources", "check", "--json"], deps, jest.fn());
    expect(deps.checkSources).toHaveBeenCalled(); expect(deps.assess).not.toHaveBeenCalled();
  });
  it("labels fixture output", async () => {
    const output: string[] = []; const deps = dependencies({ listProposals: jest.fn().mockResolvedValue([{ canonicalId: "fixture:x", source: { kind: "fixture", fixtureId: "x", canonicalUrl: "https://example.org" }, title: "Archived", bodyText: "", choices: [], linkedEvidenceUrls: [], status: "closed" }]) });
    await runQuorumXCli(["proposals", "list", "--json"], deps, (line) => output.push(line)); expect(output.join("\n")).toContain('"provenance": "fixture"');
  });
  it("returns a nonzero code for undetermined consensus", async () => {
    const deps = dependencies({ assess: jest.fn().mockResolvedValue({ attempts: [], transaction: { transactionId: "0x", proposalKey: "x", state: "undetermined" } }) });
    await expect(runQuorumXCli(["assess", "--source", "snapshot", "--proposal", "x"], deps, jest.fn())).resolves.toBe(3);
  });
  it("rejects unsupported assessment sources before invoking dependencies", async () => {
    const deps = dependencies(); const output: string[] = []; const errors: string[] = [];
    const code = await runQuorumXCli(
      ["assess", "--source", "public_url", "--proposal", "https://example.org", "--json"],
      deps,
      (line) => output.push(line),
      (line) => errors.push(line),
    );
    expect(code).toBe(4);
    expect(deps.assess).not.toHaveBeenCalled();
    expect(output).toEqual([]);
    expect(JSON.parse(errors.join("\n"))).toEqual({ error: "unsupported_source", source: "public_url" });
  });
});

describe("default QuorumX CLI wiring", () => {
  const mirage: GovernanceProposal = {
    canonicalId: "snapshot:velvet-solace.test:mirage",
    source: { kind: "snapshot", space: "velvet-solace.test", proposalId: "mirage" },
    title: "Mirage", bodyText: "Content A", choices: [], linkedEvidenceUrls: [], status: "active",
  };

  function create(overrides: object, privateKey?: string) {
    const factory = createDefaultCliDependencies as unknown as (env: NodeJS.ProcessEnv, overrides: object) => QuorumXCliDependencies;
    return factory({
      QUORUMX_SNAPSHOT_SPACES: "velvet-solace.test",
      QUORUMX_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
      ...(privateKey ? { QUORUMX_GENLAYER_PRIVATE_KEY: privateKey } : {}),
    }, overrides);
  }

  it("gets the requested proposal directly instead of scanning the first active page", async () => {
    const get = jest.fn().mockResolvedValue(mirage);
    const listEligible = jest.fn().mockRejectedValue(new Error("first-page scan must not run"));
    const runAssessment = jest.fn().mockResolvedValue({ attempts: [], transaction: { transactionId: "0xtx", proposalKey: mirage.canonicalId, state: "accepted" } });
    const deps = create({
      snapshot: { kind: "snapshot", get, listEligible },
      createGateway: jest.fn().mockResolvedValue({ submitAssessment: jest.fn(), getAssessment: jest.fn(), waitForAssessment: jest.fn() }),
      runAssessment,
    }, `0x${"1".repeat(64)}`);

    await deps.assess({ source: "snapshot", proposal: mirage.canonicalId });

    expect(get).toHaveBeenCalledWith(mirage.source);
    expect(listEligible).not.toHaveBeenCalled();
    expect(runAssessment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: expect.objectContaining({ findEligible: expect.any(Function) }),
    }));
  });

  it("rejects a write immediately before submission when no signing key is configured", async () => {
    const submitAssessment = jest.fn().mockResolvedValue("0xshould-not-submit");
    const runAssessment = jest.fn(async (_options, dependencies) => {
      await dependencies.gateway.submitAssessment(mirage.source, "key");
      return { attempts: [] };
    });
    const deps = create({
      snapshot: { kind: "snapshot", get: jest.fn().mockResolvedValue(mirage), listEligible: jest.fn() },
      createGateway: jest.fn().mockResolvedValue({ submitAssessment, getAssessment: jest.fn(), waitForAssessment: jest.fn() }),
      runAssessment,
    });

    await expect(deps.assess({ source: "snapshot", proposal: mirage.canonicalId }))
      .rejects.toThrow("QUORUMX_GENLAYER_PRIVATE_KEY is required");
    expect(submitAssessment).not.toHaveBeenCalled();
  });
});
