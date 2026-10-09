# Release checklist

1. Run `npm ci` and `npm run verify`.
2. Run the Python contract, GenVM static, semantic, direct-mode, and local
   integration checks from CI.
3. Provision a disposable database with `npm run test:organization:provision`,
   run the Postgres and browser/runtime workflows, and always tear it down.
4. Confirm migrations are append-only, checksummed, and ordered through
   `0012_due_diligence_v3_schema.sql`.
5. Confirm the runtime role has no accepted-record update/delete, DDL, schema
   ownership, or broad administrative membership.
6. Run the dependency audit and full-history secret scan.
7. Verify `/health/ready` reports matching configuration, migrations, contract,
   source freshness, and queue state before enabling writes.
8. Run the read-only Studionet smoke. Any write verification requires a
   separately authorized limited-balance credential.

Rollback changes the active Worker/configuration only. It must never rewrite or
delete an accepted format 1, format 2, or format 3 record.
