# QuorumX API Worker

The Cloudflare Worker is the v0.2 API and polling foundation. It is deployed at <https://api.quorumx.dev> and connects to Neon exclusively through the `HYPERDRIVE` binding.

Current endpoints:

- `GET /` returns service identity and foundation version.
- `GET /health` verifies the Worker-to-Hyperdrive-to-Neon path.

The proposal feed and scheduled discovery handlers will be added on top of this foundation. Do not expose the Neon connection string as a Worker variable or browser environment value.

Regenerate binding/runtime types after changing `wrangler.jsonc`:

```bash
npm run cf:types
npm run typecheck:worker
npx wrangler deploy --dry-run
```
