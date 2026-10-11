# QuorumX

[![CI](https://github.com/luch91/QuorumX/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/luch91/QuorumX/actions/workflows/ci.yml) [![Living Index](https://img.shields.io/badge/Living_Index-quorumx.dev-D4AF37)](https://quorumx.dev/) [![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE) [![Contributing](https://img.shields.io/badge/Contributing-guide-2ea44f)](CONTRIBUTING.md) [![Security](https://img.shields.io/badge/Security-policy-8b5cf6)](SECURITY.md) [![Built on GenLayer](https://img.shields.io/badge/Built_on-GenLayer-f4b942)](https://genlayer.com/) [![GitHub stars](https://img.shields.io/github/stars/luch91/QuorumX?style=flat)](https://github.com/luch91/QuorumX/stargazers)

QuorumX is a public, multi-DAO governance due-diligence index built on GenLayer.
It discovers Snapshot proposal revisions, submits bounded assessments to
GenLayer Intelligent Contracts, verifies accepted contract state, persists an
immutable index of those results, and serves them through a public API and the
Living Index.

The index covers Balancer, SafeDAO, Arbitrum DAO, and ENS DAO. QuorumX is
advisory infrastructure: it does not vote, execute governance proposals, or
replace delegates, security reviewers, or other human decision-makers.

## At a glance

- **Discover:** poll the four configured Snapshot governance spaces on a
  five-minute schedule and preserve canonical proposal IDs, content revisions,
  and observations.
- **Assess:** submit a canonical source reference to GenLayer. Validators
  retrieve and normalize source material independently, then apply the
  contract's bounded validation and consensus rules.
- **Ground:** attach structured actions, claims, findings, safeguards, execution
  dependencies, evidence references, and unresolved questions to the reviewed
  proposal.
- **Verify:** treat an assessment as accepted only when the relevant transaction
  has finalized and matching assessment state can be read from the contract.
- **Index:** keep proposal discovery, revisions, jobs, transaction provenance,
  and accepted assessments available through Postgres-backed API routes and the
  public Living Index.
- **Preserve history:** bind accepted results to their source revision and
  immutable record identifiers. New revisions do not silently rewrite earlier
  assessments.

## What an assessment contains

Depending on the accepted format and the available evidence, QuorumX can
publish:

- **Decision and action structure:** proposed transfers, assets, recipients,
  contract calls, parameter changes, control changes, and other supported action
  types.
- **Claims and findings:** material assertions from the proposal and the result
  of bounded checks.
- **Evidence:** source references, retrieval scope, authority, content hashes,
  and the claims or findings each item supports.
- **Safeguards:** safeguards found, explicitly absent in the reviewed material,
  not identified in that material, or still unknown.
- **Execution analysis:** steps, responsible actors, dependencies, human
  approvals, technical prerequisites, impact, and reversibility.
- **Open questions and changes:** unresolved issues and material changes between
  proposal revisions.
- **Review priority:** a structured indication of where human scrutiny may be
  useful, not a voting recommendation.

Interpretation matters. **Unverified does not mean false.** **Not identified**
means a safeguard was not found in the bounded material reviewed; it is not
proof that the safeguard does not exist. A proposal's assertions are not
automatically treated as independently established facts.

## How the system works

~~~text
Snapshot governance spaces
        |
        v
Cloudflare Worker indexer and durable job queue
        |
        +----> Neon Postgres: observations, revisions, jobs, transactions
        |
        v
Canonical proposal reference submitted to GenLayer
        |
        v
Validators retrieve and normalize proposal material
        |
        v
Bounded source checks and format-specific validation
        |
        v
Consensus transaction and exact accepted-state verification
        |
        v
Immutable indexed assessment
        |
        +----> Public API
        +----> QuorumX Living Index
        +----> Operator CLI and local redacted evidence
~~~

### Responsibilities and trust boundaries

| Component | Responsibility | Boundary |
| --- | --- | --- |
| Snapshot source adapter | Discover proposals and normalize canonical references | Does not declare the risk result authoritative |
| Cloudflare API Worker | Polling, durable job scheduling, budget enforcement, submission/recovery, indexing, and public API | Does not replace GenLayer as the authority for accepted assessment state |
| Neon Postgres | Index proposal observations, immutable revisions, jobs, transactions, and accepted records | Is not the consensus engine; accepted-record mutation is restricted |
| GenLayer Intelligent Contracts | Retrieve source material, apply bounded validation, reach consensus, and store accepted records | Do not vote on or execute the DAO proposal itself |
| GenLayer validators | Independently retrieve material and perform the contract's validation/derivation steps | Consensus does not make external provider data objectively true |
| Living Index and API | Present proposals, assessments, evidence, and provenance | Public reads do not require a wallet |
| Operator CLI | Discover, submit, follow, recover, and inspect assessment workflows | Signing credentials are required only for operations that submit transactions |

## Evidence scope and limitations

Format 3 supports a bounded set of external evidence adapters, including:

- Ethereum Safe configuration/state checks using two fixed JSON-RPC providers at
  a common finalized block;
- bounded transaction evidence retrieved from fixed Blockscout endpoints; and
- bounded same-space Snapshot governance-history references.

Provider responses are evidence with recorded authority, not cryptographic
proofs of Ethereum state or transaction inclusion. External material is
untrusted input and is constrained by source type, URL/network controls,
response size, content type, schema, and deterministic normalization.
Proposal-linked arbitrary URLs are not fetched by a general-purpose adapter.

What can be checked depends on the proposal, adapter coverage, source
availability, and accepted assessment format. QuorumX does not claim to
independently verify every statement in a proposal, discover every possible
safeguard, or guarantee that a proposal is safe. Missing or inconclusive
evidence remains a limitation to review, not a positive finding.

## Assessment formats and rollout status

QuorumX exposes three public record formats:

1. **Format 1:** the legacy governance risk score record. It is retained for
   compatibility and must not be interpreted as a probability or as a Format 3
   finding.
2. **Format 2:** proposal-grounded structured due diligence, with actions,
   claims, findings, safeguards, execution steps, questions, and review
   priority. Its evidence boundary is the proposal itself.
3. **Format 3:** evidence-backed structured due diligence with bounded external
   evidence adapters, evidence authority, safeguard states, execution
   relationships, and immutable assessment-run records.

Internal schema labels such as 3.1, 3.2, 3.3, and 3.4 describe stored
contract/data compatibility. They are not public product versions. See
[format history](docs/FORMAT_HISTORY.md) and
[revision compatibility](docs/revision-and-assessment-compatibility.md) .

**Production routing remains on schema 3.3.** The schema 3.4 Intelligent
Contract has been deployed on Studionet for isolated validation, but its live
BIP-933 canary has not yet reached consensus or produced an accepted assessment.
The canary is waiting for Balancer's rolling live-assessment budget to free
capacity. A deployed contract or an HTTP-successful runner invocation is not
evidence of a successful assessment. Schema 3.4 must not be described as
production-validated or globally activated until the canary reaches finality and
its accepted state is verified.

The active schema 3.3 contract is deployed on Studionet at:

~~~text
0x319e020B2cf81a5c1D7E6d8F831B8F0c531ea860
~~~

The isolated schema 3.4 contract is deployed at:

~~~text
0x312310d6D2aFA84bC55A7D6fAc68a623cBDD11c4
~~~

Studionet deployments demonstrate contract and consensus behavior on a
development network. They are not a claim of production-network security or an
independent security audit.

## Public API

The API is deployed at [api.quorumx.dev](https://api.quorumx.dev) . The Worker
runs its discovery cron every five minutes and exposes these documented routes:

| Route | Purpose |
| --- | --- |
| `GET /` | Service identity and release/version information |
| `GET /health` | Worker-to-database path and indexer counts |
| `GET /health/live` | Dependency-free process liveness |
| `GET /health/ready` | Database, source, queue, configuration, migration, and release-attestation readiness |
| `GET /v1/sources` | DAO metadata, ecosystems, assessment budgets, and polling health |
| `GET /v1/proposals` | Cursor-paginated proposal index; supports status, space, source, DAO, author, assessment, and ecosystem filters |
| `GET /v1/proposals/&lt;canonical-id&gt;` | Proposal, latest revision, transaction, and assessment details |
| `GET /v1/assessments/&lt;proposal-key&gt;` | Accepted assessment and GenLayer provenance |
| `GET /v2/proposals/&lt;canonical-id&gt;/due-diligence` | Format 2 compatibility endpoint |
| `GET /v3/proposals/&lt;canonical-id&gt;/due-diligence` | Latest accepted evidence-backed assessment |

Read-only discovery and assessment retrieval do not require a wallet. Internal
operational endpoints require the admin token and are not public user endpoints.

## Scheduling, budgets, and backfill

The live indexer applies per-source rolling 24-hour assessment budgets before
claiming work. Discovery is broader than submission: indexing a proposal does
not mean it has been assessed, and being queued does not mean a GenLayer
transaction exists or has been accepted. Jobs, attempts, transactions, and
accepted contract state are tracked separately so uncertain submissions can be
reconciled rather than blindly repeated.

Retrospective Format 3 backfill is a separate, operator-controlled workflow.
Operators should create a dry run, inspect its per-DAO report, then start a
specific run ID. Defaults cover up to the latest 25 closed proposals per DAO
within 90 days, capped at 100 total, with at most four GenLayer backfill
submissions globally per rolling 24 hours. When multiple runs are active, the
strictest active run budget applies. Backfill has a separate allowance from live
assessments, and live/final-revision jobs take priority over retrospective jobs.
Pausing prevents new backfill claims; recovery of transactions already submitted
continues.

These controls bound submission volume; they do not guarantee a fixed assessment
rate. Source limits, provider availability, queue state, budget occupancy,
consensus, and finality can delay or prevent an assessment.

## Repository map

~~~text
contracts/       GenLayer Intelligent Contracts and contract tests
database/        append-only SQL migrations, roles, and database verification
workers/api/     indexer, queue, persistence, and public API Worker
workers/site/    static-site Worker and API proxy
frontend/        Living Index source and particle renderer
app/             operator CLI, Snapshot integration, and GenLayer client
fixtures/        deterministic compatibility and assessment fixtures
scripts/         validation, migration, runtime, and release tooling
docs/            operations, release, format, and compatibility records
.github/         CI, integration, deployment-config, and secret-scan workflows
~~~

Retired DWCS, Sentinel, and Telegraph experiments are not part of the current
runtime or release process. Their implementation files and generated media were
removed from the current tree; their historical commits remain in Git history.

## Local development

### Requirements

- Node.js 22
- Python 3.12
- Docker for disposable Postgres and runtime integration tests
- GenLayer test dependencies for contract/direct-mode tests
- Linux for the documented five-validator integration script

### Install and verify

~~~bash
npm ci
npm run verify
python -m pytest contracts/tests -q
npm audit --audit-level=high
~~~

On Linux, run the five-validator **schema 3.3** local integration test:

~~~bash
npm run test:genlayer:integration
~~~

The schema 3.4 localnet test currently verifies that the contract deploys in a
five-validator environment and exposes its schema/consensus-method metadata. It
is not the same as a successful live schema 3.4 canary, and it does not by
itself prove end-to-end production acceptance for every DAO fixture.

Additional release gates include:

~~~bash
npm run test:organization:e2e
npm run test:release
npm run cf:dry-run:api
npm run cf:dry-run:site
~~~

The organization E2E workflow provisions an isolated test database, exercises
Postgres concurrency/recovery and Worker/browser paths, then tears down and
verifies absence of the test resources. The CI pipeline also runs type checks,
builds, contract tests, direct-mode evidence-adapter tests, compatibility
checks, deployment-config dry runs, dependency audit, and a full-history secret
scan. The generated particle-renderer bundle is built for
verification/deployment and intentionally is not tracked.

A green CI run is evidence for the checks actually executed. It should not be
generalized into a claim that every external DAO fixture has completed
five-validator end-to-end assessment through the live production pipeline.

## Configuration and secrets

Copy .env.example to .env for local work. The example is intentionally read-only
by default. Production Worker configuration is separate and currently enables
bounded writes while routing ordinary jobs to schema 3.3.

Important settings include:

| Variable | Purpose |
| --- | --- |
| `QUORUMX_SNAPSHOT_SPACES` | Comma-separated allowlisted Snapshot spaces |
| `QUORUMX_GENLAYER_NETWORK` | GenLayer network selection |
| `QUORUMX_GENLAYER_RPC_URL` | Optional explicit RPC URL |
| `QUORUMX_CONTRACT_ADDRESS` | Legacy Format 1 contract |
| `QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS` | Format 2 contract |
| `QUORUMX_DUE_DILIGENCE_V3_CONTRACT_ADDRESS` | Active schema 3.3 contract |
| `QUORUMX_DUE_DILIGENCE_V3_4_CONTRACT_ADDRESS` | Isolated schema 3.4 contract; not the ordinary production route |
| `QUORUMX_ASSESSMENT_VERSION` | Public assessment format version |
| `QUORUMX_ASSESSMENT_SCHEMA_VERSION` | Internal schema selected by the Worker |
| `QUORUMX_ENABLE_WRITES` | Explicit write/submission switch |
| `QUORUMX_GENLAYER_PRIVATE_KEY` | Signing credential for transaction-submitting operations |
| `QUORUMX_ADMIN_TOKEN` | Authentication for internal operational endpoints |
| `DATABASE_URL_UNPOOLED` | Direct Neon connection for migrations and provisioning |
| `QUORUMX_DATABASE_ROLE_PASSWORD` | Password used by the database-role provisioning workflow |

Never commit real environment files, signing keys, admin tokens, database URLs,
or generated transaction/request evidence. Keep secrets in the platform's secret
store, use a limited-balance development signing account, and rotate any
credential that may have been exposed. The browser-facing site must not receive
private keys, database credentials, or the admin token.

## Database and release invariants

- Migrations are ordered, append-only, and checked by SHA-256 checksums. Never
  rename or edit a migration that has been applied.
- Apply migrations with the direct database connection and a migration-capable
  role, not through a pooler or the runtime role.
- Cloudflare production traffic reaches Neon through the Hyperdrive binding.
- The runtime role receives only the table operations needed for service
  operation. It must not receive DDL, schema ownership, broad administrative
  membership, or permission to mutate/delete accepted assessment records.
- Proposal revisions, observations, transactions, and accepted assessments
  retain their provenance. An uncertain submission must be reconciled against
  GenLayer and durable job state before any retry.
- Rollback changes active Worker/configuration only. It must not rewrite or
  delete accepted records.

Migrations currently run through `0013_bounded_format3_backfill.sql` . See the
[database documentation](database/README.md) and
[operations runbook](docs/OPERATIONS.md) for provisioning, verification, and
release procedures.

## Security and responsible interpretation

Proposal text and retrieved evidence are untrusted data. They cannot redefine
contract instructions, schemas, approved evidence sources, claim status, or
voting outcomes. External retrieval is bounded and normalized before its result
can contribute to an accepted record.

Consensus establishes agreement under the implemented retrieval and derivation
rules. It does not guarantee that the underlying providers are correct, that the
proposal is honest, that all relevant evidence was found, or that an assessment
is a substitute for professional legal, financial, technical, or governance
review.

For vulnerability reports, use the repository's private **Security → Report a
vulnerability** flow. Do not post credentials or exploit details in public
issues. See [SECURITY.md](SECURITY.md) .

## Further documentation

- [Operations runbook](docs/OPERATIONS.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Assessment format history](docs/FORMAT_HISTORY.md)
-
  [Revision and assessment compatibility](docs/revision-and-assessment-compatibility.md)
- [Database architecture and migrations](database/README.md)
- [Intelligent Contracts](contracts/README.md)
- [API Worker and endpoint details](workers/api/README.md)
- [Operator CLI](app/README.md)
- [Contribution guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
