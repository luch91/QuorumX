# QuorumX

QuorumX is a GenLayer-powered governance-risk oracle. It selects public governance proposals, lets GenLayer validators independently retrieve the source, and stores a consensus-backed risk assessment for operator review.

The current verified deployment is on GenLayer Studionet:

- Contract: `0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237`
- Native Snapshot deployment transaction: `0x2fa96773ec54ae12cd0cef9f89d7a4122263ce74654a85dc6e657962713bdd84`
- Live BIP-929 assessment transaction: `0x55131db5c1b05ac6be9b46ef86511a95f5a880b957c78270337c3b3628149268`
- Canonical proposal key: `snapshot:balancer.eth:0x25ee897681ae8bbae5ae224b14ad6a03ea6920f768d52b2e9aa1a85b7eec0590`

## Architecture

The TypeScript operator client handles source discovery, deadline and duplicate checks, transaction recovery, and redacted evidence. `GovernanceRiskOracle` is authoritative: it retrieves Snapshot data through a canonical GraphQL GET request, reaches strict consensus on the normalized source, uses source-grounded non-comparative LLM validation for the assessment, and stores only bounded fields and hashes.

Supported sources are Snapshot, public HTTPS URLs, and explicitly enabled archived fixtures. Fixtures always retain fixture provenance. Telegraph remains available only through the explicit legacy command; QuorumX never silently falls back to paid Telegraph requests.

## Setup

```bash
npm ci
npm run build
```

Studionet and the verified contract are the application defaults. Copy `.env.example` only when overriding configuration or submitting a new transaction. Never commit a private key. A write requires `QUORUMX_GENLAYER_PRIVATE_KEY`; reads do not intentionally spend GEN.

Useful commands:

```bash
npm run quorumx -- sources check --json
npm run quorumx -- proposals list --json
npm run quorumx -- assessment get <proposal-key> --json
npm run quorumx -- assess --source snapshot --proposal <snapshot-id> --json
npm run validate:quorumx
```

`assess` first checks for existing contract state, so an already assessed proposal does not create another transaction. Local transaction evidence is written to `.quorumx-evidence/transactions.jsonl`, which is ignored by Git.

## Costs and trust boundaries

- Deployments and assessments consume development-network GEN; read-only checks do not intentionally submit transactions.
- Proposal text is untrusted prompt data.
- Snapshot identity and normalized content are checked before storage.
- Accepted consensus without readable stored state is reported as undetermined, never accepted.
- Public URL inputs must be HTTPS and cannot target local or private addresses.
- No Snapshot proposal is modified, flagged, or written back.
- Fixture evidence is never represented as live evidence.

## Verification

```bash
npm test -- --runInBand
npm run typecheck
npm run build
py -3.12 -m pytest contracts/tests -q
```

DWCS remains a separate optional scoring module. The former Sentinel Telegraph workflow is retained under `npm run legacy:telegraph` during the hybrid migration.
