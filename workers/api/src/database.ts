import { Client } from "pg";
import { canonicalJson, contractCanonicalJson, sha256 } from "./canonical";
import type { SnapshotProposal, StoredAssessment, StoredDueDiligenceAssessment, StoredDueDiligenceV3Assessment } from "./domain";
import type { SnapshotSourceDefinition } from "./sources";

export interface IngestResult {
  proposalsSeen: number;
  revisionsCreated: number;
  jobsCreated: number;
}

export interface ClaimedJob {
  id: string;
  attemptCount: number;
  maxAttempts: number;
  revisionId: string;
  revisionHash: string;
  expectedContractContentHash: string;
  proposalKey: string;
  source: { kind: "snapshot"; space: string; proposalId: string };
  assessmentVersion?: "1" | "2" | "3";
  assessmentSchemaVersion?: string;
  assessmentRunId?: string;
}

export interface SubmittedJob {
  jobId: string;
  attemptCount: number;
  maxAttempts: number;
  revisionId: string;
  proposalKey: string;
  transactionId: string;
  transactionRowId: string;
  assessmentVersion?: "1" | "2" | "3";
  assessmentSchemaVersion?: string;
  assessmentRunId?: string;
  contractAddress?: string;
  source?: { kind: "snapshot"; space: string; proposalId: string };
  expectedContractContentHash?: string;
}

export async function withDatabase<T>(connectionString: string, task: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await task(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureSnapshotSource(client: Client, source: SnapshotSourceDefinition): Promise<string> {
  const sourceKey = `snapshot:${source.space}`;
  const result = await client.query<{ id: string }>(`
    insert into quorumx.sources (
      source_key, kind, display_name, configuration, enabled, poll_interval_seconds,
      homepage_url, logo_url, ecosystems, assessment_enabled, daily_assessment_budget
    )
    values ($1, 'snapshot', $2, jsonb_build_object('space', $3::text), true, 300,
      $4, $5, $6::jsonb, $7, $8)
    on conflict (source_key) do update set
      display_name = excluded.display_name,
      configuration = excluded.configuration,
      homepage_url = excluded.homepage_url,
      logo_url = excluded.logo_url,
      ecosystems = excluded.ecosystems,
      assessment_enabled = excluded.assessment_enabled,
      daily_assessment_budget = excluded.daily_assessment_budget,
      updated_at = now()
    returning id::text
  `, [sourceKey, source.displayName, source.space, source.homepageUrl, source.logoUrl,
    JSON.stringify(source.ecosystems), source.assessmentEnabled, source.dailyAssessmentBudget]);
  return result.rows[0].id;
}

function shouldAssess(proposal: SnapshotProposal, now: Date): boolean {
  if (proposal.status !== "active" && proposal.status !== "pending") return false;
  return proposal.votingEndsAt === undefined || new Date(proposal.votingEndsAt).getTime() > now.getTime();
}

export async function recordSourceFailure(client: Client, source: SnapshotSourceDefinition, message: string): Promise<void> {
  const sourceId = await ensureSnapshotSource(client, source);
  await client.query(`
    update quorumx.sources
    set last_polled_at = now(), last_error = $2, updated_at = now()
    where id = $1
  `, [sourceId, message.slice(0, 1_000)]);
}

export async function ingestSnapshotProposals(
  client: Client,
  source: SnapshotSourceDefinition,
  proposals: SnapshotProposal[],
  now = new Date(),
  assessmentVersion: "1" | "2" | "3" = "1",
  assessmentSchemaVersion: string = assessmentVersion,
): Promise<IngestResult> {
  await client.query("begin");
  try {
    const sourceId = await ensureSnapshotSource(client, source);
    const recentJobs = await client.query<{ count: number }>(`
      select count(*)::integer as count
      from quorumx.assessment_jobs jobs
      join quorumx.proposal_revisions revisions on revisions.id = jobs.revision_id
      join quorumx.proposals proposals on proposals.id = revisions.proposal_id
      where proposals.source_id = $1
        and jobs.created_at >= $2::timestamptz - interval '24 hours'
    `, [sourceId, now.toISOString()]);
    let remainingBudget = source.assessmentEnabled
      ? Math.max(0, source.dailyAssessmentBudget - recentJobs.rows[0].count)
      : 0;
    let revisionsCreated = 0;
    let jobsCreated = 0;
    let newestSubmittedAt: string | undefined;

    for (const proposal of proposals) {
      const proposalResult = await client.query<{ id: string }>(`
        insert into quorumx.proposals (
          source_id, external_id, canonical_id, title, body_text, choices,
          linked_evidence_urls, status, submitted_at, voting_starts_at,
          voting_ends_at, author_address, canonical_url, assessment_eligible,
          first_seen_at, last_seen_at, created_at, updated_at
        ) values (
          $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11,
          $12, $13, $14, $15, $15, $15, $15
        )
        on conflict (source_id, external_id) do update set
          canonical_id = excluded.canonical_id,
          title = excluded.title,
          body_text = excluded.body_text,
          choices = excluded.choices,
          linked_evidence_urls = excluded.linked_evidence_urls,
          status = excluded.status,
          submitted_at = excluded.submitted_at,
          voting_starts_at = excluded.voting_starts_at,
          voting_ends_at = excluded.voting_ends_at,
          author_address = excluded.author_address,
          canonical_url = excluded.canonical_url,
          assessment_eligible = excluded.assessment_eligible,
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at
        returning id::text
      `, [
        sourceId,
        proposal.externalId,
        proposal.canonicalId,
        proposal.title,
        proposal.bodyText,
        JSON.stringify(proposal.choices),
        JSON.stringify(proposal.linkedEvidenceUrls),
        proposal.status,
        proposal.submittedAt ?? null,
        proposal.votingStartsAt ?? null,
        proposal.votingEndsAt ?? null,
        proposal.authorAddress,
        proposal.canonicalUrl,
        shouldAssess(proposal, now),
        now.toISOString(),
      ]);
      const proposalId = proposalResult.rows[0].id;
      const normalizedPayload = {
        canonicalId: proposal.canonicalId,
        source: proposal.source,
        authorAddress: proposal.authorAddress,
        canonicalUrl: proposal.canonicalUrl,
        title: proposal.title,
        bodyText: proposal.bodyText,
        choices: proposal.choices,
        linkedEvidenceUrls: proposal.linkedEvidenceUrls,
        status: proposal.status,
        submittedAt: proposal.submittedAt ?? null,
        votingStartsAt: proposal.votingStartsAt ?? null,
        votingEndsAt: proposal.votingEndsAt ?? null,
        assessmentContentHash: await sha256(contractCanonicalJson({
          id: proposal.externalId,
          space: proposal.source.space,
          title: proposal.title,
          body: proposal.bodyText,
          choices: proposal.choices,
          state: proposal.status,
        })),
      };
      const contentHash = await sha256(canonicalJson(normalizedPayload));
      const revisionResult = await client.query<{ id: string }>(`
        insert into quorumx.proposal_revisions (proposal_id, content_hash, normalized_payload, fetched_at, created_at)
        values ($1, $2, $3::jsonb, $4, $4)
        on conflict (proposal_id, content_hash) do nothing
        returning id::text
      `, [proposalId, contentHash, JSON.stringify(normalizedPayload), now.toISOString()]);

      if (revisionResult.rowCount === 1) {
        revisionsCreated += 1;
      }
      if (shouldAssess(proposal, now) && remainingBudget > 0
        && (revisionResult.rowCount === 1 || assessmentVersion !== "1")) {
        const revisionId = revisionResult.rows[0]?.id ?? (await client.query<{ id: string }>(`
          select id::text from quorumx.proposal_revisions
          where proposal_id = $1 and content_hash = $2
        `, [proposalId, contentHash])).rows[0]?.id;
        if (!revisionId) throw new Error("Indexed revision was not found");
        const jobResult = await client.query(`
          insert into quorumx.assessment_jobs
            (revision_id, assessment_version, assessment_schema_version, assessment_run_id,
             is_initial_assessment, status, available_at, created_at, updated_at)
          values ($1, $2, $3, $4, true, 'pending', $5, $5, $5)
          on conflict do nothing
          returning id
        `, [revisionId, assessmentVersion, assessmentSchemaVersion,
          `initial:${assessmentSchemaVersion}:${revisionId}`, now.toISOString()]);
        jobsCreated += jobResult.rowCount ?? 0;
        remainingBudget -= jobResult.rowCount ?? 0;
      }

      if (proposal.submittedAt && (!newestSubmittedAt || proposal.submittedAt > newestSubmittedAt)) {
        newestSubmittedAt = proposal.submittedAt;
      }
    }

    await client.query(`
      insert into quorumx.poll_cursors (source_id, cursor, updated_at)
      values ($1, jsonb_build_object('newestSubmittedAt', $2::text), $3)
      on conflict (source_id) do update set cursor = excluded.cursor, updated_at = excluded.updated_at
    `, [sourceId, newestSubmittedAt ?? "", now.toISOString()]);
    await client.query(`
      update quorumx.sources
      set last_polled_at = $2, last_succeeded_at = $2, last_error = null, updated_at = $2
      where id = $1
    `, [sourceId, now.toISOString()]);
    await client.query("commit");
    return { proposalsSeen: proposals.length, revisionsCreated, jobsCreated };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function listSubmittedJobs(client: Client, limit = 5): Promise<SubmittedJob[]> {
  const result = await client.query<{
    job_id: string; attempt_count: number; max_attempts: number; revision_id: string;
    canonical_id: string; transaction_hash: string; transaction_row_id: string; assessment_version: "1" | "2" | "3";
    expected_contract_content_hash: string; assessment_schema_version: string; assessment_run_id: string;
    contract_address: string; source: { kind: "snapshot"; space: string; proposalId: string };
  }>(`
    select
      jobs.id::text as job_id,
      jobs.attempt_count,
      jobs.max_attempts,
      jobs.revision_id::text,
      jobs.assessment_version,
      jobs.assessment_schema_version,
      jobs.assessment_run_id,
      revisions.normalized_payload ->> 'assessmentContentHash' as expected_contract_content_hash,
      revisions.normalized_payload -> 'source' as source,
      proposals.canonical_id,
      transactions.transaction_hash,
      transactions.id::text as transaction_row_id,
      transactions.contract_address
    from quorumx.assessment_jobs jobs
    join quorumx.proposal_revisions revisions on revisions.id = jobs.revision_id
    join quorumx.proposals proposals on proposals.id = revisions.proposal_id
    join lateral (
      select id, transaction_hash, contract_address
      from quorumx.transactions
      where job_id = jobs.id and state = 'submitted'
      order by submitted_at desc
      limit 1
    ) transactions on true
    where jobs.status = 'submitted'
    order by jobs.updated_at asc
    limit $1
  `, [Math.max(1, Math.min(limit, 20))]);
  return result.rows.map((row) => ({
    jobId: row.job_id,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    revisionId: row.revision_id,
    proposalKey: row.canonical_id,
    transactionId: row.transaction_hash,
    transactionRowId: row.transaction_row_id,
    assessmentVersion: row.assessment_version,
    assessmentSchemaVersion: row.assessment_schema_version,
    assessmentRunId: row.assessment_run_id,
    contractAddress: row.contract_address,
    source: row.source,
    expectedContractContentHash: row.expected_contract_content_hash,
  }));
}

export async function claimAssessmentJob(
  client: Client, workerId: string, assessmentVersion: "1" | "2" | "3" = "1",
  assessmentSchemaVersion: string = assessmentVersion,
): Promise<ClaimedJob | undefined> {
  const result = await client.query<{
    id: string; attempt_count: number; max_attempts: number; revision_id: string;
    canonical_id: string; content_hash: string; normalized_payload: Record<string, unknown>; assessment_version: "1" | "2" | "3";
    assessment_schema_version: string; assessment_run_id: string;
  }>(`
    update quorumx.assessment_jobs jobs
    set
      status = 'processing',
      attempt_count = attempt_count + 1,
      locked_at = now(),
      locked_by = $1,
      updated_at = now()
    where jobs.id = (
      select candidate.id
      from quorumx.assessment_jobs candidate
      where candidate.assessment_version = $2 and candidate.assessment_schema_version = $3 and (
        (candidate.status in ('pending', 'retryable') and candidate.available_at <= now())
        or (candidate.status = 'processing' and candidate.locked_at < now() - interval '15 minutes')
      )
      order by candidate.available_at asc, candidate.id asc
      limit 1
      for update skip locked
    )
    returning
      jobs.id::text,
      jobs.attempt_count,
      jobs.max_attempts,
      jobs.revision_id::text,
      jobs.assessment_version,
      jobs.assessment_schema_version,
      jobs.assessment_run_id,
      (select proposals.canonical_id from quorumx.proposal_revisions revisions
       join quorumx.proposals proposals on proposals.id = revisions.proposal_id
       where revisions.id = jobs.revision_id),
      (select revisions.normalized_payload from quorumx.proposal_revisions revisions
       where revisions.id = jobs.revision_id),
      (select revisions.content_hash from quorumx.proposal_revisions revisions
       where revisions.id = jobs.revision_id)
  `, [workerId, assessmentVersion, assessmentSchemaVersion]);
  const row = result.rows[0];
  if (!row) return undefined;
  const payload = row.normalized_payload;
  const source = payload.source as ClaimedJob["source"];
  if (!source || source.kind !== "snapshot" || typeof source.space !== "string" || typeof source.proposalId !== "string") {
    throw new Error(`Job ${row.id} has an invalid proposal source`);
  }
  const expectedContractContentHash = payload.assessmentContentHash;
  if (typeof expectedContractContentHash !== "string" || !/^[0-9a-f]{64}$/.test(expectedContractContentHash)) {
    throw new Error(`Job ${row.id} has an invalid assessment content hash`);
  }
  return {
    id: row.id,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    revisionId: row.revision_id,
    revisionHash: row.content_hash,
    expectedContractContentHash,
    proposalKey: row.canonical_id,
    source,
    assessmentVersion: row.assessment_version,
    assessmentSchemaVersion: row.assessment_schema_version,
    assessmentRunId: row.assessment_run_id,
  };
}

export async function createReassessmentJob(
  client: Client, canonicalId: string, assessmentSchemaVersion: "3.3", assessmentRunId: string,
): Promise<string | undefined> {
  if (!/^[A-Za-z0-9:._-]{1,120}$/.test(assessmentRunId)) throw new Error("invalid_assessment_run_id");
  const result = await client.query<{ id: string }>(`
    insert into quorumx.assessment_jobs (
      revision_id, assessment_version, assessment_schema_version, assessment_run_id,
      is_initial_assessment, status, available_at, created_at, updated_at
    )
    select revisions.id, '3', $2, $3, false, 'pending', now(), now(), now()
    from quorumx.proposals proposals
    join lateral (
      select id from quorumx.proposal_revisions where proposal_id = proposals.id
      order by fetched_at desc, id desc limit 1
    ) revisions on true
    where proposals.canonical_id = $1
    on conflict (assessment_run_id) do nothing
    returning id::text
  `, [canonicalId, assessmentSchemaVersion, assessmentRunId]);
  return result.rows[0]?.id;
}

export async function markJobRetry(client: Client, job: ClaimedJob, message: string): Promise<void> {
  const terminal = job.attemptCount >= job.maxAttempts;
  // Hosted development RPCs can enforce daily quotas. Keep retries bounded while
  // spreading a transient outage across several days instead of one hour.
  const delayMinutes = Math.min(360, 2 ** Math.min(job.attemptCount, 9));
  await client.query(`
    update quorumx.assessment_jobs
    set status = $2, available_at = now() + make_interval(mins => $3),
        locked_at = null, locked_by = null, last_error = $4, updated_at = now(),
        completed_at = case when $2 = 'dead_letter' then now() else null end
    where id = $1
  `, [job.id, terminal ? "dead_letter" : "retryable", delayMinutes, message.slice(0, 1_000)]);
}

export async function recordSubmittedTransaction(
  client: Client,
  job: ClaimedJob,
  transactionHash: string,
  network: string,
  contractAddress: string,
): Promise<void> {
  await client.query("begin");
  try {
    await client.query(`
      insert into quorumx.transactions (
        job_id, network, contract_address, transaction_hash, state, evidence, submitted_at, created_at, updated_at
      ) values ($1, $2, $3, $4, 'submitted', jsonb_build_object('source', $5::text), now(), now(), now())
      on conflict (transaction_hash) do nothing
    `, [job.id, network, contractAddress, transactionHash, "automatic_indexer"]);
    await client.query(`
      update quorumx.assessment_jobs
      set status = 'submitted', transaction_id = $2, locked_at = null, locked_by = null,
          last_error = null, updated_at = now()
      where id = $1
    `, [job.id, transactionHash]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function finalizeAssessment(
  client: Client,
  input: {
    jobId: string;
    revisionId: string;
    transactionRowId?: string;
    assessment: StoredAssessment | StoredDueDiligenceAssessment | StoredDueDiligenceV3Assessment;
    indexedFrom: "submitted_transaction" | "existing_contract_state";
    assessmentRunId?: string;
    assessmentSchemaVersion?: string;
  },
): Promise<void> {
  await client.query("begin");
  try {
    if ("assessmentVersion" in input.assessment && input.assessment.assessmentVersion === "3") {
      if (!input.transactionRowId) throw new Error("V3 assessment requires a recorded transaction");
      await client.query(`
        insert into quorumx.due_diligence_assessments_v3 (
          revision_id, transaction_id, assessment_schema_version, assessment_run_id,
          proposal_key, source_locator_hash, content_hash,
          record, consensus_state, provenance, assessed_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'accepted', $9, $10)
        on conflict (assessment_run_id) do nothing
      `, [input.revisionId, input.transactionRowId,
        input.assessment.assessmentSchemaVersion ?? input.assessmentSchemaVersion ?? "3.0",
        input.assessment.assessmentRunId ?? input.assessmentRunId,
        input.assessment.proposalKey,
        input.assessment.sourceLocatorHash, input.assessment.contentHash,
        JSON.stringify(input.assessment), input.assessment.provenance, input.assessment.assessedAt]);
    } else if ("assessmentVersion" in input.assessment) {
      if (!input.transactionRowId) throw new Error("V2 assessment requires a recorded transaction");
      await client.query(`
        insert into quorumx.due_diligence_assessments (
          revision_id, transaction_id, proposal_key, source_locator_hash, content_hash,
          record, consensus_state, provenance, assessed_at
        ) values ($1, $2, $3, $4, $5, $6::jsonb, 'accepted', $7, $8)
        on conflict (revision_id) do nothing
      `, [input.revisionId, input.transactionRowId, input.assessment.proposalKey,
        input.assessment.sourceLocatorHash, input.assessment.contentHash,
        JSON.stringify(input.assessment), input.assessment.provenance, input.assessment.assessedAt]);
    } else {
    await client.query(`
      insert into quorumx.assessments (
        revision_id, transaction_id, proposal_key, source_locator_hash, content_hash,
        risk_level, risk_score, risk_categories, recommendation, summary,
        consensus_state, provenance, assessed_at, indexed_from, created_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 'accepted', $11, $12, $13, now())
      on conflict (revision_id) do update set
        transaction_id = coalesce(excluded.transaction_id, quorumx.assessments.transaction_id),
        proposal_key = excluded.proposal_key,
        source_locator_hash = excluded.source_locator_hash,
        content_hash = excluded.content_hash,
        risk_level = excluded.risk_level,
        risk_score = excluded.risk_score,
        risk_categories = excluded.risk_categories,
        recommendation = excluded.recommendation,
        summary = excluded.summary,
        consensus_state = excluded.consensus_state,
        provenance = excluded.provenance,
        assessed_at = excluded.assessed_at,
        indexed_from = excluded.indexed_from
    `, [
      input.revisionId,
      input.transactionRowId ?? null,
      input.assessment.proposalKey,
      input.assessment.sourceLocatorHash,
      input.assessment.contentHash,
      input.assessment.riskLevel,
      input.assessment.riskScore,
      JSON.stringify(input.assessment.riskCategories),
      input.assessment.recommendation,
      input.assessment.summary,
      input.assessment.provenance,
      input.assessment.assessedAt,
      input.indexedFrom,
    ]);
    }
    if (input.transactionRowId) {
      await client.query(`
        update quorumx.transactions
        set state = 'accepted', finalized_at = now(), error = null, updated_at = now()
        where id = $1
      `, [input.transactionRowId]);
    }
    await client.query(`
      update quorumx.assessment_jobs
      set status = 'finalized', locked_at = null, locked_by = null, last_error = null,
          completed_at = now(), updated_at = now()
      where id = $1
    `, [input.jobId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function markSubmittedTerminal(
  client: Client,
  job: SubmittedJob,
  state: "undetermined" | "reverted",
  message: string,
): Promise<void> {
  const retryable = state === "reverted" && job.attemptCount < job.maxAttempts;
  const delayMinutes = Math.min(360, 2 ** Math.min(job.attemptCount, 9));
  await client.query("begin");
  try {
    await client.query(`
      update quorumx.transactions
      set state = $2, error = $3, finalized_at = now(), updated_at = now()
      where id = $1
    `, [job.transactionRowId, state, message.slice(0, 1_000)]);
    await client.query(`
      update quorumx.assessment_jobs
      set status = $3,
          available_at = case when $3 = 'retryable' then now() + make_interval(mins => $4) else available_at end,
          last_error = $2,
          completed_at = case when $3 = 'dead_letter' then now() else null end,
          updated_at = now()
      where id = $1
    `, [job.jobId, message.slice(0, 1_000), retryable ? "retryable" : "dead_letter", delayMinutes]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
