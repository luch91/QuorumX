import type { Client } from "pg";

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
  const assessmentStatuses = ["pending", "processing", "submitted", "finalized", "retryable", "failed", "dead_letter"];
  if (assessment && assessment !== "unassessed" && !assessmentStatuses.includes(assessment)) {
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
      jobs.status as "assessmentStatus",
      assessments.risk_level as "riskLevel",
      assessments.risk_score as "riskScore",
      assessments.recommendation,
      assessments.assessed_at as "assessedAt"
    from quorumx.proposals proposals
    join quorumx.sources sources on sources.id = proposals.source_id
    left join lateral (
      select id, content_hash, fetched_at
      from quorumx.proposal_revisions
      where proposal_id = proposals.id
      order by fetched_at desc, id desc
      limit 1
    ) revisions on true
    left join quorumx.assessment_jobs jobs on jobs.revision_id = revisions.id
    left join quorumx.assessments assessments on assessments.revision_id = revisions.id
    where ($1::bigint is null or proposals.id < $1)
      and ($2::text is null or proposals.status = $2)
      and ($3::text is null or sources.configuration ->> 'space' = $3)
      and ($4::text is null or sources.source_key = $4)
      and ($5::text is null or lower(sources.display_name) = $5 or sources.configuration ->> 'space' = $5)
      and ($6::text is null or proposals.author_address = $6)
      and ($7::text is null or ($7 = 'unassessed' and jobs.id is null) or jobs.status = $7)
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
      jobs.status as "assessmentStatus",
      jobs.last_error as "assessmentError",
      transactions.transaction_hash as "transactionHash",
      transactions.state as "transactionState",
      assessments.source_locator_hash as "sourceLocatorHash",
      assessments.content_hash as "assessedContentHash",
      assessments.risk_level as "riskLevel",
      assessments.risk_score as "riskScore",
      assessments.risk_categories as "riskCategories",
      assessments.recommendation,
      assessments.summary,
      assessments.consensus_state as "consensusState",
      assessments.provenance,
      assessments.assessed_at as "assessedAt",
      assessments.indexed_from as "indexedFrom"
    from quorumx.proposals proposals
    join quorumx.sources sources on sources.id = proposals.source_id
    left join lateral (
      select id, content_hash, fetched_at
      from quorumx.proposal_revisions
      where proposal_id = proposals.id
      order by fetched_at desc, id desc
      limit 1
    ) revisions on true
    left join quorumx.assessment_jobs jobs on jobs.revision_id = revisions.id
    left join lateral (
      select transaction_hash, state
      from quorumx.transactions
      where job_id = jobs.id
      order by submitted_at desc
      limit 1
    ) transactions on true
    left join quorumx.assessments assessments on assessments.revision_id = revisions.id
    where proposals.canonical_id = $1
    limit 1
  `, [canonicalId]);
  return result.rows[0];
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
