# QuorumX operations runbook

QuorumX 0.4.0 runs the v2 due-diligence path. Checked-in production defaults
enable writes, while `.env.example` keeps local writes disabled until an
operator opts in. Migration `0010_runtime_privilege_matrix.sql` is the minimum
ready schema. Never use production credentials for local validation.

## Local prerequisites

- Node.js 22 and `npm ci`
- Python 3.12 and `python -m pip install -r requirements-dev.txt`
- Docker with an available local port
- Rust 1.98.0 with `wasm32-unknown-unknown` for WASM release validation
- Chrome or Edge for the runtime browser smoke

## Disposable verification

Generate a run ID matching `YYYYMMDDtHHMMSSz-<suffix>`, then run:

```text
npm run test:organization:provision -- --run-id <run-id>
npm run test:organization:e2e -- --run-id <run-id>
npm run test:organization:runtime -- --run-id <run-id>
npm run test:organization:teardown -- --run-id <run-id>
```

Always run teardown in a `finally`/`always` step. A second teardown must also
succeed. Generated manifests and logs live under `.quorumx-e2e/<run-id>/`, are
ignored, and must remain redacted. Failed-run evidence may be retained for no
more than 24 hours locally; CI retains redacted failure artifacts for seven
days.

## Migrate, verify, and deploy

1. Back up or branch the target database.
2. Use the direct administrator connection for `db:provision-role` and
   `db:migrate`; never use the pooled runtime URL.
3. Run `db:verify` as an administrator and separately prove that the runtime
   role has no DDL, DELETE, accepted-record mutation, or privileged membership.
4. Run the commands in [the release checklist](RELEASE_CHECKLIST.md).
5. Set `QUORUMX_RELEASE_COMMIT` to the exact reviewed commit. Configure the
   runtime connection through Hyperdrive and secrets through the platform
   secret store.
6. Deploy the API before the site, verify `/health/live`, then require an
   acceptable `/health/ready` attestation before directing traffic.

Deployment is an operator action. Repository verification does not claim that
Cloudflare branch protection, dashboards, alerts, or secret stores are
configured.

## Monitor and triage

`/health/live` proves only that the Worker can answer. `/health/ready` verifies
the database and reports enabled/stale sources, queue depth, old submitted
transactions, dead-letter/quarantine count, schema migration, release commit,
assessment version, write mode, and contract address.

- `ok`: dependencies and freshness checks pass.
- `degraded`: serve reads, but investigate stale sources, partial polling
  failures, old transactions, or dead-letter growth.
- `unready`: stop promotion or remove the deployment from service; schema or a
  critical dependency is unavailable.

Use correlation IDs to join public failures to restricted logs. Never paste raw
proposal payloads, database URLs, tokens, or private keys into tickets.

For quarantine/dead-letter triage, preserve the immutable record, classify the
safe error category, compare its revision and contract version, and retry only
after the incompatibility is understood. Do not edit an accepted assessment.

For an uncertain external submission, reconcile the recorded submission intent
and transaction hash against readable contract state. Never submit a second
transaction merely because the first response timed out.

## Rollback

1. Disable writes before application rollback.
2. Keep additive migrations in place; do not reverse or edit applied migration
   files during an incident.
3. Restore the last verified Worker version and its matching contract mode.
4. Verify liveness, readiness attestation, one v1 `Afterglow` read, and one v2
   `Halcyon` read before restoring writes.
5. If current code cannot safely read the migrated schema, keep writes disabled
   and forward-fix. Preserve all revision, intent, transaction, and assessment
   history.

## Secrets and test networks

Use separate limited-balance development wallets, least-privilege database
roles, unique administrator tokens, and environment-scoped secrets. Rotate any
credential that appears in output. Public test-network writes require explicit
human authorization naming the network, account, maximum spend, and cleanup.
