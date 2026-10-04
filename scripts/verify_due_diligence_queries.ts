import { getDueDiligence, getProposal, listProposals } from "../workers/api/src/api";
import { withDatabase } from "../workers/api/src/database";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const result = await withDatabase(databaseUrl, async (client) => {
    const listed = await listProposals(client, new URL("https://api.quorumx.dev/v1/proposals?limit=1")) as {
      data: Array<{ canonicalId: string; assessmentVersion: string | null }>;
    };
    if (!listed.data.length) throw new Error("No indexed proposal available for query verification");
    const proposal = await getProposal(client, listed.data[0].canonicalId) as {
      canonicalId: string; changesSincePreviousRevision: unknown[];
    } | undefined;
    if (!proposal || proposal.canonicalId !== listed.data[0].canonicalId
      || !Array.isArray(proposal.changesSincePreviousRevision)) {
      throw new Error("Proposal detail or revision diff query failed");
    }
    const dueDiligence = await getDueDiligence(client, proposal.canonicalId);
    if (process.argv.includes("--fixture")) {
      await client.query("begin");
      try {
        const legacy = await client.query<{ canonical_id: string; transaction_hash: string }>(`
          select proposals.canonical_id, transactions.transaction_hash
          from quorumx.proposals proposals
          join lateral (
            select id from quorumx.proposal_revisions
            where proposal_id = proposals.id order by fetched_at desc, id desc limit 1
          ) revisions on true
          join quorumx.assessments assessments on assessments.revision_id = revisions.id
          join quorumx.transactions transactions on transactions.id = assessments.transaction_id
          limit 1
        `);
        const legacyRow = legacy.rows[0];
        if (!legacyRow) throw new Error("No current-revision v1 assessment available for provenance verification");
        const revision = await client.query<{ id: string; content_hash: string }>(`
          select revisions.id::text, revisions.normalized_payload ->> 'assessmentContentHash' as content_hash
          from quorumx.proposals proposals
          join lateral (
            select id, normalized_payload from quorumx.proposal_revisions
            where proposal_id = proposals.id order by fetched_at desc, id desc limit 1
          ) revisions on true
          where proposals.canonical_id = $1
        `, [legacyRow.canonical_id]);
        const row = revision.rows[0];
        if (!row?.content_hash) throw new Error("No matching source revision");
        const job = await client.query<{ id: string }>(`
          insert into quorumx.assessment_jobs (revision_id, assessment_version, status)
          values ($1, '2', 'finalized') on conflict (revision_id, assessment_version) do nothing returning id::text
        `, [row.id]);
        if (!job.rows[0]) throw new Error("A v2 job already exists for the test revision");
        const transactionHash = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
        const transaction = await client.query<{ id: string }>(`
          insert into quorumx.transactions (job_id, network, contract_address, transaction_hash, state)
          values ($1, 'studionet', 'fixture-only', $2, 'accepted') returning id::text
        `, [job.rows[0].id, transactionHash]);
        const duringReassessment = await getProposal(client, legacyRow.canonical_id) as {
          assessmentVersion: string; transactionHash: string;
        } | undefined;
        if (duringReassessment?.assessmentVersion !== "1"
          || duringReassessment.transactionHash !== legacyRow.transaction_hash) {
          throw new Error("Pending v2 job hid legacy transaction provenance");
        }
        const fixture = {
          assessmentVersion: "2", proposalKey: legacyRow.canonical_id, contentHash: row.content_hash,
          sourceLocatorHash: "a".repeat(64),
          overview: { purpose: "Integration fixture only", requestedActions: ["Review source"],
            assetsAffected: [], permissionsChanged: [], controlChanges: [] },
          evidence: [], materialClaims: [], findings: [], executionMap: [], unresolvedQuestions: [],
          reviewPriority: "low", reviewPriorityExplanation: "No material issue identified in fixture.",
          assessedAt: new Date().toISOString(), provenance: "fixture",
          consensus: { state: "accepted", method: "source_grounded_material_facts_v2" },
        };
        await client.query(`
          insert into quorumx.due_diligence_assessments (
            revision_id, transaction_id, proposal_key, source_locator_hash, content_hash,
            record, provenance, assessed_at
          ) values ($1, $2, $3, $4, $5, $6::jsonb, 'fixture', now())
        `, [row.id, transaction.rows[0].id, legacyRow.canonical_id, fixture.sourceLocatorHash,
          fixture.contentHash, JSON.stringify(fixture)]);
        const v2Proposal = await getProposal(client, legacyRow.canonical_id) as {
          assessmentVersion: string; dueDiligence?: { provenance: string };
        } | undefined;
        const v2Assessment = await getDueDiligence(client, legacyRow.canonical_id) as {
          assessmentVersion: string; provenance: string;
        } | undefined;
        if (v2Proposal?.assessmentVersion !== "2" || v2Proposal.dueDiligence?.provenance !== "fixture"
          || v2Assessment?.assessmentVersion !== "2" || v2Assessment.provenance !== "fixture") {
          throw new Error("V2 SQL did not expose versioned fixture data");
        }
      } finally {
        await client.query("rollback");
      }
      return { proposalFound: true, revisionDiffAvailable: true, v2FixtureRoundTrip: true };
    }
    return { proposalFound: true, revisionDiffAvailable: true, v2RecordPresent: Boolean(dueDiligence) };
  });
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
