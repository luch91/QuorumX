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
GENVM_VERSION=v0.2.16 genvm-lint check contracts/governance_due_diligence_v3_3.py --json
```

Contract changes must explain their effect on source retrieval, normalization, consensus, storage, and transaction cost. Add deterministic tests for every new rule. Do not weaken an invariant merely to make an assessment pass.

Use Python 3.12 with the repository-pinned `genvm-linter` and `GENVM_VERSION=v0.2.16` for SDK-backed checks. The CI contract job pins and caches that GenVM bundle and fails on any semantic-validation error.
