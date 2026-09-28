# GovernanceRiskOracle

`governance_risk.py` is QuorumX's authoritative GenLayer Intelligent Contract.
Validators independently retrieve the public proposal. Snapshot sources use a
canonical GraphQL GET URL and retain a `snapshot:<space>:<proposal-id>` key.
Strict equality establishes the normalized source material; source-grounded
non-comparative validation then checks the bounded risk assessment before state
is stored. Public URL and explicitly labelled fixture sources remain supported.

Verified Studionet deployment:

```text
0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237
```

Run deterministic rule tests with:

```sh
python -m unittest contracts/tests/test_governance_risk.py
```

GenLayer direct-mode tests require Python 3.12+ and `genlayer-test`:

```sh
pytest contracts/tests -v
```
