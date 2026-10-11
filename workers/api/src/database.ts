import { Client } from "pg";
import { canonicalJson, contractCanonicalJson, sha256 } from "./canonical";
import type { SnapshotProposal, StoredAssessment, StoredDueDiligenceAssessment, StoredDueDiligenceV3Assessment } from "./domain";
import type { SnapshotSourceDefinition } from "./sources";
import type { BackfillRunConfig, BackfillState } from "./backfill_types";

export interface IngestResult {
  proposalsSeen: number;
  revisionsCreated: number;
  jobsCreated: number;
  scanState?: SnapshotScanState;
}

export interface SnapshotScanState {
  generation: number;
  skip: number;
  newProposalCount: number;
  stableSweepCount: number;
  sweepFingerprint: string;
  lastSweepFingerprint?: string;
  coverage: "scanning" | "covered";
  lastCompletedAt?: string;
  reconciliationOffset: number;
}

export interface SnapshotPageCommit {
  skip: number;
  first: number;
  exhausted: boolean;
  pageIds: string[];
}

const initialScanState = (): SnapshotScanState => ({
  generation: 1, skip: 0, newProposalCount: 0, stableSweepCount: 0, sweepFingerprint: "", coverage: "scanning", reconciliationOffset: 0,
});

function parseScanState(value: unknown): SnapshotScanState {
  if (!value || typeof value !== "object") return initialScanState();
  const raw = value as Record<string, unknown>;
  return {
    generation: Number.isSafeInteger(raw.generation) && Number(raw.generation) > 0 ? Number(raw.generation) : 1,
    skip: Number.isSafeInteger(raw.skip) && Number(raw.skip) >= 0 ? Number(raw.skip) : 0,
    newProposalCount: Number.isSafeInteger(raw.newProposalCount) && Number(raw.newProposalCount) >= 0 ? Number(raw.newProposalCount) : 0,
    stableSweepCount: Number.isSafeInteger(raw.stableSweepCount) && Number(raw.stableSweepCount) >= 0 ? Number(raw.stableSweepCount) : 0,
    sweepFingerprint: typeof raw.sweepFingerprint === "string" ? raw.sweepFingerprint : "",
    ...(typeof raw.lastSweepFingerprint === "string" ? { lastSweepFingerprint: raw.lastSweepFingerprint } : {}),
    coverage: raw.coverage === "covered" ? "covered" : "scanning",
    ...(typeof raw.lastCompletedAt === "string" ? { lastCompletedAt: raw.lastCompletedAt } : {}),
    reconciliationOffset: Number.isSafeInteger(raw.reconciliationOffset) && Number(raw.reconciliationOffset) >= 0 ? Number(raw.reconciliationOffset) : 0,
  };
}

export function nextSnapshotScanState(
  previous: SnapshotScanState, newlySeen: number, page: SnapshotPageCommit, now: Date,
): SnapshotScanState {
  const totalNew = previous.newProposalCount + newlySeen;
  const sameCompleteSequence = previous.sweepFingerprint !== ""
    && previous.sweepFingerprint === previous.lastSweepFingerprint;
  const stableSweepCount = totalNew === 0 && sameCompleteSequence ? previous.stableSweepCount + 1 : 0;
  return page.exhausted ? {
    generation: previous.generation + 1,
    skip: 0,
    newProposalCount: 0,
    stableSweepCount,
    sweepFingerprint: "",
    lastSweepFingerprint: previous.sweepFingerprint,
    coverage: totalNew === 0 && sameCompleteSequence ? "covered" : "scanning",
    lastCompletedAt: now.toISOString(),
    reconciliationOffset: previous.reconciliationOffset,
  } : {
    ...previous,
    skip: page.skip + page.first,
    newProposalCount: totalNew,
    coverage: "scanning",
  };
}

export async function getSnapshotScanState(client: Client, source: SnapshotSourceDefinition): Promise<SnapshotScanState> {
  const sourceId = await ensureSnapshotSource(client, source);
  const result = await client.query<{ cursor: unknown }>(
    "select cursor from quorumx.poll_cursors where source_id = $1", [sourceId],
  );
  return parseScanState(result.rows[0]?.cursor);
}

export async function listOpenSnapshotProposalIds(
  client: Client, source: SnapshotSourceDefinition, offset: number, limit = 50,
): Promise<string[]> {
  const sourceId = await ensureSnapshotSource(client, source);
  const result = await client.query<{ external_id: string }>(`
    select external_id from quorumx.proposals
    where source_id = $1 and status in ('active', 'pending')
    order by id asc offset $2 limit $3
  `, [sourceId, Math.max(0, offset), Math.max(1, Math.min(limit, 50))]);
  return result.rows.map((row) => row.external_id);
}

export async function advanceSnapshotReconciliation(
  client: Client, source: SnapshotSourceDefinition, previousOffset: number, returnedCount: number, limit = 50,
): Promise<number> {
  const sourceId = await ensureSnapshotSource(client, source);
  const nextOffset = returnedCount < limit ? 0 : previousOffset + returnedCount;
  await client.query(`
    insert into quorumx.poll_cursors (source_id, cursor, updated_at)
    values ($1, jsonb_build_object('generation', 1, 'skip', 0, 'newProposalCount', 0,
      'stableSweepCount', 0, 'sweepFingerprint', '', 'coverage', 'scanning', 'reconciliationOffset', $2::integer), now())
    on conflict (source_id) do update set
      cursor = poll_cursors.cursor || jsonb_build_object('reconciliationOffset', $2::integer), updated_at = now()
  `, [sourceId, nextOffset]);
  return nextOffset;
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
  jobKind?: "live" | "backfill";
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
  jobKind?: "live" | "backfill";
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
    set last_polled_at = now(), last_error = $2,
        consecutive_failures = consecutive_failures + 1,
        next_poll_at = now() + make_interval(secs => least(3600,
          (30 * power(2, least(consecutive_failures, 7)))::integer + floor(random() * 15)::integer)),
        updated_at = now()
    where id = $1
  `, [sourceId, message.slice(0, 1_000)]);
}

export async function isSourcePollDue(client: Client, source: SnapshotSourceDefinition): Promise<boolean> {
  const result = await client.query<{ due: boolean }>(`
    select coalesce((select next_poll_at <= now() from quorumx.sources where source_key = $1), true) as due
  `, [`snapshot:${source.space}`]);
  return result.rows[0]?.due ?? true;
}

export async function sourcePollOffset(client: Client, source: SnapshotSourceDefinition): Promise<number> {
  const result = await client.query<{ offset: number }>(`
    select coalesce((select greatest(0, (cursors.cursor ->> 'pageOffset')::integer)
      from quorumx.poll_cursors cursors join quorumx.sources sources on sources.id = cursors.source_id
      where sources.source_key = $1), 0)::integer as offset
  `, [`snapshot:${source.space}`]);
  return result.rows[0]?.offset ?? 0;
}

export async function ingestSnapshotProposals(
  client: Client,
  source: SnapshotSourceDefinition,
  proposals: SnapshotProposal[],
  now = new Date(),
  assessmentVersion: "1" | "2" | "3" = "1",
  assessmentSchemaVersionOrNextPageOffset: string | number = assessmentVersion,
  pageCommit?: SnapshotPageCommit,
): Promise<IngestResult> {
  const assessmentSchemaVersion = typeof assessmentSchemaVersionOrNextPageOffset === "string"
    ? assessmentSchemaVersionOrNextPageOffset : assessmentVersion;
  const nextPageOffset = typeof assessmentSchemaVersionOrNextPageOffset === "number"
    ? assessmentSchemaVersionOrNextPageOffset : undefined;
  await client.query("begin");
  try {
    const sourceId = await ensureSnapshotSource(client, source);
    // Serialize budget calculation and job creation for one source without
    // blocking unrelated sources or holding a session-level lock.
    await client.query("select pg_advisory_xact_lock($1::bigint)", [sourceId]);
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
    const cursorResult = await client.query<{ cursor: unknown }>(
      "select cursor from quorumx.poll_cursors where source_id = $1 for update", [sourceId],
    );
    const previousScan = parseScanState(cursorResult.rows[0]?.cursor);
    if (pageCommit && previousScan.skip !== pageCommit.skip) {
      throw new Error(`stale_snapshot_page: expected offset ${previousScan.skip}, received ${pageCommit.skip}`);
    }
    const existingIds = proposals.length === 0 ? new Set<string>() : new Set((await client.query<{ external_id: string }>(`
      select external_id from quorumx.proposals where source_id = $1 and external_id = any($2::text[])
    `, [sourceId, proposals.map((proposal) => proposal.externalId)])).rows.map((row) => row.external_id));
    const newlySeen = proposals.filter((proposal) => !existingIds.has(proposal.externalId)).length;
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
      const revisionResult = await client.query<{ id: string; inserted: boolean }>(`
        with inserted as (
          insert into quorumx.proposal_revisions (proposal_id, content_hash, normalized_payload, fetched_at, created_at)
          values ($1, $2, $3::jsonb, $4, $4)
          on conflict (proposal_id, content_hash) do nothing
          returning id::text, true as inserted
        )
        select id, inserted from inserted
        union all
        select id::text, false as inserted
        from quorumx.proposal_revisions
        where proposal_id = $1 and content_hash = $2
          and not exists (select 1 from inserted)
        limit 1
      `, [proposalId, contentHash, JSON.stringify(normalizedPayload), now.toISOString()]);
      const revisionId = revisionResult.rows[0]?.id;
      if (!revisionId) throw new Error("Indexed revision was not found");
      const revisionInserted = revisionResult.rows[0].inserted;
      if (revisionInserted) {
        revisionsCreated += 1;
      }
      const observation = await client.query<{ id: string }>(`
        insert into quorumx.proposal_revision_observations (proposal_id, revision_id, observed_at, created_at)
        values ($1, $2, $3, $3)
        returning id::text
      `, [proposalId, revisionId, now.toISOString()]);
      await client.query(`
        update quorumx.proposals
        set current_revision_id = $2, current_observation_id = $3, updated_at = $4
        where id = $1
      `, [proposalId, revisionId, observation.rows[0].id, now.toISOString()]);
      // A schema upgrade must not turn every previously indexed revision into
      // a new assessment.  Schema 3.4 is activated prospectively: it assesses
      // newly indexed material, while explicit reassessments are created by
      // the bounded reassessment path.  Earlier non-v1 formats retain their
      // historical requeue behaviour for compatibility.
      const requeueExistingRevision = assessmentVersion !== "1" && assessmentSchemaVersion !== "3.4";
      if (shouldAssess(proposal, now) && remainingBudget > 0
        && (revisionInserted || requeueExistingRevision)) {
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

    let scanState = previousScan;
    if (pageCommit) {
      const fingerprintState = {
        ...previousScan,
        sweepFingerprint: await sha256(`${previousScan.sweepFingerprint}:${canonicalJson(pageCommit.pageIds)}`),
      };
      scanState = nextSnapshotScanState(fingerprintState, newlySeen, pageCommit, now);
    }
    await client.query(`
      insert into quorumx.poll_cursors (source_id, cursor, updated_at)
      values ($1, $2::jsonb, $3)
      on conflict (source_id) do update set cursor = excluded.cursor, updated_at = excluded.updated_at
    `, [sourceId, JSON.stringify({
      ...scanState,
      newestSubmittedAt: newestSubmittedAt ?? "",
      pageOffset: nextPageOffset ?? scanState.skip,
    }), now.toISOString()]);
    await client.query(`
      update quorumx.sources
      set last_polled_at = $2, last_succeeded_at = $2, last_error = null,
          consecutive_failures = 0, next_poll_at = $2, updated_at = $2
      where id = $1
    `, [sourceId, now.toISOString()]);
    await client.query("commit");
    return { proposalsSeen: proposals.length, revisionsCreated, jobsCreated, scanState };
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
    job_kind: "live" | "backfill";
  }>(`
    select
      jobs.id::text as job_id,
      jobs.attempt_count,
      jobs.max_attempts,
      jobs.revision_id::text,
      jobs.assessment_version,
      jobs.assessment_schema_version,
      jobs.assessment_run_id,
      jobs.job_kind,
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
    where jobs.status = 'submitted' and jobs.next_poll_at <= now()
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
    jobKind: row.job_kind,
  }));
}

export async function claimAssessmentJob(
  client: Client, workerId: string, assessmentVersion: "1" | "2" | "3" = "1",
  assessmentSchemaVersion: string = assessmentVersion,
): Promise<ClaimedJob | undefined> {
  await client.query("begin isolation level read committed");
  try {
    await client.query(`
      select id from quorumx.sources
      where enabled and assessment_enabled
      order by id
      for update
    `);
    await client.query(`
      select id from quorumx.backfill_runs
      where status = 'running'
      order by id
      for share
    `);
    const result = await client.query<{
    id: string; attempt_count: number; max_attempts: number; revision_id: string;
    canonical_id: string; content_hash: string; normalized_payload: Record<string, unknown>; assessment_version: "1" | "2" | "3";
    assessment_schema_version: string; assessment_run_id: string;
    job_kind: "live" | "backfill";
  }>(`
    with backfill_usage as (
      select
        count(*) filter (where transactions.id is not null) as submitted_count,
        (select count(*) from quorumx.assessment_jobs reserved
          where reserved.job_kind = 'backfill' and reserved.status = 'processing'
            and reserved.locked_at >= now() - interval '15 minutes') as reserved_count
      from quorumx.transactions transactions
      join quorumx.assessment_jobs jobs on jobs.id = transactions.job_id
      where jobs.job_kind = 'backfill' and transactions.submitted_at >= now() - interval '24 hours'
    ), backfill_limit as (
      select min(daily_submission_budget) as count from quorumx.backfill_runs where status = 'running'
    ), eligible_candidate as (
      select candidate.id
      from quorumx.assessment_jobs candidate
      join quorumx.proposal_revisions revisions on revisions.id = candidate.revision_id
      join quorumx.proposals proposals on proposals.id = revisions.proposal_id
      join quorumx.sources sources on sources.id = proposals.source_id
      left join quorumx.backfill_runs on backfill_runs.id = candidate.backfill_run_id
      cross join backfill_usage
      cross join backfill_limit
      where candidate.assessment_version = $2 and candidate.assessment_schema_version = $3
        and sources.assessment_enabled
        and (candidate.job_kind = 'live' or (backfill_runs.status = 'running'
          and backfill_usage.submitted_count + backfill_usage.reserved_count
            < backfill_limit.count))
        and ((
          select count(*) from quorumx.transactions recent_transactions
          join quorumx.assessment_jobs submitted_jobs on submitted_jobs.id = recent_transactions.job_id
          join quorumx.proposal_revisions submitted_revisions on submitted_revisions.id = submitted_jobs.revision_id
          join quorumx.proposals submitted_proposals on submitted_proposals.id = submitted_revisions.proposal_id
          where submitted_proposals.source_id = sources.id
            and submitted_jobs.job_kind = 'live'
            and recent_transactions.submitted_at >= now() - interval '24 hours'
        ) + (
          select count(*) from quorumx.assessment_jobs reserved_jobs
          join quorumx.proposal_revisions reserved_revisions on reserved_revisions.id = reserved_jobs.revision_id
          join quorumx.proposals reserved_proposals on reserved_proposals.id = reserved_revisions.proposal_id
          where reserved_proposals.source_id = sources.id
            and reserved_jobs.job_kind = 'live'
            and reserved_jobs.status = 'processing'
            and reserved_jobs.locked_at >= now() - interval '15 minutes'
        )) < sources.daily_assessment_budget
        and (
          (candidate.status in ('pending', 'retryable') and candidate.next_poll_at <= now())
          or (candidate.status = 'processing' and candidate.lease_expires_at <= now())
        )
      order by
        case candidate.job_kind when 'live' then 0 else 1 end,
        case proposals.status when 'active' then 0 when 'pending' then 1 else 2 end,
        candidate.attempt_count asc,
        candidate.next_poll_at asc,
        proposals.voting_ends_at asc nulls last,
        revisions.created_at asc,
        candidate.id asc
      limit 1
      for update of candidate skip locked
    )
    update quorumx.assessment_jobs jobs
    set
      status = 'processing',
      attempt_count = attempt_count + 1,
      locked_at = now(),
      locked_by = $1,
      lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
    where jobs.id = (select id from eligible_candidate)
    returning
      jobs.id::text,
      jobs.attempt_count,
      jobs.max_attempts,
      jobs.revision_id::text,
      jobs.assessment_version,
      jobs.assessment_schema_version,
      jobs.assessment_run_id,
      jobs.job_kind,
      (select proposals.canonical_id from quorumx.proposal_revisions revisions
       join quorumx.proposals proposals on proposals.id = revisions.proposal_id
       where revisions.id = jobs.revision_id),
      (select revisions.normalized_payload from quorumx.proposal_revisions revisions
       where revisions.id = jobs.revision_id),
      (select revisions.content_hash from quorumx.proposal_revisions revisions
       where revisions.id = jobs.revision_id)
  `, [workerId, assessmentVersion, assessmentSchemaVersion]);
    const row = result.rows[0];
    if (!row) {
      await client.query("commit");
      return undefined;
    }
    const payload = row.normalized_payload;
    const source = payload.source as ClaimedJob["source"];
    if (!source || source.kind !== "snapshot" || typeof source.space !== "string" || typeof source.proposalId !== "string") {
      throw new Error(`Job ${row.id} has an invalid proposal source`);
    }
    const expectedContractContentHash = payload.assessmentContentHash;
    if (typeof expectedContractContentHash !== "string" || !/^[0-9a-f]{64}$/.test(expectedContractContentHash)) {
      throw new Error(`Job ${row.id} has an invalid assessment content hash`);
    }
    const job = {
      id: row.id, attemptCount: row.attempt_count, maxAttempts: row.max_attempts,
      revisionId: row.revision_id, revisionHash: row.content_hash, expectedContractContentHash,
      proposalKey: row.canonical_id, source, assessmentVersion: row.assessment_version,
      assessmentSchemaVersion: row.assessment_schema_version, assessmentRunId: row.assessment_run_id,
      jobKind: row.job_kind,
    };
    await client.query("commit");
    return job;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function createReassessmentJob(
  client: Client, canonicalId: string, assessmentSchemaVersion: "3.3" | "3.4", assessmentRunId: string,
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

export async function createBackfillDryRun(
  client: Client, candidates: Array<{ dao: string; canonicalId: string }>, config: BackfillRunConfig,
): Promise<string> {
  await client.query("begin");
  try {
    const run = await client.query<{ id: string }>(`
      insert into quorumx.backfill_runs (status, per_dao_limit, total_limit, window_days, daily_submission_budget)
      values ('dry_run', $1, $2, $3, $4) returning id::text
    `, [config.perDaoLimit, config.totalLimit, config.windowDays, config.dailySubmissionBudget]);
    const runId = run.rows[0].id;
    await client.query(`
        with requested as (
          select candidate.dao, candidate.canonical_id, candidate.ordinality
          from rows from (jsonb_to_recordset($2::jsonb) as (dao text, canonical_id text))
            with ordinality as candidate(dao, canonical_id, ordinality)
        )
        insert into quorumx.backfill_candidates (run_id, revision_id, dao_name, state, reason)
        select $1, revisions.id, requested.dao,
          case
            when exists (select 1 from quorumx.due_diligence_assessments_v3 assessments
              where assessments.revision_id = revisions.id and assessments.assessment_schema_version = '3.3') then 'skipped'
            when exists (select 1 from quorumx.assessment_jobs jobs
              where jobs.revision_id = revisions.id and jobs.assessment_version = '3'
                and jobs.assessment_schema_version = '3.3') then 'skipped'
            else 'eligible'
          end,
          case when exists (select 1 from quorumx.due_diligence_assessments_v3 assessments
            where assessments.revision_id = revisions.id and assessments.assessment_schema_version = '3.3')
            then 'existing_format3_assessment'
          when exists (select 1 from quorumx.assessment_jobs jobs
            where jobs.revision_id = revisions.id and jobs.assessment_version = '3'
              and jobs.assessment_schema_version = '3.3') then 'existing_format3_job' else null end
        from quorumx.proposals proposals
        join quorumx.proposal_revisions revisions on revisions.id = proposals.current_revision_id
        join requested on requested.canonical_id = proposals.canonical_id
        where proposals.status = 'closed'
        order by requested.ordinality
        on conflict (run_id, revision_id) do nothing
      `, [runId, JSON.stringify(candidates.map((candidate) => ({ dao: candidate.dao, canonical_id: candidate.canonicalId })))]);
    await client.query("commit");
    return runId;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function startBackfillRun(client: Client, runId: string): Promise<boolean> {
  await client.query("begin");
  try {
    const locked = await client.query<{ status: string }>(
      "select status from quorumx.backfill_runs where id = $1 for update", [runId]);
    if (locked.rows[0]?.status !== "dry_run") { await client.query("rollback"); return false; }
    await client.query(`
        insert into quorumx.assessment_jobs (
          revision_id, assessment_version, assessment_schema_version, assessment_run_id,
          is_initial_assessment, job_kind, backfill_run_id, status, available_at, created_at, updated_at
        )
        select candidates.revision_id, '3', '3.3',
          'backfill:3.3:' || candidates.run_id::text || ':' || candidates.revision_id::text,
          true, 'backfill', candidates.run_id, 'pending', now(), now(), now()
        from quorumx.backfill_candidates candidates
        where candidates.run_id = $1 and candidates.state = 'eligible'
        on conflict do nothing
    `, [runId]);
    await client.query(`
      with selected as (
        select candidates.id, (select jobs.id from quorumx.assessment_jobs jobs
          where jobs.revision_id = candidates.revision_id and jobs.backfill_run_id = $1 limit 1) as job_id
        from quorumx.backfill_candidates candidates
        where candidates.run_id = $1 and candidates.state = 'eligible'
      )
      update quorumx.backfill_candidates candidates set
        job_id = selected.job_id,
        state = case when selected.job_id is not null then 'queued' else 'skipped' end,
        reason = case when selected.job_id is not null then null else 'existing_format3_job' end,
        updated_at = now()
      from selected where candidates.id = selected.id
    `, [runId]);
    await client.query(`
      with state as (
        select exists (select 1 from quorumx.backfill_candidates candidates
          where candidates.run_id = $1 and candidates.state in ('eligible','queued','processing','retrying')) as has_remaining
      )
      update quorumx.backfill_runs runs set
        status = case when state.has_remaining then 'running' else 'completed' end,
        completed_at = case when state.has_remaining then null else now() end,
        updated_at = now()
      from state where runs.id = $1
    `, [runId]);
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    if ((error as { code?: string }).code === "23505") return false;
    throw error;
  }
}

export async function setBackfillRunStatus(
  client: Client, runId: string, status: "paused" | "running",
): Promise<"changed" | "not_found" | "invalid_state"> {
  const existing = await client.query<{ status: string }>("select status from quorumx.backfill_runs where id = $1", [runId]);
  if (!existing.rows[0]) return "not_found";
  if (existing.rows[0].status !== "running" && existing.rows[0].status !== "paused") return "invalid_state";
  const result = await client.query(`update quorumx.backfill_runs runs set
      status = case when $2 = 'running' and not exists (select 1 from quorumx.backfill_candidates candidates
        where candidates.run_id = runs.id and candidates.state in ('eligible','queued','processing','retrying'))
        then 'completed' else $2 end,
      completed_at = case when $2 = 'running' and not exists (select 1 from quorumx.backfill_candidates candidates
        where candidates.run_id = runs.id and candidates.state in ('eligible','queued','processing','retrying'))
        then now() else completed_at end,
      updated_at = now()
    where id = $1 and status in ('running','paused')`, [runId, status]);
  return (result.rowCount ?? 0) === 1 ? "changed" : "invalid_state";
}

export async function getBackfillRun(client: Client, runId: string) {
  const run = await client.query(`select id::text, status, per_dao_limit as "perDaoLimit", total_limit as "totalLimit",
    window_days as "windowDays", daily_submission_budget as "dailySubmissionBudget", created_at as "createdAt",
    updated_at as "updatedAt", completed_at as "completedAt" from quorumx.backfill_runs where id = $1`, [runId]);
  if (!run.rows[0]) return undefined;
  const candidates = await client.query<{ dao: string; state: BackfillState; canonicalId: string; revisionId: string; reason: string | null; jobId: string | null }>(`
    select candidates.dao_name as dao, proposals.canonical_id as "canonicalId",
      candidates.revision_id::text as "revisionId", candidates.reason,
      candidates.job_id::text as "jobId",
      case
        when assessments.id is not null and candidates.job_id is not null then 'accepted'
        when jobs.status in ('processing','submitted') then 'processing'
        when jobs.status = 'retryable' then 'retrying'
        when jobs.status in ('failed','dead_letter') then 'failed'
        when jobs.status = 'pending' then 'queued'
        else candidates.state
      end as state
    from quorumx.backfill_candidates candidates
    join quorumx.proposal_revisions revisions on revisions.id = candidates.revision_id
    join quorumx.proposals proposals on proposals.id = revisions.proposal_id
    left join quorumx.assessment_jobs jobs on jobs.id = candidates.job_id
    left join quorumx.due_diligence_assessments_v3 assessments
      on assessments.revision_id = candidates.revision_id and assessments.assessment_schema_version = '3.3'
    where candidates.run_id = $1 order by candidates.id
  `, [runId]);
  return { ...run.rows[0], candidates: candidates.rows };
}

async function settleBackfillCandidate(client: Client, jobId: string, state: "accepted" | "retrying" | "failed"): Promise<void> {
  await client.query(`
    update quorumx.backfill_candidates candidates
    set state = $2, reason = case when $2 = 'failed' then coalesce(jobs.last_error, 'assessment_failed') else null end,
        updated_at = now()
    from quorumx.assessment_jobs jobs
    where candidates.job_id = jobs.id and jobs.id = $1 and jobs.job_kind = 'backfill'
  `, [jobId, state]);
  await client.query(`
    update quorumx.backfill_runs runs
    set status = 'completed', completed_at = now(), updated_at = now()
    where runs.status in ('running','paused')
      and exists (select 1 from quorumx.assessment_jobs jobs where jobs.id = $1 and jobs.backfill_run_id = runs.id)
      and not exists (
        select 1 from quorumx.backfill_candidates candidates
        where candidates.run_id = runs.id and candidates.state in ('eligible','queued','processing','retrying')
      )
  `, [jobId]);
}

export async function markJobRetry(client: Client, job: ClaimedJob, message: string): Promise<void> {
  const terminal = job.attemptCount >= job.maxAttempts;
  // Hosted development RPCs can enforce daily quotas. Keep retries bounded while
  // spreading a transient outage across several days instead of one hour.
  const delayMinutes = Math.min(360, 2 ** Math.min(job.attemptCount, 9));
  await client.query("begin");
  try {
    await client.query(`
      update quorumx.assessment_jobs
      set status = $2, available_at = now() + make_interval(mins => $3),
          next_poll_at = now() + make_interval(mins => $3),
          locked_at = null, locked_by = null, lease_expires_at = null, last_error = $4, updated_at = now(),
          completed_at = case when $2 = 'dead_letter' then now() else null end
      where id = $1
    `, [job.id, terminal ? "dead_letter" : "retryable", delayMinutes, message.slice(0, 1_000)]);
    if (job.jobKind === "backfill") await settleBackfillCandidate(client, job.id, terminal ? "failed" : "retrying");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
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
    const inserted = await client.query<{ job_id: string; state: string }>(`
      insert into quorumx.transactions (
        job_id, network, contract_address, transaction_hash, state, evidence, submitted_at, created_at, updated_at
      ) values ($1, $2, $3, $4, 'submitted', jsonb_build_object('source', $5::text), now(), now(), now())
      on conflict (transaction_hash) do nothing
      returning job_id::text, state
    `, [job.id, network, contractAddress, transactionHash, "automatic_indexer"]);
    const transaction = inserted.rows[0] ?? (await client.query<{ job_id: string; state: string }>(`
      select job_id::text, state
      from quorumx.transactions
      where transaction_hash = $1
      for share
    `, [transactionHash])).rows[0];
    if (!transaction || transaction.job_id !== job.id || transaction.state !== "submitted") {
      throw new Error("submission transaction is not a viable active attempt");
    }
    await client.query(`
      update quorumx.submission_intents
      set state = 'recorded', transaction_hash = $2, updated_at = now()
      where job_id = $1
    `, [job.id, transactionHash]);
    await client.query(`
      update quorumx.assessment_jobs
      set status = 'submitted', transaction_id = $2, next_poll_at = now() + interval '15 seconds',
          locked_at = null, locked_by = null, lease_expires_at = null,
          last_error = null, updated_at = now()
      where id = $1
    `, [job.id, transactionHash]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function deferSubmittedPoll(client: Client, job: SubmittedJob): Promise<void> {
  await client.query(`
    update quorumx.assessment_jobs
    set poll_attempt_count = poll_attempt_count + 1,
        next_poll_at = now() + make_interval(secs => least(300, 5 * power(2, least(poll_attempt_count, 6)))::integer),
        updated_at = now()
    where id = $1 and status = 'submitted'
  `, [job.jobId]);
}

export async function prepareSubmissionIntent(
  client: Client, job: ClaimedJob, idempotencyKey: string,
): Promise<{ created: boolean; state: string; transactionHash?: string; retryRearmed?: boolean }> {
  const result = await client.query<{
    created: boolean; state: string; transaction_hash: string | null; retry_rearmed: boolean;
  }>(`
    with rearmed as (
      update quorumx.submission_intents intents
      set state = 'prepared', transaction_hash = null, updated_at = now()
      from quorumx.assessment_jobs jobs
      where intents.job_id = $1
        and intents.idempotency_key = $2
        and jobs.id = intents.job_id
        and jobs.status = 'processing'
        and jobs.attempt_count < jobs.max_attempts
        and exists (
          select 1 from quorumx.transactions transactions
          where transactions.job_id = intents.job_id
            and transactions.transaction_hash = intents.transaction_hash
            and transactions.state = 'reverted'
        )
      returning false as created, intents.state, intents.transaction_hash, true as retry_rearmed
    ),
    inserted as (
      insert into quorumx.submission_intents (job_id, idempotency_key)
      values ($1, $2)
      on conflict (job_id) do nothing
      returning true as created, state, transaction_hash, false as retry_rearmed
    )
    select created, state, transaction_hash, retry_rearmed from rearmed
    union all
    select created, state, transaction_hash, retry_rearmed from inserted
    union all
    select false, state, transaction_hash, false from quorumx.submission_intents
    where job_id = $1 and not exists (select 1 from rearmed) and not exists (select 1 from inserted)
    limit 1
  `, [job.id, idempotencyKey]);
  return { created: result.rows[0].created, state: result.rows[0].state, ...(result.rows[0].transaction_hash
    ? { transactionHash: result.rows[0].transaction_hash } : {}), ...(result.rows[0].retry_rearmed
    ? { retryRearmed: true } : {}) };
}

/**
 * Repairs the only safe stranded-submission shape: a submitted job whose most
 * recent transaction is definitively reverted and which has no active
 * submitted transaction. Undetermined attempts deliberately remain untouched.
 */
export async function repairStrandedSubmittedJobs(client: Client, limit = 5): Promise<number> {
  await client.query("begin");
  try {
    const repaired = await client.query<{ job_id: string; retryable: boolean; job_kind: "live" | "backfill" }>(`
      with stranded as (
        select jobs.id, jobs.attempt_count, jobs.max_attempts, jobs.job_kind
        from quorumx.assessment_jobs jobs
        join lateral (
          select state from quorumx.transactions
          where job_id = jobs.id
          order by submitted_at desc, id desc
          limit 1
        ) latest on true
        where jobs.status = 'submitted'
          and jobs.assessment_version = '3'
          and latest.state = 'reverted'
          and not exists (
            select 1 from quorumx.transactions active
            where active.job_id = jobs.id and active.state = 'submitted'
          )
        order by jobs.updated_at asc, jobs.id asc
        limit $1
        for update of jobs skip locked
      ), updated as (
        update quorumx.assessment_jobs jobs
        set status = case when stranded.attempt_count < stranded.max_attempts then 'retryable' else 'dead_letter' end,
            available_at = case when stranded.attempt_count < stranded.max_attempts then now() else available_at end,
            completed_at = case when stranded.attempt_count < stranded.max_attempts then null else now() end,
            locked_at = null, locked_by = null, lease_expires_at = null,
            last_error = case when stranded.attempt_count < stranded.max_attempts
              then 'repaired_reverted_submission' else 'reverted_submission_attempts_exhausted' end,
            updated_at = now()
        from stranded
        where jobs.id = stranded.id
        returning jobs.id::text as job_id, stranded.attempt_count < stranded.max_attempts as retryable, stranded.job_kind
      )
      select * from updated
    `, [Math.max(1, Math.min(limit, 20))]);
    for (const job of repaired.rows) {
      if (job.job_kind === "backfill") await settleBackfillCandidate(client, job.job_id, job.retryable ? "retrying" : "failed");
    }
    await client.query("commit");
    return repaired.rows.length;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function markSubmissionUncertain(client: Client, job: ClaimedJob): Promise<void> {
  await client.query("begin");
  try {
    await client.query(`
      update quorumx.assessment_jobs
      set status = 'dead_letter', last_error = 'submission_outcome_unknown', completed_at = now(),
          locked_at = null, locked_by = null, lease_expires_at = null, updated_at = now()
      where id = $1
    `, [job.id]);
    if (job.jobKind === "backfill") await settleBackfillCandidate(client, job.id, "failed");
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
    jobKind?: "live" | "backfill";
  },
): Promise<void> {
  await client.query("begin");
  try {
    if ("assessmentVersion" in input.assessment && input.assessment.assessmentVersion === "3") {
      if (!input.transactionRowId) throw new Error("V3 assessment requires a recorded transaction");
      const inserted = await client.query(`
        insert into quorumx.due_diligence_assessments_v3 (
          revision_id, transaction_id, assessment_schema_version, assessment_run_id,
          proposal_key, source_locator_hash, content_hash,
          record, consensus_state, provenance, assessed_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'accepted', $9, $10)
        on conflict (assessment_run_id) do nothing
        returning id
      `, [input.revisionId, input.transactionRowId,
        input.assessment.assessmentSchemaVersion ?? input.assessmentSchemaVersion ?? "3.0",
        input.assessment.assessmentRunId ?? input.assessmentRunId,
        input.assessment.proposalKey,
        input.assessment.sourceLocatorHash, input.assessment.contentHash,
        JSON.stringify(input.assessment), input.assessment.provenance, input.assessment.assessedAt]);
      if (inserted.rowCount === 0) {
        const identical = await client.query(`
          select 1 from quorumx.due_diligence_assessments_v3
          where assessment_run_id = $1 and revision_id = $2 and transaction_id = $3
            and assessment_schema_version = $4 and proposal_key = $5
            and source_locator_hash = $6 and content_hash = $7 and record = $8::jsonb
            and provenance = $9 and assessed_at = $10
        `, [input.assessment.assessmentRunId ?? input.assessmentRunId, input.revisionId,
          input.transactionRowId,
          input.assessment.assessmentSchemaVersion ?? input.assessmentSchemaVersion ?? "3.0",
          input.assessment.proposalKey, input.assessment.sourceLocatorHash,
          input.assessment.contentHash, JSON.stringify(input.assessment),
          input.assessment.provenance, input.assessment.assessedAt]);
        if (identical.rowCount === 0) throw new Error("Accepted v3 assessment conflict: immutable record differs");
      }
    } else if ("assessmentVersion" in input.assessment) {
      if (!input.transactionRowId) throw new Error("V2 assessment requires a recorded transaction");
      const inserted = await client.query(`
        insert into quorumx.due_diligence_assessments (
          revision_id, transaction_id, proposal_key, source_locator_hash, content_hash,
          record, consensus_state, provenance, assessed_at
        ) values ($1, $2, $3, $4, $5, $6::jsonb, 'accepted', $7, $8)
        on conflict (revision_id) do nothing
        returning id
      `, [input.revisionId, input.transactionRowId, input.assessment.proposalKey,
        input.assessment.sourceLocatorHash, input.assessment.contentHash,
        JSON.stringify(input.assessment), input.assessment.provenance, input.assessment.assessedAt]);
      if (inserted.rowCount === 0) {
        const identical = await client.query(`
          select 1 from quorumx.due_diligence_assessments
          where revision_id = $1 and transaction_id = $2 and proposal_key = $3
            and source_locator_hash = $4 and content_hash = $5 and record = $6::jsonb
            and provenance = $7 and assessed_at = $8
        `, [input.revisionId, input.transactionRowId, input.assessment.proposalKey,
          input.assessment.sourceLocatorHash, input.assessment.contentHash,
          JSON.stringify(input.assessment), input.assessment.provenance, input.assessment.assessedAt]);
        if (identical.rowCount === 0) throw new Error("Accepted v2 assessment conflict: immutable record differs");
      }
    } else {
    const inserted = await client.query(`
      insert into quorumx.assessments (
        revision_id, transaction_id, proposal_key, source_locator_hash, content_hash,
        risk_level, risk_score, risk_categories, recommendation, summary,
        consensus_state, provenance, assessed_at, indexed_from, created_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 'accepted', $11, $12, $13, now())
      on conflict (revision_id) do nothing
      returning id
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
    if (inserted.rowCount === 0) {
      const identical = await client.query(`
        select 1 from quorumx.assessments
        where revision_id = $1 and transaction_id is not distinct from $2::bigint
          and proposal_key = $3 and source_locator_hash = $4 and content_hash = $5
          and risk_level = $6 and risk_score = $7 and risk_categories = $8::jsonb
          and recommendation = $9 and summary = $10 and provenance = $11
          and assessed_at = $12 and indexed_from = $13
      `, [input.revisionId, input.transactionRowId ?? null, input.assessment.proposalKey,
        input.assessment.sourceLocatorHash, input.assessment.contentHash,
        input.assessment.riskLevel, input.assessment.riskScore,
        JSON.stringify(input.assessment.riskCategories), input.assessment.recommendation,
        input.assessment.summary, input.assessment.provenance, input.assessment.assessedAt,
        input.indexedFrom]);
      if (identical.rowCount === 0) throw new Error("Accepted v1 assessment conflict: immutable record differs");
    }
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
      set status = 'finalized', locked_at = null, locked_by = null, lease_expires_at = null, last_error = null,
          completed_at = now(), updated_at = now()
      where id = $1
    `, [input.jobId]);
    if (input.jobKind === "backfill") await settleBackfillCandidate(client, input.jobId, "accepted");
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
    if (job.jobKind === "backfill") await settleBackfillCandidate(client, job.jobId, retryable ? "retrying" : "failed");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function quarantineSubmittedAssessment(
  client: Client,
  job: SubmittedJob,
  category: string,
): Promise<void> {
  await client.query("begin");
  try {
    await client.query(`
      update quorumx.transactions
      set state = 'undetermined', error = $2, finalized_at = now(), updated_at = now()
      where id = $1
    `, [job.transactionRowId, category]);
    await client.query(`
      update quorumx.assessment_jobs
      set status = 'dead_letter', last_error = $2, completed_at = now(),
          locked_at = null, locked_by = null, lease_expires_at = null, updated_at = now()
      where id = $1
    `, [job.jobId, category]);
    if (job.jobKind === "backfill") await settleBackfillCandidate(client, job.jobId, "failed");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
