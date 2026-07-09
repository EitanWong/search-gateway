# One-click Cloudflare deployment

This repository is designed for Cloudflare's Deploy to Workers flow with **zero mandatory deploy-time configuration**. Runtime search/fetch endpoints default to public mode for true one-click use. For long-running personal deployments, switch to private mode with `SEARCH_GATEWAY_MODE=private` and a `SEARCH_GATEWAY_TOKEN` secret.

## Deploy button

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/EitanWong/search-gateway/tree/main/deploy-template)
```

The button opens Cloudflare's Workers deploy flow and imports this public GitHub repository.

## What should be prefilled

Cloudflare imports the `deploy-template/` subdirectory. That directory intentionally contains the deployable Worker surface:

- `wrangler.toml` — minimal TOML Worker config with Worker name, entrypoint, conservative compatibility date, and default vars.
- `src/index.js` — Worker entrypoint.
- `package.json` / `package-lock.json` — reproducible npm install.
- `npm run build` — minimal syntax/build validation.
- `npm run deploy` — deploy command.

Expected Deploy to Workers settings:

| Setting | Expected value |
|---|---|
| Repository | `https://github.com/EitanWong/search-gateway/tree/main/deploy-template` |
| Worker name | `search-gateway` |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Config file | `wrangler.toml` |
| Required deploy-time secrets | none; default public mode works immediately. Configure `SEARCH_GATEWAY_MODE=private` and `SEARCH_GATEWAY_TOKEN` later for private use. |

If the dashboard asks for the repository URL manually, use the subdirectory URL:

```text
https://github.com/EitanWong/search-gateway/tree/main/deploy-template
```

## Default auth mode

The Worker deploys in public mode by default so the one-click flow is immediately usable:

```json
{
  "auth_mode": "public",
  "setup": {
    "status": "public_mode"
  }
}
```

Public mode means anyone with the Worker URL can call `/search`, `/fetch`, `/batch_fetch`, and `/search_fetch`. This is convenient for demos and quick testing.

For long-running personal use, switch to private mode after deployment:

```bash
# In Cloudflare Dashboard → Worker → Settings → Variables:
# set SEARCH_GATEWAY_MODE=private
openssl rand -hex 32
npx wrangler secret put SEARCH_GATEWAY_TOKEN
```

Private-mode requests must include:

```http
Authorization: Bearer ***
```

## Optional provider configuration

The gateway works without paid provider keys by using DuckDuckGo/Bing HTML fallbacks where reachable.

Optional provider secrets can be added after deployment:

```bash
npx wrangler secret put SEARXNG_URL
npx wrangler secret put ZHIPU_API_KEY
npx wrangler secret put BOCHA_API_KEY
npx wrangler secret put COHERE_API_KEY
npx wrangler secret put JINA_API_KEY
npx wrangler secret put VOYAGE_API_KEY
npx wrangler secret put SILICONFLOW_API_KEY
npx wrangler secret put BRAVE_SEARCH_API_KEY
npx wrangler secret put SERPER_API_KEY
npx wrangler secret put TAVILY_API_KEY
```

## Post-deploy health check

Public health check:

```bash
curl https://<your-worker>.<your-subdomain>.workers.dev/health
```

Public-mode search:

```bash
curl -X POST https://<your-worker>.<your-subdomain>.workers.dev/search \
  -H "Content-Type: application/json" \
  -d '{"query":"Cloudflare Workers docs","limit":3,"provider":"auto"}'
```

## Manual dashboard import

If you do not use the button:

1. Go to Cloudflare Dashboard → Workers & Pages.
2. Create application / Worker from GitHub repository.
3. Enter `https://github.com/EitanWong/search-gateway/tree/main/deploy-template`.
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

Use the `deploy-template/` subdirectory URL for Deploy to Cloudflare. Although `create-cloudflare` can work with remote templates, Cloudflare Dashboard import paths are more reliable when the Deploy Button points directly at the deployable Worker directory. The `deploy-template/` directory contains the deployable Worker config (`wrangler.toml`) and package scripts. The repository root is kept for development, tests, docs, and integrations.
