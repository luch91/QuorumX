import type { Client } from "pg";
import { revisionChanges } from "./revision_changes";

function boundedLimit(url: URL): number {
  const parsed = Number(url.searchParams.get("limit") ?? "20");
  return Number.isInteger(parsed) ? Math.max(1, Math.min(parsed, 100)) : 20;
}

function cursorScope(url: URL): string {
  return [...url.searchParams.entries()].filter(([key]) => key !== "cursor")
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
}

function cursor(url: URL): { id: number; priorityRank?: number } | undefined {
  const raw = url.searchParams.get("cursor");
  if (!raw) return undefined;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as Record<string, unknown>;
    if (!Number.isSafeInteger(parsed.id) || Number(parsed.id) <= 0 || parsed.scope !== cursorScope(url)
      || (parsed.priorityRank !== undefined && !Number.isInteger(parsed.priorityRank))) throw new Error();
    return { id: Number(parsed.id), ...(parsed.priorityRank === undefined ? {} : { priorityRank: Number(parsed.priorityRank) }) };
  } catch { throw new RangeError("invalid_cursor"); }
}

function encodeCursor(url: URL, id: string, priorityRank?: number): string {
  return btoa(JSON.stringify({ id: Number(id), scope: cursorScope(url), ...(priorityRank === undefined ? {} : { priorityRank }) }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
  const pageCursor = cursor(url);
  const status = url.searchParams.get("status");
  const space = url.searchParams.get("space")?.trim().toLowerCase();
  const source = url.searchParams.get("source")?.trim().toLowerCase();
  const dao = url.searchParams.get("dao")?.trim().toLowerCase();
  const author = url.searchParams.get("author")?.trim().toLowerCase();
  const assessment = url.searchParams.get("assessment")?.trim().toLowerCase();
  const ecosystem = url.searchParams.get("ecosystem")?.trim().toLowerCase();
  const query = url.searchParams.get("q")?.trim().toLowerCase();
  const sort = url.searchParams.get("sort")?.trim().toLowerCase() ?? "newest";
  if (status && !["pending", "active", "closed", "unknown"].includes(status)) {
    throw new RangeError("invalid_status");
  }
  if (author && !/^0x[0-9a-f]{40}$/.test(author)) throw new RangeError("invalid_author");
  if (dao && (dao.length > 100 || !/^[a-z0-9 ._-]+$/.test(dao))) throw new RangeError("invalid_dao");
  const assessmentStatuses = ["pending", "processing", "submitted", "finalized", "retryable", "failed", "dead_letter"];
  if (assessment && assessment !== "unassessed" && !assessmentStatuses.includes(assessment)) {
    throw new RangeError("invalid_assessment");
  }
  if (ecosystem && !/^[a-z0-9][a-z0-9-]{0,49}$/.test(ecosystem)) throw new RangeError("invalid_ecosystem");
  if (query && query.length > 200) throw new RangeError("invalid_query");
  if (!["newest", "priority"].includes(sort)) throw new RangeError("invalid_sort");
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
      current_observation.observed_at as "revisionFetchedAt",
      jobs.status as "assessmentStatus",
      case when due_diligence.id is not null then '2' when assessments.id is not null then '1' else null end as "assessmentVersion",
      due_diligence.record ->> 'reviewPriority' as "reviewPriority",
      case when due_diligence.id is not null then jsonb_array_length(due_diligence.record -> 'findings') else null end as "findingCount",
      case when due_diligence.id is not null then jsonb_array_length(due_diligence.record -> 'materialClaims') else null end as "claimCount",
      case when due_diligence.id is not null then jsonb_array_length(due_diligence.record -> 'unresolvedQuestions') else null end as "unresolvedCount",
      assessments.risk_level as "riskLevel",
      assessments.risk_score as "riskScore",
      assessments.recommendation,
      coalesce(due_diligence.assessed_at, assessments.assessed_at) as "assessedAt"
      ,case due_diligence.record ->> 'reviewPriority'
        when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 when 'low' then 1 else 0 end as "priorityRank"
    from quorumx.proposals proposals
    join quorumx.sources sources on sources.id = proposals.source_id
    left join quorumx.proposal_revisions revisions on revisions.id = proposals.current_revision_id
    left join quorumx.proposal_revision_observations current_observation
      on current_observation.id = proposals.current_observation_id
    left join lateral (
      select id, status from quorumx.assessment_jobs
      where revision_id = revisions.id order by assessment_version desc limit 1
    ) jobs on true
    left join quorumx.assessments assessments on assessments.revision_id = revisions.id
    left join quorumx.due_diligence_assessments due_diligence on due_diligence.revision_id = revisions.id
    left join lateral (
      select transaction_hash from quorumx.transactions
      where job_id = jobs.id order by submitted_at desc limit 1
    ) latest_transaction on true
    where (($10::text = 'priority' and ($11::integer is null
          or case due_diligence.record ->> 'reviewPriority' when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 when 'low' then 1 else 0 end < $11
          or (case due_diligence.record ->> 'reviewPriority' when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 when 'low' then 1 else 0 end = $11 and proposals.id < $1)))
        or ($10::text = 'newest' and ($1::bigint is null or proposals.id < $1)))
      and ($2::text is null or proposals.status = $2)
      and ($3::text is null or sources.configuration ->> 'space' = $3)
      and ($4::text is null or sources.source_key = $4)
      and ($5::text is null or lower(sources.display_name) = $5 or sources.configuration ->> 'space' = $5)
      and ($6::text is null or proposals.author_address = $6)
      and ($7::text is null or ($7 = 'unassessed' and jobs.id is null) or jobs.status = $7)
      and ($8::text is null or sources.ecosystems ? $8)
      and ($9::text is null or lower(proposals.title) like '%' || $9 || '%'
        or lower(proposals.canonical_id) like '%' || $9 || '%'
        or lower(sources.source_key) like '%' || $9 || '%'
        or lower(sources.display_name) like '%' || $9 || '%'
        or lower(coalesce(proposals.author_address, '')) = $9
        or lower(coalesce(latest_transaction.transaction_hash, '')) = $9)
    order by
      case when $10 = 'priority' then case due_diligence.record ->> 'reviewPriority'
        when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 when 'low' then 1 else 0 end end desc,
      proposals.id desc
    limit $12
  `, [pageCursor?.id ?? null, status ?? null, space ?? null, source ?? null, dao ?? null,
    author ?? null, assessment ?? null, ecosystem ?? null, query || null, sort,
    pageCursor?.priorityRank ?? null, limit + 1]);
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  return {
    data: rows,
    page: {
      limit,
      nextCursor: hasMore && rows.at(-1) ? encodeCursor(url, rows.at(-1).id,
        sort === "priority" ? Number(rows.at(-1).priorityRank) : undefined) : null,
      scope: "all_matching_proposals",
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
      current_observation.observed_at as "revisionFetchedAt",
      revisions.normalized_payload as "currentRevisionPayload",
      previous_revision.normalized_payload as "previousRevisionPayload",
      jobs.status as "assessmentStatus",
      jobs.last_error as "assessmentError",
      case when due_diligence.id is not null then '2' when assessments.id is not null then '1' else null end as "assessmentVersion",
      due_diligence.record as "dueDiligence",
      transactions.transaction_hash as "transactionHash",
      transactions.state as "transactionState",
      assessments.source_locator_hash as "sourceLocatorHash",
      assessments.content_hash as "assessedContentHash",
      assessments.risk_level as "riskLevel",
      assessments.risk_score as "riskScore",
      assessments.risk_categories as "riskCategories",
      assessments.recommendation,
      assessments.summary,
      coalesce(due_diligence.consensus_state, assessments.consensus_state) as "consensusState",
      coalesce(due_diligence.provenance, assessments.provenance) as provenance,
      coalesce(due_diligence.assessed_at, assessments.assessed_at) as "assessedAt",
      assessments.indexed_from as "indexedFrom"
    from quorumx.proposals proposals
    join quorumx.sources sources on sources.id = proposals.source_id
    left join quorumx.proposal_revisions revisions on revisions.id = proposals.current_revision_id
    left join quorumx.proposal_revision_observations current_observation
      on current_observation.id = proposals.current_observation_id
    left join lateral (
      select previous_revisions.normalized_payload
      from quorumx.proposal_revision_observations observations
      join quorumx.proposal_revisions previous_revisions on previous_revisions.id = observations.revision_id
      where observations.proposal_id = proposals.id
      order by observations.observed_at desc, observations.id desc offset 1 limit 1
    ) previous_revision on true
    left join lateral (
      select id, status, last_error from quorumx.assessment_jobs
      where revision_id = revisions.id order by assessment_version desc limit 1
    ) jobs on true
    left join quorumx.assessments assessments on assessments.revision_id = revisions.id
    left join quorumx.due_diligence_assessments due_diligence on due_diligence.revision_id = revisions.id
    left join lateral (
      select transaction_hash, state
      from quorumx.transactions
      where id = coalesce(due_diligence.transaction_id, assessments.transaction_id)
        or (due_diligence.id is null and assessments.id is null and job_id = jobs.id)
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
