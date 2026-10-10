import { getDueDiligenceV3, getProposal, listProposals, listSources } from "../src/api";

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
      null,
      "newest",
      null,
      21,
    ]);
  });

  it.each([
    ["author=nope", "invalid_author"],
    ["assessment=unknown", "invalid_assessment"],
    ["ecosystem=%2A", "invalid_ecosystem"],
    ["dao=%2A", "invalid_dao"],
    ["cursor=broken", "invalid_cursor"],
    ["sort=random", "invalid_sort"],
  ])("rejects invalid filter %s", async (query, error) => {
    await expect(listProposals({} as never, new URL(`https://api.quorumx.dev/v1/proposals?${query}`)))
      .rejects.toThrow(error);
  });

  it.each(["unassessed", "pending", "retryable", "failed", "dead_letter"])(
    "preserves the legacy assessment=%s filter",
    async (assessment) => {
      const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(listProposals(client as never,
        new URL(`https://api.quorumx.dev/v1/proposals?assessment=${assessment}`))).resolves.toBeDefined();
      expect(client.query.mock.calls[0][1][6]).toBe(assessment);
    },
  );

  it("binds full-dataset search and global priority ordering", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const result = await listProposals(client as never,
      new URL("https://api.quorumx.dev/v1/proposals?q=Serendipity&sort=priority&limit=2"));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("latest_transaction.transaction_hash"),
      [null, null, null, null, null, null, null, null, "serendipity", "priority", null, 3]);
    expect(result).toMatchObject({ page: { scope: "all_matching_proposals" } });
  });

  it("issues opaque filter-bound cursors and rejects reuse under another filter", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [
      { id: "9", canonicalId: "Serendipity", priorityRank: 4 },
      { id: "8", canonicalId: "Moonbeam", priorityRank: 4 },
    ] }) };
    const first = await listProposals(client as never,
      new URL("https://api.quorumx.dev/v1/proposals?status=active&sort=priority&limit=1")) as { page: { nextCursor: string } };
    expect(first.page.nextCursor).not.toMatch(/^\d+$/);
    await expect(listProposals({} as never, new URL(
      `https://api.quorumx.dev/v1/proposals?status=closed&sort=priority&limit=1&cursor=${first.page.nextCursor}`,
    ))).rejects.toThrow("invalid_cursor");
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

describe("proposal revision intelligence API", () => {
  it("returns immutable claim lineage from revision observations without a new schema", async () => {
    const current = { id: "9", currentRevisionPayload: { bodyText: "Monthly active users reached 200k." }, previousRevisionPayload: { bodyText: "The protocol has 120,000 monthly active users." } };
    const history = [
      { id: "1", observedAt: "2026-01-01T00:00:00Z", payload: current.previousRevisionPayload, assessment: { materialClaims: [{ claim: "The protocol has 120,000 monthly active users.", claimScope: "external_factual", status: "unverified", evidence: ["proposal"] }] } },
      { id: "2", observedAt: "2026-01-02T00:00:00Z", payload: current.currentRevisionPayload, assessment: { materialClaims: [{ claim: "Monthly active users reached 200k.", claimScope: "external_factual", status: "supported", evidence: ["proposal", "safe"] }] } },
    ];
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [current] }).mockResolvedValueOnce({ rows: history }) };
    const result = await getProposal(client as never, "snapshot:safe.eth:p1") as { revisionIntelligence: Array<{ changes: Array<{ kind: string }> }> };
    expect(client.query.mock.calls[1][0]).toContain("proposal_revision_observations");
    expect(client.query.mock.calls[1][1]).toEqual(["9"]);
    expect(result.revisionIntelligence[0].changes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "claim_status" })]));
  });
});
