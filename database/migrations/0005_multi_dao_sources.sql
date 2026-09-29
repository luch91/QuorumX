alter table quorumx.sources
  add column if not exists homepage_url text,
  add column if not exists logo_url text,
  add column if not exists ecosystems jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ecosystems) = 'array'),
  add column if not exists assessment_enabled boolean not null default false,
  add column if not exists daily_assessment_budget smallint not null default 0
    check (daily_assessment_budget between 0 and 100);

alter table quorumx.proposals
  add column if not exists author_address text,
  add column if not exists canonical_url text,
  add column if not exists assessment_eligible boolean not null default false;

alter table quorumx.proposals
  add constraint proposals_author_address_format_check
  check (author_address is null or author_address ~ '^0x[0-9a-f]{40}$') not valid;

alter table quorumx.proposals
  validate constraint proposals_author_address_format_check;

create index if not exists proposals_author_address_idx
  on quorumx.proposals (author_address)
  where author_address is not null;

create index if not exists proposals_source_eligibility_idx
  on quorumx.proposals (source_id, assessment_eligible, id desc);

insert into quorumx.sources (
  source_key, kind, display_name, configuration, enabled, poll_interval_seconds,
  homepage_url, logo_url, ecosystems, assessment_enabled, daily_assessment_budget
)
values
  (
    'snapshot:balancer.eth', 'snapshot', 'Balancer', '{"space":"balancer.eth"}'::jsonb, true, 300,
    'https://vote.balancer.fi', 'https://cdn.stamp.fyi/space/balancer.eth?s=160',
    '["defi","ethereum"]'::jsonb, true, 2
  ),
  (
    'snapshot:safe.eth', 'snapshot', 'SafeDAO', '{"space":"safe.eth"}'::jsonb, true, 300,
    'https://forum.safe.global', 'https://cdn.stamp.fyi/space/safe.eth?s=160',
    '["ethereum","infrastructure","smart-accounts"]'::jsonb, true, 1
  ),
  (
    'snapshot:arbitrumfoundation.eth', 'snapshot', 'Arbitrum DAO',
    '{"space":"arbitrumfoundation.eth"}'::jsonb, true, 300,
    'https://forum.arbitrum.foundation', 'https://cdn.stamp.fyi/space/arbitrumfoundation.eth?s=160',
    '["arbitrum","ethereum","layer-2"]'::jsonb, true, 1
  ),
  (
    'snapshot:ens.eth', 'snapshot', 'ENS DAO', '{"space":"ens.eth"}'::jsonb, true, 300,
    'https://discuss.ens.domains', 'https://cdn.stamp.fyi/space/ens.eth?s=160',
    '["ens","ethereum","identity"]'::jsonb, true, 1
  )
on conflict (source_key) do update set
  display_name = excluded.display_name,
  configuration = excluded.configuration,
  enabled = excluded.enabled,
  poll_interval_seconds = excluded.poll_interval_seconds,
  homepage_url = excluded.homepage_url,
  logo_url = excluded.logo_url,
  ecosystems = excluded.ecosystems,
  assessment_enabled = excluded.assessment_enabled,
  daily_assessment_budget = excluded.daily_assessment_budget,
  updated_at = now();

update quorumx.proposals proposals
set canonical_url = 'https://snapshot.box/#/s:'
    || (sources.configuration ->> 'space')
    || '/proposal/' || proposals.external_id,
    assessment_eligible = proposals.status in ('pending', 'active')
      and (proposals.voting_ends_at is null or proposals.voting_ends_at > now()),
    updated_at = now()
from quorumx.sources sources
where sources.id = proposals.source_id
  and sources.kind = 'snapshot';
