# GovernanceRiskOracle

`governance_risk.py` is QuorumX's authoritative GenLayer Intelligent Contract.
Each validator independently retrieves the public proposal and produces a risk
assessment. Consensus requires matching proposal identity, content hash, risk
level, recommendation, and categories, with a five-point score tolerance.

Run deterministic rule tests with:

```sh
python -m unittest contracts/tests/test_governance_risk.py
```

GenLayer direct-mode tests require Python 3.12+ and `genlayer-test`:

```sh
pytest contracts/tests -v
```
