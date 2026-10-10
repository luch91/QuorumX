-- Bounded, observable Format 3 historical backfill. Live jobs remain the default.
alter table quorumx.assessment_jobs add column if not exists job_kind text not null default 'live';
alter table quorumx.assessment_jobs add column if not exists backfill_run_id bigint;
alter table quorumx.assessment_jobs drop constraint if exists assessment_jobs_job_kind_check;
alter table quorumx.assessment_jobs add constraint assessment_jobs_job_kind_check check (job_kind in ('live', 'backfill'));

create table if not exists quorumx.backfill_runs (
  id bigint generated always as identity primary key,
  status text not null check (status in ('dry_run', 'running', 'paused', 'completed')),
  per_dao_limit integer not null check (per_dao_limit between 1 and 25),
  total_limit integer not null check (total_limit between 1 and 100),
  window_days integer not null check (window_days between 1 and 90),
  daily_submission_budget integer not null check (daily_submission_budget between 1 and 25),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);

create table if not exists quorumx.backfill_candidates (
  id bigint generated always as identity primary key,
  run_id bigint not null references quorumx.backfill_runs(id) on delete restrict,
  revision_id bigint not null references quorumx.proposal_revisions(id) on delete restrict,
  dao_name text not null,
  state text not null check (state in ('eligible','queued','processing','accepted','skipped','retrying','failed')),
  reason text, job_id bigint,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (run_id, revision_id)
);

alter table quorumx.assessment_jobs drop constraint if exists assessment_jobs_backfill_run_id_fkey;
alter table quorumx.assessment_jobs add constraint assessment_jobs_backfill_run_id_fkey
  foreign key (backfill_run_id) references quorumx.backfill_runs(id) on delete restrict;
alter table quorumx.assessment_jobs add constraint assessment_jobs_backfill_identity_unique
  unique (id, backfill_run_id, revision_id);
alter table quorumx.backfill_candidates add constraint backfill_candidates_job_identity_fkey
  foreign key (job_id, run_id, revision_id)
  references quorumx.assessment_jobs(id, backfill_run_id, revision_id) on delete restrict;
alter table quorumx.assessment_jobs drop constraint if exists assessment_jobs_backfill_shape_check;
alter table quorumx.assessment_jobs add constraint assessment_jobs_backfill_shape_check
  check ((job_kind = 'live' and backfill_run_id is null) or (job_kind = 'backfill' and backfill_run_id is not null)) not valid;
alter table quorumx.assessment_jobs validate constraint assessment_jobs_backfill_shape_check;

create index if not exists assessment_jobs_kind_claim_idx on quorumx.assessment_jobs (job_kind, next_poll_at, id)
  where status in ('pending','retryable','processing');
create index if not exists assessment_jobs_backfill_processing_idx
  on quorumx.assessment_jobs (backfill_run_id, locked_at) where job_kind = 'backfill' and status = 'processing';
create index if not exists assessment_jobs_backfill_run_idx
  on quorumx.assessment_jobs (backfill_run_id, id) where job_kind = 'backfill';
create index if not exists backfill_candidates_run_state_idx on quorumx.backfill_candidates (run_id, state, id);
create unique index if not exists backfill_runs_one_active_idx on quorumx.backfill_runs ((true))
  where status in ('running','paused');

grant select, insert, update on quorumx.backfill_runs, quorumx.backfill_candidates to quorumx_runtime;
grant usage, select on sequence quorumx.backfill_runs_id_seq, quorumx.backfill_candidates_id_seq to quorumx_runtime;
