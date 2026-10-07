# QuorumX Intelligent Contracts

`governance_risk.py` is QuorumX's deployed v1 GenLayer Intelligent Contract.
Validators independently retrieve the public proposal. Snapshot sources use a
canonical GraphQL GET URL and retain a `snapshot:<space>:<proposal-id>` key.
Strict equality establishes the normalized source material; source-grounded
non-comparative validation then checks the bounded risk assessment before state
is stored. Public URL and explicitly labelled fixture sources remain supported.

Verified Studionet deployment:

```text
0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237
```

`governance_due_diligence.py` is the deployed v2 contract. It keeps strict
equality over validator-retrieved Snapshot material. The leader extracts
bounded facts tied to exact passages; validators deterministically normalize
them and require an exact canonical match before the report is assembled. Its
current evidence scope is the proposal itself. It does not verify external
metrics or advise a vote. Records are keyed by proposal and content hash, so
revised proposals retain readable historical v2 state.

Verified Studionet deployment:

```text
0x55d4b311f5b8ec5948cf0F34Feb05fce79b71760
```

Keep the v1 address unchanged for historical records.

The superseded v3.1 evaluation was additive; production remains on v2. Its
historical build is deployed on Studionet at
`0x121d55804fACa1696C2B8C4e04DfEaEE8fF98884` (deployment transaction
`0xfc0b7bf7a4d9e4c8e31eb9678e20ebbacfb13163be32d0b88a1c1e029fc14bfb`). The
deployed code SHA-256 exactly matches the tested source. Live Balancer BIP-930
assessment transaction
`0x92202c09f5bd8c4aba46f937739b4065ab55afaa61c1c20b74269cf9802ac835`
finalized `FINALIZED` / `MAJORITY_AGREE`, with successful leader execution in
one round. The stored source content hash is
`6cd31928c25e4b73e88c9759eb3ada7f2e4328efc9c4ce2c72b97b3ce1954a6d`; the
record has three claims, one finding, five ordered execution steps, and normal
review priority. Do not interpret majority agreement as unanimity.

V3.1 recognizes only a bounded Markdown table with explicit `Amount (ETH)` and
`Return Tx` headers, a consistent total, and at most five unique transaction
hashes. Validators fetch transaction data, its block, and—only if top-level
value/recipient do not match—the internal-transaction endpoint from the fixed
`eth.blockscout.com/api/v2` host. Every response must return HTTP 200 and fit
the response bound. The row must report successful execution, the proposal-
identified Safe as recipient, and a value matching the listed amount at six
decimal places. Direct transaction values and internal calls are represented
distinctly. Validators re-run the same fixed-source derivation and require
canonical equality; a missing, malformed, non-200, or disagreeing response
keeps the aggregate claim unverified.

The accepted record contains four top-level transaction-value transfers and
one internal call reported to the Safe. Blockscout reports a sum of
`296.40171109 ETH`; this matches the proposal table's `296.401711 ETH` at its
displayed precision. Each transaction row has its own hashed evidence record
and is linked to the claim. The claim's method and explanation identify
Blockscout as the source. These records are **secondary provider evidence**,
not a cryptographic inclusion proof or direct Ethereum RPC verification. The
assessment does not establish that the table covers all recoveries or verify
the proposal-reported `$1,393,694.67` incident loss, which remains unverified
and proposal-only.

That v3.1 record's fixed Safe Transaction Service adapter remains limited to explicitly
identified Ethereum-mainnet Safes. Its configuration for BIP-930 is 11 owners,
6-of-11 threshold, and Safe 1.1.1; that source is also secondary evidence.
Proposal-linked URLs are not fetched, and external response text is not sent to
an LLM. The API parser validates evidence hashes, fixed locators, source
authority, chain identifier, transfer shape, unique transaction hashes, claim
links, and aggregate amount.

Migration `0007` is applied only on the expiring Neon branch
`dev-due-diligence-v3`. The v3.1 record matched indexed revision `158802`; the
actual database finalizer, persistence, assessment route, and proposal-detail
route passed in a rollback-only transaction. A follow-up query confirmed no
test transaction, assessment row, or assessment job persisted. The public
Worker, Neon main, and Living Index remain on v2; no v3 public endpoint is
enabled.

## Current implementation: v3.3

The immutable v3.3 contract is deployed on Studionet at
`0xf183c38364Bc92726E54d3639a6c4f8d107630c7` (deployment transaction
`0x600796d8eafe99df247004bd8f400b531884894adef8de540409b3bb4befdb50`).
The deployment finalized with successful GenVM execution. The bounded BIP-930
assessment transaction
`0xf23151d9a28c76d39b0a189dc30cd716a777da7c2b13fcbfbbacf5207bdb5d29`
also finalized with successful leader and participating-validator execution,
and its immutable run record was read back by assessment-run ID.

V3.3 stores records by immutable run ID, supports additive schema-specific
reads, and preserves all v1, v2, v3.1, and v3.2 state. Validators independently
retrieve Snapshot material and derive matching decision-bearing structured
facts. External verification is limited to fixed dual Ethereum JSON-RPC Safe
state, bounded Blockscout transaction evidence, and bounded same-space
Snapshot governance-history references. All external sources are untrusted
data, are size/schema constrained, and remain explicitly `secondary` unless
the evidence model states otherwise. No arbitrary URL adapter exists.

The contract source is `governance_due_diligence_v3_3.py`. Python 3.12, the
pinned `GENVM_VERSION=v0.2.16`, and `genvm-linter` 0.11.0 are required for the
semantic gate.

## Historical evaluation candidate: v3.2

V3.2 supersedes v3.1 as the evaluation target without rewriting its immutable
Studionet record. It is deployed at
`0x3df401767e8C9E8E86aaf4d15B62ae903c4735Aa` (deployment transaction
`0xd600467b5f8e2819ab0433c38ded4dba2ab3ef5c74291cec30681437ad5ba04b`), with
source SHA-256
`b92813138c6faba498f5384a7998ecf2958e13c53ad67110cefa12dfbc2ee03e`.
Balancer BIP-930 assessment transaction
`0x91be17489fe5026888af082ff759dce9285f7bb9c38d4dd4c6daf8ac0ebc087d`
finalized with `MAJORITY_AGREE` and successful leader execution. Its schema
3.2 record has three claims, one finding, five execution steps, two Safe
provider records, and five Blockscout transaction records.

V3.2 obtains the explicitly identified Ethereum-mainnet Safe's threshold and
owners using fixed JSON-RPC calls to PublicNode and dRPC, both pinned to the
same `finalized` Ethereum block. The record requires the two provider results
to match and labels them `secondary`; this is provider corroboration, not a
cryptographic state proof. The live state reports threshold 6 and 11 owners at
block `26123704` (`0x57e77469d9e0334598d20e7c8ea6418f40f7f4a75f7cece3debb80f7421fce2a`).
Blockscout-returned transfer details remain secondary provider evidence, not a
receipt proof or completeness claim. The proposal's reported incident loss
remains unverified. No proposal-linked arbitrary URLs are fetched.

The exact record passes the Worker v3.2 parser and an isolated Neon
`dev-due-diligence-v3` integration: the indexed revision hash matched, the
real finalizer persisted the record inside a rollback-only transaction, and
both the assessment and proposal API query paths returned the expected v3.2
data. A post-rollback query confirmed zero test assessment, transaction, or
v3 job rows. Migration `0007` and all writes were confined to that expiring
development branch. Neon main, the public Worker, and the Living Index remain
on v2; v3.2 is not a public endpoint and is not approved for production.

Superseded Studionet candidates are immutable and must not be treated as the
current integration target. One candidate was stopped before assessment after
live Blockscout inspection showed that transaction responses expose
`block_number` while block hashes require a separate block lookup. A later
assessment's wording implied direct receipt retrieval and was superseded by a
source-precise record. The current build checks HTTP status using the pinned
GenVM `Response.status` interface and has regression tests for non-success
responses.

Run deterministic rule tests with:

```sh
python -m unittest contracts/tests/test_governance_risk.py
```

GenLayer direct-mode tests require Python 3.12+ and `genlayer-test`:

```sh
pytest contracts/tests -v
```
