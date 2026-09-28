import { SnapshotProposalSource } from "../../src/ingest/sources/snapshot_source";

describe("SnapshotProposalSource", () => {
  it("queries configured spaces and normalizes active proposals", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          proposals: [{
            id: "p1", title: "Proposal", body: "Body", choices: ["For", "Against"],
            created: 1_700_000_000, start: 1_700_000_100, end: 1_700_100_000,
            state: "active", space: { id: "genlayer.eth" },
          }],
        },
      }),
    } as Response);

    const source = new SnapshotProposalSource(["balancer.eth", "genlayer.eth"], fetcher);
    const proposals = await source.listEligible();

    expect(proposals[0]).toEqual(expect.objectContaining({
      canonicalId: "snapshot:genlayer.eth:p1",
      choices: ["For", "Against"],
      status: "active",
    }));
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      body: expect.stringContaining("balancer.eth"),
    }));
  });

  it("gets an explicitly requested archived proposal", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { proposal: {
        id: "closed-1", title: "Closed", body: "Body", choices: [], created: 1,
        start: 1, end: 2, state: "closed", space: { id: "balancer.eth" },
      } } }),
    } as Response);
    const source = new SnapshotProposalSource(["balancer.eth"], fetcher);
    await expect(source.get({ kind: "snapshot", space: "balancer.eth", proposalId: "closed-1" }))
      .resolves.toEqual(expect.objectContaining({ status: "closed", canonicalId: "snapshot:balancer.eth:closed-1" }));
  });

  it("returns an empty active set", async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { proposals: [] } }) } as Response);
    await expect(new SnapshotProposalSource(["balancer.eth"], fetcher).listEligible()).resolves.toEqual([]);
  });

  it("reports GraphQL errors", async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ errors: [{ message: "bad query" }] }) } as Response);
    await expect(new SnapshotProposalSource(["balancer.eth"], fetcher).listEligible()).rejects.toThrow("bad query");
  });
});
