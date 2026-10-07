-- Additive v3 storage. Existing v1/v2 rows, constraints, and contract records stay intact.
alter table quorumx.assessment_jobs
  drop constraint if exists assessment_jobs_assessment_version_check;

alter table quorumx.assessment_jobs
  add constraint assessment_jobs_assessment_version_check
  check (assessment_version in ('1', '2', '3')) not valid;

alter table quorumx.assessment_jobs
  validate constraint assessment_jobs_assessment_version_check;

create table if not exists quorumx.due_diligence_assessments_v3 (
  id bigint generated always as identity primary key,
  revision_id bigint not null unique references quorumx.proposal_revisions(id) on delete restrict,
  transaction_id bigint not null unique references quorumx.transactions(id) on delete restrict,
  proposal_key text not null,
  source_locator_hash text not null check (source_locator_hash ~ '^[0-9a-f]{64}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  record jsonb not null check (
    jsonb_typeof(record) = 'object'
    and record ->> 'assessmentVersion' = '3'
    and octet_length(record::text) <= 25000
  ),
  consensus_state text not null default 'accepted' check (consensus_state = 'accepted'),
  provenance text not null check (provenance in ('live', 'fixture')),
  assessed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index due_diligence_assessments_v3_proposal_key_idx
  on quorumx.due_diligence_assessments_v3 (proposal_key, assessed_at desc);

grant select, insert, update on quorumx.due_diligence_assessments_v3 to quorumx_runtime;
grant usage, select on sequence quorumx.due_diligence_assessments_v3_id_seq to quorumx_runtime;
