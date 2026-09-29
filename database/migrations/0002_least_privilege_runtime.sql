grant usage on schema quorumx to quorumx_runtime;
grant select, insert, update on all tables in schema quorumx to quorumx_runtime;
grant usage, select on all sequences in schema quorumx to quorumx_runtime;

alter default privileges in schema quorumx
  grant select, insert, update on tables to quorumx_runtime;
alter default privileges in schema quorumx
  grant usage, select on sequences to quorumx_runtime;
