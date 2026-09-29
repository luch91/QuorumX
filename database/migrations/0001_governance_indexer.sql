create schema if not exists quorumx;

create table if not exists quorumx.sources (
  id bigint generated always as identity primary key,
  source_key text not null unique,
  kind text not null check (kind in ('snapshot', 'gen', 'public_url')),
  display_name text not null,
  configuration jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  poll_interval_seconds integer not null default 300 check (poll_interval_seconds between 60 and 86400),
  last_polled_at timestamptz,
  last_succeeded_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quorumx.poll_cursors (
  source_id bigint primary key references quorumx.sources(id) on delete cascade,
  cursor jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists quorumx.proposals (
  id bigint generated always as identity primary key,
  source_id bigint not null references quorumx.sources(id) on delete restrict,
  external_id text not null,
  canonical_id text not null unique,
  title text not null,
  body_text text not null,
  choices jsonb not null default '[]'::jsonb check (jsonb_typeof(choices) = 'array'),
  linked_evidence_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(linked_evidence_urls) = 'array'),
  status text not null check (status in ('pending', 'active', 'closed', 'unknown')),
  submitted_at timestamptz,
  voting_starts_at timestamptz,
  voting_ends_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create index if not exists proposals_source_id_idx on quorumx.proposals (source_id);
create index if not exists proposals_status_voting_ends_idx on quorumx.proposals (status, voting_ends_at);

create table if not exists quorumx.proposal_revisions (
  id bigint generated always as identity primary key,
  proposal_id bigint not null references quorumx.proposals(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  normalized_payload jsonb not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (proposal_id, content_hash)
);

create index if not exists proposal_revisions_proposal_id_idx on quorumx.proposal_revisions (proposal_id);

create table if not exists quorumx.assessment_jobs (
  id bigint generated always as identity primary key,
  revision_id bigint not null unique references quorumx.proposal_revisions(id) on delete cascade,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'submitted', 'finalized', 'retryable', 'failed', 'dead_letter')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  transaction_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists assessment_jobs_claim_idx
  on quorumx.assessment_jobs (available_at, id)
  where status in ('pending', 'retryable');

create table if not exists quorumx.transactions (
  id bigint generated always as identity primary key,
  job_id bigint not null references quorumx.assessment_jobs(id) on delete cascade,
  network text not null,
  contract_address text not null,
  runner_hash text,
  transaction_hash text not null unique,
  state text not null check (state in ('submitted', 'accepted', 'undetermined', 'reverted')),
  evidence jsonb not null default '{}'::jsonb,
  error text,
  submitted_at timestamptz not null default now(),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transactions_job_id_idx on quorumx.transactions (job_id);
create index if not exists transactions_state_submitted_at_idx on quorumx.transactions (state, submitted_at);

create table if not exists quorumx.assessments (
  id bigint generated always as identity primary key,
  revision_id bigint not null unique references quorumx.proposal_revisions(id) on delete restrict,
  transaction_id bigint not null unique references quorumx.transactions(id) on delete restrict,
  proposal_key text not null,
  source_locator_hash text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  risk_score smallint not null check (risk_score between 0 and 100),
  risk_categories jsonb not null default '[]'::jsonb check (jsonb_typeof(risk_categories) = 'array'),
  recommendation text not null check (recommendation in ('allow', 'manual_review', 'block')),
  summary text not null,
  consensus_state text not null default 'accepted' check (consensus_state = 'accepted'),
  provenance text not null check (provenance in ('live', 'fixture')),
  assessed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists assessments_proposal_key_assessed_at_idx
  on quorumx.assessments (proposal_key, assessed_at desc);
create index if not exists assessments_risk_level_assessed_at_idx
  on quorumx.assessments (risk_level, assessed_at desc);
