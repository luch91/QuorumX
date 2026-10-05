import { listProposals } from "../src/api";

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
