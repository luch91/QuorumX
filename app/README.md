# QuorumX operator client

The operator client discovers governance proposals, submits canonical source references to GenLayer, follows consensus, reads stored assessments, and records redacted local evidence.

Studionet defaults to `GovernanceRiskOracle` at `0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237`. Set `QUORUMX_GENLAYER_PRIVATE_KEY` only for a write. Keep keys outside repository files and use a dedicated, limited-balance development account.

```bash
npm run build
npm run quorumx -- sources check --json
npm run quorumx -- proposals list --json
npm run quorumx -- assessment get snapshot:balancer.eth:<proposal-id> --json
npm run quorumx -- assess --source snapshot --proposal <proposal-id> --json
```

Snapshot assessment references accept a bare proposal ID, `space:id`,
`snapshot:space:id`, or a canonical `snapshot.org`/`snapshot.box` proposal
URL. The command performs a direct proposal lookup, including archived or
older records outside the first active page. Unsupported source kinds fail
before assessment work. Read-only commands need no private key; the CLI
requires a key only immediately before a new submission.

Snapshot discovery uses GraphQL GET. The assessment workflow checks stored state before submission, writes `submitted` evidence before waiting, and can resume from a recorded transaction ID without resubmitting. Accepted consensus is surfaced as accepted only when the matching assessment is readable from contract state.

Archived fixtures require `QUORUMX_ALLOW_FIXTURES=true` and remain labelled `fixture`. They are never enabled implicitly in production paths.
