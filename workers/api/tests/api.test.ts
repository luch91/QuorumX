import { getDueDiligenceV3, listProposals, listSources } from "../src/api";

describe("source coverage API", () => {
  it("exposes fixed-point scan progress and durable assessment backlog", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listSources(client as never);
    const sql = client.query.mock.calls[0][0];
    expect(sql).toContain("coverageState");
    expect(sql).toContain("scanGeneration");
    expect(sql).toContain("backlogCount");
    expect(sql).toContain("oldestBacklogAt");
  });
});

describe("proposal API filters", () => {
  it("normalizes and binds DAO, author, assessment, and ecosystem filters", async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    await listProposals(client as never, new URL(
      "https://api.quorumx.dev/v1/proposals?source=SNAPSHOT%3ASAFE.ETH"
      + "&dao=SafeDAO&author=0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&assessment=finalized&ecosystem=ethereum",
    ));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("sources.ecosystems ? $8"), [
      null,
      null,
      null,
      "snapshot:safe.eth",
      "safedao",
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "finalized",
      "ethereum",
      21,
    ]);
  });

  it.each([
    ["author=nope", "invalid_author"],
    ["assessment=unknown", "invalid_assessment"],
    ["ecosystem=%2A", "invalid_ecosystem"],
    ["dao=%2A", "invalid_dao"],
  ])("rejects invalid filter %s", async (query, error) => {
    await expect(listProposals({} as never, new URL(`https://api.quorumx.dev/v1/proposals?${query}`)))
      .rejects.toThrow(error);
  });
});

describe("versioned due diligence reads", () => {
  it("defaults to the newest schema and binds an explicit historical selector", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await getDueDiligenceV3(client as never, "snapshot:safe.eth:p1", "3.2");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("assessment_schema_version desc"),
      ["snapshot:safe.eth:p1", "3.2"]);
    await expect(getDueDiligenceV3(client as never, "snapshot:safe.eth:p1", "latest"))
      .rejects.toThrow("invalid_assessment_schema");
  });
});
