create or replace function quorumx.enforce_assessment_transaction_revision()
returns trigger
language plpgsql
as $$
begin
  if new.transaction_id is null then
    if tg_table_name <> 'assessments' or new.indexed_from <> 'existing_contract_state' then
      raise exception 'assessment transaction is required for this indexed source';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from quorumx.transactions transactions
    join quorumx.assessment_jobs jobs on jobs.id = transactions.job_id
    where transactions.id = new.transaction_id
      and jobs.revision_id = new.revision_id
  ) then
    raise exception 'assessment transaction job revision does not match assessment revision';
  end if;
  return new;
end;
$$;

create or replace function quorumx.reject_accepted_assessment_mutation()
returns trigger
language plpgsql
as $$
begin
  if new is distinct from old then
    raise exception 'accepted assessment rows are immutable';
  end if;
  return old;
end;
$$;

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
where jobs.revision_id is distinct from due_diligence.revision_id;

drop trigger if exists assessments_transaction_revision on quorumx.assessments;
create trigger assessments_transaction_revision
before insert or update on quorumx.assessments
for each row execute function quorumx.enforce_assessment_transaction_revision();

drop trigger if exists assessments_immutable on quorumx.assessments;
create trigger assessments_immutable
before update on quorumx.assessments
for each row execute function quorumx.reject_accepted_assessment_mutation();

drop trigger if exists due_diligence_transaction_revision on quorumx.due_diligence_assessments;
create trigger due_diligence_transaction_revision
before insert or update on quorumx.due_diligence_assessments
for each row execute function quorumx.enforce_assessment_transaction_revision();

drop trigger if exists due_diligence_immutable on quorumx.due_diligence_assessments;
create trigger due_diligence_immutable
before update on quorumx.due_diligence_assessments
for each row execute function quorumx.reject_accepted_assessment_mutation();

revoke update on quorumx.assessments from quorumx_runtime;
revoke update on quorumx.due_diligence_assessments from quorumx_runtime;
revoke all on quorumx.assessment_integrity_issues from quorumx_runtime;
