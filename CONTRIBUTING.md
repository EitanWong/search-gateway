# Contributing

Thanks for improving `search-gateway`.

## Development

```bash
npm install
npm run check
npm test
npm run test:search-quality
npm run dry-run
```

For the full local CI gate:

```bash
npm run test:ci
```

## Branch policy

`main` is the latest stable version and the source used by Cloudflare one-click deployments. Do not merge experimental work into `main`.

Use scoped branches:

| Branch | Purpose |
|---|---|
| `feat/<short-name>` | New user-visible capability. |
| `fix/<short-name>` | Bug fix or deploy-flow repair. |
| `docs/<short-name>` | Documentation-only change. |
| `chore/<short-name>` | CI, tooling, dependency, or repository maintenance. |
| `hotfix/<short-name>` | Urgent production/deploy breakage fix. |
| `dev` | Optional integration branch for grouped feature work before `main`. |

Default flow:

```text
feat/* or fix/* -> PR -> CI -> main
```

Use `dev` only when multiple feature branches need combined stabilization before being promoted to `main`.

See [Release and update policy](docs/release-management.md) for the full maintainer workflow.

## Search ranking changes

Ranking changes must be small, deterministic, and backed by evidence:

1. Save a baseline before changing weights:
   ```bash
   npm run ranking:diff -- --write-baseline /tmp/search-ranking-baseline.json
   ```
2. Make the smallest ranking change.
3. Compare after the change:
   ```bash
   npm run ranking:diff -- --baseline /tmp/search-ranking-baseline.json --top 3
   ```
4. Run:
   ```bash
   npm run test:search-quality
   ```

Do not add query rewrite, semantic claim consensus, or RAG behavior to the ranking layer without a separate design discussion and benchmark.

## Security

Never commit real `.dev.vars`, API tokens, Cloudflare credentials, provider keys, logs, or local release-loop state.
