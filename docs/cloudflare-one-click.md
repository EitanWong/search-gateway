# One-click Cloudflare deployment

This repository is designed for Cloudflare's Deploy to Workers flow with **zero mandatory configuration**.

## Deploy button

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/EitanWong/search-gateway)
```

The button opens Cloudflare's Workers deploy flow and imports this public GitHub repository.

## What should be prefilled

Cloudflare imports the repository root. The root intentionally contains the deployable Worker surface:

- `wrangler.toml` — minimal Worker config with Worker name, entrypoint, conservative compatibility date, and default vars.
- `src/index.js` — Worker entrypoint.
- `package.json` / `package-lock.json` — reproducible npm install.
- `npm run build` — minimal syntax/build validation.
- `npm run deploy` — deploy command.

Expected Deploy to Workers settings:

| Setting | Expected value |
|---|---|
| Repository | `https://github.com/EitanWong/search-gateway` |
| Worker name | `search-gateway` |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Config file | `wrangler.toml` |
| Required secrets | none |

If the dashboard asks for the repository URL manually, use the repository root URL:

```text
https://github.com/EitanWong/search-gateway
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
3. Enter `https://github.com/EitanWong/search-gateway`.
4. Use `wrangler.toml` if the dashboard asks for a config file.
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

## Dashboard importer compatibility note

Use the repository root URL for Deploy to Cloudflare. Although `create-cloudflare` can work with remote templates, Cloudflare Dashboard import paths are more reliable when the Deploy Button points at the repository root. The root contains the deployable Worker config (`wrangler.toml`), package scripts, and Cloudflare template metadata. The `deploy-template/` directory is kept only as a minimal local/CI compatibility fixture, not as the public Deploy Button target.
