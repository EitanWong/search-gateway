# One-click Cloudflare deployment

This repository is designed for Cloudflare's Deploy to Workers flow with **zero mandatory configuration**.

## Deploy button

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/EitanWong/search-gateway.git)
```

The button opens Cloudflare's Workers deploy flow and imports this public GitHub repository.

## What should be prefilled

Cloudflare reads this repository's standard Worker template files:

- `wrangler.toml` — conservative compatibility config for Cloudflare's Deploy to Workers importer.
- `wrangler.jsonc` — equivalent modern Wrangler config retained for newer tooling.
- `src/index.js` — Worker entrypoint.
- `package.json` / `package-lock.json` — reproducible npm install and Cloudflare template metadata.
- `npm run build` — syntax/build validation.
- `npm run deploy` — deploy command.

Expected Deploy to Workers settings:

| Setting | Expected value |
|---|---|
| Repository | `https://github.com/EitanWong/search-gateway` |
| Worker name | `search-gateway` |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Config file | `wrangler.toml` or `wrangler.jsonc` |
| Required secrets | none |

If the dashboard reports “Unable to fetch repository contents”, retry with the explicit clone URL:

```text
https://github.com/EitanWong/search-gateway.git
```

## Default auth mode

To make one-click deployment real, the Worker defaults to open mode when no `SEARCH_GATEWAY_TOKEN` secret exists:

```json
{
  "auth_mode": "open",
  "setup": {
    "status": "zero_config_open"
  }
}
```

That means `/search`, `/fetch`, `/batch_fetch`, and `/search_fetch` are usable immediately after deployment.

For production or public endpoints, switch to bearer auth by setting a Worker secret:

```bash
openssl rand -hex 32
npx wrangler secret put SEARCH_GATEWAY_TOKEN
```

After that, requests must include:

```http
Authorization: Bearer <your-token>
```

## Optional provider configuration

The gateway works without paid provider keys by using DuckDuckGo/Bing HTML fallbacks where reachable.

Optional provider secrets can be added after deployment:

```bash
npx wrangler secret put SEARXNG_URL
npx wrangler secret put BRAVE_SEARCH_API_KEY
npx wrangler secret put SERPER_API_KEY
npx wrangler secret put TAVILY_API_KEY
```

## Post-deploy health check

Public health check:

```bash
curl https://<your-worker>.<your-subdomain>.workers.dev/health
```

Zero-config search:

```bash
curl -X POST https://<your-worker>.<your-subdomain>.workers.dev/search \
  -H "Content-Type: application/json" \
  -d '{"query":"Cloudflare Workers docs","limit":3,"provider":"auto"}'
```

Bearer-auth search after `SEARCH_GATEWAY_TOKEN` is configured:

```bash
curl -X POST https://<your-worker>.<your-subdomain>.workers.dev/search \
  -H "Authorization: Bearer $SEARCH_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"Cloudflare Workers docs","limit":3,"provider":"auto"}'
```

## Manual dashboard import

If you do not use the button:

1. Go to Cloudflare Dashboard → Workers & Pages.
2. Create application / Worker from GitHub repository.
3. Select `EitanWong/search-gateway`.
4. Use `wrangler.toml` if the dashboard asks for a config file; `wrangler.jsonc` is also present for newer tooling.
5. Install command: `npm ci`.
6. Build command: `npm run build`.
7. Deploy command: `npm run deploy`.
8. Visit `/health` to verify the deployment.

## GitHub Actions deployment

This repository includes `.github/workflows/deploy-cloudflare.yml` for manual Cloudflare deployment from GitHub Actions.
It is intentionally `workflow_dispatch`-only so fresh forks and public imports do not fail on every push before Cloudflare credentials are configured.

To enable it, set these GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Worker runtime secrets such as `SEARCH_GATEWAY_TOKEN` and provider keys are configured on the Cloudflare Worker, not in this repository.
