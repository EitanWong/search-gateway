# Deployment

For zero-config import, see [One-click Cloudflare deployment](cloudflare-one-click.md).

## Prerequisites for manual deployment

- Node.js 22+
- Cloudflare account
- Wrangler authentication

## One-click public default

The Worker can deploy without any secrets or provider keys:

```bash
npm ci
npm run build
npm run deploy
```

By default, `SEARCH_GATEWAY_MODE=public`, so `/search`, `/fetch`, `/batch_fetch`, and `/search_fetch` work immediately after deployment. Search works without paid provider keys through DuckDuckGo/Bing HTML fallbacks where reachable.

## Optional private mode

For long-running personal deployments, configure bearer auth after deployment:

```bash
# In Cloudflare Dashboard → Worker → Settings → Variables:
# set SEARCH_GATEWAY_MODE=private
openssl rand -hex 32
npx wrangler secret put SEARCH_GATEWAY_TOKEN
```

Authenticated requests then require:

```http
Authorization: Bearer <your-token>
```

## Optional provider secrets

```bash
npx wrangler secret put SEARXNG_URL
npx wrangler secret put BRAVE_SEARCH_API_KEY
npx wrangler secret put SERPER_API_KEY
npx wrangler secret put TAVILY_API_KEY
```

## Dry run

```bash
npm run dry-run
```

## Cloudflare configuration

The `deploy-template/` subdirectory is the Cloudflare Dashboard one-click import target. `deploy-template/wrangler.toml` is intentionally minimal so Dashboard import has exactly one deployable Worker config. The repository root is kept for development, tests, docs, and integrations.

Default values:

- Worker name: `search-gateway`
- Entrypoint: `src/index.js`
- Workers.dev enabled: `true`
- Default vars: `SEARCH_GATEWAY_MODE=public`, `BING_MARKET=en-US`, `DUCKDUCKGO_LANGUAGE=en-US`

One-click template URL:

```text
https://github.com/EitanWong/search-gateway/tree/main/deploy-template
```

## GitHub deployment workflow

The repository includes `.github/workflows/deploy-cloudflare.yml` for manual deployment from GitHub Actions.
It is intentionally `workflow_dispatch`-only so fresh forks and public imports do not fail on every push before Cloudflare credentials are configured.

Before running it, configure these GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Worker runtime secrets such as `SEARCH_GATEWAY_TOKEN` and provider keys are optional and configured on the Cloudflare Worker. Use `SEARCH_GATEWAY_TOKEN` when `SEARCH_GATEWAY_MODE=private`.

Do not commit `.dev.vars`, `.env`, `.wrangler/`, `dist/`, or release-loop state.
