# QuorumX

[![CI](https://github.com/luch91/QuorumX/actions/workflows/ci.yml/badge.svg)](https://github.com/luch91/QuorumX/actions/workflows/ci.yml)
[![Studionet smoke](https://github.com/luch91/QuorumX/actions/workflows/smoke.yml/badge.svg)](https://github.com/luch91/QuorumX/actions/workflows/smoke.yml)
[![Living Index](https://img.shields.io/badge/Living_Index-quorumx.dev-C9A24D.svg)](https://quorumx.dev/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Consensus-backed governance intelligence for decisions too important to trust to one model, one API, or one operator.**

QuorumX is a consensus-backed governance due-diligence system built on GenLayer.
It turns a public proposal into bounded, inspectable claims, findings, execution
steps, safeguards, and unresolved questions. Validators independently retrieve
the source and require an exact canonical match over source-grounded material
facts before the deterministic report is accepted. The result is stored for
governance interfaces, treasury tooling, delegates, and human reviewers.

QuorumX is advisory infrastructure. It does not vote, execute proposals, or
replace governance judgment. It shows what was assessed, where it came from,
what consequences and evidence gaps were identified, and what GenLayer
validators accepted.

## Due diligence v2

The original `GovernanceRiskOracle` and its accepted Studionet assessments are
version 1 records. Their 0–100 scores are historical model outputs, not
probabilities, confidence levels, or defined weighted totals. They remain
inspectable and are labelled **Legacy risk assessment** in the Living Index.

Version 2 introduces a separate `GovernanceDueDiligence` contract. It represents
proposal actions, material claims, evidence references, findings, execution
steps, unresolved questions, and a finding-derived review priority. It does not
recommend a vote. Validators still retrieve the Snapshot proposal independently
and agree on normalized source material. The leader extracts bounded material
facts from exact source passages; validators independently retrieve the source,
re-normalize those facts, and require an exact canonical match before the
deterministic report is accepted. The record can be inspected alongside its
proposal content hash and transaction.

The first v2 evidence scope is the validator-retrieved proposal. A proposal's
own assertion of an external metric does **not** establish independent
verification; those claims remain unverified until controlled external evidence
adapters and validator checks exist. Review priority means the proposal merits
human attention, never that QuorumX has decided a governance vote.

The v2 contract passed deterministic tests, GenVM static lint, and live
Studionet write/read checks. Version 1 remains readable as immutable legacy
provenance; no legacy score is silently reinterpreted as a v2 finding.

| Layer | v2 path |
| --- | --- |
| Contract | `contracts/governance_due_diligence.py` |
| Database | `database/migrations/0006_due_diligence_v2.sql` adds revision-bound v2 records |
| API | Existing v1 routes retain their fields; `GET /v2/proposals/<canonical-id>/due-diligence` exposes v2 |
| Living Index | Findings and evidence take precedence when a v2 record exists; v1 is labelled legacy |

The verified v2 Studionet contract is
`0x55d4b311f5b8ec5948cf0F34Feb05fce79b71760`. No legacy result is converted
into a v2 finding.

> **Live now:** [open the Living Index](https://quorumx.dev/) · [inspect the contract](https://explorer-studio.genlayer.com/address/0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237) · [inspect the first assessment](https://explorer-studio.genlayer.com/tx/0x55131db5c1b05ac6be9b46ef86511a95f5a880b957c78270337c3b3628149268)

## Why QuorumX exists

Governance proposals combine long-form claims, treasury transfers, voting mechanics, smart-contract changes, and time-sensitive execution details. Reviewers usually face a slow manual process that is difficult to reproduce or a single off-chain model whose provider, prompt, and source selection must all be trusted.

QuorumX changes that trust boundary. The operator does not submit an authoritative summary for validators to rubber-stamp; it submits a source reference. The Intelligent Contract makes validators retrieve the source independently, establishes agreement over canonical material, constrains the assessment schema, and stores only an accepted bounded record.

QuorumX can serve as:

- an early-warning layer for delegates and security councils;
- a review queue for treasury and operations teams;
- a machine-readable risk signal for governance dashboards;
- an auditable input to policies that still require human approval;
- a reusable pattern for source-grounded GenLayer applications.

## What is different

| Property | Single-model governance bot | QuorumX |
| --- | --- | --- |
| Source authority | Operator prompt or backend | Validators independently fetch the public source |
| Agreement | One provider response | GenLayer consensus |
| Output | Free-form prose | Bounded score, level, categories, recommendation, summary, hashes |
| Provenance | Usually implicit | Canonical key, source kind, locator hash, content hash |
| Duplicate handling | Application convention | Content-derived idempotency plus contract state |
| Failure behavior | Often best effort | Missing readable state remains unavailable or undetermined |
| Audit trail | Backend logs | Public transaction, readable state, redacted local evidence |

## Verified live proof

QuorumX has been deployed and exercised against a real Snapshot proposal on GenLayer Studionet.

| Item | Verified value |
| --- | --- |
| Network | GenLayer Studionet · chain ID `61999` |
| Intelligent Contract | [`0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237`](https://explorer-studio.genlayer.com/address/0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237) |
| GenVM runner | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Deployment | [`0x2fa96773…3bdd84`](https://explorer-studio.genlayer.com/tx/0x2fa96773ec54ae12cd0cef9f89d7a4122263ce74654a85dc6e657962713bdd84) · finalized · unanimous agreement |
| Proposal | [`BIP-929`](https://snapshot.box/#/s:balancer.eth/proposal/0x25ee897681ae8bbae5ae224b14ad6a03ea6920f768d52b2e9aa1a85b7eec0590) in `balancer.eth` |
| Assessment | [`0x55131db5…49268`](https://explorer-studio.genlayer.com/tx/0x55131db5c1b05ac6be9b46ef86511a95f5a880b957c78270337c3b3628149268) · finalized · majority agreement |
| Stored decision | `high` risk · `78/100` · `manual_review` |
| Provenance | Live Snapshot retrieval inside the Intelligent Contract |

The v0.2 indexer also discovered and submitted [BIP-928](https://snapshot.box/#/s:balancer.eth/proposal/0xeae4f8bab6f2fbfe22cfeae51ec336ef238c82e6e0017ee511ee67995235d53d) automatically. Its [accepted transaction](https://explorer-studio.genlayer.com/tx/0x6c5cfc8dee384896e4129ac5682d1168627416ec9d2596b4aee0a5d056f1cd85) is indexed at `api.quorumx.dev` with a `high` risk, `80/100`, `manual_review` result and `submitted_transaction` provenance.

The v0.3 multi-DAO path independently indexed SafeDAO's live [SEP 56](https://snapshot.box/#/s:safe.eth/proposal/0x9d226d025170ec4c56adc53dd77dda851da75c712757122c70dea965003278c4), preserved its proposer wallet, and finalized [transaction `0x806172…34000`](https://explorer-studio.genlayer.com/tx/0x806172bdc02629a2bc07ceb04d87d10fafde2d08a3e485f006babbba4de34000). The accepted result is `high` risk, `82/100`, `manual_review`, with `submitted_transaction` provenance.

Canonical key:

```text
snapshot:balancer.eth:0x25ee897681ae8bbae5ae224b14ad6a03ea6920f768d52b2e9aa1a85b7eec0590
```

The stored assessment identifies execution, governance, liquidity, smart-contract, and treasury risk. Its summary highlights the proposed BAL transfer, governance conflicts, council-threshold changes, IP assignment, migration dependencies, and speculative return assumptions. This demonstrates a functioning consensus path; it is not financial advice or a claim that Studionet is production infrastructure.

## Architecture

```text
Public proposal source
        │ source reference
        ▼
QuorumX operator client
discover · dedupe · submit · wait · recover · present
        │ assess(source, idempotency key)
        ▼
GovernanceRiskOracle on GenLayer
parse → independent retrieval → strict source equality
      → grounded assessment → bounded storage
        │ readable consensus state
        ▼
CLI · Living Index · governance integrations
```

| Component | Responsibility | Not responsible for |
| --- | --- | --- |
| Source adapters | Discover and normalize references | Declaring the authoritative risk result |
| TypeScript operator | Deadline checks, deduplication, submission, recovery, presentation | Supplying authoritative proposal text |
| `GovernanceRiskOracle` | Retrieval, canonicalization, consensus validation, bounded storage | Voting or executing governance actions |
| GenLayer validators | Independently observe and validate nondeterministic work | Trusting local operator evidence |
| Living Index | Present the public proposal index, review priorities, and verified evidence | Requiring a wallet for public reads or holding keys |

### v0.3 multi-DAO governance indexer

The backend at [api.quorumx.dev](https://api.quorumx.dev) polls Balancer, SafeDAO, Arbitrum DAO, and ENS DAO on Snapshot every five minutes. It fingerprints proposal revisions, preserves proposer wallets and canonical Snapshot URLs, durably claims eligible assessment jobs, submits them to GenLayer, recovers finality, and exposes the indexed result through a public API. Each source has an explicit assessment switch and rolling 24-hour budget, so broad indexing does not imply unbounded GenLayer spending. Neon stores discovery and delivery state; it does not replace GenLayer as the authority for assessments.

```text
Snapshot governance spaces
        │ scheduled discovery every five minutes
        ▼
Cloudflare Worker · api.quorumx.dev
        │ HYPERDRIVE binding
        ▼
Neon Postgres · proposals · immutable revisions · durable jobs · transactions
        │ assessment submission and finality tracking
        ▼
GovernanceRiskOracle on GenLayer
```

`GET /health` exercises the deployed Worker, Hyperdrive, and Neon database together. Atomic `FOR UPDATE SKIP LOCKED` claiming and stale-lock recovery prevent concurrent cron invocations from processing the same job. Contract state is accepted only when its proposal key and validator-agreed content hash match the indexed revision. The runtime database role is SQL-managed and intentionally lacks `DELETE`, schema ownership, DDL, and Neon's broad `neon_superuser` membership.

### Public API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Database reachability plus indexer counts and last successful poll |
| `GET /v1/sources` | DAO metadata, ecosystems, assessment budgets, polling health, and bounded error state |
| `GET /v1/proposals?status=active&ecosystem=ethereum` | Cursor-paginated proposal feed with latest assessment state |
| `GET /v1/proposals/<canonical-id>` | Proposal body, revision, transaction, and accepted assessment details |
| `GET /v1/assessments/<proposal-key>` | Accepted assessment and GenLayer provenance |

Proposal lists accept `status`, `space`, exact `source`, human-facing `dao`, proposer `author`, `assessment`, and `ecosystem` filters. Use `assessment=unassessed` for indexed proposals without a job. Lists also accept `limit` (maximum 100) and the numeric `cursor` returned as `page.nextCursor`. Reads require no wallet or API key. The internal cycle endpoint is bearer-protected; normal ingestion is cron-driven.

### Public interface

The Living Index is QuorumX's evidence-first governance interface. It consumes the public API directly and provides:

- **Needs Review Now:** a deadline-aware queue ranked by accepted risk signal;
- **Proposal Index:** searchable, filterable coverage across every configured DAO;
- **Public Record:** proposal material beside its source, proposer, revision, GenLayer transaction, network, and consensus state;
- **Risk Assessments:** a compact view of accepted GenLayer results;
- **DAO Directory:** transparent indexing and assessment-policy status for each source; and
- **Methodology:** the retrieval, normalization, consensus, and publication lifecycle in plain language.

All browsing remains public and wallet-free. Cloudflare serves the interface shell at [quorumx.dev](https://quorumx.dev/), while the browser retrieves the current proposal, source, and assessment state from [api.quorumx.dev](https://api.quorumx.dev). The optional navbar wallet control only requests an account from an already-installed injected wallet and displays the selected address locally. It does not request a signature, switch networks, submit transactions, or unlock additional reading access. Signed participation is reserved for a later feature with a specific, visible purpose.

## Consensus lifecycle

1. **Discover:** find an eligible proposal in configured Snapshot spaces.
2. **Check:** reject expired review windows and read existing contract state.
3. **Identify:** derive an idempotency key from source, title, body, and choices.
4. **Submit:** send only the structured source reference and idempotency key.
5. **Retrieve:** validators independently fetch a canonical Snapshot GraphQL GET URL.
6. **Fix the evidence:** `strict_eq` establishes equality over normalized identity and content.
7. **Assess:** `prompt_non_comparative` validates risk against agreed material; proposal text is untrusted data, never instructions.
8. **Bound:** reject unknown values, malformed hashes, out-of-range scores, empty categories, and overlong summaries.
9. **Store:** persist decision fields, source kind, locator hash, content hash, and timestamp.
10. **Verify:** report `accepted` only when matching state is readable. Transaction status alone is insufficient.

## Assessment model

| Field | Constraint |
| --- | --- |
| `proposalKey` | Stable source-specific identity |
| `sourceLocatorHash` | SHA-256 of the canonical source reference |
| `contentHash` | SHA-256 of validator-agreed material |
| `riskLevel` | `low`, `medium`, or `high` |
| `riskScore` | Integer from `0` to `100` |
| `riskCategories` | Non-empty subset of the fixed vocabulary |
| `recommendation` | `allow`, `manual_review`, or `block` |
| `summary` | Source-grounded explanation, at most 500 contract characters |
| `assessedAt` | GenLayer message timestamp |
| `consensusState` | `accepted` for readable stored assessments |
| `provenance` | `live` or explicitly labelled `fixture` |

```text
execution · governance · liquidity · market · oracle · security · smart_contract · treasury
```

These are advisory signals. Integrators decide whether `manual_review` opens a ticket, pauses a workflow, notifies delegates, or annotates a proposal.

## Supported sources

| Source | Contract support | Default operator flow | Identity |
| --- | --- | --- | --- |
| Snapshot | Yes | Yes | `snapshot:<space>:<proposal-id>` |
| Public HTTPS | Yes | Adapter and contract; not default v0.1 CLI discovery | `public_url:<sha256(url)>` |
| Archived fixture | Yes | Development only; explicit enablement | `fixture:<fixture-id>` |

The automatic indexer uses an allowlisted registry for `balancer.eth`, `safe.eth`, `arbitrumfoundation.eth`, and `ens.eth`; environment configuration can select only registered spaces. This is also the path for a public GEN governance space once its canonical source is verified. QuorumX never silently substitutes a fixture when a live space has no proposal.

Public URL ingestion rejects credentials, non-HTTPS schemes, localhost, loopback, link-local, private/reserved addresses, and hostnames resolving privately. Redirects are not followed. Responses are restricted to text/JSON and bounded. Fixtures are never implicit and permanently retain `fixture` provenance.

## Quick start

Requirements: Node.js 22+, npm, and Python 3.12+ for contract tests and lint. Reads and tests require no wallet.

```bash
git clone https://github.com/luch91/QuorumX.git
cd QuorumX
npm ci
npm run verify
```

```bash
npm run quorumx -- sources check --json
npm run quorumx -- proposals list --json
npm run quorumx -- assessment get \
  snapshot:balancer.eth:0x25ee897681ae8bbae5ae224b14ad6a03ea6920f768d52b2e9aa1a85b7eec0590 \
  --json
```

Read-only live probe:

```bash
QUORUMX_PROBE_PROPOSAL_KEY="snapshot:balancer.eth:0x25ee897681ae8bbae5ae224b14ad6a03ea6920f768d52b2e9aa1a85b7eec0590" npm run smoke:studionet
```

```powershell
$env:QUORUMX_PROBE_PROPOSAL_KEY = "snapshot:balancer.eth:0x25ee897681ae8bbae5ae224b14ad6a03ea6920f768d52b2e9aa1a85b7eec0590"
npm run smoke:studionet
```

## Submit an assessment

Writes consume development GEN. Use a limited-balance account, copy `.env.example` to `.env`, and never commit the file or key.

```env
QUORUMX_GENLAYER_NETWORK=studionet
QUORUMX_CONTRACT_ADDRESS=0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237
QUORUMX_SNAPSHOT_SPACES=balancer.eth
QUORUMX_GENLAYER_PRIVATE_KEY=0x...
```

```bash
npm run quorumx -- assess --source snapshot --proposal <snapshot-proposal-id> --json
```

Existing state is checked first. An assessed proposal returns without another transaction. New transaction evidence is recorded before polling so an interrupted workflow can recover without a second write.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `QUORUMX_GENLAYER_NETWORK` | No | `studionet` | `localnet`, `studionet`, `testnetAsimov`, `testnetBradbury` |
| `QUORUMX_GENLAYER_RPC_URL` | No | SDK endpoint | Explicit HTTP(S) RPC override |
| `QUORUMX_CONTRACT_ADDRESS` | Non-Studionet | Verified contract | Target oracle |
| `QUORUMX_GENLAYER_PRIVATE_KEY` | Writes only | None | 32-byte signing key |
| `QUORUMX_SNAPSHOT_SPACES` | No | `balancer.eth` | Ordered comma-separated spaces |
| `QUORUMX_SNAPSHOT_LIMIT` | Worker only | `20` | Recent proposals fetched per configured space, maximum 50 |
| `QUORUMX_ENABLE_WRITES` | Worker only | `true` | Explicit automatic GenLayer submission switch |
| `QUORUMX_ADMIN_TOKEN` | Worker only | None | Secret bearer token for the internal manual-cycle endpoint |
| `QUORUMX_ALLOW_FIXTURES` | No | `false` | Explicit fixture enablement |
| `QUORUMX_PROBE_PROPOSAL_KEY` | Smoke only | None | Record that must be readable |
| `DATABASE_URL_UNPOOLED` | Migrations only | None | Direct Neon owner connection; never a pooler URL |
| `QUORUMX_DATABASE_ROLE_PASSWORD` | Role provisioning only | None | High-entropy password passed to the one-time role script |

RPC and contract must belong to the same network. Studionet and Studio development preview have different chain IDs and state; QuorumX does not relabel one as the other.

## CLI and exit codes

```text
quorumx sources check [--json]
quorumx proposals list [--json]
quorumx assess --source <source> --proposal <id-or-url> [--json]
quorumx assessment get <proposal-key> [--json]
quorumx legacy telegraph
```

| Code | Meaning |
| --- | --- |
| `0` | Success or accepted readable state |
| `2` | No eligible proposal or assessment not found |
| `3` | Consensus undetermined |
| `4` | Invalid input or terminal failure |

## Evidence and recovery

`.quorumx-evidence/transactions.jsonl` is an ignored append-only record of transaction ID, canonical key, lifecycle state, structured source, provenance, timestamp, and bounded errors. It excludes keys, full fetched pages, prompts, and raw model responses.

Evidence is written after submission and at the terminal state. Recovery starts from the transaction ID, but local evidence can never promote a result to accepted; matching contract state must be readable.

## Trust and safety

| Boundary | QuorumX behavior |
| --- | --- |
| Malicious proposal text | Untrusted data; instructions remain contract-controlled |
| Operator manipulation | Operator supplies a reference, not authoritative content |
| Source drift | Validator-agreed material is hashed and stored |
| Duplicate submission | Pre-read, content idempotency, contract key-reuse rejection |
| SSRF/private access | Public HTTPS validation and private-address rejection |
| Fixture confusion | Explicit enablement and permanent fixture provenance |
| False acceptance | Requires readable matching contract state |
| Unexpected payment | GenLayer failure never triggers legacy Telegraph payment |
| Secret leakage | Keys/evidence ignored; full-history secret scan in CI |

Consensus does not make a conclusion objectively correct. It makes retrieval and acceptance inspectable and harder to manipulate unilaterally. Human review remains essential.

## Verification status

Protected `main` requires the full Jest suite, TypeScript type-check and builds, Python contract tests, GenVM static checks, npm audit, and full-history Gitleaks scanning. The separate daily/on-demand **Studionet smoke** has no key and performs no write; it must discover live proposals and read the canonical stored assessment. Worker-specific tests cover Snapshot normalization, bounded GraphQL handling, and byte-identical contract hashing.

`genvm-lint lint` passes. SDK-backed `genvm-lint check` currently returns `E101` because `genvm-linter 0.11.0` requests an absent `genvm-universal.tar.xz` release asset. CI tolerates only that exact error. See [genlayerlabs/genvm-linter#27](https://github.com/genlayerlabs/genvm-linter/issues/27).

## Repository map

```text
app/src/domain/       proposal and assessment invariants
app/src/ingest/       Snapshot, HTTPS, fixture, fallback adapters
app/src/genlayer/     SDK boundary, gateway, lifecycle, evidence
app/src/workflows/    orchestration and recovery
app/src/cli/          operator commands and presentation
app/tests/            unit, integration, security, regression tests
contracts/            authoritative contract and rule tests
scripts/              read-only validation harness
database/migrations/  versioned indexer schema and source registry
workers/api/           Cloudflare API and polling foundation
wrangler.jsonc         custom domain, Hyperdrive, placement, observability
dwcs/                  optional legacy scoring research; not authoritative
frontend/              Living Index document, styles, API client, motion, and tests
workers/site/          Cloudflare web Worker and canonical-host redirect
wrangler.site.jsonc    web assets, custom domains, and observability
.github/workflows/     CI and smoke verification
```

## Current limitations

- Studionet is a development environment, not a production-persistence guarantee.
- v0.1 discovers/submits Snapshot proposals; general HTTPS is not yet a default CLI path.
- Automatic discovery currently covers four Snapshot DAOs; GEN-native discovery waits for a stable canonical public proposal feed.
- QuorumX does not block proposals, control treasuries, or cast votes.
- Conclusions can be incomplete or wrong; consensus improves provenance, not certainty.
- Persistent production-like testnet deployment remains a future milestone.

## Roadmap

- automate Cloudflare web deployment after protected-main verification;
- add purposeful signed participation without gating public reads;
- add notifications and operational dashboards for retry/dead-letter states;
- add a verified public GEN governance source when canonical access exists;
- expose public HTTPS through a supported operator command;
- notify maintainers when scheduled smoke runs fail;
- deploy on a persistent production-like GenLayer testnet;
- publish governance-dashboard integration examples.

## Legacy, contributing, and license

QuorumX evolved through a hybrid migration from Cassandra/Sentinel. The paid Telegraph workflow is isolated behind `npm run legacy:telegraph`; it is never an automatic fallback and is not authoritative. Optional DWCS research is also outside the GenLayer consensus path.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). QuorumX is licensed under [Apache License 2.0](LICENSE); the license does not grant rights to the QuorumX name or marks.
