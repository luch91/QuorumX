const { createHash } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { Client } = require("pg");

const runId = process.argv[process.argv.indexOf("--run-id") + 1];
const artifactRoot = path.resolve(process.env.QUORUMX_E2E_ARTIFACT_DIR || path.join(__dirname, "../.quorumx-e2e"));

(async () => {
  if (!/^[0-9]{8}t[0-9]{6}z-[a-z0-9]{6,16}$/.test(runId || "")) throw new Error("invalid run id");
  const state = JSON.parse(await readFile(path.join(artifactRoot, runId, "state.json"), "utf8"));
  const client = new Client({ connectionString: state.runtimeUrl });
  await client.connect();
  try {
    const result = await client.query(`
      select proposals.title, proposals.canonical_id, proposals.body_text,
        revisions.content_hash,
        coalesce((select count(*)::integer from quorumx.transactions transactions
          join quorumx.assessment_jobs jobs on jobs.id = transactions.job_id
          where jobs.revision_id = revisions.id), 0) as submission_count
      from quorumx.proposals proposals
      left join quorumx.proposal_revisions revisions on revisions.id = proposals.current_revision_id
      join quorumx.sources sources on sources.id = proposals.source_id
      where sources.configuration ->> 'runId' = $1
      order by proposals.title
    `, [runId]);
    const expected = ["Afterglow", "Eclipse", "Ember", "Halcyon", "Mirage", "Moonbeam", "Reverie", "Serendipity", "Wanderlust", "Whimsy"];
    if (result.rows.length !== 10 || result.rows.map((row) => row.title).join("|") !== expected.join("|")) {
      throw new Error(`fixture ledger is incomplete: ${result.rows.map((row) => row.title).join("|")}`);
    }
    const ledger = result.rows.map((row) => ({
      title: row.title, canonicalId: row.canonical_id,
      contentHash: row.content_hash || createHash("sha256").update(row.body_text).digest("hex"),
      submissionCount: row.submission_count,
    }));
    process.stdout.write(`${JSON.stringify({ runId, fixtures: ledger,
      ledgerSha256: createHash("sha256").update(JSON.stringify(ledger)).digest("hex") }, null, 2)}\n`);
  } finally { await client.end(); }
})().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
