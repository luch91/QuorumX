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

## Current implementation: format 3

The current immutable format 3 contract is deployed on Studionet at
`0x319e020B2cf81a5c1D7E6d8F831B8F0c531ea860` (deployment transaction
`0x8db0a0e5be933c1fb025e1a8431b1d60eb912a86b543ed13cf12700320da12ae`).
It replaces `0xf183c38364Bc92726E54d3639a6c4f8d107630c7` (deployment
transaction `0x600796d8eafe99df247004bd8f400b531884894adef8de540409b3bb4befdb50`)
only for the long-proposal passage-boundary correction: complete canonical
material remains capped at 24 KB, while dense line formatting no longer rejects
otherwise admissible material. The previous address and all records it accepted
remain historical and immutable. The bounded BIP-930
assessment transaction
`0xf23151d9a28c76d39b0a189dc30cd716a777da7c2b13fcbfbbacf5207bdb5d29`
also finalized with successful leader and participating-validator execution,
and its immutable run record was read back by assessment-run ID.

Format 3 stores records by immutable run ID, supports schema-specific reads for
historical compatibility, and preserves all format 1, format 2, and earlier
format 3 state. Validators independently
retrieve Snapshot material and derive matching decision-bearing structured
facts. External verification is limited to fixed dual Ethereum JSON-RPC Safe
state, bounded Blockscout transaction evidence, and bounded same-space
Snapshot governance-history references. All external sources are untrusted
data, are size/schema constrained, and remain explicitly `secondary` unless
the evidence model states otherwise. No arbitrary URL adapter exists.

The contract source is `governance_due_diligence_v3_3.py`. Python 3.12, the
pinned `GENVM_VERSION=v0.2.16`, and `genvm-linter` 0.11.0 are required for the
semantic gate.

Internal format 3 schema history is documented in
[`docs/FORMAT_HISTORY.md`](../docs/FORMAT_HISTORY.md). Decimal schema labels
remain only where immutable stored records require exact decoding.

Run deterministic rule tests with:

```sh
python -m unittest contracts/tests/test_governance_risk.py
```

GenLayer direct-mode tests require Python 3.12+ and `genlayer-test`:

```sh
pytest contracts/tests -v
```
