# QuorumX Intelligent Contracts

QuorumX maintains three public assessment formats. Older contracts and accepted
records remain readable for compatibility; a newly deployed contract is not
automatically the active production route.

## Format 1: legacy governance risk record

`governance_risk.py` is the legacy v1 GenLayer Intelligent Contract. Validators
independently retrieve the public proposal. Snapshot sources use a canonical
GraphQL GET URL and retain a `snapshot:&lt;space&gt;:&lt;proposal-id&gt;` key.
Strict equality establishes normalized source material; source-grounded,
non-comparative validation then checks the bounded risk assessment before state
is stored. Public URL and explicitly labelled fixture sources remain supported.

Verified Studionet deployment:

~~~text
0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237
~~~

Format 1 records are historical risk-score records. Their scores are not
probabilities and must not be reinterpreted as Format 3 findings.

## Format 2: proposal-grounded due diligence

`governance_due_diligence.py` is the v2 contract. It preserves strict equality
over validator-retrieved Snapshot material. The leader extracts bounded facts
tied to exact passages; validators deterministically normalize them and require
an exact canonical match before the report is assembled. Its evidence boundary
is the proposal itself. It does not verify external metrics or advise a vote.
Records are keyed by proposal and content hash, so revised proposals retain
readable historical v2 state.

Verified Studionet deployment:

~~~text
0x55d4b311f5b8ec5948cf0F34Feb05fce79b71760
~~~

Keep the Format 1 address unchanged for historical records.

## Format 3: evidence-backed due diligence

### Active production route: schema 3.3

The immutable Format 3 contract currently selected for ordinary production
processing is deployed on Studionet at:

~~~text
0x319e020B2cf81a5c1D7E6d8F831B8F0c531ea860
~~~

Deployment transaction:

~~~text
0x8db0a0e5be933c1fb025e1a8431b1d60eb912a86b543ed13cf12700320da12ae
~~~

This deployment replaced `0xf183c38364Bc92726E54d3639a6c4f8d107630c7` for the
long-proposal passage-boundary correction. Complete canonical material remains
capped at 24 KB, while dense line formatting no longer rejects otherwise
admissible material. The previous address and all records it accepted remain
historical and immutable.

Schema 3.3 stores records by immutable assessment-run ID and supports
schema-specific reads for historical compatibility. Validators independently
retrieve Snapshot material and derive matching decision-bearing structured
facts. External verification is limited to fixed dual Ethereum JSON-RPC Safe
state, bounded Blockscout transaction evidence, and bounded same-space Snapshot
governance-history references. Provider responses are secondary evidence, not
cryptographic proofs. No arbitrary URL adapter exists.

The bounded BIP-930 assessment transaction
`0xf23151d9a28c76d39b0a189dc30cd716a777da7c2b13fcbfbbacf5207bdb5d29` finalized
with successful leader and participating-validator execution, and its immutable
run record was read back by assessment-run ID. This is evidence for that
specific transaction, not a guarantee about every proposal or provider.

### Isolated validation: schema 3.4

The schema 3.4 contract is deployed on Studionet at:

~~~text
0x312310d6D2aFA84bC55A7D6fAc68a623cBDD11c4
~~~

Deployment transaction:

~~~text
0x5e28c52d72839867ae880af5bef40121faad5b1d20f88b45d404e3c8306a58d6
~~~

Schema 3.4 adds a grounded Decision IR and deterministic evidence plan to each
new immutable record while retaining bounded Safe configuration checks. Its
declared consensus method is `deterministic_grounded_candidate_v3_4` .

**Schema 3.4 is not the ordinary production route.** The API Worker continues to
route ordinary ingestion, scheduled processing, reassessments, and job claiming
to schema 3.3. The isolated BIP-933 canary job has been created and its runner
invoked once, but it remains pending because both of Balancer's rolling 24-hour
live-assessment slots were occupied. No canary transaction or accepted schema
3.4 assessment exists yet. Do not infer successful consensus from contract
deployment, job creation, or a successful HTTP response. Recheck durable state
and live budget before any further run; do not recreate or blindly retry the
canary.

The current five-validator schema 3.4 localnet test verifies deployment and
schema/consensus-method metadata. It is not a live canary and does not establish
end-to-end acceptance for every DAO fixture.

## Compatibility and testing

Internal schema labels such as 3.1, 3.2, 3.3, and 3.4 exist to decode immutable
stored records. They are compatibility metadata, not new public product formats.
See [format history](../docs/FORMAT_HISTORY.md) .

Run the deterministic contract tests with:

~~~bash
python -m pytest contracts/tests -q
~~~

GenLayer direct-mode evidence-adapter tests and the schema 3.3 five-validator
integration test are run in CI. The local schema 3.4 deployment smoke is defined
in `genlayer_localnet_tests/test_v3_4_release_localnet.py` . Passing these tests
should be described according to their actual scope; they do not by themselves
prove that every DAO has completed a live schema 3.4 assessment.

Python 3.12, the repository-pinned GenVM version `v0.2.16` , and `genvm-linter`
0.11.0 are required for the documented semantic gate. CI distinguishes the known
upstream GenVM release-asset 404 condition from a genuine semantic validation
failure; static lint must still pass.
