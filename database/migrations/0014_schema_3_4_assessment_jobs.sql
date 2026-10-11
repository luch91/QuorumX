-- Permit new immutable Format-3/schema-3.4 jobs without changing any
-- existing job, assessment, backfill, transaction, or migration history.
alter table quorumx.assessment_jobs
  drop constraint if exists assessment_jobs_assessment_schema_version_check;
alter table quorumx.assessment_jobs
  add constraint assessment_jobs_assessment_schema_version_check
  check (assessment_schema_version in ('1', '2', '3.0', '3.1', '3.2', '3.3', '3.4')) not valid;
alter table quorumx.assessment_jobs
  validate constraint assessment_jobs_assessment_schema_version_check;
