alter table quorumx.assessment_jobs
  add column if not exists next_poll_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists poll_attempt_count integer not null default 0 check (poll_attempt_count >= 0);

alter table quorumx.sources
  add column if not exists consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  add column if not exists next_poll_at timestamptz not null default now();

update quorumx.assessment_jobs
set next_poll_at = available_at
where next_poll_at is null;

alter table quorumx.assessment_jobs
  alter column next_poll_at set default now(),
  alter column next_poll_at set not null;

create index if not exists assessment_jobs_fair_claim_idx
  on quorumx.assessment_jobs (assessment_version, attempt_count, next_poll_at, id)
  where status in ('pending', 'retryable', 'processing');

create table if not exists quorumx.assessment_job_transitions (
  id bigint generated always as identity primary key,
  job_id bigint not null references quorumx.assessment_jobs(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  actor text,
  occurred_at timestamptz not null default now()
);

create table if not exists quorumx.submission_intents (
  id bigint generated always as identity primary key,
  job_id bigint not null unique references quorumx.assessment_jobs(id) on delete cascade,
  idempotency_key text not null unique,
  state text not null default 'prepared' check (state in ('prepared', 'recorded', 'reconciled', 'abandoned')),
  transaction_hash text,
  prepared_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'prepared' and transaction_hash is null) or state <> 'prepared')
);

create index if not exists assessment_job_transitions_job_idx
  on quorumx.assessment_job_transitions (job_id, occurred_at, id);

create or replace function quorumx.audit_assessment_job_transition()
returns trigger language plpgsql as $$
begin
  if old.status is distinct from new.status then
    insert into quorumx.assessment_job_transitions (job_id, from_status, to_status, reason, actor)
    values (new.id, old.status, new.status, new.last_error, new.locked_by);
  end if;
  return new;
end;
$$;

create or replace function quorumx.enforce_assessment_job_transition()
returns trigger language plpgsql as $$
begin
  if old.status = new.status then return new; end if;
  if (old.status in ('pending', 'retryable') and new.status in ('processing', 'dead_letter'))
    or (old.status = 'processing' and new.status in ('submitted', 'finalized', 'retryable', 'dead_letter'))
    or (old.status = 'submitted' and new.status in ('finalized', 'retryable', 'dead_letter')) then
    return new;
  end if;
  raise exception 'illegal assessment job transition: % -> %', old.status, new.status;
end;
$$;

drop trigger if exists assessment_jobs_enforce_transition on quorumx.assessment_jobs;
create trigger assessment_jobs_enforce_transition
before update of status on quorumx.assessment_jobs
for each row execute function quorumx.enforce_assessment_job_transition();

drop trigger if exists assessment_jobs_audit_transition on quorumx.assessment_jobs;
create trigger assessment_jobs_audit_transition
after update of status on quorumx.assessment_jobs
for each row execute function quorumx.audit_assessment_job_transition();

grant select, insert on quorumx.assessment_job_transitions to quorumx_runtime;
grant usage, select on sequence quorumx.assessment_job_transitions_id_seq to quorumx_runtime;
grant select, insert, update on quorumx.submission_intents to quorumx_runtime;
grant usage, select on sequence quorumx.submission_intents_id_seq to quorumx_runtime;
