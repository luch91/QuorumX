alter table quorumx.proposals
  add column if not exists current_revision_id bigint;

create unique index if not exists proposal_revisions_proposal_id_id_idx
  on quorumx.proposal_revisions (proposal_id, id);

create table if not exists quorumx.proposal_revision_observations (
  id bigint generated always as identity primary key,
  proposal_id bigint not null references quorumx.proposals(id) on delete cascade,
  revision_id bigint not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (proposal_id, revision_id)
    references quorumx.proposal_revisions(proposal_id, id) on delete cascade
);

create index if not exists proposal_revision_observations_current_idx
  on quorumx.proposal_revision_observations (proposal_id, observed_at desc, id desc);

create unique index if not exists proposal_revision_observations_proposal_id_id_idx
  on quorumx.proposal_revision_observations (proposal_id, id);

insert into quorumx.proposal_revision_observations (proposal_id, revision_id, observed_at, created_at)
select revisions.proposal_id, revisions.id, revisions.fetched_at, revisions.created_at
from quorumx.proposal_revisions revisions
where not exists (
  select 1 from quorumx.proposal_revision_observations observations
  where observations.proposal_id = revisions.proposal_id
    and observations.revision_id = revisions.id
    and observations.observed_at = revisions.fetched_at
);

update quorumx.proposals proposals
set current_revision_id = (
  select revisions.id
  from quorumx.proposal_revisions revisions
  where revisions.proposal_id = proposals.id
  order by revisions.fetched_at desc, revisions.id desc
  limit 1
)
where proposals.current_revision_id is null
  and exists (select 1 from quorumx.proposal_revisions revisions where revisions.proposal_id = proposals.id);

alter table quorumx.proposals
  add column if not exists current_observation_id bigint;

update quorumx.proposals proposals
set current_observation_id = (
  select observations.id
  from quorumx.proposal_revision_observations observations
  where observations.proposal_id = proposals.id
  order by observations.observed_at desc, observations.id desc
  limit 1
)
where proposals.current_observation_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'proposals_current_revision_matches_proposal_fk'
  ) then
    alter table quorumx.proposals
      add constraint proposals_current_revision_matches_proposal_fk
      foreign key (id, current_revision_id)
      references quorumx.proposal_revisions(proposal_id, id)
      on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'proposals_current_observation_matches_proposal_fk'
  ) then
    alter table quorumx.proposals
      add constraint proposals_current_observation_matches_proposal_fk
      foreign key (id, current_observation_id)
      references quorumx.proposal_revision_observations(proposal_id, id)
      on delete restrict;
  end if;
end $$;

grant select, insert on quorumx.proposal_revision_observations to quorumx_runtime;
grant usage, select on sequence quorumx.proposal_revision_observations_id_seq to quorumx_runtime;
