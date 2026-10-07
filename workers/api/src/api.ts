import type { Client } from "pg";
import { revisionChanges } from "./revision_changes";

function boundedLimit(url: URL): number {
  const parsed = Number(url.searchParams.get("limit") ?? "20");
  return Number.isInteger(parsed) ? Math.max(1, Math.min(parsed, 100)) : 20;
}

function cursor(url: URL): number | undefined {
  const raw = url.searchParams.get("cursor");
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function listSources(client: Client): Promise<unknown> {
  const result = await client.query(`
    select
      source_key as "sourceKey",
      kind,
      display_name as "displayName",
      configuration,
      enabled,
      homepage_url as "homepageUrl",
      logo_url as "logoUrl",
      ecosystems,
      assessment_enabled as "assessmentEnabled",
      daily_assessment_budget as "dailyAssessmentBudget",
      poll_interval_seconds as "pollIntervalSeconds",
      last_polled_at as "lastPolledAt",
      last_succeeded_at as "lastSucceededAt",
      last_error as "lastError"
    from quorumx.sources
    order by source_key
  `);
  return { data: result.rows };
}

export async function listProposals(client: Client, url: URL): Promise<unknown> {
  const limit = boundedLimit(url);
  const beforeId = cursor(url);
  const status = url.searchParams.get("status");
  const space = url.searchParams.get("space")?.trim().toLowerCase();
  const source = url.searchParams.get("source")?.trim().toLowerCase();
  const dao = url.searchParams.get("dao")?.trim().toLowerCase();
  const author = url.searchParams.get("author")?.trim().toLowerCase();
  const assessment = url.searchParams.get("assessment")?.trim().toLowerCase();
  const ecosystem = url.searchParams.get("ecosystem")?.trim().toLowerCase();
  if (status && !["pending", "active", "closed", "unknown"].includes(status)) {
    throw new RangeError("invalid_status");
  }
  if (author && !/^0x[0-9a-f]{40}$/.test(author)) throw new RangeError("invalid_author");
  if (dao && (dao.length > 100 || !/^[a-z0-9 ._-]+$/.test(dao))) throw new RangeError("invalid_dao");
  const assessmentStatuses = ["indexed", "waiting_capacity", "processing", "submitted", "finalized", "retrying", "unavailable"];
  if (assessment && !assessmentStatuses.includes(assessment)) {
    throw new RangeError("invalid_assessment");
  }
  if (ecosystem && !/^[a-z0-9][a-z0-9-]{0,49}$/.test(ecosystem)) throw new RangeError("invalid_ecosystem");
  const result = await client.query(`
    select
      proposals.id::text,
      proposals.canonical_id as "canonicalId",
      proposals.external_id as "externalId",
      sources.source_key as "sourceKey",
      sources.display_name as "daoName",
      sources.configuration ->> 'space' as space,
      sources.logo_url as "daoLogoUrl",
      sources.ecosystems,
      proposals.author_address as "authorAddress",
      proposals.canonical_url as "canonicalUrl",
      proposals.assessment_eligible as "assessmentEligible",
      proposals.title,
      proposals.choices,
      proposals.status,
      proposals.submitted_at as "submittedAt",
      proposals.voting_starts_at as "votingStartsAt",
      proposals.voting_ends_at as "votingEndsAt",
      revisions.content_hash as "revisionHash",
      revisions.fetched_at as "revisionFetchedAt",
      coalesce(case jobs.status
        when 'pending' then 'waiting_capacity'
        when 'retryable' then 'retrying'
        when 'dead_letter' then 'unavailable'
        when 'failed' then 'unavailable'
        else jobs.status end, 'indexed') as "assessmentStatus",
      case when due_diligence_v3.id is not null then '3' when due_diligence.id is not null then '2' when assessments.id is not null then '1' else null end as "assessmentVersion",
      coalesce(due_diligence_v3.record, due_diligence.record) ->> 'reviewPriority' as "reviewPriority",
      case when coalesce(due_diligence_v3.id, due_diligence.id) is not null then jsonb_array_length(coalesce(due_diligence_v3.record, due_diligence.record) -> 'findings') else null end as "findingCount",
      case when coalesce(due_diligence_v3.id, due_diligence.id) is not null then jsonb_array_length(coalesce(due_diligence_v3.record, due_diligence.record) -> 'materialClaims') else null end as "claimCount",
      case when coalesce(due_diligence_v3.id, due_diligence.id) is not null then jsonb_array_length(coalesce(due_diligence_v3.record, due_diligence.record) -> 'unresolvedQuestions') else null end as "unresolvedCount",
      assessments.risk_level as "riskLevel",
      assessments.risk_score as "riskScore",
      assessments.recommendation,
      coalesce(due_diligence_v3.assessed_at, due_diligence.assessed_at, assessments.assessed_at) as "assessedAt"
    from quorumx.proposals proposals
    join quorumx.sources sources on sources.id = proposals.source_id
    left join lateral (
      select id, content_hash, fetched_at
      from quorumx.proposal_revisions
      where proposal_id = proposals.id
      order by fetched_at desc, id desc
      limit 1
    ) revisions on true
    left join lateral (
      select id, status from quorumx.assessment_jobs
      where revision_id = revisions.id order by assessment_version desc, assessment_schema_version desc, created_at desc limit 1
    ) jobs on true
    left join quorumx.assessments assessments on assessments.revision_id = revisions.id
    left join quorumx.due_diligence_assessments due_diligence on due_diligence.revision_id = revisions.id
    left join lateral (
      select * from quorumx.due_diligence_assessments_v3
      where revision_id = revisions.id
      order by assessment_schema_version desc, assessed_at desc, id desc limit 1
    ) due_diligence_v3 on true
    where ($1::bigint is null or proposals.id < $1)
      and ($2::text is null or proposals.status = $2)
      and ($3::text is null or sources.configuration ->> 'space' = $3)
      and ($4::text is null or sources.source_key = $4)
      and ($5::text is null or lower(sources.display_name) = $5 or sources.configuration ->> 'space' = $5)
      and ($6::text is null or proposals.author_address = $6)
      and ($7::text is null
        or ($7 = 'indexed' and jobs.id is null)
        or ($7 = 'waiting_capacity' and jobs.status = 'pending')
        or ($7 = 'retrying' and jobs.status = 'retryable')
        or ($7 = 'unavailable' and jobs.status in ('failed', 'dead_letter'))
        or jobs.status = $7)
      and ($8::text is null or sources.ecosystems ? $8)
    order by proposals.id desc
    limit $9
  `, [beforeId ?? null, status ?? null, space ?? null, source ?? null, dao ?? null,
    author ?? null, assessment ?? null, ecosystem ?? null, limit + 1]);
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  return {
    data: rows,
    page: {
      limit,
      nextCursor: hasMore ? rows.at(-1)?.id ?? null : null,
    },
  };
}

export async function getProposal(client: Client, canonicalId: string): Promise<unknown | undefined> {
  const result = await client.query(`
    select
      proposals.id::text,
      proposals.canonical_id as "canonicalId",
      proposals.external_id as "externalId",
      sources.source_key as "sourceKey",
      sources.display_name as "daoName",
      sources.configuration ->> 'space' as space,
      sources.homepage_url as "daoHomepageUrl",
      sources.logo_url as "daoLogoUrl",
      sources.ecosystems,
      proposals.author_address as "authorAddress",
      proposals.canonical_url as "canonicalUrl",
      proposals.assessment_eligible as "assessmentEligible",
      proposals.title,
      proposals.body_text as "bodyText",
      proposals.choices,
      proposals.linked_evidence_urls as "linkedEvidenceUrls",
      proposals.status,
      proposals.submitted_at as "submittedAt",
      proposals.voting_starts_at as "votingStartsAt",
      proposals.voting_ends_at as "votingEndsAt",
      proposals.first_seen_at as "firstSeenAt",
      proposals.last_seen_at as "lastSeenAt",
      revisions.content_hash as "revisionHash",
      revisions.fetched_at as "revisionFetchedAt",
      revisions.normalized_payload as "currentRevisionPayload",
      previous_revision.normalized_payload as "previousRevisionPayload",
      coalesce(case jobs.status
        when 'pending' then 'waiting_capacity'
        when 'retryable' then 'retrying'
        when 'dead_letter' then 'unavailable'
        when 'failed' then 'unavailable'
        else jobs.status end, 'indexed') as "assessmentStatus",
      jobs.last_error as "assessmentError",
      case when due_diligence_v3.id is not null then '3' when due_diligence.id is not null then '2' when assessments.id is not null then '1' else null end as "assessmentVersion",
      coalesce(due_diligence_v3.record, due_diligence.record) as "dueDiligence",
      transactions.transaction_hash as "transactionHash",
      transactions.state as "transactionState",
      assessments.source_locator_hash as "sourceLocatorHash",
      assessments.content_hash as "assessedContentHash",
      assessments.risk_level as "riskLevel",
      assessments.risk_score as "riskScore",
      assessments.risk_categories as "riskCategories",
      assessments.recommendation,
      assessments.summary,
      coalesce(due_diligence_v3.consensus_state, due_diligence.consensus_state, assessments.consensus_state) as "consensusState",
      coalesce(due_diligence_v3.provenance, due_diligence.provenance, assessments.provenance) as provenance,
      coalesce(due_diligence_v3.assessed_at, due_diligence.assessed_at, assessments.assessed_at) as "assessedAt",
      assessments.indexed_from as "indexedFrom"
    from quorumx.proposals proposals
    join quorumx.sources sources on sources.id = proposals.source_id
    left join lateral (
      select id, content_hash, fetched_at, normalized_payload
      from quorumx.proposal_revisions
      where proposal_id = proposals.id
      order by fetched_at desc, id desc
      limit 1
    ) revisions on true
    left join lateral (
      select normalized_payload from quorumx.proposal_revisions
      where proposal_id = proposals.id and id <> revisions.id
      order by fetched_at desc, id desc limit 1
    ) previous_revision on true
    left join lateral (
      select id, status, last_error from quorumx.assessment_jobs
      where revision_id = revisions.id order by assessment_version desc, assessment_schema_version desc, created_at desc limit 1
    ) jobs on true
    left join quorumx.assessments assessments on assessments.revision_id = revisions.id
    left join quorumx.due_diligence_assessments due_diligence on due_diligence.revision_id = revisions.id
    left join lateral (
      select * from quorumx.due_diligence_assessments_v3
      where revision_id = revisions.id
      order by assessment_schema_version desc, assessed_at desc, id desc limit 1
    ) due_diligence_v3 on true
    left join lateral (
      select transaction_hash, state
      from quorumx.transactions
      where id = coalesce(due_diligence_v3.transaction_id, due_diligence.transaction_id, assessments.transaction_id)
        or (due_diligence_v3.id is null and due_diligence.id is null and assessments.id is null and job_id = jobs.id)
      order by submitted_at desc
      limit 1
    ) transactions on true
    where proposals.canonical_id = $1
    limit 1
  `, [canonicalId]);
  const row = result.rows[0];
  if (!row) return undefined;
  const { currentRevisionPayload, previousRevisionPayload, ...publicRow } = row;
  return { ...publicRow, changesSincePreviousRevision: revisionChanges(
    previousRevisionPayload as { title?: string; bodyText?: string; choices?: string[] } | undefined,
    currentRevisionPayload as { title?: string; bodyText?: string; choices?: string[] } | undefined,
  ) };
}

export async function getAssessment(client: Client, proposalKey: string): Promise<unknown | undefined> {
  const result = await client.query(`
    select
      assessments.proposal_key as "proposalKey",
      assessments.source_locator_hash as "sourceLocatorHash",
      assessments.content_hash as "contentHash",
      assessments.risk_level as "riskLevel",
      assessments.risk_score as "riskScore",
      assessments.risk_categories as "riskCategories",
      assessments.recommendation,
      assessments.summary,
      assessments.consensus_state as "consensusState",
      assessments.provenance,
      assessments.assessed_at as "assessedAt",
      assessments.indexed_from as "indexedFrom",
      transactions.transaction_hash as "transactionHash",
      transactions.network,
      transactions.contract_address as "contractAddress"
    from quorumx.assessments assessments
    left join quorumx.transactions transactions on transactions.id = assessments.transaction_id
    where assessments.proposal_key = $1
    order by assessments.assessed_at desc
    limit 1
  `, [proposalKey]);
  return result.rows[0];
}

export async function getDueDiligence(client: Client, proposalKey: string): Promise<unknown | undefined> {
  const result = await client.query(`
    select
      due_diligence.record,
      revisions.content_hash as "revisionHash",
      transactions.transaction_hash as "transactionHash",
      transactions.network,
      transactions.contract_address as "contractAddress"
    from quorumx.due_diligence_assessments due_diligence
    join quorumx.proposal_revisions revisions on revisions.id = due_diligence.revision_id
    join quorumx.transactions transactions on transactions.id = due_diligence.transaction_id
    where due_diligence.proposal_key = $1
    order by due_diligence.assessed_at desc, due_diligence.id desc
    limit 1
  `, [proposalKey]);
  const row = result.rows[0];
  return row ? { ...row.record, revisionHash: row.revisionHash, transactionHash: row.transactionHash,
    network: row.network, contractAddress: row.contractAddress } : undefined;
}

export async function getDueDiligenceV3(client: Client, proposalKey: string, schema?: string): Promise<unknown | undefined> {
  if (schema !== undefined && !/^3\.(?:0|1|2|3)$/.test(schema)) throw new RangeError("invalid_assessment_schema");
  const result = await client.query(`
    select
      due_diligence.record,
      revisions.content_hash as "revisionHash",
      transactions.transaction_hash as "transactionHash",
      transactions.network,
      transactions.contract_address as "contractAddress"
    from quorumx.due_diligence_assessments_v3 due_diligence
    join quorumx.proposal_revisions revisions on revisions.id = due_diligence.revision_id
    join quorumx.transactions transactions on transactions.id = due_diligence.transaction_id
    where due_diligence.proposal_key = $1
      and ($2::text is null or due_diligence.assessment_schema_version = $2)
    order by due_diligence.assessment_schema_version desc, due_diligence.assessed_at desc, due_diligence.id desc
    limit 1
  `, [proposalKey, schema ?? null]);
  const row = result.rows[0];
  return row ? { ...row.record, revisionHash: row.revisionHash, transactionHash: row.transactionHash,
    network: row.network, contractAddress: row.contractAddress } : undefined;
}
