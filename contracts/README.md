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

Run deterministic rule tests with:

```sh
python -m unittest contracts/tests/test_governance_risk.py
```

GenLayer direct-mode tests require Python 3.12+ and `genlayer-test`:

```sh
pytest contracts/tests -v
```
