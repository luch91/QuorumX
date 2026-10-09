# Operations

QuorumX production runs the Cloudflare Worker on its five-minute schedule with
the runtime-only Postgres role. Use `/health/live` for process liveness and
`/health/ready` for database, migration, source, queue, configuration, and
contract attestations. Never run migrations with the runtime role.

Before a release, follow [the release checklist](RELEASE_CHECKLIST.md). Keep
format 1, format 2, and earlier format 3 records readable. If a submission
outcome is uncertain, reconcile its idempotency key against GenLayer rather
than submitting a second transaction. A rollback changes active configuration;
it does not mutate accepted records.

The logical non-production environment is `staging`. Its existing physical
Cloudflare names retain `v2-dev` for deployment continuity and must not be
renamed without a separately planned resource migration.
