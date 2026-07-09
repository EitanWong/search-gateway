# Deployment

For zero-config import, see [One-click Cloudflare deployment](cloudflare-one-click.md).

## Prerequisites for manual deployment

- Node.js 22+
- Cloudflare account
- Wrangler authentication

## Zero-config default

The Worker can deploy without any secrets or provider keys:

```bash
npm ci
npm run build
npm run deploy
```

Without `SEARCH_GATEWAY_TOKEN`, the Worker stays secure-by-default: `/search`, `/fetch`, `/batch_fetch`, and `/search_fetch` return `503` unless `SEARCH_GATEWAY_ALLOW_OPEN=true` is explicitly configured for local/temporary development. Search itself still works without paid provider keys through DuckDuckGo/Bing HTML fallbacks where reachable.

## Optional secure mode

For production or public endpoints, configure bearer auth after deployment:

```bash
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
- Default vars: `BING_MARKET=en-US`, `DUCKDUCKGO_LANGUAGE=en-US`

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

Worker runtime secrets such as `SEARCH_GATEWAY_TOKEN` and provider keys must be configured on the Cloudflare Worker.

Do not commit `.dev.vars`, `.env`, `.wrangler/`, `dist/`, or release-loop state.
