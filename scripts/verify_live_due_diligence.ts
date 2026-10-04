import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { getDueDiligence, getProposal } from "../workers/api/src/api";
import { withDatabase } from "../workers/api/src/database";
import { parseDueDiligence } from "../workers/api/src/due_diligence";

async function main() {
  const [contractAddress, transactionHash, proposalKey] = process.argv.slice(2);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress ?? "")
    || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash ?? "")
    || !proposalKey?.startsWith("snapshot:")) {
    throw new Error("Usage: DATABASE_URL=<pooled dev URL> tsx scripts/verify_live_due_diligence.ts <contract> <transaction> <proposal-key>");
  }
  const genlayer = createClient({ chain: studionet, endpoint: "https://studio.genlayer.com/api" });
  const transaction = await genlayer.getTransaction({ hash: transactionHash as `0x${string}` });
  const leader = transaction.consensus_data?.leader_receipt?.[0];
  if (transaction.statusName !== "FINALIZED" || transaction.result_name !== "MAJORITY_AGREE"
    || leader?.execution_result !== "SUCCESS") {
    throw new Error("Live assessment transaction did not finalize successfully");
  }
  const raw = await genlayer.readContract({ address: contractAddress as `0x${string}`,
    functionName: "get_assessment", args: [proposalKey] });
  const assessment = parseDueDiligence(raw, proposalKey);
  if (!assessment || assessment.provenance !== "live") throw new Error("Missing live v2 assessment");

  const result = await withDatabase(databaseUrl, async (client) => {
    await client.query("begin");
    try {
      const revision = await client.query<{ id: string; content_hash: string }>(`
        select revisions.id::text, revisions.normalized_payload ->> 'assessmentContentHash' as content_hash
        from quorumx.proposals proposals
        join lateral (
          select id, normalized_payload from quorumx.proposal_revisions
          where proposal_id = proposals.id order by fetched_at desc, id desc limit 1
        ) revisions on true
        where proposals.canonical_id = $1
      `, [proposalKey]);
      const row = revision.rows[0];
      if (!row || row.content_hash !== assessment.contentHash) {
        throw new Error("Live source hash does not match the indexed latest revision");
      }
      const job = await client.query<{ id: string }>(`
        insert into quorumx.assessment_jobs (revision_id, assessment_version, status)
        values ($1, '2', 'finalized')
        on conflict (revision_id, assessment_version) do update
          set status = 'finalized', updated_at = now()
        returning id::text
      `, [row.id]);
      const tx = await client.query<{ id: string }>(`
        insert into quorumx.transactions (job_id, network, contract_address, transaction_hash, state)
        values ($1, 'studionet', $2, $3, 'accepted') returning id::text
      `, [job.rows[0].id, contractAddress, transactionHash]);
      await client.query(`
        insert into quorumx.due_diligence_assessments (
          revision_id, transaction_id, proposal_key, source_locator_hash, content_hash,
          record, provenance, assessed_at
        ) values ($1, $2, $3, $4, $5, $6::jsonb, 'live', $7::timestamptz)
      `, [row.id, tx.rows[0].id, proposalKey, assessment.sourceLocatorHash,
        assessment.contentHash, JSON.stringify(assessment), assessment.assessedAt]);
      const proposal = await getProposal(client, proposalKey) as {
        assessmentVersion?: string; dueDiligence?: { provenance: string };
      } | undefined;
      const publicAssessment = await getDueDiligence(client, proposalKey) as {
        assessmentVersion?: string; contentHash?: string; provenance?: string;
      } | undefined;
      if (proposal?.assessmentVersion !== "2" || proposal.dueDiligence?.provenance !== "live"
        || publicAssessment?.assessmentVersion !== "2"
        || publicAssessment.contentHash !== assessment.contentHash
        || publicAssessment.provenance !== "live") {
        throw new Error("API did not expose the live v2 assessment");
      }
      return { liveTransactionFinalized: true, sourceHashMatched: true, persistedAndReadBack: true,
        claims: assessment.materialClaims.length, findings: assessment.findings.length };
    } finally {
      await client.query("rollback");
    }
  });
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
