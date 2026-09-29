# QuorumX API Worker

The Cloudflare Worker is the v0.3 multi-DAO governance indexer and public API. It is deployed at <https://api.quorumx.dev>, runs every five minutes, and connects to Neon exclusively through the `HYPERDRIVE` binding.

Current endpoints:

- `GET /` returns service identity and version.
- `GET /health` verifies the Worker-to-Hyperdrive-to-Neon path and reports indexer counts.
- `GET /v1/sources` returns DAO metadata, ecosystems, assessment budgets, and polling health.
- `GET /v1/proposals` returns cursor-paginated proposals; filter with `status`, `space`, `source`, `dao`, `author`, `assessment`, and `ecosystem`.
- `GET /v1/proposals/<canonical-id>` returns a proposal, latest revision, transaction, and assessment.
- `GET /v1/assessments/<proposal-key>` returns an accepted assessment and GenLayer provenance.

`POST /internal/run` is an operations-only manual trigger protected by `QUORUMX_ADMIN_TOKEN`. The normal path is the cron: discover recent proposals from the allowlisted Balancer, SafeDAO, Arbitrum DAO, and ENS DAO Snapshot spaces; persist content-addressed revisions; apply per-source rolling 24-hour assessment budgets; atomically claim one eligible job; submit or recover its GenLayer transaction; and index readable matching contract state. Do not expose the admin token, signing key, or Neon connection string as a Worker variable or browser value.

Required secrets are `QUORUMX_ADMIN_TOKEN` and `QUORUMX_GENLAYER_PRIVATE_KEY`. The funded signing account should carry only enough development GEN for bounded indexer activity.

Regenerate binding/runtime types after changing `wrangler.jsonc`:

```bash
npm run cf:types
npm run typecheck:worker
npx wrangler deploy --dry-run
```
