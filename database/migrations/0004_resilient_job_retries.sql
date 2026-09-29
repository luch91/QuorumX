alter table quorumx.assessment_jobs
  alter column max_attempts set default 20;

update quorumx.assessment_jobs
set max_attempts = 20,
    updated_at = now()
where status in ('pending', 'processing', 'submitted', 'retryable')
  and max_attempts < 20;
