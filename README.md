# QuorumX

[![CI](https://github.com/luch91/QuorumX/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/luch91/QuorumX/actions/workflows/ci.yml) [![Living Index](https://img.shields.io/badge/Living_Index-quorumx.dev-D4AF37)](https://quorumx.dev/) [![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE) [![Contributing](https://img.shields.io/badge/Contributing-guide-2ea44f)](CONTRIBUTING.md) [![Security](https://img.shields.io/badge/Security-policy-8b5cf6)](SECURITY.md) [![Built on GenLayer](https://img.shields.io/badge/Built_on-GenLayer-f4b942)](https://genlayer.com/) [![GitHub stars](https://img.shields.io/github/stars/luch91/QuorumX?style=flat)](https://github.com/luch91/QuorumX/stargazers)

QuorumX is a public, multi-DAO governance due-diligence index. It discovers
Snapshot proposal revisions, submits bounded analysis to GenLayer, persists
accepted assessments immutably, and exposes them through an API and Living
Index.

The current index covers Balancer, SafeDAO, Arbitrum DAO, and ENS DAO.

## What QuorumX publishes

For each assessed proposal QuorumX records:

- the proposal action, assets, recipients, and control changes;
- material proposal assertions and independently checked claim status;
- evidence references, authority, retrieval scope, and content hashes;
- safeguards that are present, explicitly absent, not identified, or unknown;
- execution steps, actors, human and technical dependencies, impact, and
  reversibility;
- unresolved questions and material revision changes; and
- an inspectable review priority, never a voting recommendation.

`unverified` does not mean false. `not_identified` means a safeguard was not
found in the bounded reviewed material; it is not proof that the safeguard
does not exist.

## Architecture

```text
Snapshot proposal and revision
        |
        v
Cloudflare Worker indexer and durable job queue
        |
        v
GenLayer validators retrieve canonical proposal material
        |
        v
Bounded evidence adapters and deterministic format-3 derivation
        |
        v
Accepted transaction and exact content-hash verification
        |
        v
Immutable Postgres assessment record
        |
        v
Public API and Living Index
```

Validators independently retrieve proposal material and derive the same
deterministic format-3 record. Controlled external evidence currently covers
dual-provider Ethereum Safe state, bounded Blockscout transfers, and related
Snapshot governance history. Provider responses are evidence with recorded
authority; they are not represented as cryptographic state proofs.

## Assessment formats

- **Format 1:** legacy score records, retained read-only for compatibility.
- **Format 2:** proposal-grounded structured due diligence.
- **Format 3:** evidence-backed structured due diligence.

Internal schema identifiers such as `3.1`, `3.2`, and `3.3` preserve the exact
meaning of already accepted records. They are not public product versions.
Historical contracts and records remain readable and are never silently
rewritten. See [format history](docs/FORMAT_HISTORY.md) and
[revision compatibility](docs/revision-and-assessment-compatibility.md).

## Repository map

```text
contracts/       GenLayer intelligent contracts and contract tests
database/        append-only migrations and database documentation
workers/api/     indexer, queue, persistence, and public API
workers/site/    static-site Worker and API proxy
frontend/        Living Index and particle renderer source
app/             current QuorumX CLI, Snapshot, and GenLayer clients
fixtures/        deterministic compatibility and assessment fixtures
scripts/         validation, migration, runtime, and release tooling
docs/            operations, release, format, and compatibility records
```

Earlier DWCS, Sentinel, and Telegraph experiments are preserved in Git
history only. They are not part of the QuorumX runtime, release process, or
fallback behavior.

## Local verification

Requirements:

- Node.js 22
- Python 3.12
- Docker for disposable Postgres/runtime tests

```bash
npm ci
npm run verify
py -3.12 -m pytest contracts/tests -q
```

On Linux, run the five-validator local consensus test with:

```bash
npm run test:genlayer:integration
```

Additional release gates:

```bash
npm run test:organization:e2e
npm run test:release
npm audit --audit-level=high
```

`npm run test:ci` builds the generated particle renderer before running tests.
The generated bundle is intentionally not tracked.

## Configuration

Copy `.env.example` to `.env` for local commands. Never commit private keys,
database credentials, or administrative tokens.

Important variables include:

- `QUORUMX_SNAPSHOT_SPACES`
- `QUORUMX_GENLAYER_NETWORK`
- `QUORUMX_GENLAYER_RPC_URL`
- `QUORUMX_CONTRACT_ADDRESS`
- `QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS`
- `QUORUMX_DUE_DILIGENCE_V3_CONTRACT_ADDRESS`
- `QUORUMX_ASSESSMENT_VERSION`
- `QUORUMX_ASSESSMENT_SCHEMA_VERSION`
- `QUORUMX_ENABLE_WRITES`
- `QUORUMX_GENLAYER_PRIVATE_KEY`
- `QUORUMX_ADMIN_TOKEN`
- `DATABASE_URL_UNPOOLED`

Writes are disabled unless explicitly enabled. Read-only proposal discovery and
assessment retrieval do not require a wallet.

## Operations and deployment

Database migrations are ordered and append-only. Existing migrations must
never be renamed or modified after release. Apply them with a migration-capable
database role and run application traffic through the least-privilege runtime
role.

Cloudflare configuration lives in `wrangler.jsonc` and
`wrangler.site.jsonc`. Deployment commands build the frontend particle bundle
before publishing assets.

Operational procedures and release evidence requirements are documented in:

- [Operations](docs/OPERATIONS.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Database documentation](database/README.md)
- [Contract documentation](contracts/README.md)
- [Worker documentation](workers/api/README.md)

## Security and trust boundary

Proposal text and retrieved evidence are untrusted data. They cannot redefine
prompts, schemas, evidence sources, confidence, claim status, or voting
outcomes. External retrieval is bounded by source type, URL and network
controls, response size, content type, and deterministic normalization.

Consensus establishes agreement under the implemented retrieval and derivation
rules. It does not turn mutable provider data into objective truth. See
[SECURITY.md](SECURITY.md) for reporting and security policy.

## License

Apache-2.0. See [LICENSE](LICENSE).
