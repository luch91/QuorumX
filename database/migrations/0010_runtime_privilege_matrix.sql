revoke all privileges on all tables in schema quorumx from quorumx_runtime;
revoke all privileges on all sequences in schema quorumx from quorumx_runtime;

grant select, insert, update on quorumx.sources, quorumx.proposals, quorumx.assessment_jobs,
  quorumx.transactions, quorumx.poll_cursors, quorumx.submission_intents to quorumx_runtime;
grant select, insert on quorumx.proposal_revisions, quorumx.proposal_revision_observations,
  quorumx.assessments, quorumx.due_diligence_assessments,
  quorumx.assessment_job_transitions to quorumx_runtime;

grant usage, select on sequence quorumx.sources_id_seq, quorumx.proposals_id_seq,
  quorumx.proposal_revisions_id_seq, quorumx.proposal_revision_observations_id_seq,
  quorumx.assessment_jobs_id_seq, quorumx.transactions_id_seq, quorumx.assessments_id_seq,
  quorumx.due_diligence_assessments_id_seq, quorumx.assessment_job_transitions_id_seq,
  quorumx.submission_intents_id_seq to quorumx_runtime;

revoke all on public.quorumx_schema_migrations from quorumx_runtime;
revoke all on quorumx.assessment_integrity_issues from quorumx_runtime;

alter default privileges in schema quorumx revoke all on tables from quorumx_runtime;
alter default privileges in schema quorumx revoke all on sequences from quorumx_runtime;
