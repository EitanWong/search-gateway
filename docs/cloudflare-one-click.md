# One-click Cloudflare deployment

This repository is designed to be imported and deployed directly on Cloudflare Workers with Cloudflare's Deploy to Workers flow.

## Deploy button

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/EitanWong/search-gateway)
```

The button opens Cloudflare's Workers deploy flow and imports this public GitHub repository.

## What Cloudflare expects

The repository includes the standard Worker files:

- `wrangler.toml` — Worker name, entrypoint, compatibility date, and observability.
- `src/index.js` — Worker entrypoint.
- `package.json` / `package-lock.json` — reproducible npm install.
- `npm run deploy` — deploy command.
- `.dev.vars.example` — secret names surfaced by Cloudflare during one-click deployment.

No build step is required; Wrangler deploys `src/index.js` directly.

## Required secret during deployment

Cloudflare reads `.dev.vars.example` and prompts for Worker secrets during the deploy flow.

Required:

```ini
SEARCH_GATEWAY_TOKEN=
```

Generate a strong random token, for example:

```bash
openssl rand -hex 32
```

Use this value as the bearer token for authenticated requests:

```http
Authorization: Bearer <SEARCH_GATEWAY_TOKEN>
```

Optional provider secrets/vars:

```ini
SEARXNG_URL=https://your-searxng.example.com
BRAVE_SEARCH_API_KEY=
SERPER_API_KEY=
TAVILY_API_KEY=
```

Without paid provider keys, `/search` still has no-key fallback providers (`duckduckgo`, `bing`) where reachable.

## Dashboard import flow

If you do not use the button:

1. Go to Cloudflare Dashboard → Workers & Pages.
2. Create application / Worker from GitHub repository.
3. Select `EitanWong/search-gateway`.
4. Use the existing `wrangler.toml`.
5. Install command: `npm ci`.
6. Deploy command: `npm run deploy`.
7. Set `SEARCH_GATEWAY_TOKEN` as a Worker secret if the import flow did not prompt for it.
8. Visit `/health` to verify the deployment.

## GitHub Actions deployment

This repository includes `.github/workflows/deploy-cloudflare.yml` for manual Cloudflare deployment from GitHub Actions.
It is intentionally `workflow_dispatch`-only so fresh forks and public imports do not fail on every push before Cloudflare secrets are configured.

To enable it, set these GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`SEARCH_GATEWAY_TOKEN` and provider keys must still be configured as Cloudflare Worker secrets.

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
