# QuorumX database

QuorumX v0.2 uses Neon Postgres as the durable index for discovered proposals, immutable proposal revisions, assessment jobs, GenLayer transactions, and finalized assessments. GenLayer remains authoritative for risk consensus; Postgres indexes and presents that state. Runtime job claims use row locking with `SKIP LOCKED`, bounded exponential retry, and stale-lock recovery.

## Migration order

Use the Neon direct connection for role provisioning and migrations. Never use a `-pooler` endpoint for schema changes.

```bash
export DATABASE_URL_UNPOOLED='postgresql://...'
export QUORUMX_DATABASE_ROLE_PASSWORD='a generated high-entropy password'
npm run db:provision-role
npm run db:migrate
```

The runtime password belongs in Cloudflare Hyperdrive, not in source control or a Worker variable. `quorumx_runtime` receives schema usage and only the table operations required by the runtime. Accepted assessment tables are append/read only. The role receives no `DELETE`, DDL, ownership, or `neon_superuser` membership.

Migrations are applied alphabetically and recorded with SHA-256 checksums in `public.quorumx_schema_migrations`. Editing an applied migration causes the runner to stop.

## Runtime verification

Set `DATABASE_URL` to the runtime-role connection only for the command invocation:

```bash
npm run db:verify
```

Successful output after migration `0013_bounded_format3_backfill.sql` reports at
least 14 tables, `schema_usage: true`, `proposal_rw: true`,
`due_diligence_rw: true`, both delete privileges `false`, no accepted-record
mutation privilege, no schema creation, and no unsafe role membership. Migration
0006 keeps format 1 assessments intact; migrations 0007-0010 add immutable
observation, acceptance, recovery, audit, and runtime-privilege invariants.
Migration 0011 adds format 3 storage without weakening those invariants, and
0012 adds the current internal format 3 schema/run metadata. 0013 adds bounded,
pausable Format 3 retrospective backfill runs and per-DAO observability. Earlier migration
numbers are never renamed or overwritten.
