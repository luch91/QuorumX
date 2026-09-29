alter table quorumx.assessments
  alter column transaction_id drop not null;

alter table quorumx.assessments
  add column if not exists indexed_from text not null default 'submitted_transaction'
  check (indexed_from in ('submitted_transaction', 'existing_contract_state'));

insert into quorumx.sources (
  source_key,
  kind,
  display_name,
  configuration,
  enabled,
  poll_interval_seconds
)
values (
  'snapshot:balancer.eth',
  'snapshot',
  'Balancer governance',
  '{"space":"balancer.eth"}'::jsonb,
  true,
  300
)
on conflict (source_key) do update set
  display_name = excluded.display_name,
  configuration = excluded.configuration,
  enabled = excluded.enabled,
  poll_interval_seconds = excluded.poll_interval_seconds,
  updated_at = now();
