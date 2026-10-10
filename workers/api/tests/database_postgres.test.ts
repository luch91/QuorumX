import { Client } from "pg";
import { claimAssessmentJob, createBackfillDryRun, getBackfillRun, ingestSnapshotProposals, startBackfillRun } from "../src/database";
import { snapshotSourceForSpace } from "../src/sources";
import type { SnapshotProposal } from "../src/domain";

// A full 125-proposal page sweep performs many real PostgreSQL round trips.
// Keep the integration deterministic on containerized/remote CI databases.
jest.setTimeout(30_000);

const databaseUrl = process.env.QUORUMX_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("PostgreSQL proposal coverage", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });
  afterAll(async () => client.end());

  it("persists 125 open proposals and jobs even with zero submission capacity", async () => {
    const source = { ...snapshotSourceForSpace("safe.eth"), dailyAssessmentBudget: 0 };
    await client.query("delete from quorumx.proposals where canonical_id like 'snapshot:safe.eth:coverage-%'");
    const proposals: SnapshotProposal[] = Array.from({ length: 125 }, (_, index) => ({
      externalId: `coverage-${index}`,
      canonicalId: `snapshot:safe.eth:coverage-${index}`,
      source: { kind: "snapshot", space: "safe.eth", proposalId: `coverage-${index}` },
      authorAddress: "0x1111111111111111111111111111111111111111",
      canonicalUrl: `https://snapshot.box/#/s:safe.eth/proposal/coverage-${index}`,
      title: `Coverage ${index}`,
      bodyText: `Proposal ${index}`,
      choices: ["For", "Against"],
      linkedEvidenceUrls: [],
      status: "active",
      submittedAt: "2026-10-01T00:00:00.000Z",
      votingEndsAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      assessmentEligible: true,
    }));
    let jobs = 0;
    for (const [pageIndex, page] of [proposals.slice(0, 50), proposals.slice(50, 100), proposals.slice(100)].entries()) {
      const result = await ingestSnapshotProposals(client, source, page, new Date("2026-10-07T00:00:00.000Z"), "3", "3.3",
        { skip: pageIndex * 50, first: 50, exhausted: page.length < 50, pageIds: page.map((proposal) => proposal.externalId) });
      jobs += result.jobsCreated;
    }
    expect(jobs).toBe(125);
    expect((await client.query("select count(*)::integer as count from quorumx.proposals where canonical_id like 'snapshot:safe.eth:coverage-%'")).rows[0].count).toBe(125);
    expect((await client.query(`select count(*)::integer as count from quorumx.assessment_jobs jobs
      join quorumx.proposal_revisions revisions on revisions.id = jobs.revision_id
      join quorumx.proposals proposals on proposals.id = revisions.proposal_id
      where jobs.assessment_schema_version = '3.3' and proposals.canonical_id like 'snapshot:safe.eth:coverage-%'`)).rows[0].count).toBe(125);
    expect(await claimAssessmentJob(client, "capacity-zero", "3", "3.3")).toBeUndefined();

    await client.query("update quorumx.sources set daily_assessment_budget = 1 where source_key = 'snapshot:safe.eth'");
    const first = await claimAssessmentJob(client, "fair-order", "3", "3.3");
    expect(first?.proposalKey).toBe("snapshot:safe.eth:coverage-0");
    expect(await claimAssessmentJob(client, "reserved-capacity", "3", "3.3")).toBeUndefined();

    await client.query(`update quorumx.assessment_jobs jobs set status = 'pending', locked_at = null, locked_by = null
      from quorumx.proposal_revisions revisions, quorumx.proposals proposals
      where revisions.id = jobs.revision_id and proposals.id = revisions.proposal_id
        and proposals.canonical_id like 'snapshot:safe.eth:coverage-%'`);
    const concurrentClient = new Client({ connectionString: databaseUrl });
    await concurrentClient.connect();
    try {
      const claims = await Promise.all([
        claimAssessmentJob(client, "concurrent-a", "3", "3.3"),
        claimAssessmentJob(concurrentClient, "concurrent-b", "3", "3.3"),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
    } finally {
      await concurrentClient.end();
    }

    await ingestSnapshotProposals(client, source, [{ ...proposals[100], status: "closed", assessmentEligible: false }],
      new Date("2026-10-07T00:06:00.000Z"), "3", "3.3");
    expect((await client.query("select status from quorumx.proposals where canonical_id = 'snapshot:safe.eth:coverage-100'")).rows[0].status)
      .toBe("closed");
  });

  it.each(["arbitrumfoundation.eth", "ens.eth"])("persists all 125 open %s proposals independently", async (space) => {
    const source = { ...snapshotSourceForSpace(space), dailyAssessmentBudget: 0 };
    await client.query("delete from quorumx.proposals where canonical_id like $1", [`snapshot:${space}:coverage-%`]);
    const proposals: SnapshotProposal[] = Array.from({ length: 125 }, (_, index) => ({
      externalId: `coverage-${index}`, canonicalId: `snapshot:${space}:coverage-${index}`,
      source: { kind: "snapshot", space, proposalId: `coverage-${index}` },
      authorAddress: "0x2222222222222222222222222222222222222222",
      canonicalUrl: `https://snapshot.box/#/s:${space}/proposal/coverage-${index}`,
      title: `Coverage ${index}`, bodyText: `Proposal ${index}`, choices: ["For", "Against"],
      linkedEvidenceUrls: [], status: "active", votingEndsAt: "2026-11-01T00:00:00.000Z", assessmentEligible: true,
    }));
    let jobs = 0;
    for (const [pageIndex, page] of [proposals.slice(0, 50), proposals.slice(50, 100), proposals.slice(100)].entries()) {
      const result = await ingestSnapshotProposals(client, source, page, new Date("2026-10-07T00:00:00.000Z"), "3", "3.3",
        { skip: pageIndex * 50, first: 50, exhausted: page.length < 50, pageIds: page.map((proposal) => proposal.externalId) });
      jobs += result.jobsCreated;
    }
    expect(jobs).toBe(125);
    expect((await client.query("select count(*)::integer as count from quorumx.proposals where canonical_id like $1",
      [`snapshot:${space}:coverage-%`])).rows[0].count).toBe(125);
    expect(await claimAssessmentJob(client, `capacity-zero-${space}`, "3", "3.3")).toBeUndefined();
  });

  it("persists one exact retrospective revision and starts it idempotently", async () => {
    await client.query("delete from quorumx.proposals where canonical_id like 'snapshot:safe.eth:coverage-%'");
    const canonicalId = `snapshot:safe.eth:backfill-${Date.now()}`;
    const externalId = canonicalId.split(":").at(-1)!;
    const source = snapshotSourceForSpace("safe.eth");
    await ingestSnapshotProposals(client, source, [{
      externalId, canonicalId, source: { kind: "snapshot", space: "safe.eth", proposalId: externalId },
      authorAddress: "0x3333333333333333333333333333333333333333",
      canonicalUrl: `https://snapshot.box/#/s:safe.eth/proposal/${externalId}`,
      title: "Backfill integration", bodyText: "Closed proposal", choices: ["For", "Against"],
      linkedEvidenceUrls: [], status: "closed", votingEndsAt: "2026-10-08T00:00:00.000Z",
      assessmentEligible: false,
    }], new Date("2026-10-09T00:00:00.000Z"), "3", "3.3");
    const runId = await createBackfillDryRun(client, [{ dao: "SafeDAO", canonicalId }],
      { perDaoLimit: 25, totalLimit: 100, windowDays: 90, dailySubmissionBudget: 4 });
    expect((await getBackfillRun(client, runId))?.candidates).toEqual([expect.objectContaining({
      dao: "SafeDAO", state: "eligible", canonicalId,
    })]);
    expect(await startBackfillRun(client, runId)).toBe(true);
    expect(await startBackfillRun(client, runId)).toBe(false);
    const jobs = await client.query(`select count(*)::integer as count from quorumx.assessment_jobs
      where backfill_run_id = $1 and assessment_schema_version = '3.3'`, [runId]);
    expect(jobs.rows[0].count).toBe(1);
    expect((await getBackfillRun(client, runId))?.candidates).toEqual([expect.objectContaining({
      dao: "SafeDAO", state: "queued", canonicalId,
    })]);

    const backfillJob = await client.query<{ id: string }>(
      "select id::text from quorumx.assessment_jobs where backfill_run_id = $1", [runId]);
    await client.query("update quorumx.assessment_jobs set status = 'finalized' where id = $1", [backfillJob.rows[0].id]);
    await client.query(`insert into quorumx.transactions
      (job_id, network, contract_address, transaction_hash, state, submitted_at)
      values ($1, 'test', $2, $3, 'accepted', now())`, [backfillJob.rows[0].id, `0x${"4".repeat(40)}`, `0x${Date.now().toString(16).padStart(64, "0")}`]);

    const liveCanonicalId = `${canonicalId}-live`;
    await ingestSnapshotProposals(client, source, [{
      externalId: `${externalId}-live`, canonicalId: liveCanonicalId,
      source: { kind: "snapshot", space: "safe.eth", proposalId: `${externalId}-live` },
      authorAddress: "0x3333333333333333333333333333333333333333",
      canonicalUrl: `https://snapshot.box/#/s:safe.eth/proposal/${externalId}-live`,
      title: "Live priority", bodyText: "Active proposal", choices: ["For", "Against"],
      linkedEvidenceUrls: [], status: "active", votingEndsAt: "2026-10-11T00:00:00.000Z",
      assessmentEligible: true,
    }], new Date("2026-10-09T00:00:00.000Z"), "3", "3.3");
    expect((await claimAssessmentJob(client, "live-after-backfill", "3", "3.3"))?.proposalKey).toBe(liveCanonicalId);

    await client.query("delete from quorumx.backfill_candidates where run_id = $1", [runId]);
    await client.query("delete from quorumx.assessment_jobs where backfill_run_id = $1", [runId]);
    await client.query("delete from quorumx.backfill_runs where id = $1", [runId]);
    await client.query("delete from quorumx.proposals where canonical_id = $1", [canonicalId]);
    await client.query("delete from quorumx.proposals where canonical_id = $1", [liveCanonicalId]);
  });
});
