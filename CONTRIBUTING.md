# Contributing to QuorumX

Use a feature branch and open a pull request against `main`. Never commit wallet keys, generated transaction evidence, local `.env` files, internal plans, or decision logs.

Before opening a pull request, run:

```bash
npm ci
npm run verify
npm audit --audit-level=high
python -m pip install -r requirements-dev.txt
python -m pytest contracts/tests -q
genvm-lint lint contracts/governance_risk.py --json
```

Contract changes must explain their effect on source retrieval, normalization, consensus, storage, and transaction cost. Add deterministic tests for every new rule. Do not weaken an invariant merely to make an assessment pass.

The SDK-backed `genvm-lint check` currently has a known upstream artifact-download 404. CI permits only that exact `E101` failure; new validation failures must be fixed.
