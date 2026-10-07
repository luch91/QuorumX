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

## Current architecture: due diligence v3.3

Schema 3.3 is the current public implementation. Its immutable
Studionet contract is
[`0xf183c38364Bc92726E54d3639a6c4f8d107630c7`](https://explorer-studio.genlayer.com/address/0xf183c38364Bc92726E54d3639a6c4f8d107630c7),
deployed by transaction
[`0x600796d8…db50`](https://explorer-studio.genlayer.com/tx/0x600796d8eafe99df247004bd8f400b531884894adef8de540409b3bb4befdb50).
The finalized deployment receipt contains successful GenVM execution, and
`get_contract_schema` returns assessment version `3`, schema `3.3`.

The bounded BIP-930 write/read smoke finalized in transaction
[`0xf23151d9…5d29`](https://explorer-studio.genlayer.com/tx/0xf23151d9a28c76d39b0a189dc30cd716a777da7c2b13fcbfbbacf5207bdb5d29).
Validators independently retrieved the Snapshot proposal and derived matching
decision-bearing structured facts. They also retrieved fixed-source secondary
evidence: Safe state from PublicNode and dRPC at one pinned finalized Ethereum
block, and up to five proposal-linked transfer records from fixed Blockscout
endpoints. Each evidence object is hashed and attached only to the claims it
supports. Provider corroboration is not represented as a cryptographic state
proof, and arbitrary proposal-linked URLs are never fetched.

The v3.3 public and read-only staging Workers index `balancer.eth`, `safe.eth`,
`arbitrumfoundation.eth`, and `ens.eth`. Migrations `0007` and `0008` are
applied to the corresponding Neon branches. The public Worker runs v3.3 with
the established five-minute discovery schedule; staging has writes disabled.
The `quorumx-v3-3-pre-promotion-20261007` Neon branch preserves the exact
pre-promotion production state. A rollback is an assessment-version
configuration change and does not rewrite v1, v2, or v3 records.

### Historical v2 production deployment

The original `GovernanceRiskOracle` and its accepted Studionet assessments are
version 1 records. Their 0–100 scores are historical model outputs, not
probabilities, confidence levels, or defined weighted totals. They remain
inspectable and are labelled **Legacy risk assessment** in the Living Index.

The deployed version 2 `GovernanceDueDiligence` contract represents
proposal actions, material claims, evidence references, findings, execution
steps, unresolved questions, and a finding-derived review priority. It does not
recommend a vote. Validators still retrieve the Snapshot proposal independently
and agree on normalized source material. The leader extracts bounded material
facts from exact source passages; validators independently retrieve the source,
re-normalize those facts, and require an exact canonical match before the
deterministic report is accepted. The record can be inspected alongside its
proposal content hash and transaction.

The v2 evidence scope is the validator-retrieved proposal. A proposal's
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

### Historical due diligence v3.2 evaluation

V3 is additive; v1 and production v2 contracts and records remain unchanged.
The current evaluation contract is `0x3df401767e8C9E8E86aaf4d15B62ae903c4735Aa`
(deployment transaction
`0xd600467b5f8e2819ab0433c38ded4dba2ab3ef5c74291cec30681437ad5ba04b`). Its
source SHA-256 (`b92813138c6faba498f5384a7998ecf2958e13c53ad67110cefa12dfbc2ee03e`)
matches the deployed source. Active Balancer BIP-930 was assessed in transaction
`0x91be17489fe5026888af082ff759dce9285f7bb9c38d4dd4c6daf8ac0ebc087d`;
the transaction finalized `MAJORITY_AGREE`, leader execution succeeded, and
the revision-specific record was read back. Its source content hash remains
`6cd31928c25e4b73e88c9759eb3ada7f2e4328efc9c4ce2c72b97b3ce1954a6d`. The
schema 3.2 record contains three claims, one finding, five ordered execution
steps, two Safe provider records, five Blockscout transaction records, and
normal review priority.

V3.1 adds a bounded returned-funds evidence adapter. Validators retrieve only
the fixed Ethereum Blockscout transaction, block, and (where required)
internal-transaction endpoints for up to five transaction hashes explicitly
linked from a proposal table; proposal-linked URLs are not fetched. The live
record contains four successful transaction-value transfers and one
provider-reported internal call to the proposal-identified Safe. Provider data
totals `296.40171109 ETH`, matching the proposal table's `296.401711 ETH` at
its displayed six-decimal precision. The claim is supported by these
validator-retrieved records, each attached to that claim. Blockscout is a
**secondary provider**, not a cryptographic proof or independent Ethereum
RPC; the assessment does not establish that the table is complete or verify
the reported exploit loss.

The proposal-reported `$1,393,694.67` loss remains **unverified** and backed
only by the proposal. V3.2 replaces the live Safe Transaction Service adapter
with fixed Ethereum JSON-RPC calls to PublicNode and dRPC. Both providers are
queried for `getThreshold()` and `getOwners()` at the same Ethereum `finalized`
block; the record contains two secondary, provider-reported evidence objects
and requires their structured values and pinned block to agree. This is not a
cryptographic state proof, and the providers are not represented as independent
consensus participants. Blockscout transfer data remains secondary provider
evidence, not a receipt/inclusion proof or proof of completeness. The live
record reports Safe `0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f`, threshold 6,
and 11 owners at Ethereum block `26123704` (`0x57e77469d9e0334598d20e7c8ea6418f40f7f4a75f7cece3debb80f7421fce2a`).
The fixed adapters are bounded by source, row count, and response size. No
arbitrary web browsing occurs inside the contract.

The v3.2 evaluation flow is:

```text
Snapshot proposal
      ↓
GenLayer validators independently retrieve and agree on normalized material
      ↓
Bounded extraction of proposal actions and material claims
      ↓
Fixed dual-provider Safe JSON-RPC + Blockscout transfer adapters
      ↓
Evidence-linked claims and findings; provider sources remain secondary
      ↓
Versioned assessment accepted on Studionet
      ↓
Worker parser/finalizer/API path tested transactionally on Neon dev branch
```

This was the isolated v3.2 evaluation path, before v3.3 promotion. It is not a
description of the current public pipeline.

The v3.2 rollout initially applied migration `0007` only to the expiring Neon
branch `dev-due-diligence-v3`. A rollback-only integration check
matched the indexed revision's assessment content hash to the live record,
exercised the actual v3 finalizer and both API query paths, and confirmed no
assessment, transaction, or v3 job rows remained after rollback. The real
Worker parser accepts the exact on-chain record, validates both Safe provider
records against the same pinned block, and checks evidence hashes and claim
relationships. These statements are historical: production Neon now also has
the additive v3.3 migration and the public Cloudflare Worker serves v3.3.

Earlier evaluation deployments remain immutable, including the v3.1
Safe-API-based record and earlier candidates. The first v3.1 candidate
used an outdated assumption about Blockscout's transaction response and was
stopped before an assessment write. A later candidate's assessment is also
historical; its explanatory wording was superseded to describe provider data
precisely rather than imply direct receipt retrieval. Neither candidate is
the current integration target.

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
- machine-readable evidence and review-priority data for governance dashboards;
- an auditable input to policies that still require human approval;
- a reusable pattern for source-grounded GenLayer applications.

## What is different

| Property | Single-model governance bot | QuorumX |
| --- | --- | --- |
| Source authority | Operator prompt or backend | Validators independently fetch the public source |
| Agreement | One provider response | GenLayer consensus |
| Output | Free-form prose | Versioned findings, claims, evidence references, unresolved questions, review priority, hashes |
| Provenance | Usually implicit | Canonical key, source kind, locator hash, content hash |
| Duplicate handling | Application convention | Content-derived idempotency plus contract state |
| Failure behavior | Often best effort | Missing readable state remains unavailable or undetermined |
| Audit trail | Backend logs | Public transaction, readable state, redacted local evidence |

## Historical v1 live proof

The first public test demonstrates the historical v1 scoring path only. It is
not QuorumX's current assessment model; its risk level, 0–100 score, and
recommendation are retained as legacy provenance, not interpreted as current
due-diligence findings.

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

## Deployed architecture (v3.3)

```text
Public proposal source
        │ source reference
        ▼
QuorumX operator client
discover · dedupe · submit · wait · recover · present
        │ assess(source, immutable run ID)
        ▼
GovernanceDueDiligence v3.3 on GenLayer
validators independently retrieve proposal → strict source equality
      → independently derive/validate structured facts
      → fixed Safe RPC, Blockscout, and governance-history adapters
      → evidence-linked claims, safeguards, and consequences
      → bounded immutable storage
        │ readable consensus state
        ▼
CLI · Living Index · governance integrations
```

| Component | Responsibility | Not responsible for |
| --- | --- | --- |
| Source adapters | Discover and normalize references | Declaring the authoritative risk result |
| TypeScript operator | Deadline checks, deduplication, submission, recovery, presentation | Supplying authoritative proposal text |
| `GovernanceDueDiligenceV33` | Retrieval, canonicalization, source-grounded fact validation, bounded immutable storage | Voting or executing governance actions |
| GenLayer validators | Independently retrieve proposals and derive/validate bounded facts and fixed-adapter evidence | Trusting local operator evidence |
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
GovernanceDueDiligence v3.3 on GenLayer
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
| `GET /v2/proposals/<canonical-id>/due-diligence` | Deployed v2 proposal-grounded due-diligence record |
| `GET /v3/proposals/<canonical-id>/due-diligence` | Current v3.3 evidence-aware record; optional `schema=3.3` selects the immutable schema explicitly |

Proposal lists accept `status`, `space`, exact `source`, human-facing `dao`, proposer `author`, `assessment`, and `ecosystem` filters. Use `assessment=unassessed` for indexed proposals without a job. Lists also accept `limit` (maximum 100) and the numeric `cursor` returned as `page.nextCursor`. Reads require no wallet or API key. The internal cycle endpoint is bearer-protected; normal ingestion is cron-driven.

### Public interface

The Living Index is QuorumX's evidence-first governance interface. It consumes the public API directly and provides:

- **Needs Review Now:** a deadline-aware queue ranked by accepted review priority;
- **Proposal Index:** searchable, filterable coverage across every configured DAO;
- **Public Record:** proposal material beside its source, proposer, revision, GenLayer transaction, network, and consensus state;
- **Risk Assessments:** a compact view of accepted due-diligence findings and evidence, not a vote or opaque score;
- **DAO Directory:** transparent indexing and assessment-policy status for each source; and
- **Methodology:** the retrieval, normalization, consensus, and publication lifecycle in plain language.

All browsing remains public and wallet-free. Cloudflare serves the interface shell at [quorumx.dev](https://quorumx.dev/), while the browser retrieves the current proposal, source, and assessment state from [api.quorumx.dev](https://api.quorumx.dev). The optional navbar wallet control only requests an account from an already-installed injected wallet and displays the selected address locally. It does not request a signature, switch networks, submit transactions, or unlock additional reading access. Signed participation is reserved for a later feature with a specific, visible purpose.

## Legacy v1 scoring lifecycle (historical)

The following lifecycle and field table describe `GovernanceRiskOracle` v1
only. They are not the current due-diligence assessment model.

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

## Legacy v1 assessment fields

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
| SSRF/private access | V1 public-URL intake applies URL/IP checks; v2/v3 contracts construct fixed source URLs and do not fetch proposal-linked URLs |
| Fixture confusion | Explicit enablement and permanent fixture provenance |
| False acceptance | Requires readable matching contract state |
| Unexpected payment | GenLayer failure never triggers legacy Telegraph payment |
| Secret leakage | Keys/evidence ignored; full-history secret scan in CI |

Consensus does not make a conclusion objectively correct. It makes retrieval and acceptance inspectable and harder to manipulate unilaterally. Human review remains essential.

## Verification status

Protected `main` requires the full Jest suite, TypeScript type-check and builds,
Python contract tests, GenVM static and SDK-backed semantic checks, npm audit,
and full-history Gitleaks scanning. The separate daily/on-demand **Studionet
smoke** has no key and performs no write; it enumerates Balancer, SafeDAO,
Arbitrum DAO, and ENS DAO and reads canonical stored state. Current local checks
pass 64 Python contract tests plus 14 subtests, 8 GenLayer Direct Mode tests,
one five-validator Linux GLSim integration test, the pinned GenVM v0.2.16
semantic check, and 37 Jest suites with 188 tests; the three PostgreSQL
integration tests are a separate database-backed gate.
`npm audit --audit-level=high` passes with no high or critical findings and
reports 20 moderate test-tooling findings through Jest/ts-jest. The v3.3
BIP-930 Studionet record proves fixed provider retrieval and the reported
values, not completeness of recovery data, the exploit-loss figure, or a
cryptographic chain proof. Public production now uses v3.3; historical v1 and
v2 records remain readable without reinterpretation.

The contract workflow pins `GENVM_VERSION=v0.2.16` and caches the official GenVM bundle so SDK-backed checks use a reproducible runner artifact. All three contracts pass `genvm-lint check` against that bundle.

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
