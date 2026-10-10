jest.mock("../src/database", () => ({
  createBackfillDryRun: jest.fn(async (_client, candidates) => {
    (globalThis as { capturedCandidates?: unknown }).capturedCandidates = candidates;
    return "17";
  }),
  ingestSnapshotProposals: jest.fn(async () => ({ proposalsUpserted: 1, revisionsCreated: 1, jobsCreated: 0 })),
}));

jest.mock("../src/snapshot", () => ({
  fetchClosedSnapshotBackfill: jest.fn(async (space: string) => [{
    canonicalId: `snapshot:${space}:closed-1`, externalId: "closed-1",
    source: { kind: "snapshot", space, proposalId: "closed-1" },
    title: "Closed", bodyText: "Body", choices: [], linkedEvidenceUrls: [],
    status: "closed", assessmentEligible: false,
  }]),
}));

import { createBackfillDryRun, ingestSnapshotProposals } from "../src/database";
import { BACKFILL_DAOS, prepareBackfillDryRun } from "../src/backfill";
import { fetchClosedSnapshotBackfill } from "../src/snapshot";

describe("backfill dry-run orchestration", () => {
  beforeEach(() => jest.clearAllMocks());

  it("indexes the bounded closed set for all four DAOs before persisting the exact plan", async () => {
    const runId = await prepareBackfillDryRun({} as never, { totalLimit: 4 }, jest.fn() as never,
      new Date("2026-10-09T00:00:00Z"));
    expect(runId).toBe("17");
    expect(fetchClosedSnapshotBackfill).toHaveBeenCalledTimes(4);
    expect(ingestSnapshotProposals).toHaveBeenCalledTimes(4);
    expect(createBackfillDryRun).toHaveBeenCalledTimes(1);
    expect((globalThis as { capturedCandidates?: unknown }).capturedCandidates).toEqual([
      { dao: "SafeDAO", canonicalId: "snapshot:safe.eth:closed-1" },
      { dao: "Arbitrum DAO", canonicalId: "snapshot:arbitrumfoundation.eth:closed-1" },
      { dao: "ENS DAO", canonicalId: "snapshot:ens.eth:closed-1" },
      { dao: "Balancer", canonicalId: "snapshot:balancer.eth:closed-1" },
    ]);
    expect(BACKFILL_DAOS).toHaveLength(4);
  });

  it("does not mutate the index when any bounded source fetch fails", async () => {
    jest.mocked(fetchClosedSnapshotBackfill).mockRejectedValueOnce(new Error("snapshot unavailable"));
    await expect(prepareBackfillDryRun({} as never, {}, jest.fn() as never,
      new Date("2026-10-09T00:00:00Z"))).rejects.toThrow("snapshot unavailable");
    expect(ingestSnapshotProposals).not.toHaveBeenCalled();
    expect(createBackfillDryRun).not.toHaveBeenCalled();
  });
});
