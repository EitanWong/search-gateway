# One-click Cloudflare deployment

This repository is designed to be imported and deployed directly on Cloudflare Workers.

## Deploy button

After this project is published on GitHub, replace `EitanWong/search-gateway` with the real repository path:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/EitanWong/search-gateway)
```

The button opens Cloudflare's Workers deploy flow and imports the GitHub repository.

## What Cloudflare expects

The repository includes the standard Worker files:

- `wrangler.toml` — Worker name, entrypoint, compatibility date, observability.
- `src/index.js` — Worker entrypoint.
- `package.json` / `package-lock.json` — reproducible npm install.
- `npm run deploy` — deploy command.
- `npm run dry-run` — deployment validation.

No build step is required; Wrangler deploys `src/index.js` directly.

## Required secret after import

Set this secret in Cloudflare before using authenticated endpoints:

```bash
SEARCH_GATEWAY_TOKEN
```

Optional provider secrets:

```bash
SEARXNG_URL
BRAVE_SEARCH_API_KEY
SERPER_API_KEY
TAVILY_API_KEY
```

Without paid provider keys, `/search` still has no-key fallback providers (`duckduckgo`, `bing`) where reachable.

## Dashboard import flow

If you do not use the button:

1. Go to Cloudflare Dashboard → Workers & Pages.
2. Create application / Worker from GitHub repository.
3. Select this repository.
4. Use the existing `wrangler.toml`.
5. Install command: `npm ci`.
6. Deploy command: `npm run deploy`.
7. Set `SEARCH_GATEWAY_TOKEN` as a Worker secret.
8. Visit `/health` to verify the deployment.

## GitHub Actions deployment

This repository includes `.github/workflows/deploy-cloudflare.yml` for automatic Cloudflare deployment.

To enable it, set these GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The workflow runs on manual dispatch and automatically deploys on push to `main` or `master` after you configure GitHub repository secrets.

## Post-deploy health check

Public health check:

```bash
curl https://<your-worker>.<your-subdomain>.workers.dev/health
```

Authenticated health check:

```bash
curl -H "Authorization: Bearer $SEARCH_GATEWAY_TOKEN" \
  https://<your-worker>.<your-subdomain>.workers.dev/health
```

Authenticated search:

```bash
curl -X POST https://<your-worker>.<your-subdomain>.workers.dev/search \
  -H "Authorization: Bearer $SEARCH_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"Cloudflare Workers docs","limit":3,"provider":"auto"}'
```
