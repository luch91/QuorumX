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

drop trigger if exists due_diligence_v3_transaction_revision on quorumx.due_diligence_assessments_v3;
create trigger due_diligence_v3_transaction_revision
before insert or update on quorumx.due_diligence_assessments_v3
for each row execute function quorumx.enforce_assessment_transaction_revision();

drop trigger if exists due_diligence_v3_immutable on quorumx.due_diligence_assessments_v3;
create trigger due_diligence_v3_immutable
before update on quorumx.due_diligence_assessments_v3
for each row execute function quorumx.reject_accepted_assessment_mutation();

create or replace view quorumx.assessment_integrity_issues as
select '1'::text as assessment_version, assessments.id as assessment_id,
  assessments.revision_id, assessments.transaction_id,
  case
    when assessments.transaction_id is null and assessments.indexed_from <> 'existing_contract_state'
      then 'missing_transaction'
    else 'transaction_job_revision_mismatch'
  end as issue
from quorumx.assessments assessments
left join quorumx.transactions transactions on transactions.id = assessments.transaction_id
left join quorumx.assessment_jobs jobs on jobs.id = transactions.job_id
where (assessments.transaction_id is null and assessments.indexed_from <> 'existing_contract_state')
   or (assessments.transaction_id is not null and jobs.revision_id is distinct from assessments.revision_id)
union all
select '2', due_diligence.id, due_diligence.revision_id, due_diligence.transaction_id,
  'transaction_job_revision_mismatch'
from quorumx.due_diligence_assessments due_diligence
left join quorumx.transactions transactions on transactions.id = due_diligence.transaction_id
left join quorumx.assessment_jobs jobs on jobs.id = transactions.job_id
where jobs.revision_id is distinct from due_diligence.revision_id
union all
select '3', due_diligence.id, due_diligence.revision_id, due_diligence.transaction_id,
  'transaction_job_revision_mismatch'
from quorumx.due_diligence_assessments_v3 due_diligence
left join quorumx.transactions transactions on transactions.id = due_diligence.transaction_id
left join quorumx.assessment_jobs jobs on jobs.id = transactions.job_id
where jobs.revision_id is distinct from due_diligence.revision_id;

grant select, insert on quorumx.due_diligence_assessments_v3 to quorumx_runtime;
grant usage, select on sequence quorumx.due_diligence_assessments_v3_id_seq to quorumx_runtime;
revoke update, delete on quorumx.due_diligence_assessments_v3 from quorumx_runtime;
revoke all on quorumx.assessment_integrity_issues from quorumx_runtime;
