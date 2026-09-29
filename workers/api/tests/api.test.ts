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
