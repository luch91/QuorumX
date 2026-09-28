import { runQuorumXCli, type QuorumXCliDependencies } from "../../src/cli";

function dependencies(overrides: Partial<QuorumXCliDependencies> = {}): QuorumXCliDependencies {
  return {
    checkSources: jest.fn().mockResolvedValue([{ kind: "snapshot", outcome: "empty" }]),
    listProposals: jest.fn().mockResolvedValue([]),
    assess: jest.fn().mockResolvedValue({ attempts: [], transaction: { transactionId: "0xtx", proposalKey: "fixture:x", state: "accepted" } }),
    getAssessment: jest.fn().mockResolvedValue(undefined),
    runLegacy: jest.fn().mockResolvedValue(undefined),
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
  it("keeps legacy invocation explicit", async () => {
    const deps = dependencies(); await runQuorumXCli(["legacy", "telegraph"], deps, jest.fn()); expect(deps.runLegacy).toHaveBeenCalled();
  });
});
