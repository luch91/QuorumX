import { fetchRecentSnapshotProposals, normalizeSnapshotProposal } from "../src/snapshot";

describe("Snapshot ingestion", () => {
  it("normalizes identity, dates, status, choices, and unique evidence links", () => {
    const proposal = normalizeSnapshotProposal({
      id: "0xabc",
      title: "Upgrade",
      body: "Read https://example.com/a and https://example.com/a",
      choices: ["For", "Against"],
      created: 1_700_000_000,
      start: 1_700_000_100,
      end: 1_700_000_200,
      state: "active",
      author: "0x1111111111111111111111111111111111111111",
      space: { id: "Balancer.ETH" },
    }, new Date("2023-11-14T22:16:00.000Z"));
    expect(proposal.canonicalId).toBe("snapshot:balancer.eth:0xabc");
    expect(proposal.status).toBe("active");
    expect(proposal.choices).toEqual(["For", "Against"]);
    expect(proposal.linkedEvidenceUrls).toEqual(["https://example.com/a"]);
    expect(proposal.submittedAt).toBe("2023-11-14T22:13:20.000Z");
    expect(proposal.authorAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(proposal.canonicalUrl).toBe("https://snapshot.box/#/s:balancer.eth/proposal/0xabc");
    expect(proposal.assessmentEligible).toBe(true);
  });

  it("uses a bounded, parameterized query and normalizes its response", async () => {
    const fetcher = jest.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://hub.snapshot.org");
      expect(JSON.parse(url.searchParams.get("variables")!)).toEqual({ spaces: ["balancer.eth"], limit: 50 });
      return new Response(JSON.stringify({ data: { proposals: [{
        id: "proposal-1", title: "One", body: "Body", choices: [], state: "closed",
        author: "0x2222222222222222222222222222222222222222", space: { id: "balancer.eth" },
      }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const proposals = await fetchRecentSnapshotProposals("balancer.eth", fetcher, 500);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].externalId).toBe("proposal-1");
  });

  it("rejects GraphQL failures", async () => {
    const fetcher = jest.fn(async () => new Response(
      JSON.stringify({ errors: [{ message: "bad query" }] }),
      { status: 200 },
    )) as typeof fetch;
    await expect(fetchRecentSnapshotProposals("balancer.eth", fetcher)).rejects.toThrow("bad query");
  });
});
