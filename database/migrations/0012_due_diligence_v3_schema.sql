-- Add immutable schema/run identity without rewriting accepted v3.2 records.
alter table quorumx.assessment_jobs
  add column if not exists assessment_schema_version text;
alter table quorumx.assessment_jobs
  add column if not exists assessment_run_id text;
alter table quorumx.assessment_jobs
  add column if not exists is_initial_assessment boolean not null default true;

update quorumx.assessment_jobs
set assessment_schema_version = case assessment_version
  when '1' then '1'
  when '2' then '2'
  else '3.0'
end
where assessment_schema_version is null;

update quorumx.assessment_jobs
set assessment_run_id = 'legacy-job-' || id::text
where assessment_run_id is null;

-- Preserve the pre-format-3 insert API. Older workers provide only
-- assessment_version; the identity value is already assigned before this
-- trigger runs, so it can supply a stable unique run ID without randomness.
create or replace function quorumx.default_assessment_job_schema()
returns trigger
language plpgsql
as $$
begin
  if new.assessment_schema_version is null then
    new.assessment_schema_version := case new.assessment_version
      when '1' then '1'
      when '2' then '2'
      else '3.0'
    end;
  end if;
  if new.assessment_run_id is null then
    new.assessment_run_id := 'legacy-job-' || new.id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists assessment_jobs_default_schema on quorumx.assessment_jobs;
create trigger assessment_jobs_default_schema
before insert on quorumx.assessment_jobs
for each row execute function quorumx.default_assessment_job_schema();

alter table quorumx.assessment_jobs alter column assessment_schema_version set not null;
alter table quorumx.assessment_jobs alter column assessment_run_id set not null;
alter table quorumx.assessment_jobs drop constraint if exists assessment_jobs_assessment_schema_version_check;
alter table quorumx.assessment_jobs add constraint assessment_jobs_assessment_schema_version_check
  check (assessment_schema_version in ('1', '2', '3.0', '3.1', '3.2', '3.3')) not valid;
alter table quorumx.assessment_jobs validate constraint assessment_jobs_assessment_schema_version_check;

drop index if exists quorumx.assessment_jobs_revision_version_idx;
create unique index if not exists assessment_jobs_run_id_idx
  on quorumx.assessment_jobs (assessment_run_id);
create unique index if not exists assessment_jobs_initial_revision_schema_idx
  on quorumx.assessment_jobs (revision_id, assessment_version, assessment_schema_version)
  where is_initial_assessment;

alter table quorumx.due_diligence_assessments_v3
  add column if not exists assessment_schema_version text;
alter table quorumx.due_diligence_assessments_v3
  add column if not exists assessment_run_id text;

update quorumx.due_diligence_assessments_v3
set assessment_schema_version = coalesce(record ->> 'assessmentSchemaVersion', '3.0'),
    assessment_run_id = coalesce(record ->> 'assessmentRunId', 'legacy-v3-' || id::text)
where assessment_schema_version is null or assessment_run_id is null;

alter table quorumx.due_diligence_assessments_v3 alter column assessment_schema_version set not null;
alter table quorumx.due_diligence_assessments_v3 alter column assessment_run_id set not null;
alter table quorumx.due_diligence_assessments_v3
  drop constraint if exists due_diligence_assessments_v3_revision_id_key;
create unique index if not exists due_diligence_assessments_v3_run_id_idx
  on quorumx.due_diligence_assessments_v3 (assessment_run_id);
create index if not exists due_diligence_assessments_v3_revision_schema_idx
  on quorumx.due_diligence_assessments_v3 (revision_id, assessment_schema_version, assessed_at desc);

-- Accepted assessments are append-only for the runtime role.
revoke update, delete on quorumx.due_diligence_assessments_v3 from quorumx_runtime;
grant select, insert on quorumx.due_diligence_assessments_v3 to quorumx_runtime;
