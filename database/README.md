# QuorumX database

QuorumX uses Neon Postgres as the durable index for discovered proposals, immutable proposal revisions, assessment jobs, GenLayer transactions, and finalized assessments. GenLayer remains authoritative for consensus results; Postgres indexes and presents that state. Runtime job claims use row locking with <code>SKIP LOCKED</code>, bounded exponential retry, and stale-lock recovery.

## Migration order

Use the Neon direct connection for role provisioning and migrations. Never use a <code>-pooler</code> endpoint for schema changes.

~~~bash
export DATABASE_URL_UNPOOLED='postgresql://...'
export QUORUMX_DATABASE_ROLE_PASSWORD='a generated high-entropy password'
npm run db:provision-role
npm run db:migrate
~~~

The runtime password belongs in Cloudflare Hyperdrive, not in source control or a Worker variable. <code>quorumx_runtime</code> receives schema usage and only the table operations required by the runtime. Accepted assessment tables are append/read only. The role receives no <code>DELETE</code>, DDL, ownership, or <code>neon_superuser</code> membership.

Migrations are applied in order and recorded with SHA-256 checksums in <code>public.quorumx_schema_migrations</code>. Editing an applied migration causes the runner to stop.

## Runtime verification

Set <code>DATABASE_URL</code> to the runtime-role connection only for the command invocation:

~~~bash
npm run db:verify
~~~

Successful output after migration <code>0013_bounded_format3_backfill.sql</code> reports at least 14 tables, <code>schema_usage: true</code>, <code>proposal_rw: true</code>, <code>due_diligence_rw: true</code>, both delete privileges <code>false</code>, no accepted-record mutation privilege, no schema creation, and no unsafe role membership.

Migration 0006 keeps Format 1 assessments intact. Migrations 0007–0010 add immutable observation, acceptance, recovery, audit, and runtime-privilege invariants. Migration 0011 adds Format 3 storage; 0012 adds internal Format 3 schema/run metadata; and 0013 adds bounded, pausable Format 3 retrospective backfill runs and per-DAO observability. Earlier migration numbers are never renamed or overwritten.
