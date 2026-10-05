import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { claimAssessmentJob, finalizeAssessment, ingestSnapshotProposals } from "../../../workers/api/src/database";

const enabled = process.env.QUORUMX_RUN_DOCKER_E2E === "true";
const suite = enabled ? describe : describe.skip;
const root = path.resolve(__dirname, "../../..");
const script = path.join(root, "scripts", "velvet_solace.cjs");
const runtimeScript = path.join(root, "scripts", "verify_velvet_solace_runtime.cjs");

suite("Velvet Solace real PostgreSQL lifecycle", () => {
  const artifactDir = mkdtempSync(path.join(os.tmpdir(), "quorumx-velvet-"));
  const runId = `20261005t120000z-${process.pid.toString(36).padStart(6, "0")}`;
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args, "--run-id", runId], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, QUORUMX_E2E_ARTIFACT_DIR: artifactDir },
  });

  afterAll(() => {
    run("teardown");
    rmSync(artifactDir, { recursive: true, force: true });
  });

  it("provisions, verifies, and idempotently tears down the migrated database", async () => {
    const provision = run("provision");
    expect(provision.status).toBe(0);
    const manifest = JSON.parse(provision.stdout);
    expect(manifest.services.database).toEqual(expect.objectContaining({ engine: "postgres:16-alpine" }));

    const verify = run("verify");
    expect(verify.status).toBe(0);
    expect(JSON.parse(verify.stdout)).toEqual(expect.objectContaining({
      organization: "Velvet Solace",
      sources: 1,
      proposals: 10,
      runtimeRole: "quorumx_runtime",
      deletePrivilege: false,
      schemaCreatePrivilege: false,
      acceptedUpdatePrivilege: false,
      migrationReadPrivilege: false,
      safeRoleAttributes: true,
      memberships: 0,
    }));

    const state = JSON.parse(require("node:fs").readFileSync(path.join(artifactDir, runId, "state.json"), "utf8"));
    const client = new Client({ connectionString: state.runtimeUrl });
    await client.connect();
    try {
    const source = {
      kind: "snapshot" as const, space: `revision-${runId}.test`, displayName: "Revision Test", homepageUrl: "https://example.invalid",
      logoUrl: "https://example.invalid/logo.png", ecosystems: ["test"], assessmentEnabled: false,
      dailyAssessmentBudget: 0,
    };
    const proposal = (bodyText: string) => ({
      externalId: "mirage", canonicalId: `snapshot:${source.space}:mirage`,
      source: { kind: "snapshot" as const, space: source.space, proposalId: "mirage" },
      authorAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      canonicalUrl: `https://snapshot.org/#/${source.space}/proposal/mirage`, title: "Mirage",
      bodyText, choices: ["For", "Against"], linkedEvidenceUrls: [], status: "active" as const,
      assessmentEligible: false,
    });
    await ingestSnapshotProposals(client, source, [proposal("Content A")], new Date("2026-10-05T12:00:00Z"));
    await ingestSnapshotProposals(client, source, [proposal("Content B")], new Date("2026-10-05T12:01:00Z"));
    await ingestSnapshotProposals(client, source, [proposal("Content A")], new Date("2026-10-05T12:02:00Z"));
    const current = await client.query<{ body_text: string; observed_at: Date; observation_id: string }>(`
      select revisions.normalized_payload ->> 'bodyText' as body_text,
        observations.observed_at, observations.id::text as observation_id
      from quorumx.proposals proposals
      join quorumx.proposal_revisions revisions on revisions.id = proposals.current_revision_id
      join quorumx.proposal_revision_observations observations on observations.id = proposals.current_observation_id
      where proposals.canonical_id = $1
    `, [`snapshot:${source.space}:mirage`]);
    const history = await client.query(`
      select
        (select count(*)::integer from quorumx.proposal_revisions revisions join quorumx.proposals proposals on proposals.id = revisions.proposal_id where proposals.canonical_id = $1) as revisions,
        (select count(*)::integer from quorumx.proposal_revision_observations observations join quorumx.proposals proposals on proposals.id = observations.proposal_id where proposals.canonical_id = $1) as observations
    `, [`snapshot:${source.space}:mirage`]);
    expect(current.rows[0].body_text).toBe("Content A");
    expect(current.rows[0].observed_at.toISOString()).toBe("2026-10-05T12:02:00.000Z");
    expect(current.rows[0].observation_id).toBeTruthy();
    expect(history.rows[0]).toEqual({ revisions: 2, observations: 3 });

    const revision = await client.query<{ id: string }>(`
      select current_revision_id::text as id from quorumx.proposals where canonical_id = $1
    `, [`snapshot:${source.space}:mirage`]);
    const job = await client.query<{ id: string }>(`
      insert into quorumx.assessment_jobs (revision_id, status, assessment_version)
      values ($1, 'processing', '1') returning id::text
    `, [revision.rows[0].id]);
    const transaction = await client.query<{ id: string }>(`
      insert into quorumx.transactions (job_id, network, contract_address, transaction_hash, state)
      values ($1, 'testnet', '0xcontract', $2, 'submitted') returning id::text
    `, [job.rows[0].id, `0x${runId}-assessment`]);
    const assessment = {
      proposalKey: `snapshot:${source.space}:mirage`,
      sourceLocatorHash: "1".repeat(64), contentHash: "2".repeat(64),
      riskLevel: "medium" as const, riskScore: 50, riskCategories: ["governance"],
      recommendation: "manual_review" as const, summary: "Original accepted result",
      assessedAt: "2026-10-05T12:03:00.000Z", provenance: "fixture" as const,
    };
    const finalizeInput = {
      jobId: job.rows[0].id, revisionId: revision.rows[0].id,
      transactionRowId: transaction.rows[0].id, assessment,
      indexedFrom: "submitted_transaction" as const,
    };
    const concurrentClient = new Client({ connectionString: state.runtimeUrl });
    await concurrentClient.connect();
    await Promise.all([
      finalizeAssessment(client, finalizeInput),
      finalizeAssessment(concurrentClient, finalizeInput),
    ]);
    await concurrentClient.end();
    await expect(finalizeAssessment(client, finalizeInput)).resolves.toBeUndefined();
    await expect(finalizeAssessment(client, {
      ...finalizeInput, assessment: { ...assessment, summary: "Mutated accepted result" },
    })).rejects.toThrow(/immutable|conflict/i);

    const otherRevision = await client.query<{ id: string }>(`
      select revisions.id::text
      from quorumx.proposal_revisions revisions
      join quorumx.proposals proposals on proposals.id = revisions.proposal_id
      where proposals.canonical_id = $1 and revisions.id <> $2
      limit 1
    `, [`snapshot:${source.space}:mirage`, revision.rows[0].id]);
    const otherJob = await client.query<{ id: string }>(`
      insert into quorumx.assessment_jobs (revision_id, status, assessment_version)
      values ($1, 'processing', '1') returning id::text
    `, [otherRevision.rows[0].id]);
    const otherTransaction = await client.query<{ id: string }>(`
      insert into quorumx.transactions (job_id, network, contract_address, transaction_hash, state)
      values ($1, 'testnet', '0xcontract', $2, 'submitted') returning id::text
    `, [otherJob.rows[0].id, `0x${runId}-other`]);
    await expect(client.query(`
      insert into quorumx.assessments (
        revision_id, transaction_id, proposal_key, source_locator_hash, content_hash,
        risk_level, risk_score, risk_categories, recommendation, summary,
        consensus_state, provenance, assessed_at, indexed_from
      ) values ($1, $2, $3, $4, $5, 'low', 1, '[]'::jsonb, 'allow', 'mismatch',
        'accepted', 'fixture', now(), 'submitted_transaction')
    `, [revision.rows[0].id, otherTransaction.rows[0].id, assessment.proposalKey,
      "3".repeat(64), "4".repeat(64)])).rejects.toThrow(/revision|transaction|job/i);
    const preserved = await client.query<{ summary: string }>(`
      select summary from quorumx.assessments where revision_id = $1
    `, [revision.rows[0].id]);
    expect(preserved.rows[0].summary).toBe("Original accepted result");

    const queueSource = { ...source, space: `queue-${runId}.test`, displayName: "Queue Test",
      assessmentEnabled: true, dailyAssessmentBudget: 20 };
    const queueProposal = (name: string, index: number) => ({
      ...proposal(`Queue ${name}`), externalId: name.toLowerCase(),
      canonicalId: `snapshot:${queueSource.space}:${name.toLowerCase()}`,
      source: { kind: "snapshot" as const, space: queueSource.space, proposalId: name.toLowerCase() },
      title: name, canonicalUrl: `https://snapshot.org/#/${queueSource.space}/proposal/${name.toLowerCase()}`,
      votingEndsAt: new Date(Date.UTC(2026, 9, 6 + index)).toISOString(),
    });
    await ingestSnapshotProposals(client, queueSource,
      ["Eclipse1", "Eclipse2", "Eclipse3", "Eclipse4", "Eclipse5", "Reverie"].map(queueProposal),
      new Date("2026-10-05T13:00:00Z"), "2");
    await client.query(`
      update quorumx.assessment_jobs jobs set attempt_count = 5
      from quorumx.proposal_revisions revisions join quorumx.proposals proposals on proposals.id = revisions.proposal_id
      where jobs.revision_id = revisions.id and proposals.canonical_id like $1
        and proposals.canonical_id not like '%:reverie'
    `, [`snapshot:${queueSource.space}:%`]);
    const claimedReverie = await claimAssessmentJob(client, "fair-worker", "2");
    expect(claimedReverie?.proposalKey).toBe(`snapshot:${queueSource.space}:reverie`);
    const lease = await client.query<{ locked_by: string; active: boolean }>(`
      select locked_by, lease_expires_at > now() as active from quorumx.assessment_jobs where id = $1
    `, [claimedReverie!.id]);
    expect(lease.rows[0]).toEqual({ locked_by: "fair-worker", active: true });
    await client.query(`update quorumx.assessment_jobs set lease_expires_at = now() - interval '1 second' where id = $1`, [claimedReverie!.id]);
    const reclaimed = await claimAssessmentJob(client, "recovery-worker", "2");
    expect(reclaimed?.id).toBe(claimedReverie?.id);
    const transitionCount = await client.query<{ count: number }>(`
      select count(*)::integer as count from quorumx.assessment_job_transitions where job_id = $1
    `, [claimedReverie!.id]);
    expect(transitionCount.rows[0].count).toBeGreaterThanOrEqual(1);
    await client.query(`update quorumx.assessment_jobs set status = 'dead_letter' where id = $1`, [claimedReverie!.id]);
    await expect(client.query(`update quorumx.assessment_jobs set status = 'pending' where id = $1`,
      [claimedReverie!.id])).rejects.toThrow(/illegal assessment job transition/i);

    const budgetSource = { ...queueSource, space: `budget-${runId}.test`, displayName: "Budget Test",
      dailyAssessmentBudget: 1 };
    const budgetClients = [new Client({ connectionString: state.runtimeUrl }), new Client({ connectionString: state.runtimeUrl })];
    await Promise.all(budgetClients.map((entry) => entry.connect()));
    try {
      await Promise.all([
        ingestSnapshotProposals(budgetClients[0], budgetSource, [{ ...queueProposal("MoonbeamA", 1),
          canonicalId: `snapshot:${budgetSource.space}:moonbeam-a`, externalId: "moonbeam-a",
          source: { kind: "snapshot" as const, space: budgetSource.space, proposalId: "moonbeam-a" } }],
        new Date("2026-10-05T14:00:00Z"), "2"),
        ingestSnapshotProposals(budgetClients[1], budgetSource, [{ ...queueProposal("MoonbeamB", 2),
          canonicalId: `snapshot:${budgetSource.space}:moonbeam-b`, externalId: "moonbeam-b",
          source: { kind: "snapshot" as const, space: budgetSource.space, proposalId: "moonbeam-b" } }], new Date("2026-10-05T14:00:00Z"), "2"),
      ]);
    } finally {
      await Promise.all(budgetClients.map((entry) => entry.end()));
    }
    const budgetJobs = await client.query<{ count: number }>(`
      select count(*)::integer as count from quorumx.assessment_jobs jobs
      join quorumx.proposal_revisions revisions on revisions.id = jobs.revision_id
      join quorumx.proposals proposals on proposals.id = revisions.proposal_id
      join quorumx.sources sources on sources.id = proposals.source_id
      where sources.source_key = $1
    `, [`snapshot:${budgetSource.space}`]);
    expect(budgetJobs.rows[0].count).toBe(1);
    } finally {
      await client.end().catch(() => undefined);
    }

    const runtime = spawnSync(process.execPath, [runtimeScript, "--run-id", runId], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, QUORUMX_E2E_ARTIFACT_DIR: artifactDir },
    });
    expect(runtime.status).toBe(0);
    expect(JSON.parse(runtime.stdout)).toEqual(expect.objectContaining({
      api: expect.objectContaining({ status: "online", sources: 1, proposals: 10 }),
      site: expect.objectContaining({ status: 200, containsVelvetSolace: true }),
      siteApiBase: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/),
      contract: expect.objectContaining({ mode: "python-normalization-fixture", fixtureSha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
      browser: {
        directRoute: true, javascriptDisabled: true, desktopScreenshot: true, mobileScreenshot: true,
      },
      securityHeaders: { frameAncestors: true, nosniff: true, permissions: true },
      publicAssets: { robots: true, llms: true, favicon: true },
      listenersClosed: true,
    }));

    expect(run("teardown").status).toBe(0);
    expect(run("teardown").status).toBe(0);
    const clean = run("verify-clean");
    expect(clean.status).toBe(0);
    expect(JSON.parse(clean.stdout)).toEqual({ runId, clean: true });
  }, 180_000);

  it.each(["container", "migration", "seed"])("cleans up after forced %s failure", (phase) => {
    const failedRunId = `20261005t120001z-${phase.padEnd(9, "x")}`;
    const failed = spawnSync(process.execPath, [script, "provision", "--run-id", failedRunId], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, QUORUMX_E2E_ARTIFACT_DIR: artifactDir, QUORUMX_E2E_FAIL_AFTER: phase },
    });
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain(`forced failure after ${phase}`);
    const clean = spawnSync(process.execPath, [script, "verify-clean", "--run-id", failedRunId], {
      cwd: root, encoding: "utf8", env: { ...process.env, QUORUMX_E2E_ARTIFACT_DIR: artifactDir },
    });
    expect(clean.status).toBe(0);
  }, 130_000);

  it("keeps two live Velvet Solace runs isolated", () => {
    const ids = ["20261005t120002z-parallela", "20261005t120002z-parallelb"];
    const execute = (id: string, command: string) => spawnSync(process.execPath, [script, command, "--run-id", id], {
      cwd: root, encoding: "utf8", timeout: 120_000,
      env: { ...process.env, QUORUMX_E2E_ARTIFACT_DIR: artifactDir },
    });
    try {
      expect(execute(ids[0], "provision").status).toBe(0);
      expect(execute(ids[1], "provision").status).toBe(0);
      const first = JSON.parse(execute(ids[0], "verify").stdout);
      const second = JSON.parse(execute(ids[1], "verify").stdout);
      expect(first.runId).toBe(ids[0]);
      expect(second.runId).toBe(ids[1]);
    } finally {
      for (const id of ids) execute(id, "teardown");
    }
    expect(execute(ids[0], "verify-clean").status).toBe(0);
    expect(execute(ids[1], "verify-clean").status).toBe(0);
  }, 130_000);
});
