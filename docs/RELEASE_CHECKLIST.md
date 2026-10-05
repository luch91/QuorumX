# QuorumX release checklist

Record every result in the release evidence bundle. A mismatch blocks release.

## Repository gates

- [ ] Clean install uses the committed lockfile on Node.js 22.
- [ ] `npm run verify` and `npm audit --audit-level=high` pass.
- [ ] Python 3.12 contract tests and GenVM static lint pass.
- [ ] Rust tests, release WASM build, zero-import/export validation, and v2
      fixture validation pass.
- [ ] Velvet Solace provision, database E2E, Worker/site runtime, browser,
      accessibility, performance, and idempotent teardown pass.
- [ ] Site and API deployment dry-runs pass without production credentials.
- [ ] Documentation/link/configuration parity checks pass.

## Configuration and attestation

- [ ] Package and runtime `serviceVersion` are `0.4.0`.
- [ ] `releaseCommit` equals the reviewed commit and is not `unreleased`.
- [ ] `schemaMigration` is `0010_runtime_privilege_matrix.sql`.
- [ ] `assessmentVersion`, `writesEnabled`, and contract address match the
      approved environment configuration.
- [ ] The v2 contract is readable before v2 writes are enabled.
- [ ] Runtime role privilege verification passes.

## Operator-controlled settings

Verify these in their authoritative consoles; the repository cannot attest to
them:

- [ ] Protected `main` requires all CI jobs and dismisses stale approvals.
- [ ] Cloudflare routes, Hyperdrive, secrets, log retention, and alerts target
      the approved environment.
- [ ] Neon backup/branch and connection limits are suitable for rollback.
- [ ] Scheduled-smoke and failed-cron alerts reach an actively monitored route.
- [ ] Signing wallet is environment-specific, limited-balance, and funded only
      within the approved test-network budget.

## Promotion and rollback decision

- [ ] Release evidence contains no secret or raw connection string.
- [ ] Residual risks and approval-required external checks are recorded.
- [ ] Rollback owner, previous Worker version, and write-disable mechanism are
      known before promotion.
- [ ] Post-promotion liveness, readiness, v1 compatibility, v2 provenance, and
      public site checks pass.
