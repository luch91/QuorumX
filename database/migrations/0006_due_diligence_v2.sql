-- Preserve every v1 assessment and transaction. A revision may have one job per
-- assessment model, so a v2 reassessment never replaces its legacy provenance.
alter table quorumx.assessment_jobs
  add column if not exists assessment_version text not null default '1'
    check (assessment_version in ('1', '2'));

alter table quorumx.assessment_jobs
  drop constraint if exists assessment_jobs_revision_id_key;

create unique index if not exists assessment_jobs_revision_version_idx
  on quorumx.assessment_jobs (revision_id, assessment_version);

create table if not exists quorumx.due_diligence_assessments (
  id bigint generated always as identity primary key,
  revision_id bigint not null unique references quorumx.proposal_revisions(id) on delete restrict,
  transaction_id bigint not null unique references quorumx.transactions(id) on delete restrict,
  proposal_key text not null,
  source_locator_hash text not null check (source_locator_hash ~ '^[0-9a-f]{64}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  record jsonb not null check (
    jsonb_typeof(record) = 'object'
    and record ->> 'assessmentVersion' = '2'
    and octet_length(record::text) <= 25000
  ),
  consensus_state text not null default 'accepted' check (consensus_state = 'accepted'),
  provenance text not null check (provenance in ('live', 'fixture')),
  assessed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists due_diligence_assessments_proposal_key_idx
  on quorumx.due_diligence_assessments (proposal_key, assessed_at desc);

grant select, insert, update on quorumx.due_diligence_assessments to quorumx_runtime;
grant usage, select on sequence quorumx.due_diligence_assessments_id_seq to quorumx_runtime;
