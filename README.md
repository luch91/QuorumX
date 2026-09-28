# QuorumX

[![CI](https://github.com/luch91/QuorumX/actions/workflows/ci.yml/badge.svg)](https://github.com/luch91/QuorumX/actions/workflows/ci.yml)
[![Demo](https://github.com/luch91/QuorumX/actions/workflows/pages.yml/badge.svg)](https://luch91.github.io/QuorumX/)

QuorumX is a GenLayer-powered governance-risk oracle. GenLayer validators independently retrieve a public governance proposal, agree on normalized source material, assess bounded risk fields, and preserve the consensus-backed result for reviewers.

**[Open the live demo](https://luch91.github.io/QuorumX/)**

## Verified Studionet deployment

| Item | Value |
| --- | --- |
| Network | GenLayer Studionet (chain ID `61999`) |
| Contract | [`0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237`](https://explorer-studio.genlayer.com/address/0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237) |
| Deployment | [`0x2fa96773…3bdd84`](https://explorer-studio.genlayer.com/tx/0x2fa96773ec54ae12cd0cef9f89d7a4122263ce74654a85dc6e657962713bdd84) — finalized, unanimous agreement |
| Live assessment | [`0x55131db5…49268`](https://explorer-studio.genlayer.com/tx/0x55131db5c1b05ac6be9b46ef86511a95f5a880b957c78270337c3b3628149268) — finalized, majority agreement |
| Proposal | [`BIP-929`](https://snapshot.box/#/s:balancer.eth/proposal/0x25ee897681ae8bbae5ae224b14ad6a03ea6920f768d52b2e9aa1a85b7eec0590) |
| Stored verdict | `high` risk · `78/100` · `manual_review` |

The canonical stored key is:

```text
snapshot:balancer.eth:0x25ee897681ae8bbae5ae224b14ad6a03ea6920f768d52b2e9aa1a85b7eec0590
```

Studionet is a hosted development environment and may not provide production-grade persistence. The transaction links above are the public verification trail; the application never presents fixture data as live evidence.

## How it works

```text
Snapshot / HTTPS source
         │
         ▼
TypeScript operator client ── deadline, duplicate, and provenance checks
         │
         ▼
GovernanceRiskOracle ──────── validators fetch + normalize independently
         │
         ▼
GenLayer consensus ────────── strict source equality + bounded assessment
         │
         ▼
Stored result ─────────────── verdict, score, categories, hashes, summary
```

The Intelligent Contract is authoritative. It uses a canonical Snapshot GraphQL GET request, strict equality for normalized source material, and source-grounded non-comparative LLM validation. Only bounded fields and hashes are stored. Public HTTPS URLs and explicitly enabled archived fixtures are also supported; fixture provenance cannot be relabelled as live.

## Run locally

Requirements: Node.js 22+, npm, and Python 3.12+.

```bash
git clone https://github.com/luch91/QuorumX.git
cd QuorumX
npm ci
npm run verify
python -m pip install -r requirements-dev.txt
python -m pytest contracts/tests -q
genvm-lint lint contracts/governance_risk.py --json
```

Studionet and the verified contract are the defaults. Copy `.env.example` only to override configuration or submit a transaction. Never commit a private key.

```bash
npm run quorumx -- sources check --json
npm run quorumx -- proposals list --json
npm run quorumx -- assessment get \
  snapshot:balancer.eth:0x25ee897681ae8bbae5ae224b14ad6a03ea6920f768d52b2e9aa1a85b7eec0590 \
  --json
```

Submitting a new assessment consumes development-network GEN and requires `QUORUMX_GENLAYER_PRIVATE_KEY`:

```bash
npm run quorumx -- assess --source snapshot --proposal <snapshot-id> --json
```

The command checks existing contract state first, preventing duplicate writes. Local transaction evidence is stored in ignored `.quorumx-evidence/transactions.jsonl`.

## Trust and safety boundaries

- Proposal content is untrusted prompt data and never becomes an instruction.
- Snapshot identity and normalized content are checked before assessment storage.
- Accepted consensus without readable stored state is reported as undetermined.
- Public URL sources require HTTPS and reject local or private network targets.
- QuorumX never modifies, flags, or writes back to a Snapshot proposal.
- Reads do not intentionally spend GEN; deployments and assessments do.
- Private keys, generated evidence, local plans, and decision logs are ignored.

## GenVM semantic-linter status

`genvm-lint lint` passes all three static safety checks. The separate SDK-backed `genvm-lint check` phase currently returns `E101` because `genvm-linter 0.11.0` requests an upstream GenVM release asset that responds with HTTP 404. CI tolerates only that exact known failure; every other semantic-linter error fails the build. Live Studionet deployment and execution provide additional runtime evidence while [upstream issue #27](https://github.com/genlayerlabs/genvm-linter/issues/27) tracks the packaging mismatch.

## Development

CI runs the complete Jest suite, TypeScript type-check/builds, Python contract tests, GenVM static lint, dependency audit, and full-history secret scanning. GitHub Pages deploys only the static `index.html`; it receives no wallet key and cannot submit transactions.

The former Cassandra/Sentinel Telegraph path remains available only through the explicit `npm run legacy:telegraph` command during the hybrid migration. DWCS is a separate optional scoring module and is not part of the authoritative QuorumX consensus path.

## License

No license has been granted yet. Source is publicly viewable, but conventional copyright restrictions apply until the project owner selects a license.
