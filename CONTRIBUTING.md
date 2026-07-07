# Contributing

Thanks for improving `agent-search-gateway`.

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
